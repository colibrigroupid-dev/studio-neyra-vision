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

LINES_PER_PAGE = 55
HEAD = re.compile(r"^(ИНТ|НАТ|ИНТ\./НАТ|НАТ\./ИНТ|INT|EXT|INT\./EXT|EXT\./INT|I/E)\.?\s+(.+)$", re.I)
TIME_WORDS = {"ДЕНЬ", "НОЧЬ", "УТРО", "ВЕЧЕР", "РАССВЕТ", "ЗАКАТ", "СУМЕРКИ", "ПОЗЖЕ", "ПРОДОЛЖЕНИЕ", "DAY", "NIGHT", "MORNING", "EVENING", "DAWN", "DUSK", "CONTINUOUS", "LATER", "ТОТ ЖЕ МОМЕНТ"}
CAPS = "A-ZА-ЯЁӘҒҚҢӨҰҮҺІ"
NAME_RE = re.compile(rf"^[{CAPS}][{CAPS}0-9\s\-'’.]*?(\s*\([^)]*\))?\s*(\^)?$")
TRANSITION_RE = re.compile(rf"^[{CAPS}\s.]+:$|^ЗТМ\.?$|^>\s")
INTRO_RE = re.compile(rf"\b([{CAPS}][{CAPS}\-’']{{2,}}(?:\s[{CAPS}][{CAPS}\-’']{{2,}})?)\s*\((\d{{1,2}})(?:[^)]*)\)")
CAPSWORD_RE = re.compile(rf"\b([{CAPS}][{CAPS}\-’']{{3,}}(?:\s[{CAPS}][{CAPS}\-’']{{3,}}){{0,2}})\b")

TR = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"yo","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"c","ч":"ch","ш":"sh","щ":"shch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya","ә":"a","ғ":"g","қ":"q","ң":"ng","ө":"o","ұ":"u","ү":"u","һ":"h","і":"i"}
def translit(s):
    out = "".join(TR.get(ch, ch) for ch in s.lower())
    out = re.sub(r"[^a-z0-9]+", "-", out).strip("-")
    return out or "x"

def norm_loc(s):
    s = re.sub(r"\s+", " ", s.strip(" .—-")).upper()
    return s

def split_heading(rest):
    """'ЮРТА ЕРНАЗАРА — НОЧЬ' → ('ЮРТА ЕРНАЗАРА', 'НОЧЬ')"""
    parts = re.split(r"\s+[—–-]+\s+", rest)
    if len(parts) >= 2:
        loc, time = " — ".join(parts[:-1]), parts[-1]
        if time.strip().upper().split("(")[0].strip() not in TIME_WORDS and not any(w in time.upper() for w in TIME_WORDS):
            return norm_loc(rest), ""
        return norm_loc(loc), time.strip().upper()
    return norm_loc(rest), ""

def parse(text):
    lines = text.splitlines()
    i = 0
    title = OrderedDict()
    while i < len(lines) and re.match(r"^[A-Za-zА-Яа-я ]+:\s*", lines[i]):
        k, v = lines[i].split(":", 1); title[k.strip()] = v.strip(); i += 1
    scenes, chars, locs, caps = [], OrderedDict(), OrderedDict(), OrderedDict()
    cur, act = None, ""
    n = 0
    while i < len(lines):
        ln = lines[i].rstrip()
        s = ln.strip()
        if s.startswith("="):
            act = s.lstrip("= ").strip(); i += 1; continue
        m = HEAD.match(s) if s and not s.startswith("!") else None
        if s.startswith("."):  # форсированный заголовок
            m = re.match(r"^\.(.+)$", s); s2 = m.group(1); m = HEAD.match(s2) or re.match(r"^()(.+)$", s2)
        if m:
            n += 1
            typ = (m.group(1) or "").upper().replace(".", "")
            loc, time = split_heading(m.group(2))
            cur = {"n": n, "heading": s.lstrip("."), "type": typ, "location": loc, "time": time, "act": act,
                   "line_from": i + 1, "line_to": i + 1, "chars": [], "intros": [], "caps": []}
            scenes.append(cur)
            L = locs.setdefault(loc, {"name": loc, "types": set(), "times": set(), "scenes": []})
            L["types"].add(typ); L["scenes"].append(n)
            if time: L["times"].add(time)
            i += 1; continue
        if cur:
            cur["line_to"] = i + 1
            # имя героя перед репликой
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            if s and NAME_RE.match(s) and nxt and not TRANSITION_RE.match(s) and not HEAD.match(s) and len(s) < 60 and s == s.upper():
                name = re.sub(r"\s*\([^)]*\)\s*", "", s).replace("^", "").strip()
                if name:
                    C = chars.setdefault(name, {"name": name, "lines": 0, "scenes": [], "first_scene": n, "age": None})
                    C["lines"] += 1
                    if n not in C["scenes"]: C["scenes"].append(n)
                    if name not in cur["chars"]: cur["chars"].append(name)
                    i += 1
                    while i < len(lines) and lines[i].strip():
                        i += 1
                    continue
            # первое появление: ИМЯ (возраст) в действии
            if s and s != s.upper():
                for mm in INTRO_RE.finditer(s):
                    name, age = mm.group(1).strip(), int(mm.group(2))
                    C = chars.setdefault(name, {"name": name, "lines": 0, "scenes": [], "first_scene": n, "age": None})
                    C["age"] = C["age"] or age
                    if n not in C["scenes"]: C["scenes"].append(n)
                    if name not in cur["chars"]: cur["chars"].append(name)
                    cur["intros"].append({"name": name, "age": age})
                for mm in CAPSWORD_RE.finditer(s):
                    w = mm.group(1)
                    if w in TIME_WORDS or w in chars: continue
                    caps.setdefault(w, []).append(n)
                    if w not in cur["caps"]: cur["caps"].append(w)
        i += 1
    for sc in scenes:
        sc["page_from"] = sc["line_from"] // LINES_PER_PAGE + 1
        sc["page_to"] = max(sc["page_from"], sc["line_to"] // LINES_PER_PAGE + 1)
        sc["lines"] = sc["line_to"] - sc["line_from"] + 1
    for L in locs.values():
        L["types"] = sorted(L["types"]); L["times"] = sorted(L["times"])
        L["parent"] = re.split(r"\s+—\s+", L["name"])[0]  # «АУЛ — ОКРАИНА» → родитель «АУЛ»
    # герои: только с репликами или с возрастом; остальные капс-упоминания — кандидаты
    heroes = OrderedDict((k, v) for k, v in chars.items() if v["lines"] > 0 or v["age"])
    for k in list(caps):
        if k in heroes: caps.pop(k)
    return {"title": dict(title), "pages_est": len(lines) // LINES_PER_PAGE + 1, "scenes": scenes,
            "characters": list(heroes.values()), "locations": list(locs.values()),
            "caps_mentions": [{"word": w, "scenes": sorted(set(v))} for w, v in caps.items() if len(v) >= 1]}

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
    for L in d["locations"]:
        if L["name"] != L["parent"]:  # паспорт — у основного места; суб-локации перечисляются в нём
            continue
        p = out / "lokacii" / translit(L["name"]) / "KARTOCHKA.md"
        if p.exists(): continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(KARTA_LOK.format(name=L["name"], types="/".join(L["types"]), times=", ".join(L["times"]), scenes=", ".join(map(str, L["scenes"]))), encoding="utf-8"); made += 1
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
