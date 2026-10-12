#!/usr/bin/env python3
"""Мост «папка проекта Киностанции ↔ сервер хранения» (№29).

    python3 tools/sync-project.py <slug> push      папка → сервер (проект, сценарий + версия, карта производства)
    python3 tools/sync-project.py <slug> pull      сервер → папка (новый драфт файлом, карта в PROEKT.md)
    python3 tools/sync-project.py <slug> status    что различается
    python3 tools/sync-project.py <slug> razbivka [--draft <файл.fountain>]   разбивка + паспорта → сервер (№21.a: /breakdown, /characters, /locations)
    python3 tools/sync-project.py <slug> pasporta [--apply]   паспорта с сервера → канон: показать расхождения; --apply переносит правки команды в KANON.md

Доступ: ~/.config/neyra-studio/sync.json  →  {"url": "http://127.0.0.1:8770", "key": "…"}  (или переменные NV_URL, NV_KEY).
Источник правды — папка; сервер — рабочая копия команды. Ничего не затирается: сценарий с сервера ложится новым файлом
drafty/draft-NN.fountain, карта в PROEKT.md переписывается только внутри таблицы раздела «Карта производства».
"""
import argparse, json, os, pathlib, re, sys, urllib.request, urllib.error, datetime
sys.path.insert(0, str(pathlib.Path(__file__).parent))

HOME = pathlib.Path.home()
PROEKTY = HOME / "Documents/CODE/KINO-STANCIYA/PROEKTY"
STAGES = ["script", "breakdown", "heroes", "locations", "storyboard", "shots", "video", "sound", "edit"]
STAGE_RU = ["Сценарий", "Разбивка", "Герои", "Локации", "Раскадровка", "Кадры", "Видео", "Звук", "Монтаж"]
SYM = {"○": "empty", "●": "working", "✓": "done", "◆": "done", "✗": "returned"}
SYM_BACK = {"empty": "○", "working": "●", "done": "✓", "awaiting": "◆", "approved": "◆", "returned": "✗"}

def cfg():
    url, key = os.environ.get("NV_URL"), os.environ.get("NV_KEY")
    p = HOME / ".config/neyra-studio/sync.json"
    if (not url or not key) and p.exists():
        d = json.loads(p.read_text()); url, key = url or d.get("url"), key or d.get("key")
    if not url or not key:
        sys.exit("нет доступа: создайте ~/.config/neyra-studio/sync.json {url, key} или NV_URL/NV_KEY")
    return url.rstrip("/"), key

