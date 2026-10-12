#!/usr/bin/env python3
"""Выгрузка проекта из дата-рума (№28): папка проекта → ZIP с манифестом и паспортом проекта.

    python3 tools/export-project.py <slug> [--out <файл.zip>] [--bez-arhiva]

Внутри ZIP: все файлы папки проекта (кроме скрытых и `__pycache__`; с --bez-arhiva — и кроме ARHIV-*),
MANIFEST.json (каждый файл: путь, размер, sha256; сводка происхождения по сайдкарам *.json схемы
neyra-vision/provenance/1: движки, стоимость, сухие/боевые; версия канона; счётчики) и PASPORT-PROEKTA.md —
человекочитаемый паспорт: что это за проект, что в нём есть, чем и за сколько сделано, кто принимал.
Ничего не удаляет и не меняет в папке. Проект можно отдать/продать одним файлом (RAZBOR/06 §6).
"""
from __future__ import annotations
import argparse, datetime, hashlib, json, pathlib, re, sys, zipfile
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kanon

HOME = pathlib.Path.home()
PROEKTY = HOME / "Documents/CODE/KINO-STANCIYA/PROEKTY"

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""): h.update(ch)
    return h.hexdigest()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("slug"); ap.add_argument("--out"); ap.add_argument("--bez-arhiva", action="store_true")
    a = ap.parse_args(); proj = PROEKTY / a.slug
    if not proj.exists(): sys.exit(f"нет папки {proj}")
    cfg = json.loads((proj / "stranica.json").read_text()) if (proj / "stranica.json").exists() else {}
    title = cfg.get("nazvanie", a.slug)
    stamp = datetime.datetime.now()
    out = pathlib.Path(a.out) if a.out else proj.parent / f"{a.slug}-export-{stamp:%Y%m%d-%H%M}.zip"
    files, prov, skipped = [], [], 0
    for p in sorted(proj.rglob("*")):
        rel = p.relative_to(proj)
        if any(part.startswith(".") or part == "__pycache__" for part in rel.parts): continue
        if a.bez_arhiva and rel.parts[0].startswith("ARHIV"): skipped += 1; continue
        if p.is_file():
            files.append({"path": str(rel), "bytes": p.stat().st_size, "sha256": sha(p)})
            if p.suffix == ".json" and "provenance" in p.read_text(encoding="utf-8", errors="ignore")[:200]:
                try:
                    d = json.loads(p.read_text(encoding="utf-8"))
                    if d.get("schema", "").startswith("neyra-vision/provenance"): prov.append(d)
                except Exception: pass
    K = kanon.read_kanon(proj)
    engines = {}
    for d in prov:
        e = (d.get("engine") or {}).get("name", "?"); engines.setdefault(e, {"jobs": 0, "dry": 0, "usd": 0.0})
        engines[e]["jobs"] += 1; engines[e]["dry"] += 1 if d.get("dry_run") else 0; engines[e]["usd"] += float(d.get("cost_usd", 0) or 0)
    kadry = [f for f in files if re.match(r"03-vizual/(kadry|raskadrovka/kadry)/[^/]+\.md$", f["path"])]
    drafts = [f for f in files if f["path"].endswith(".fountain")]
    passports = [f for f in files if f["path"].endswith("KARTOCHKA.md")]
    manifest = {"schema": "neyra-vision/export/1", "project": a.slug, "title": title, "exported_at": stamp.astimezone().isoformat(timespec="seconds"),
                "exported_by": "tools/export-project.py", "files": len(files), "bytes": sum(f["bytes"] for f in files),
                "kanon_version": K["version"] if K else "", "counts": {"drafts": len(drafts), "passports": len(passports), "kadry": len(kadry), "provenance": len(prov)},
                "engines": {k: {"jobs": v["jobs"], "dry_run": v["dry"], "usd": round(v["usd"], 3)} for k, v in engines.items()},
                "total_usd": round(sum(v["usd"] for v in engines.values()), 3), "skipped_archive_dirs": skipped, "file_list": files}
    zh = (proj / "ZHURNAL.md").read_text(encoding="utf-8") if (proj / "ZHURNAL.md").exists() else ""
    last = [l for l in zh.splitlines() if l.startswith("## ")][-5:]
    pasport = [f"# Паспорт проекта · {title}", "", f"*Выгружено {stamp:%d.%m.%Y %H:%M}. Файлов {len(files)} ({manifest['bytes'] // 1024} КБ). Публично — Neyra Vision, технология NEYRA.*", "",
               "## Что это", f"- Тип: {cfg.get('tip', '—')} · статус: {cfg.get('status', '—')} · {' · '.join(cfg.get('meta', []))}",
               f"- Контакт: {cfg.get('kontakt', {}).get('imya', '—')} · {cfg.get('kontakt', {}).get('pochta', '')}", "",
               "## Что внутри", f"- Драфтов сценария: {len(drafts)} ({', '.join(f['path'] for f in drafts) or '—'})",
               f"- Паспортов героев и локаций: {len(passports)}", f"- Карточек кадров: {len(kadry)}", f"- Канон проекта: {'версия ' + K['version'] if K else 'нет'}",
               f"- Записей происхождения: {len(prov)}", "",
               "## Чем и за сколько сделано (по записям происхождения)"]
    pasport += [f"- {k}: заданий {v['jobs']}, из них сухих {v['dry_run']}, {v['usd']} $" for k, v in manifest["engines"].items()] or ["- генераций ещё не было"]
    pasport += [f"- Итого: {manifest['total_usd']} $", "", "## Последние записи журнала"] + [f"- {l[3:]}" for l in last] + ["", "## Как читать", "- `MANIFEST.json` — полный список файлов с хэшами; сверка целостности: пересчитать sha256.", "- `03-vizual/KANON.md` — стиль и замки; `03-vizual/REESTR-KADROV.md` — все кадры и их состояние.", "- Сайдкар `<файл>.json` рядом с каждым сгенерированным файлом — кто, когда, чем, промпт, цена."]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files: z.write(proj / f["path"], f"{a.slug}/{f['path']}")
        z.writestr(f"{a.slug}/MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        z.writestr(f"{a.slug}/PASPORT-PROEKTA.md", "\n".join(pasport) + "\n")
    print(f"ok {out} · {out.stat().st_size // 1024} КБ · файлов {len(files)} · кадров {len(kadry)} · происхождений {len(prov)} · {manifest['total_usd']} $")

if __name__ == "__main__":
    main()
