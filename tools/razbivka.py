#!/usr/bin/env python3
"""Разбивка сценария (breakdown) из Fountain: сцены, герои, локации, упоминания капсом.

    python3 tools/razbivka.py <draft.fountain> [--out <папка>] [--kartochki]

Пишет в --out (по умолчанию рядом с драфтом): razbivka.json и razbivka.md.
С --kartochki создаёт пустые паспорта: <out>/geroi/<imya>/KARTOCHKA.md и <out>/lokacii/<imya>/KARTOCHKA.md
(существующие не трогает). Русская и английская запись заголовков сцен, казахские буквы.
Страницы — оценка: 1 страница ≈ 55 строк Fountain.
"""
import argparse, json, pathlib, re, sys
from collections import OrderedDict

import sys as _sys
_sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "server"))
from blocks.breakdown.parser import parse, split_heading, norm_loc, LINES_PER_PAGE, HEAD, TIME_WORDS  # noqa: E402

def md(d):
    o = [f"# Разбивка сценария · {d['title'].get('Title','')}", "",
         f"*Сцен: {len(d['scenes'])} · героев с репликами: {len(d['characters'])} · локаций: {len(d['locations'])} · страниц (оценка): {d['pages_est']}. Собрано автоматически; проверить глазами.*", "",
         "## Сцены", "", "| № | ИНТ/НАТ | Локация | Время | Стр. | Кто в сцене | Акт/секвенция |", "|---|---|---|---|---|---|---|"]
    for s in d["scenes"]:
        pg = f"{s['page_from']}" if s["page_from"] == s["page_to"] else f"{s['page_from']}–{s['page_to']}"
        o.append(f"| {s['n']} | {s['type']} | {s['location']} | {s['time']} | {pg} | {', '.join(s['chars'])} | {s['act']} |")
    o += ["", "## Герои", "", "| Герой | Возраст | Сцен | Реплик | Первое появление |", "|---|---|---|---|---|"]
    for c in sorted(d["characters"], key=lambda c: -c["lines"]):
        o.append(f"| **{c['name']}** | {c['age'] or ''} | {len(c['scenes'])} | {c['lines']} | сцена {c['first_scene']} |")
    o += ["", "## Локации", "", f"*Основных мест: {len({L['parent'] for L in d['locations']})}; суб-локации сгруппированы по первому слову заголовка до «—».*", "",
          "| Место | Суб-локация | ИНТ/НАТ | Время суток | Сцены |", "|---|---|---|---|---|"]
    groups = OrderedDict()
    for L in d["locations"]:
        groups.setdefault(L["parent"], []).append(L)
    for parent, Ls in sorted(groups.items(), key=lambda kv: -sum(len(L["scenes"]) for L in kv[1])):
        for j, L in enumerate(Ls):
            sub = L["name"][len(parent):].strip(" —") if L["name"] != parent else "—"
            o.append(f"| {'**'+parent+'**' if j == 0 else ''} | {sub} | {'/'.join(L['types'])} | {', '.join(L['times'])} | {', '.join(map(str, L['scenes']))} |")
    if d["caps_mentions"]:
        o += ["", "## Капсом в действии — кандидаты в реквизит, звук, мир (проверить)", ""]
        o.append(", ".join(f"{m['word']} ({len(m['scenes'])})" for m in sorted(d["caps_mentions"], key=lambda m: -len(m["scenes"]))[:60]))
    return "\n".join(o) + "\n"

KARTA_GEROY = """---
imya: {name}
rol: {rol}
vozrast: {age}
scen: {scenes}
replik: {lines}
status: chernovik
zamok: ""
portret: ""
golos: ""
---
# {name}

**Кто это (одним предложением):** [заполнить]

**Что никогда не меняется (25–60 слов, идёт в каждый промпт):** [заполнить]

**Первое появление:** сцена {first_scene}. **В сценах:** {scenes}.

**Костюм по сценам:** [заполнить]

**Варианты портрета:** здесь появятся 4 варианта → выбранный ⭐ станет замком.
"""
KARTA_LOK = """---
imya: {name}
tip: {types}
vremya: {times}
scen: {scenes}
status: chernovik
zamok: ""
plastina: ""
---
# {name}

**Что никогда не меняется (8–20 слов):** [заполнить]

**Свет по времени суток:** {times} — [заполнить]

**План площадки / суб-локации:** [заполнить]

**В сценах:** {scenes}.
"""

def kartochki(d, out):
    made = 0
    for c in d["characters"]:
        p = out / "geroi" / translit(c["name"]) / "KARTOCHKA.md"
        if p.exists(): continue
        p.parent.mkdir(parents=True, exist_ok=True)
        rol = "главный" if c["lines"] >= 20 else ("второстепенный" if c["lines"] >= 5 else "эпизод")
        p.write_text(KARTA_GEROY.format(name=c["name"], rol=rol, age=c["age"] or "", scenes=", ".join(map(str, c["scenes"])), lines=c["lines"], first_scene=c["first_scene"]), encoding="utf-8"); made += 1
    groups = OrderedDict()
    for L in d["locations"]:
        groups.setdefault(L["parent"], []).append(L)
    for parent, Ls in groups.items():  # паспорт — у основного места; суб-локации перечисляются в нём
        p = out / "lokacii" / translit(parent) / "KARTOCHKA.md"
        if p.exists(): continue
        p.parent.mkdir(parents=True, exist_ok=True)
        types = sorted({t for L in Ls for t in L["types"]}); times = sorted({t for L in Ls for t in L["times"]})
        scenes = sorted({n for L in Ls for n in L["scenes"]})
        subs = ", ".join(L["name"][len(parent):].strip(" —") for L in Ls if L["name"] != parent)
        txt = KARTA_LOK.format(name=parent, types="/".join(types), times=", ".join(times), scenes=", ".join(map(str, scenes)))
        if subs: txt = txt.replace("**План площадки / суб-локации:** [заполнить]", f"**План площадки / суб-локации:** {subs} — [заполнить]")
        p.write_text(txt, encoding="utf-8"); made += 1
    return made

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("draft"); ap.add_argument("--out"); ap.add_argument("--kartochki", action="store_true")
    a = ap.parse_args()
    src = pathlib.Path(a.draft)
    out = pathlib.Path(a.out) if a.out else src.parent
    out.mkdir(parents=True, exist_ok=True)
    d = parse(src.read_text(encoding="utf-8"))
    (out / "razbivka.json").write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "razbivka.md").write_text(md(d), encoding="utf-8")
    msg = f"ok {out/'razbivka.md'} · сцен {len(d['scenes'])} · героев {len(d['characters'])} · локаций {len(d['locations'])} · стр. ≈{d['pages_est']}"
    if a.kartochki:
        msg += f" · карточек создано {kartochki(d, out)}"
    print(msg)
