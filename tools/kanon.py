#!/usr/bin/env python3
"""Канон проекта (continuity ledger) и реестр кадров — чтобы машина помнила каждый кадр и рисовала всё в одном стиле.

    python3 tools/kanon.py init <slug>        собрать 03-vizual/KANON.md из паспортов и stranica.json (существующий не трогает)
    python3 tools/kanon.py proverka <slug>    проверить канон и кадры: пустые замки, возраст числом, устаревшие кадры
    python3 tools/kanon.py reestr <slug>      реестр кадров 03-vizual/REESTR-KADROV.md/.json из карточек и сайдкаров

Механика (RAZBOR/09): канон = один файл, который дословно вклеивается в каждый промпт, — стиль и палитра 60:30:10,
список запретов, замок каждого героя (identity block, табу-детали, референсы с ролями) и локации. У канона есть
версия (хэш текста); каждая карточка кадра и каждый сайдкар происхождения хранят версию канона, с которой сделаны.
Изменился канон — реестр показывает, какие кадры устарели. Правки режиссёра копятся в разделе «Правила из замечаний»
и тоже попадают в промпты («ИИ учится»).

Сборка промпта: sobrat(kanon, stage, shot) — stage = karandash (Z-Image + LoRA), image (Nano Banana 2, шаблон
мастер-промпта), video (Seedance 2.5, стиль-префикс + Characters + Scene + CUT). Замок героя — одними и теми же словами
во всех трёх; описание действия отделено от описания внешности (identity block ≠ motion block).
"""
from __future__ import annotations
import datetime, hashlib, json, pathlib, re, sys

HOME = pathlib.Path.home()
PROEKTY = HOME / "Documents/CODE/KINO-STANCIYA/PROEKTY"
AGE_RE = re.compile(r"\b\d{1,2}[- ]?(year|лет|года|год)\b", re.I)
TIME_EN = {"ДЕНЬ": "day", "НОЧЬ": "night", "УТРО": "morning", "ВЕЧЕР": "evening", "РАССВЕТ": "dawn", "ЗАКАТ": "sunset", "СУМЕРКИ": "dusk", "ПОЗЖЕ": "later the same day", "ПРОДОЛЖЕНИЕ": "continuous", "ТОТ ЖЕ МОМЕНТ": "same moment"}

def time_en(t):
    t = (t or "").strip().upper()
    for k, v in TIME_EN.items():
        if k in t: return v
    return t.lower() or "day"

def _v(x):
    """Значение поля канона без заглушек: «[решение…]», «[заполнить…]» = пусто; метка [ред.] снимается."""
    if not x: return ""
    x = re.sub(r"\[ред\.\]", "", x).strip()
    if "[решение" in x or "[заполнить" in x or x.startswith("(") : return ""
    return x

# ---------- чтение ----------
def read_kanon(proj):
    p = proj / "03-vizual" / "KANON.md"
    if not p.exists(): return None
    t = p.read_text(encoding="utf-8")
    k = {"path": p, "text": t, "version": hashlib.sha256(t.encode()).hexdigest()[:10], "style": {}, "forbid": [], "heroes": {}, "locs": {}, "rules": []}
    sec, cur = None, None
    for ln in t.splitlines():
        if ln.startswith("## "):
            h = ln[3:].strip().lower(); cur = None
            sec = "style" if h.startswith("стиль") else "forbid" if h.startswith("запрет") else "heroes" if h.startswith("геро") else "locs" if h.startswith("локац") else "rules" if h.startswith("правил") else None
            continue
        if ln.startswith("### ") and sec in ("heroes", "locs"):
            m = re.match(r"###\s+(@\S+)\s*·\s*(.+)", ln)
            if not m: continue
            cur = {"tag": m.group(1), "imya": m.group(2).strip(), "identity": "", "taboo": [], "refs": [], "height": "", "state": "v1", "lock": ""}
            k[sec][m.group(1)] = cur; continue
        s = ln.strip()
        if not s: continue
        if sec == "style" and ":" in s:
            a, b = s.split(":", 1); k["style"][a.strip().lower()] = _v(b.strip()); k.setdefault("raw_style", {})[a.strip().lower()] = b.strip()
        elif sec == "forbid" and s.startswith("-") and _v(s.lstrip("- ").strip()):
            k["forbid"].append(_v(s.lstrip("- ").strip()))
        elif sec == "rules" and s.startswith("-") and not s.lstrip("- ").startswith("("):
            k["rules"].append(s.lstrip("- ").strip())
        elif cur is not None and ":" in s:
            a, b = s.split(":", 1); a = a.strip().lower(); b = b.strip()
            if a == "identity": cur["identity"] = _v(b)
            elif a == "taboo": cur["taboo"] = [x.strip() for x in _v(b).split(";") if x.strip()]
            elif a == "refs": cur["refs"] = [x.strip() for x in b.split(";") if x.strip() and not x.strip().startswith("[нет")]
            elif a in ("height", "state", "lock"): cur[a] = _v(b)
    return k

