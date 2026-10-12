#!/usr/bin/env python3
"""Черновая раскадровка из сценария (№24): сцена Fountain → шот-лист → промпты карандаша → контактный лист → сухой прогон.

    python3 tools/raskadrovka.py <slug> <draft.fountain> --sceny 1,2 [--out <папка>] [--v-kadry]

Что делает (RAZBOR/07 §2, шаги 1–2 и подготовка к 3–4):
  1. Режет выбранные сцены на кадры: абзац действия = кадр; реплика = кадр на говорящем; закадровый голос (ЗК)
     не рвёт кадр, а удлиняет предыдущий. Крупность, движение, объектив, длительность — по словам сцены (эвристика,
     человек правит в таблице).
  2. Собирает промпт карандаша по шаблону: триггер LoRA + крупность + действие + замки героев и локации из паспортов
     (`03-vizual/geroi|lokacii/*/KARTOCHKA.md`, английская строка в обратных кавычках). Слово «storyboard» не пишется —
     модель начинает рисовать сетку. Действие остаётся на языке сценария; английский перевод кладёт ассистент в поле
     `deystvie_en` карточки перед запуском (поле пустое = запуск невозможен).
  3. Пишет: `raskadrovka.md` (шот-лист таблицей), `raskadrovka.json`, `kontaktnyy-list.html` (сетка 16:9 без картинок,
     печатается), карточки `kadry/<сцена>-<кадр>.md` в формате страницы проекта и сайдкары сухого прогона через
     `tools/generator.py` (ничего не генерирует, не платит).

По умолчанию всё ложится в `<проект>/03-vizual/raskadrovka/` — на страницу проекта НЕ попадает. После «да» Александра
`--v-kadry` копирует карточки в `03-vizual/kadry/`, откуда их читает `build-project.py`. Правило: список кадров
сначала показывается, генерация — потом.
"""
from __future__ import annotations
import argparse, html, json, pathlib, re, shutil, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import razbivka, generator, kanon

HOME = pathlib.Path.home()
PROEKTY = HOME / "Documents/CODE/KINO-STANCIYA/PROEKTY"
CAPS = razbivka.CAPS
TRIGGER = "5t0ry style digital sketch, pencil on paper, rough storyboard-free single frame, 16:9"
NEGATIVE = "color, photo, photoreal, multiple panels, grid, comic page, text, letters, watermark, blurry"
SIZE_EN = {"общий": "wide shot", "общий (мастер)": "wide establishing shot", "общий, тени": "wide shot, silhouettes and shadows",
           "средний": "medium shot", "средний (двое)": "medium two-shot", "средний крупный": "medium close-up", "крупный": "close-up", "деталь": "extreme close-up detail"}
LENS = {"общий": "24 мм", "общий (мастер)": "24 мм", "общий, тени": "24 мм", "средний": "35 мм", "средний (двое)": "35 мм", "средний крупный": "50 мм", "крупный": "85 мм", "деталь": "100 мм макро"}
MOVE_EN = {"статика": "static camera", "панорама": "slow pan", "сопровождение": "tracking shot", "наезд": "slow push-in", "отъезд": "slow pull-out", "панорама за взглядом": "pan following the look"}
CLOSE_WORDS = re.compile(r"\b(глаза|глаз|лицо|лица|губы|рука|руки|пальц|моргает|слез|взгляд|ладон|брови|морду)\w*", re.I)
WIDE_WORDS = re.compile(r"\b(горизонт|степь|табун|вдалеке|юрты|аул|холм|небо|дым|до горизонта|пустот)\w*", re.I)
SHADOW_WORDS = re.compile(r"\b(тень|тени|силуэт)\w*", re.I)
MOVE_WORDS = [(re.compile(r"\b(переводит взгляд|смотрит на|оборачивается)", re.I), "панорама за взглядом"),
              (re.compile(r"\b(гонят|скачет|скачут|бежит|бегут|идёт|идут|уходит|уходят|возвращаются|тают)\w*", re.I), "сопровождение"),
              (re.compile(r"\b(растёт|поднимается|вспыхивает|находит)\w*", re.I), "наезд")]

