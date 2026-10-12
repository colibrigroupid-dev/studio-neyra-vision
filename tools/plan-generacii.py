#!/usr/bin/env python3
"""План платной генерации «до кнопки» (№19 раунд 2, правило «референсы сначала показать»): что нарисовать, какими промптами, за сколько.

    python3 tools/plan-generacii.py <slug> [--variants 4] [--route hf|google] [--run]

Берёт из канона (03-vizual/KANON.md) всех героев и локации БЕЗ утверждённого референса и собирает для каждого задание:
герой — лист-портрет (identity-плейт: крупно лицо + 3/4 + рост, нейтральный серый фон, ровный свет, без реквизита — по правилам
Soul/Untouched Base); локация — мастер-пластина (16:9, без людей, свет по канону). Промпт — `kanon.sobrat("image")`.
Пишет 03-vizual/PLAN-GENERACII.md (таблица: объект · что · вариантов · цена по маршруту · промпт свёрнут) и PLAN-GENERACII.json
(задания generator.Job) + сухие сайдкары в 03-vizual/<geroi|lokacii>/<slug>/plan/. Ничего не генерирует без --run.
--run — только после «да» Александра по этому плану: запускает через generator (route hf = Higgsfield CLI, google = nb.py — пока заглушка).
Цены: hf — 2 кредита за кадр 2K 16:9 (оценка `higgsfield generate cost` 13.10.2026), google — ≈0,04 $ за кадр (мастер-промпт).
"""
from __future__ import annotations
import argparse, json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kanon, generator

PROEKTY = pathlib.Path.home() / "Documents/CODE/KINO-STANCIYA/PROEKTY"
PRICE = {"hf": ("кредит", 2.0), "google": ("$", 0.04)}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("slug"); ap.add_argument("--variants", type=int, default=4); ap.add_argument("--route", choices=["hf", "google"], default="hf"); ap.add_argument("--run", action="store_true")
    a = ap.parse_args(); proj = PROEKTY / a.slug
    K = kanon.read_kanon(proj)
    if not K: sys.exit("канона нет — python3 tools/kanon.py init " + a.slug)
    unit, price = PRICE[a.route]; rows, jobs = [], []
    for tag, h in K["heroes"].items():
        if h["refs"]: continue
        slug = tag.replace("@char_", "")
        shot = {"id": f"portret-{slug}", "size_en": "identity plate: large close-up of the face (front), plus a 3/4 view and a full-height figure side by side on one 16:9 sheet", "move_en": "static camera, eye level", "chars": [h["imya"]], "loc_name": "", "vo": []}
        prompt, refs = kanon.sobrat(K, "image", shot, action_en="Neutral expression, even soft studio light, plain mid-grey background, no props beyond the character's own costume, no text", time_en="studio")
        if not h["identity"]: rows.append({"obj": h["imya"], "what": "портрет", "skip": "нет замка текстом — сначала заполнить identity"}); continue
        out = proj / "03-vizual" / "geroi" / slug / "plan"
        job = generator.Job(kind="image", project=a.slug, target=f"hero:{slug}", prompt=prompt, params={"resolution": "2k", "aspect_ratio": "16:9", "variants": a.variants, "route": a.route, "kanon": K["version"]}, refs=refs, requested_by="plan-generacii.py", out_dir=str(out), dry_run=True, id=f"portret-{slug}")
        jobs.append(job); rows.append({"obj": h["imya"], "what": "лист-портрет (лицо · 3/4 · рост)", "variants": a.variants, "cost": a.variants * price, "prompt": prompt, "tag": tag})
    for tag, L in K["locs"].items():
        if L["refs"]: continue
        slug = tag.replace("@loc_", "")
        shot = {"id": f"plastina-{slug}", "size_en": "wide establishing master plate, 24 mm", "move_en": "static camera", "chars": [], "loc_name": L["imya"], "vo": []}
        prompt, refs = kanon.sobrat(K, "image", shot, action_en="Master plate of the location, no people, the key light of the scene as described in the canon", time_en="day")
        if not L["identity"]: rows.append({"obj": L["imya"], "what": "мастер-пластина", "skip": "нет замка текстом"}); continue
        out = proj / "03-vizual" / "lokacii" / slug / "plan"
        job = generator.Job(kind="image", project=a.slug, target=f"location:{slug}", prompt=prompt, params={"resolution": "2k", "aspect_ratio": "16:9", "variants": a.variants, "route": a.route, "kanon": K["version"]}, refs=refs, requested_by="plan-generacii.py", out_dir=str(out), dry_run=True, id=f"plastina-{slug}")
        jobs.append(job); rows.append({"obj": L["imya"], "what": "мастер-пластина 16:9", "variants": a.variants, "cost": a.variants * price, "prompt": prompt, "tag": tag})
    total = sum(r.get("cost", 0) for r in rows)
    gaps = [m for m in ("palette", "light") if not K["style"].get(m)]
    o = [f"# План генерации · {a.slug} · маршрут {'Higgsfield' if a.route == 'hf' else 'Google (Nano Banana 2)'}", "",
         f"*Канон `{K['version']}`. Заданий {len(jobs)}, вариантов на объект {a.variants}, итого ≈ **{total:g} {unit}**. Ничего не запущено: это список «до кнопки». После «да» — `python3 tools/plan-generacii.py {a.slug} --route {a.route} --run`.*", ""]
    if gaps: o += [f"⚠️ В каноне не заполнено: {', '.join(gaps)} — промпты пойдут без палитры/света, кадры будут расходиться по цвету. Лучше заполнить до «да» (№49).", ""]
    o += ["| Объект | Что рисуем | Вариантов | Цена | Примечание |", "|---|---|---|---|---|"]
    for r in rows:
        o.append(f"| **{r['obj']}** | {r['what']} | {r.get('variants', '—')} | {r['cost']:g} {unit} | {r.get('skip', '')} |" if "cost" in r else f"| **{r['obj']}** | {r['what']} | — | — | {r.get('skip', '')} |")
    o += ["", "## Промпты (что уйдёт в генерацию)", ""]
    for r in rows:
        if "prompt" in r: o += [f"<details><summary>{r['obj']} · {r['what']}</summary>", "", "```", r["prompt"], "```", "", "</details>", ""]
    (proj / "03-vizual" / "PLAN-GENERACII.md").write_text("\n".join(o), encoding="utf-8")
    (proj / "03-vizual" / "PLAN-GENERACII.json").write_text(json.dumps([generator.dataclasses.asdict(j) for j in jobs], ensure_ascii=False, indent=1), encoding="utf-8")
    done = 0
    for j in jobs:
        if a.run:
            j.dry_run = False
            r = (generator.HiggsfieldCLI() if a.route == "hf" else generator.NanoBanana()).run(j)
            print(("ok " if r.ok else "ОШИБКА ") + j.id + (": " + r.error if not r.ok else f" → {r.file}")); done += r.ok
        else:
            generator.HiggsfieldCLI().run(j)
    print(f"план: {proj / '03-vizual' / 'PLAN-GENERACII.md'} · заданий {len(jobs)} · ≈{total:g} {unit}" + (f" · выполнено {done}" if a.run else " · сухой"))

if __name__ == "__main__":
    main()