def hero_by_name(k, name):
    n = name.upper()
    for h in k["heroes"].values():
        imya = h["imya"].upper()
        if n == imya or n.startswith(imya) or imya.startswith(n) or n in h.get("aliases", ()): return h
    return None

def loc_by_name(k, loc_name):
    first = re.split(r"\s+—\s+", loc_name)[0].upper()
    for L in k["locs"].values():
        imya = L["imya"].upper()
        if first == imya or first.startswith(imya) or imya in first: return L
    return None

# ---------- сборка промптов ----------
def _style_lines(k):
    st = k["style"]; o = []
    if st.get("medium"): o.append(f"Style: {st['medium']}")
    if st.get("palette"): o.append(f"Color ratio 60:30:10 — {st['palette']}")
    if st.get("light"): o.append(f"Lighting logic: {st['light']}")
    if st.get("materials"): o.append(f"Materials: {st['materials']}")
    if st.get("lens"): o.append(f"Optics: {st['lens']}")
    return o

def _forbid_line(k):
    return ("Forbidden: " + "; ".join(k["forbid"]) + ".") if k["forbid"] else ""

def _char_lines(k, names, with_refs=True):
    o = []
    for n in names:
        h = hero_by_name(k, n)
        if not h: o.append(f"{n.title()} (no lock yet — identity text missing)"); continue
        line = f"{h['tag']} is {h['imya']}: {h['identity'] or '[identity missing]'}"
        if h["taboo"]: line += ". Never changes: " + "; ".join(h["taboo"])
        if h["height"] and len(names) > 1: line += f". Height {h['height']}"
        if with_refs and h["refs"]: line += f". Matches reference {h['refs'][0].split(' ')[0]} 100%"
        o.append(line + ".")
    return o

