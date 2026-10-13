"""Парсер разбивки Fountain → сцены, герои, локации, капс-упоминания (перенос tools/razbivka.py в блок, 13.10.2026).

Чистые функции без файлов и HTTP. tools/razbivka.py импортирует parse() отсюда, чтобы разбивка
на маке и на сервере была одной и той же."""
import re
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
            mm = re.match(r"^=\s*(тон|ton|визуал|visual|вижуал)\s*:\s*(.+)$", s, re.I)
            if mm and cur is not None:
                # «= Тон: тревога» / «= Визуал: холодный рассвет» — заметки автора к сцене (ТЗ Ара, Writer п. 3)
                cur["ton" if mm.group(1).lower() in ("тон", "ton") else "vizual"] = mm.group(2).strip()[:2000]
                i += 1; continue
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