# ---------- паспорта ----------
def read_cards(proj, kind):
    out = {}
    for f in sorted((proj / "03-vizual" / kind).glob("*/KARTOCHKA.md")):
        t = f.read_text(encoding="utf-8"); meta = {}
        if t.startswith("---"):
            for ln in t.split("---", 2)[1].splitlines():
                if ":" in ln: k, v = ln.split(":", 1); meta[k.strip()] = v.strip().strip('"')
        m = re.search(r"\*\*Промпт[^*]*\*\*:?\s*`([^`]+)`", t)
        lock_en = ""
        if m:
            s = re.sub(r"^(Portrait of|Master plate of|Wide shot of)\s+", "", m.group(1).strip())
            lock_en = s.split(". ")[0].rstrip(".")
        img = next((p for p in f.parent.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and "zamok" in p.stem.lower()), None)
        aliases = {meta.get("imya", "").upper()} | {a.strip().upper() for a in meta.get("alias", "").split(",") if a.strip()}
        out[f.parent.name] = {"slug": f.parent.name, "imya": meta.get("imya", f.parent.name), "aliases": aliases, "lock_en": lock_en, "lock_ru": "", "zamok_img": str(img) if img else "", "status": meta.get("status", "")}
        mr = re.search(r"\*\*Что никогда не меняется[^*]*\*\*:?\s*(?:\[ред\.\]\s*)?(.+)", t)
        if mr: out[f.parent.name]["lock_ru"] = mr.group(1).strip()
    return out

def find_hero(name, heroes):
    n = name.upper()
    for h in heroes.values():
        if n in h["aliases"] or any(a and (a in n or n in a) for a in h["aliases"]): return h
    return None

def find_loc(loc_name, locs):
    first = re.split(r"\s+—\s+", loc_name)[0].upper()
    for L in locs.values():
        for a in L["aliases"]:
            if a and (a == first or first.startswith(a) or a in first): return L
    return None

# ---------- шот-лист ----------
def shots_for_scene(lines, sc, hero_names):
    """lines — весь сценарий; sc — сцена из razbivka.parse. Возвращает список кадров."""
    block = lines[sc["line_from"]: sc["line_to"]]  # без заголовка
    i, shots, first_action = 0, [], True
    def add(kind, text, chars, size=None, move="статика"):
        shots.append({"kind": kind, "text": text.strip(), "chars": chars, "size": size, "move": move, "vo": []})
    while i < len(block):
        s = block[i].strip()
        if not s or s.startswith("=") or razbivka.TRANSITION_RE.match(s): i += 1; continue
        nxt = block[i + 1].strip() if i + 1 < len(block) else ""
        if razbivka.NAME_RE.match(s) and nxt and len(s) < 60 and s == s.upper() and not razbivka.HEAD.match(s):
            name = re.sub(r"\s*\([^)]*\)\s*", "", s).replace("^", "").strip()
            i += 1; rep = []
            while i < len(block) and block[i].strip(): rep.append(block[i].strip()); i += 1
            rep = " ".join(r for r in rep if not r.startswith("("))
            if "(ЗК)" in s or "(V.O.)" in s or "(O.S.)" in s or name.startswith("ГОЛОС"):
                if shots: shots[-1]["vo"].append((name, rep))
                else: add("vo", rep, [], "общий, тени")
            else:
                add("replika", rep, [name], "крупный" if len(rep.split()) <= 8 else "средний крупный")
                shots[-1]["speaker"] = name
            continue
        para = []
        while i < len(block) and block[i].strip() and not razbivka.NAME_RE.match(block[i].strip()): para.append(block[i].strip()); i += 1
        text = " ".join(para)
        chars = [n for n in hero_names if re.search(r"(?<!\w)" + re.escape(n) + r"(?!\w)", text, flags=(0 if n == n.upper() else re.I))]
        if first_action: size = "общий (мастер)"; first_action = False
        elif SHADOW_WORDS.search(text): size = "общий, тени"
        elif CLOSE_WORDS.search(text) and not WIDE_WORDS.search(text): size = "крупный"
        elif len(chars) >= 2: size = "средний (двое)"
        elif WIDE_WORDS.search(text): size = "общий"
        else: size = "средний"
        move = next((m for rx, m in MOVE_WORDS if rx.search(text)), "статика")
        add("deystvie", text, chars, size, move)
    # восьмёрка: подряд идущие реплики двух людей — чередуем через плечо
    for k, sh in enumerate(shots):
        if sh["kind"] == "replika" and k and shots[k - 1]["kind"] == "replika" and shots[k - 1]["chars"] != sh["chars"]:
            sh["size"] = "средний крупный" if sh["size"] == "крупный" and shots[k - 1]["size"] == "крупный" else sh["size"]
            sh["move"] = "статика (через плечо)"
    for sh in shots:
        words = len(sh["text"].split()) + sum(len(r.split()) for _, r in sh["vo"])
        sh["sec"] = max(2.0, round(words / 2.5 + (0.8 if sh["kind"] == "replika" else 0), 1))
    return shots