def sobrat(k, stage, shot, action_en="", time_en="day"):
    time_en = globals()["time_en"](time_en) if time_en and not time_en.isascii() else (time_en or "day")
    """shot: {'size_en','move_en','chars':[имена],'loc_name','vo'}; возвращает (prompt, refs[{path,role}])"""
    loc = loc_by_name(k, shot.get("loc_name", ""))
    refs = []
    for n in shot.get("chars", []):
        h = hero_by_name(k, n)
        if h:
            for r in h["refs"]: refs.append({"path": r.split(" ")[0], "role": "identity", "tag": h["tag"]})
    if loc:
        for r in loc["refs"]: refs.append({"path": r.split(" ")[0], "role": "environment", "tag": loc["tag"]})
    place = (f"{loc['tag']} is {loc['imya']}: {loc['identity']}" + (f". {loc['lock']}" if loc["lock"] else "")) if loc else f"Location: {shot.get('loc_name','').title()} (no lock yet)"
    act = action_en or "{ACTION_EN}"
    rules = [r for r in k["rules"] if any(x.lower() in r.lower() for x in shot.get("chars", []) + [shot.get("loc_name", "")]) or r.lower().startswith("все")]
    if stage == "karandash":
        parts = ["5t0ry style digital sketch, pencil on paper, single frame, 16:9", shot.get("size_en", "medium shot"), shot.get("move_en", "static camera"),
                 f"Setting — {place}, {time_en}"] + _char_lines(k, shot.get("chars", []), with_refs=False) + [f"Action: {act}"]
        if rules: parts.append("Director notes: " + " ".join(rules))
        parts.append("Loose pencil lines, grey hatching, white paper, no colour, no text")
        return ". ".join(p.rstrip(".") for p in parts) + ".", refs
    if stage == "image":
        roles = "\n".join(f"REF {i+1} — {r['tag']} {'canonical identity, match 100%' if r['role']=='identity' else 'environment and lighting only; the set contains only what this reference shows'}" for i, r in enumerate(refs)) or "(no references yet — identity carried by text)"
        o = [f"Create a NEW film frame, 16:9, 2K, {k['style'].get('medium','cinematic frame')}.", "", "REFERENCE ROLES:", roles, "",
             "GOAL:", f"Shot {shot.get('id','')} — {act}", "",
             "SUBJECTS AND IDENTITY:"] + (_char_lines(k, shot.get("chars", [])) or ["(no characters in frame)"]) + ["",
             "SCENE:", f"{place}. Time: {time_en}.", "",
             "COMPOSITION:", f"{shot.get('size_en','medium shot')}, {shot.get('move_en','static camera')}; " + k["style"].get("lens", "") , "",
             "LIGHTING:", k["style"].get("light", "motivated natural light, faces readable"), "",
             "COLOUR AND TEXTURE:", (f"Color ratio 60:30:10 — {k['style']['palette']}. " if k["style"].get("palette") else "") + k["style"].get("materials", ""), "",
             "PROTECTED DETAILS — PRESERVE EXACTLY:", "; ".join(t for n in shot.get("chars", []) for t in (hero_by_name(k, n) or {"taboo": []})["taboo"]) or "character locks above", "",
             "FORBIDDEN:", "; ".join(k["forbid"]) or "—"]
        if rules: o += ["", "DIRECTOR NOTES (from accepted takes):", " ".join(rules)]
        o += ["", "TEXT IN IMAGE: none.", "FINAL QUALITY: crisp edges, no watermark, no text, frame for animatic."]
        return "\n".join(o), refs
    if stage == "video":
        prefix = "\n".join(_style_lines(k) + ["Continuity: characters, props, environment identical across every cut. No identity drift.", "Physics: gravity and inertia respected, correct contact shadows, no floating props.", "Audio: location sound only. No music. No subtitles.", _forbid_line(k)]).strip()
        chars = "\n".join(_char_lines(k, shot.get("chars", []))) or "(no characters)"
        o = [prefix, "", "Characters:", chars, "", "Scene:", f"{place}. {time_en}.", "",
             f"CUT 1 — {shot.get('size_en','medium shot')}, {shot.get('move_en','static camera')}:", act]
        if shot.get("vo"): o.append("Voice-over is added in the edit; characters do not speak in this clip.")
        if rules: o += ["", "Director notes: " + " ".join(rules)]
        o += ["", "Cuts only at the specified points, the camera does not cut on its own."]
        return "\n".join(o), refs
    raise ValueError(stage)