def api(method, path, body=None):
    url, key = cfg()
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(url + path, data=data, method=method, headers={"X-Key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

def slugify(s):
    tr = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"yo","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"c","ч":"ch","ш":"sh","щ":"shch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya","ә":"a","ғ":"g","қ":"q","ң":"ng","ө":"o","ұ":"u","ү":"u","һ":"h","і":"i"}
    out = "".join(tr.get(c, c) for c in s.lower()); out = re.sub(r"[^a-z0-9]+", "-", out).strip("-")
    return out[:60] or "x"

# ---------- папка ----------
def read_karta(proekt_md):
    m = re.search(r"^## Карта производства[^\n]*\n(.*?)(?=^## |\Z)", proekt_md, flags=re.S | re.M)
    if not m: return None, []
    sec = m.group(1)
    lines = [l for l in sec.splitlines() if l.startswith("|")]
    if len(lines) < 3: return sec, []
    rows = []
    for l in lines[2:]:
        c = [x.strip() for x in l.strip("|").split("|")]
        if len(c) < 2: continue
        rows.append({"name": c[0], "cells": c[1:1 + len(STAGES)]})
    return sec, rows

def write_karta(proekt_md, rows):
    head = "| Объект | " + " | ".join(STAGE_RU) + " |\n|" + "---|" * (len(STAGES) + 1) + "\n"
    body = "".join("| " + r["name"] + " | " + " | ".join(r["cells"]) + " |\n" for r in rows)
    m = re.search(r"(^## Карта производства[^\n]*\n)(.*?)(?=^## |\Z)", proekt_md, flags=re.S | re.M)
    if not m: return proekt_md.rstrip("\n") + "\n\n## Карта производства\n*○ не начато · ● в работе (кто) · ✓ готово · ◆ принято/ждёт · ✗ вернули.*\n\n" + head + body
    sec = m.group(2)
    note = re.search(r"^\*.*\*\s*$", sec, flags=re.M)
    new_sec = (note.group(0) + "\n\n" if note else "") + head + body
    return proekt_md[:m.start(2)] + new_sec + proekt_md[m.end(2):]

def latest_draft(proj):
    d = proj / "02-scenariy" / "drafty"
    if not d.exists(): return None, 0
    fs = sorted(d.glob("draft-*.fountain"))
    if not fs: return None, 0
    n = int(re.search(r"draft-(\d+)", fs[-1].name).group(1))
    return fs[-1], n

# ---------- действия ----------
def ensure_project(slug, proj):
    st, r = api("GET", f"/api/projects/{slug}")
    if st == 200: return r["data"]
    cfgj = json.loads((proj / "stranica.json").read_text()) if (proj / "stranica.json").exists() else {}
    title = cfgj.get("nazvanie") or re.search(r"^#\s+(.+)$", (proj / "PROEKT.md").read_text(), flags=re.M).group(1)
    st, r = api("POST", "/api/projects", {"slug": slug, "title": title, "language": "ru"})
    if st != 201: sys.exit(f"не удалось создать проект: {st} {r}")
    print(f"создан проект {slug} «{title}»"); return r["data"]

def push(slug):
    proj = PROEKTY / slug
    ensure_project(slug, proj)
    # сценарий
    f, n = latest_draft(proj)
    if f:
        text = f.read_text(encoding="utf-8")
        st, r = api("GET", f"/api/projects/{slug}/script")
        if st == 200 and r["data"].get("text") == text:
            print(f"сценарий: совпадает с {f.name}")
        else:
            st, r = api("PUT", f"/api/projects/{slug}/script", {"text": text, "language": "ru"})
            st2, r2 = api("POST", f"/api/projects/{slug}/versions", {"label": f.stem})
            print(f"сценарий: отправлен {f.name} ({st}), версия {f.stem} ({st2})")
    else:
        print("сценарий: драфтов в 02-scenariy/drafty/ нет — пропуск")
    # карта
    proekt = (proj / "PROEKT.md").read_text(encoding="utf-8")
    _, rows = read_karta(proekt)
    st, m = api("GET", f"/api/projects/{slug}/map")
    existing = {(c["object"]["type"], c["object"]["id"], c["stage"]): c for c in (m.get("data", {}).get("cells") or [])} if st == 200 else {}
    made = upd = 0
    for row in rows:
        oid = slugify(row["name"])
        for stage, val in zip(STAGES, row["cells"]):
            sym = val[:1] if val[:1] in SYM else "○"
            status = SYM[sym]; name = val[1:].strip()
            key = ("episode", oid, stage)
            body = {"status": status, "comment": name, "assignee": {"keyId": None, "name": name if status == "working" else ""}}
            if key in existing:
                c = existing[key]
                if c["status"] in ("approved", "awaiting", "returned"): continue  # вердикты сервера сильнее папки
                if c["status"] != status or (c.get("comment") or "") != name:
                    st, r = api("PATCH", f"/api/projects/{slug}/cells/{c['id']}", body); upd += (st == 200)
            else:
                if status == "empty" and not name: continue
                st, r = api("POST", f"/api/projects/{slug}/cells", {"object": {"type": "episode", "id": oid}, "stage": stage, **body})
                made += (st == 201)
                if st not in (201,): print(f"  клетка {row['name']} × {stage}: {st} {r.get('error', {}).get('message', '')}")
    print(f"карта: строк {len(rows)}, клеток создано {made}, обновлено {upd}")

def pull(slug):
    proj = PROEKTY / slug
    st, r = api("GET", f"/api/projects/{slug}/script")
    if st == 200 and r["data"].get("text", "").strip():
        text = r["data"]["text"]; f, n = latest_draft(proj)
        if f and f.read_text(encoding="utf-8") == text:
            print(f"сценарий: без изменений ({f.name})")
        else:
            d = proj / "02-scenariy" / "drafty"; d.mkdir(parents=True, exist_ok=True)
            new = d / f"draft-{n + 1:02d}.fountain"; new.write_text(text, encoding="utf-8")
            print(f"сценарий: новый файл {new.name} (с сервера, {len(text)} знаков)")
            with (proj / "ZHURNAL.md").open("a", encoding="utf-8") as z:
                z.write(f"\n- {datetime.date.today():%d.%m.%Y} · sync: сценарий с сервера сохранён как `{new.name}`\n")
    else:
        print("сценарий: на сервере пусто")
    st, m = api("GET", f"/api/projects/{slug}/map")
    if st != 200: sys.exit(f"карта: {st}")
    cells = m["data"].get("cells") or []
    proekt = (proj / "PROEKT.md").read_text(encoding="utf-8")
    _, rows = read_karta(proekt)
    by_row = {slugify(r["name"]): r for r in rows}
    changed = 0
    for c in cells:
        if c["object"]["type"] != "episode": continue
        row = by_row.get(c["object"]["id"])
        if not row: continue
        i = STAGES.index(c["stage"]); sym = SYM_BACK.get(c["status"], "○")
        txt = (c.get("assignee") or {}).get("name") or c.get("comment") or ""
        if c["status"] == "done" and txt.lower().startswith("принят"): sym = "◆"  # ◆ в папке = принято; сервер хранит done + комментарий
        val = (sym + " " + txt).strip()
        if row["cells"][i] != val: row["cells"][i] = val; changed += 1
    if changed:
        (proj / "PROEKT.md").write_text(write_karta(proekt, rows), encoding="utf-8")
    print(f"карта: клеток на сервере {len(cells)}, обновлено в PROEKT.md {changed}")


def razbivka_push(slug, draft=None):
    """Сценарий → razbivka.json → POST /breakdown; паспорта из KANON.md и карточек → /characters, /locations (по имени, без дублей)."""
    import razbivka, kanon
    proj = PROEKTY / slug
    ensure_project(slug, proj)
    f = pathlib.Path(draft) if draft else latest_draft(proj)[0]
    if not f or not f.exists(): sys.exit("нет драфта: укажите --draft <файл.fountain>")
    d = razbivka.parse(f.read_text(encoding="utf-8"))
    st, r = api("POST", f"/api/projects/{slug}/breakdown", d)
    if st == 404: sys.exit("сервер ещё не умеет /breakdown (№21.a у Codex)")
    if st not in (200, 201): sys.exit(f"разбивка: {st} {r}")
    rd = r.get("data", {})
    print(f"разбивка: {st} · сцен {len(d['scenes'])}, героев {len(d['characters'])}, локаций {len(d['locations'])}" + (f" · сервер: {json.dumps(rd, ensure_ascii=False)[:160]}" if rd else ""))
    K = kanon.read_kanon(proj)
    if not K: print("канона нет — паспорта на сервер не ушли (python3 tools/kanon.py init)"); return
    for coll, items, tagp in (("characters", K["heroes"], "@char_"), ("locations", K["locs"], "@loc_")):
        st, r = api("GET", f"/api/projects/{slug}/{coll}")
        have = r.get("data", []) if st == 200 else []
        have = have if isinstance(have, list) else have.get("items", [])
        by_name = {x.get("name", "").upper(): x for x in have}
        made = upd = 0
        for tag, h in items.items():
            body = {"name": h["imya"], "identity": h["identity"], "taboo": h["taboo"], "refs": [{"path": x.split(" ")[0], "role": "identity" if coll == "characters" else "environment"} for x in h["refs"]],
                    "status": "locked" if h["refs"] and h["identity"] else "draft"}
            if coll == "characters" and h.get("height"): body["height"] = h["height"]
            ex = by_name.get(h["imya"].upper())
            if ex:
                diff = {k: v for k, v in body.items() if ex.get(k) != v}
                if diff:
                    st, r = api("PATCH", f"/api/projects/{slug}/{coll}/{ex['id']}", diff); upd += (st == 200)
                    if st != 200: print(f"  {coll} {h['imya']}: {st} {r.get('error', {}).get('message', '')}")
            else:
                st, r = api("POST", f"/api/projects/{slug}/{coll}", body); made += (st == 201)
                if st != 201: print(f"  {coll} {h['imya']}: {st} {r.get('error', {}).get('message', '')}")
        print(f"{coll}: создано {made}, обновлено {upd}, было {len(have)}")

def pasporta_pull(slug, apply=False):
    """Правки паспортов, сделанные командой в окне (role/identity/taboo/height/status), → KANON.md. Без --apply только показывает."""
    import kanon
    proj = PROEKTY / slug; K = kanon.read_kanon(proj)
    if not K: sys.exit("канона нет")
    kp = proj / "03-vizual" / "KANON.md"; text = kp.read_text(encoding="utf-8"); changes = []
    for coll, items, field_names in (("characters", K["heroes"], ("identity", "taboo", "height")), ("locations", K["locs"], ("identity",))):
        st, r = api("GET", f"/api/projects/{slug}/{coll}")
        if st != 200: print(f"{coll}: {st}"); continue
        srv = r.get("data", []); srv = srv if isinstance(srv, list) else srv.get("items", [])
        by_name = {x.get("name", "").upper(): x for x in srv}
        for tag, h in items.items():
            x = by_name.get(h["imya"].upper())
            if not x: continue
            for f in field_names:
                sv = x.get(f); lv = h.get(f)
                if isinstance(sv, list): sv = "; ".join(sv); lv = "; ".join(lv or [])
                sv = (sv or "").strip(); lv = (lv or "").strip()
                if sv and sv != lv:
                    changes.append((tag, f, lv, sv))
    if not changes: print("паспорта: расхождений с сервером нет"); return
    for tag, f, lv, sv in changes: print(f"  {tag} · {f}: «{lv[:60] or '—'}» → «{sv[:60]}»")
    if not apply: print(f"расхождений {len(changes)} — применить: pasporta --apply"); return
    for tag, f, lv, sv in changes:
        m = re.search(rf"(^### {re.escape(tag)} ·[^\n]*\n)((?:(?!^### |^## )[^\n]*\n)*)", text, flags=re.M)
        if not m: continue
        block = m.group(2)
        if re.search(rf"^{f}:.*$", block, flags=re.M): block = re.sub(rf"^{f}:.*$", f"{f}: {sv}", block, count=1, flags=re.M)
        else: block = block.rstrip("\n") + f"\n{f}: {sv}\n"
        text = text[:m.start(2)] + block + text[m.end(2):]
    kp.write_text(text, encoding="utf-8")
    with (proj / "ZHURNAL.md").open("a", encoding="utf-8") as z:
        z.write(f"\n- {datetime.date.today():%d.%m.%Y} · sync: правки паспортов команды с сервера перенесены в KANON.md ({len(changes)}): " + "; ".join(f"{t} {f}" for t, f, _, _ in changes) + "\n")
    print(f"применено {len(changes)}; версия канона изменилась — `kanon.py reestr {slug}` покажет устаревшие кадры")

def status(slug):
    proj = PROEKTY / slug
    st, r = api("GET", f"/api/projects/{slug}")
    print("проект на сервере:", "есть" if st == 200 else f"нет ({st})")
    f, n = latest_draft(proj); print("драфт в папке:", f.name if f else "нет")
    st, r = api("GET", f"/api/projects/{slug}/script"); print("сценарий на сервере:", f"{len((r.get('data') or {}).get('text',''))} знаков" if st == 200 else st)
    st, m = api("GET", f"/api/projects/{slug}/map"); print("клеток карты:", len((m.get("data") or {}).get("cells") or []) if st == 200 else st)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("slug"); ap.add_argument("action", choices=["push", "pull", "status", "razbivka", "pasporta"]); ap.add_argument("--draft"); ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    if a.action == "razbivka": razbivka_push(a.slug, a.draft)
    elif a.action == "pasporta": pasporta_pull(a.slug, a.apply)
    else: {"push": push, "pull": pull, "status": status}[a.action](a.slug)