def build_prompt(sh, heroes, loc, loc_name, time):
    size_en = SIZE_EN.get(sh["size"], "medium shot"); move_en = MOVE_EN.get(sh["move"].split(" (")[0], "static camera")
    parts = [TRIGGER, size_en, move_en]
    hs = []
    for n in sh["chars"]:
        h = find_hero(n, heroes)
        if h and h["lock_en"]: hs.append(f"{h['imya']}: {h['lock_en']}")
        elif h: hs.append(h["imya"])
    place = (loc["imya"] + ": " + loc["lock_en"]) if loc and loc["lock_en"] else loc_name.title()
    parts.append(f"Location {place}, {time.lower() if time else 'day'}")
    if hs: parts.append("Characters — " + "; ".join(hs))
    parts.append("Action: {ACTION_EN}")
    return ", ".join(parts[:3]) + ". " + ". ".join(parts[3:]) + ". Loose pencil lines, grey hatching, white paper, no colour."

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug"); ap.add_argument("draft"); ap.add_argument("--sceny", default="1")
    ap.add_argument("--out"); ap.add_argument("--v-kadry", action="store_true", help="после «да»: скопировать карточки в 03-vizual/kadry/")
    ap.add_argument("--gpu-usd", type=float, default=0.5); ap.add_argument("--variants", type=int, default=4)
    a = ap.parse_args()
    proj = PROEKTY / a.slug
    out = pathlib.Path(a.out) if a.out else proj / "03-vizual" / "raskadrovka"
    (out / "kadry").mkdir(parents=True, exist_ok=True)
    text = pathlib.Path(a.draft).read_text(encoding="utf-8"); lines = text.splitlines()
    d = razbivka.parse(text)
    heroes, locs = read_cards(proj, "geroi"), read_cards(proj, "lokacii")
    K = kanon.read_kanon(proj)
    if not K: print("канона нет (03-vizual/KANON.md) — промпты без стиля и запретов; создайте: python3 tools/kanon.py init", a.slug)
    hero_names = sorted({c["name"] for c in d["characters"]} | {a for h in heroes.values() for a in h["aliases"] if a} | {a for h in (K["heroes"].values() if K else []) for a in h.get("aliases", ()) if a}, key=len, reverse=True)
    want = [int(x) for x in a.sceny.split(",") if x.strip()]
    rows, cards, jobs, total_sec = [], [], [], 0.0
    for sc in d["scenes"]:
        if sc["n"] not in want: continue
        loc = find_loc(sc["location"], locs)
        shots = shots_for_scene(lines, sc, hero_names)
        for k, sh in enumerate(shots, 1):
            sid = f"{sc['n']:02d}-{k:02d}"
            prev = out / "kadry" / f"{sid}.md"; action_en = ""; keep = {"status": "draft", "prinyal": "", "zamechanie": ""}
            if prev.exists():  # перевод, статус, замечание и «кто принял» переживают пересборку
                pm = {}
                for ln in prev.read_text(encoding="utf-8").split("---", 2)[1].splitlines():
                    if ":" in ln: a_, b_ = ln.split(":", 1); pm[a_.strip()] = b_.strip()
                action_en = pm.get("deystvie_en", "")
                keep = {k_: pm.get(k_, v_) for k_, v_ in keep.items()}
            if K:
                prompt, krefs = kanon.sobrat(K, "karandash", {"id": sid, "size_en": SIZE_EN.get(sh["size"], "medium shot"), "move_en": MOVE_EN.get(sh["move"].split(" (")[0], "static camera"), "chars": list(dict.fromkeys(sh["chars"])), "loc_name": sc["location"], "vo": sh["vo"]}, action_en=action_en, time_en=(sc["time"] or "day").lower())
            else:
                prompt, krefs = build_prompt(sh, heroes, loc, sc["location"], sc["time"]), []
            who = ", ".join(dict.fromkeys(sh["chars"]))
            vo = " ".join(f"[{n}: {r}]" for n, r in sh["vo"])
            action = sh["text"] + ((" " + vo) if vo else "")
            lens = LENS.get(sh["size"], "35 мм")
            rows.append({"kadr": sid, "scena": sc["n"], "heading": sc["heading"], "krupnost": sh["size"], "dvizhenie": sh["move"], "obektiv": lens,
                         "sec": sh["sec"], "chars": who, "location": sc["location"], "loc_card": loc["slug"] if loc else "", "deystvie": action, "prompt": prompt})
            total_sec += sh["sec"]
            refs = [{"path": str(proj / r["path"]), "role": r["role"]} for r in krefs] if K else []
            if not K:
                for n in sh["chars"]:
                    h = find_hero(n, heroes)
                    if h and h["zamok_img"]: refs.append({"path": h["zamok_img"], "role": "identity"})
                if loc and loc["zamok_img"]: refs.append({"path": loc["zamok_img"], "role": "staging"})
            card = ("---\n" + f"kadr: {sid}\nscena: {sc['n']}\nkrupnost: {sh['size']}\ndvizhenie: {sh['move']}\nobektiv: {lens}\ndlitelnost: {sh['sec']} с\n"
                    f"status: {keep['status']}\nprinyal: {keep['prinyal']}\ndeystvie: {action}\ndeystvie_en: {action_en}\nzamechanie: {keep['zamechanie']}\ngeroi: {who}\nlokaciya: {sc['location']}\nkanon: {K['version'] if K else ''}\n---\n" + prompt + "\n")
            (out / "kadry" / f"{sid}.md").write_text(card, encoding="utf-8")
            cards.append(sid)
            job = generator.Job(kind="karandash", project=a.slug, target=f"shot:{sc['n']}.{k}", prompt=prompt, negative=NEGATIVE,
                                params={"width": 1024, "height": 576, "steps": 8, "variants": a.variants, "seconds": 3 * a.variants, "gpu_usd_per_hour": a.gpu_usd, "lora": "storyboard-sketch", "needs": "deystvie_en", "kanon": K["version"] if K else ""},
                                refs=refs, requested_by="raskadrovka.py", out_dir=str(out / "kadry"), dry_run=True, id=sid)
            r = generator.KarandashComfy().run(job); jobs.append(r)
            if not r.ok: print("сайдкар не записан:", sid, r.error)
    if not rows: sys.exit(f"сцены {want} не найдены (всего сцен {len(d['scenes'])})")
    est_usd = sum(generator.KarandashComfy().estimate(generator.Job(kind="karandash", project=a.slug, target="", prompt="", params={"seconds": 3 * a.variants, "gpu_usd_per_hour": a.gpu_usd})) for _ in rows)
    # --- raskadrovka.md
    o = [f"# Черновая раскадровка · {d['title'].get('Title', a.slug)} · сцены {', '.join(map(str, want))}", "",
         f"*Сухой прогон: кадров {len(rows)}, хронометраж ≈ {total_sec:.0f} с, вариантов на кадр {a.variants}, оценка GPU ≈ {est_usd:.2f} $ при {a.gpu_usd} $/ч. Картинок нет — генерация после «да». Крупность и движение — эвристика, править в таблице.*", ""]
    cur = None
    for r in rows:
        if r["scena"] != cur:
            cur = r["scena"]; o += [f"## Сцена {cur}. {r['heading']}", "", "| Кадр | Крупность | Движение | Объектив | с | Кто | Действие |", "|---|---|---|---|---|---|---|"]
        o.append(f"| {r['kadr']} | {r['krupnost']} | {r['dvizhenie']} | {r['obektiv']} | {r['sec']} | {r['chars']} | {r['deystvie'].replace('|', '/')} |")
    o += ["", f"## Замки, которые ушли в промпты (канон `{K['version'] if K else '—'}`)", ""]
    used_h = {n for r in rows for n in r["chars"].split(", ") if n}
    for n in sorted(used_h):
        h = find_hero(n, heroes); o.append(f"- **{n}** → " + (f"паспорт `{h['slug']}`: {h['lock_en'] or 'английской строки в паспорте нет'}" if h else "паспорта нет — в промпт идёт только имя"))
    for L in {r["loc_card"] for r in rows}:
        if L: o.append(f"- **{locs[L]['imya']}** → паспорт `{L}`: {locs[L]['lock_en'] or 'английской строки нет'}")
    for r in rows:
        if not r["loc_card"]: o.append(f"- **{r['location']}** → паспорта локации нет, в промпт идёт заголовок сцены"); break
    o += ["", "Промпт каждого кадра — в `kadry/<кадр>.md`; поле `deystvie_en` заполняет ассистент перед запуском.", ""]
    (out / "raskadrovka.md").write_text("\n".join(o), encoding="utf-8")
    (out / "raskadrovka.json").write_text(json.dumps({"project": a.slug, "draft": str(a.draft), "scenes": want, "shots": rows, "estimate_usd": round(est_usd, 3), "variants": a.variants}, ensure_ascii=False, indent=1), encoding="utf-8")
    # --- контактный лист
    E = html.escape
    tiles = "".join(f'<li><div class="fr"><b>{E(r["kadr"])}</b><i>{E(r["krupnost"])}</i></div><p class="sp">{E(r["dvizhenie"])} · {E(r["obektiv"])} · {r["sec"]} с{(" · " + E(r["chars"])) if r["chars"] else ""}</p><p>{E(r["deystvie"])}</p></li>' for r in rows)
    page = f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Контактный лист · сцены {", ".join(map(str, want))}</title>