# ---------- init ----------
def _cards(proj, kind):
    out = []
    for f in sorted((proj / "03-vizual" / kind).glob("*/KARTOCHKA.md")):
        t = f.read_text(encoding="utf-8"); meta = {}
        if t.startswith("---"):
            for ln in t.split("---", 2)[1].splitlines():
                if ":" in ln: a, b = ln.split(":", 1); meta[a.strip()] = b.strip().strip('"')
        m = re.search(r"\*\*Промпт[^*]*\*\*:?\s*`([^`]+)`", t)
        ident = ""
        if m:
            s = re.sub(r"^(Portrait of|Master plate of|Wide shot of)\s+", "", m.group(1).strip()); ident = s.split(". ")[0].rstrip(".")
            ident = "; ".join(seg.strip() for seg in ident.split(";") if not re.search(r"\b\d+ ?mm\b|16:9|\blight\b|golden hour|no people", seg, re.I))
        ru = re.search(r"\*\*Что никогда не меняется[^*]*\*\*:?\s*(?:\[ред\.\]\s*)?(.+)", t)
        imgs = [str(p.relative_to(proj)) for p in f.parent.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
        out.append({"slug": f.parent.name, "imya": meta.get("imya", f.parent.name), "ident": ident, "ru": ru.group(1).strip() if ru else "", "imgs": imgs, "meta": meta})
    return out

def init(slug):
    proj = PROEKTY / slug; p = proj / "03-vizual" / "KANON.md"
    if p.exists(): sys.exit(f"уже есть: {p} — правьте его, init не перезаписывает")
    cfg = json.loads((proj / "stranica.json").read_text()) if (proj / "stranica.json").exists() else {}
    title = cfg.get("nazvanie", slug)
    heroes, locs = _cards(proj, "geroi"), _cards(proj, "lokacii")
    o = [f"---\nproekt: {slug}\nsozdan: {datetime.date.today():%d.%m.%Y}\nstatus: chernovik\n---", f"# Канон проекта · {title}", "",
         "*Этот файл дословно вклеивается в каждый промпт (карандаш, картинка, видео). Меняется только здесь; изменился — реестр кадров покажет, что устарело. Поля «[решение: худрук]» заполняет человек; [ред.] — черновик редактора.*", "",
         "## Стиль (в каждый промпт)", "",
         f"medium: {'family animated feature look, clean shapes, expressive faces, painterly backgrounds; no photoreal skin pores, no 3D-render plastic gloss' if 'нимац' in cfg.get('tip','') else 'photoreal live-action cinematic look; no 3D render, no game engine'}  [ред.]",
         "palette: 60% [решение: худрук — фон, hex] / 30% [герои, hex] / 10% [акценты, hex]",
         "light: [решение: худрук — логика света: напр. warm low sun on the steppe, cool blue night interiors lit by the hearth]",
         "materials: [ред.] felt, undyed wool, worn leather, dry amber grass, smoke, hammered copper",
         "lens: 24 mm for wide and establishing, 35–50 mm for two-shots and dialogue, 85 mm for close-ups; eye-level unless stated", "",
         "## Запреты (чего в этом мире нет)", "",
         "- NO generic teal-and-orange grade", "- NO photoreal celebrity faces", "- NO text, letters, logos, watermarks in frame", "- NO multiple panels or grids in one frame",
         "- [решение: худрук — что ещё никогда не появляется]", "",
         "## Герои (замок = одни и те же слова в каждом промпте)", ""]
    for h in heroes:
        o += [f"### @char_{h['slug']} · {h['imya']}",
              f"identity: {h['ident'] or '[заполнить по-английски из паспорта: ' + h['ru'][:80] + '…]'}",
              "taboo: [решение: 2–3 детали, которые никогда не меняются — напр. the red ribbons in the braids never change colour; the bow is always on the back]",
              "height: [решение: рост в см — нужен, когда в кадре двое]",
              f"refs: {'; '.join(h['imgs']) if h['imgs'] else '[нет — после утверждённого портрета: 03-vizual/geroi/' + h['slug'] + '/zamok.png (identity)]'}",
              "state: v1", ""]
    o += ["## Локации (замок + правило «ничего сверх референса»)", ""]
    for L in locs:
        o += [f"### @loc_{L['slug']} · {L['imya']}",
              f"identity: {L['ident'] or '[заполнить по-английски: ' + L['ru'][:80] + '…]'}",
              "lock: the set contains only what the reference shows — no added buildings, furniture or geography",
              f"refs: {'; '.join(L['imgs']) if L['imgs'] else '[нет — после мастер-пластины: 03-vizual/lokacii/' + L['slug'] + '/plastina.png (environment)]'}", ""]
    o += ["## Правила из замечаний (ИИ учится: замечание режиссёра к кадру → правило сюда)", "",
          "- (пусто — появится после первых принятых и отклонённых кадров; формат: `дата · кадр · кого касается · правило по-английски`)", ""]
    p.write_text("\n".join(o), encoding="utf-8")
    print(f"ok {p} · героев {len(heroes)} · локаций {len(locs)}")

# ---------- реестр и проверка ----------
def _kadry(proj):
    out = []
    for d in (proj / "03-vizual" / "kadry", proj / "03-vizual" / "raskadrovka" / "kadry"):
        if not d.exists(): continue
        for f in sorted(d.glob("*.md")):
            t = f.read_text(encoding="utf-8"); meta = {}
            if t.startswith("---"):
                for ln in t.split("---", 2)[1].splitlines():
                    if ":" in ln: a, b = ln.split(":", 1); meta[a.strip()] = b.strip()
            side = [s for s in d.glob(f"{f.stem}*.json")]
            imgs = [s for s in d.glob(f"{f.stem}*") if s.suffix.lower() in (".jpg", ".png", ".webp")]
            prov = []
            for s in side:
                try: prov.append(json.loads(s.read_text()))
                except Exception: pass
            out.append({"id": meta.get("kadr", f.stem), "file": str(f.relative_to(proj)), "status": meta.get("status", "draft"), "kanon": meta.get("kanon", ""),
                        "geroi": meta.get("geroi", ""), "lokaciya": meta.get("lokaciya", ""), "variants": len(imgs), "cost": round(sum(float(p.get("cost_usd", 0)) for p in prov), 3),
                        "engines": sorted({(p.get("engine") or {}).get("name", "") for p in prov} - {""}), "dry": all(p.get("dry_run") for p in prov) if prov else None, "prinyal": meta.get("prinyal", "")})
    return out

def reestr(slug):
    proj = PROEKTY / slug; k = read_kanon(proj)
    rows = _kadry(proj)
    for r in rows: r["aktualen"] = (r["kanon"] == k["version"]) if (k and r["kanon"]) else None
    (proj / "03-vizual" / "REESTR-KADROV.json").write_text(json.dumps({"kanon_version": k["version"] if k else "", "kadry": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    o = [f"# Реестр кадров · {slug}", "", f"*Канон версии `{k['version'] if k else '—'}`. Кадров {len(rows)}; устарели (сделаны под другой канон): {sum(1 for r in rows if r['aktualen'] is False)}; без версии канона: {sum(1 for r in rows if r['aktualen'] is None)}. Обновляется `tools/kanon.py reestr`.*", "",
         "| Кадр | Статус | Герои | Локация | Вариантов | Движок | $ | Канон |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        kan = "✓" if r["aktualen"] else ("устарел" if r["aktualen"] is False else "—")
        o.append(f"| {r['id']} | {r['status']}{' · ' + r['prinyal'] if r['prinyal'] else ''} | {r['geroi']} | {r['lokaciya']} | {r['variants']}{' (сухой)' if r['dry'] else ''} | {', '.join(r['engines'])} | {r['cost']} | {kan} |")
    (proj / "03-vizual" / "REESTR-KADROV.md").write_text("\n".join(o) + "\n", encoding="utf-8")
    print(f"ok реестр: кадров {len(rows)}, устарели {sum(1 for r in rows if r['aktualen'] is False)}")

def proverka(slug):
    proj = PROEKTY / slug; k = read_kanon(proj)
    if not k: sys.exit("канона нет — python3 tools/kanon.py init " + slug)
    bad = 0
    def w(msg): nonlocal bad; bad += 1; print(" -", msg)
    print(f"канон {k['path'].name} версии {k['version']}: героев {len(k['heroes'])}, локаций {len(k['locs'])}, запретов {len(k['forbid'])}, правил {len(k['rules'])}")
    for key in ("medium", "palette", "light", "lens"):
        if not k["style"].get(key, ""): w(f"стиль · {key}: не заполнено")
    for h in k["heroes"].values():
        if not h["identity"]: w(f"{h['tag']}: нет identity")
        if AGE_RE.search(h["identity"]): w(f"{h['tag']}: возраст числом в замке — заменить телосложением (фильтры видеомоделей жёстче к числам возраста)")
        if not h["taboo"]: w(f"{h['tag']}: табу-детали не заданы")
        if not h["refs"]: w(f"{h['tag']}: нет утверждённого референса (замок только текстом)")
    for L in k["locs"].values():
        if not L["identity"]: w(f"{L['tag']}: нет identity")
        if not L["refs"]: w(f"{L['tag']}: нет мастер-пластины")
    rows = _kadry(proj)
    stale = [r["id"] for r in rows if r["kanon"] and r["kanon"] != k["version"]]
    if stale: w(f"кадры под старым каноном ({len(stale)}): {', '.join(stale[:12])}{'…' if len(stale) > 12 else ''}")
    print(f"итого замечаний: {bad}")

if __name__ == "__main__":
    if len(sys.argv) < 3: print(__doc__); sys.exit(0)
    {"init": init, "proverka": proverka, "reestr": reestr}[sys.argv[1]](sys.argv[2])