<style>:root{{--bg:oklch(0.14 0.008 70);--fg:oklch(0.93 0.01 80);--dim:oklch(0.72 0.012 85);--line:oklch(0.3 0.01 70);--acc:oklch(0.82 0.13 80)}}
body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 Geologica,Onest,system-ui,sans-serif;padding:24px 16px}}h1{{font-size:1.4rem;margin:0 0 .3rem}}.note{{color:var(--dim);max-width:60ch;margin:0 0 1.5rem}}
ol{{list-style:none;padding:0;margin:0;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}}li{{border:1px solid var(--line);border-radius:6px;padding:10px}}
.fr{{aspect-ratio:16/9;border:1px dashed var(--line);border-radius:4px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;color:var(--dim);background:repeating-linear-gradient(45deg,transparent 0 12px,oklch(0.17 0.008 70) 12px 24px)}}
.fr b{{font:600 1.4rem/1 JetBrains Mono,monospace;color:var(--acc)}}.fr i{{font-style:normal;font-size:.85rem}}.sp{{font:.78rem/1.4 JetBrains Mono,monospace;color:var(--dim);margin:.6rem 0 .3rem}}p{{margin:0;font-size:1rem}}
@media print{{body{{background:#fff;color:#000;padding:0}}li,.fr{{border-color:#999}}.fr{{background:none}}.fr b{{color:#000}}.sp,.note{{color:#444}}}}</style></head>
<body><h1>{E(d['title'].get('Title', a.slug))} · контактный лист, сцены {", ".join(map(str, want))}</h1>
<p class="note">Сухой прогон: {len(rows)} кадров, ≈{total_sec:.0f} с хронометража, по {a.variants} варианта на кадр, оценка GPU ≈ {est_usd:.2f} $. Рамки пустые: карандаш рисуется после «да». Режиссёр ставит 🔴🟡🟢 и пишет замечание одной строкой.</p>
<ol>{tiles}</ol></body></html>'''
    (out / "kontaktnyy-list.html").write_text(page, encoding="utf-8")
    if a.v_kadry:
        dst = proj / "03-vizual" / "kadry"; dst.mkdir(parents=True, exist_ok=True)
        for sid in cards: shutil.copy(out / "kadry" / f"{sid}.md", dst / f"{sid}.md")
        print(f"карточки скопированы в {dst} ({len(cards)})")
    print(f"ok {out} · кадров {len(rows)} · ≈{total_sec:.0f} с · сайдкаров {sum(1 for j in jobs if j.ok)} · оценка {est_usd:.2f} $ · картинок 0 (сухой прогон)")

if __name__ == "__main__":
    main()
