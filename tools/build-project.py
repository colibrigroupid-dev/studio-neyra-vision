#!/usr/bin/env python3
"""Сборка закрытой страницы проекта из папки Киностанции → p/<slug>/index.html.

Источник правды — папка проекта (PROEKTY/<slug>/): PROEKT.md, stranica.json, 01-zamysel/, 02-scenariy/,
03-vizual/ (referensy/, kadry/), ZHURNAL.md, SMETA.md. Страница шифруется кодом команды (AES-GCM, PBKDF2-SHA256),
смета — PRO-кодом. В исходнике страницы нет текста, только шифр.

    python3 tools/build-project.py <slug> [--proekty ~/Documents/CODE/KINO-STANCIYA/PROEKTY] [--out p]
"""
import argparse, base64, html, json, os, pathlib, re, shutil, subprocess, sys
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ITER = 310000
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

# ---------- markdown → html (ровно то, что встречается в документах станции) ----------
def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<i>\1</i>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    s = re.sub(r"\[ред\.?:?([^\]]*)\]", r'<span class="red">[ред.\1]</span>', s)
    s = re.sub(r"\[Л:?([^\]]*)\]", r'<span class="lena">[Л\1]</span>', s)
    return s

def md(text, skip_h1=True):
    out, lines, i = [], text.splitlines(), 0
    def flush_p(buf):
        if buf: out.append("<p>" + inline(" ".join(buf)) + "</p>")
    buf = []
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1]):
            flush_p(buf); buf = []
            head = [c.strip() for c in ln.strip("|").split("|")]
            rows = []; i += 2
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip("|").split("|")]); i += 1
            t = ["<div class='tbl'><table><thead><tr>" + "".join(f"<th>{inline(h)}</th>" for h in head) + "</tr></thead><tbody>"]
            for r in rows:
                t.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
            t.append("</tbody></table></div>"); out.append("".join(t)); continue
        m = re.match(r"^(#{1,4})\s+(.*)", ln)
        if m:
            flush_p(buf); buf = []
            lvl = len(m.group(1))
            if not (lvl == 1 and skip_h1):
                out.append(f"<h{min(lvl+1,4)}>{inline(m.group(2))}</h{min(lvl+1,4)}>")
            i += 1; continue
        if re.match(r"^\s*[-•]\s+", ln):
            flush_p(buf); buf = []
            items = []
            while i < len(lines) and re.match(r"^\s*[-•]\s+", lines[i]):
                items.append("<li>" + inline(re.sub(r"^\s*[-•]\s+", "", lines[i])) + "</li>"); i += 1
            out.append("<ul>" + "".join(items) + "</ul>"); continue
        if re.match(r"^\s*\d+\.\s+", ln):
            flush_p(buf); buf = []
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                items.append("<li>" + inline(re.sub(r"^\s*\d+\.\s+", "", lines[i])) + "</li>"); i += 1
            out.append("<ol>" + "".join(items) + "</ol>"); continue
        if ln.strip() == "":
            flush_p(buf); buf = []; i += 1; continue
        if ln.strip() == "---":
            flush_p(buf); buf = []; i += 1; continue
        buf.append(ln.strip()); i += 1
    flush_p(buf)
    return "\n".join(out)

def section(text, title):
    """Вернуть тело раздела `## title…` из markdown (до следующего ##)."""
    m = re.search(r"^##\s+" + re.escape(title) + r"[^\n]*\n(.*?)(?=^##\s|\Z)", text, flags=re.S | re.M)
    return m.group(1).strip() if m else ""

def first_italic(text):
    m = re.search(r"^\*(.+?)\*\s*$", text, flags=re.M)
    return m.group(1) if m else ""

# ---------- шифрование ----------
def enc(text, code):
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(code.encode())
    ct = AESGCM(key).encrypt(iv, text.encode("utf-8"), None)
    b = lambda x: base64.b64encode(x).decode()
    return json.dumps({"salt": b(salt), "iv": b(iv), "ct": b(ct), "iter": ITER})

# ---------- картинки ----------
def copy_img(src, dst_dir, name, width=1600):
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / (name + ".jpg")
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", "--resampleWidth", str(width), str(src), "--out", str(dst)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if not dst.exists():
        shutil.copy(src, dst)
    return dst

def img_size(p):
    try:
        o = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(p)], capture_output=True, text=True).stdout
        w = int(re.search(r"pixelWidth:\s*(\d+)", o).group(1)); h = int(re.search(r"pixelHeight:\s*(\d+)", o).group(1))
        return w, h
    except Exception:
        return 1600, 900

# ---------- карточки кадров: 03-vizual/kadry/<scena>-<kadr>.md ----------
def read_kadry(proj):
    cards = []
    d = proj / "03-vizual" / "kadry"
    if not d.exists():
        return cards
    for f in sorted(d.glob("*.md")):
        t = f.read_text(encoding="utf-8")
        meta = {}
        body = t
        if t.startswith("---"):
            parts = t.split("---", 2)
            if len(parts) >= 3:
                for ln in parts[1].splitlines():
                    if ":" in ln:
                        k, v = ln.split(":", 1); meta[k.strip()] = v.strip()
                body = parts[2]
        img = None
        for ext in (".jpg", ".jpeg", ".png", ".webp"):
            cand = f.with_suffix(ext)
            if cand.exists():
                img = cand; break
        cards.append({"id": meta.get("kadr", f.stem), "krupnost": meta.get("krupnost", ""), "dvizhenie": meta.get("dvizhenie", ""),
                      "obektiv": meta.get("obektiv", ""), "dlitelnost": meta.get("dlitelnost", ""), "status": meta.get("status", "draft"),
                      "prinyal": meta.get("prinyal", ""), "deystvie": meta.get("deystvie", ""), "zamechanie": meta.get("zamechanie", ""),
                      "promt": body.strip(), "img": img})
    return cards

STATUS_RU = {"draft": "черновик", "working": "в работе", "review": "на одобрении", "approved": "принят", "redo": "на доработку"}
STATUS_CLS = {"draft": "d", "working": "y", "review": "y", "approved": "g", "redo": "r"}

# ---------- сборка ----------
def build(slug, proekty, outdir):
    proj = proekty / slug
    cfg = json.loads((proj / "stranica.json").read_text(encoding="utf-8"))
    proekt = (proj / "PROEKT.md").read_text(encoding="utf-8") if (proj / "PROEKT.md").exists() else ""
    zhurnal = (proj / "ZHURNAL.md").read_text(encoding="utf-8") if (proj / "ZHURNAL.md").exists() else ""
    sinopsis = (proj / "01-zamysel" / "sinopsis.md").read_text(encoding="utf-8") if (proj / "01-zamysel" / "sinopsis.md").exists() else ""
    personazhi = (proj / "01-zamysel" / "personazhi.md").read_text(encoding="utf-8") if (proj / "01-zamysel" / "personazhi.md").exists() else ""
    poepizodnik = (proj / "02-scenariy" / "poepizodnik.md").read_text(encoding="utf-8") if (proj / "02-scenariy" / "poepizodnik.md").exists() else ""
    smeta = (proj / "SMETA.md").read_text(encoding="utf-8") if (proj / "SMETA.md").exists() else ""

    out = outdir / slug
    imgdir = out / "img"
    if imgdir.exists():
        shutil.rmtree(imgdir)

    # ключевой кадр и галерея
    hero = copy_img(proj / cfg["kadr"], imgdir, "kadr", 1920) if cfg.get("kadr") and (proj / cfg["kadr"]).exists() else None
    og = None
    if hero:
        og = imgdir / "og.jpg"
        subprocess.run(["sips", "-s", "format", "jpeg", "--resampleWidth", "1200", str(hero), "--out", str(og)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["sips", "-c", "630", "1200", str(og)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    gal = []
    gdir = proj / cfg.get("galereya", "")
    readme = (gdir / "README.md").read_text(encoding="utf-8") if gdir.exists() and (gdir / "README.md").exists() else ""
    if gdir.exists():
        for f in sorted(gdir.iterdir()):
            if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and f.name != pathlib.Path(cfg.get("kadr", "")).name:
                dst = copy_img(f, imgdir, "g-" + f.stem, 1600)
                w, h = img_size(dst)
                cap = ""
                m = re.search(r"`?" + re.escape(f.name) + r"`?\s*[—:-]\s*([^\n]+)", readme)
                if m: cap = m.group(1).strip()
                gal.append({"src": "img/" + dst.name, "w": w, "h": h, "cap": cap or f.stem.replace("-", " ")})
    kadry = read_kadry(proj)
    for c in kadry:
        if c["img"]:
            dst = copy_img(c["img"], imgdir, "k-" + c["img"].stem, 1280); c["src"] = "img/" + dst.name

    # тексты
    loglain = section(proekt, "Логлайн") or section(sinopsis, "Логлайн")
    o_chyom = section(proekt, "О чём на самом деле")
    resheno = section(proekt, "Решено")
    obsuzhdaetsya = section(proekt, "Ещё обсуждается")
    stil = section(proekt, "Стиль и референсы")
    podzag = first_italic(proekt)
    etapy = [("Сценарий", "Замысел, синопсис, поэпизодник, драфты"), ("Герои и мир", "Портреты, замок внешности, локации"),
             ("Раскадровка и аниматик", "Кадр на сцену, шот-лист, аниматик"), ("Страница проекта", "Разделы и ключи ролей"),
             ("Кадры", "Карточка каждого кадра, статусы"), ("Релиз", "Звук, монтаж, мастер, тизер")]
    etap = int(cfg.get("etap", 1))
    vehi = cfg.get("vehi", {})
    E = html.escape

    def lenta_html():
        if not gal: return ""
        cards = "".join(f'<figure class="clip"><span class="clip__frame"><img src="{g["src"]}" width="{g["w"]}" height="{g["h"]}" alt="{E(g["cap"])}" loading="lazy"></span><figcaption>{E(g["cap"])}</figcaption></figure>' for g in gal)
        return f'<section id="kadry-ref"><div class="wrap"><p class="caps">Референсы · {len(gal)}</p><h2>Мир и герои в кадрах.</h2></div><div class="lenta">{cards}</div></section>'

    def kadry_html():
        if not kadry:
            return '<section id="kadry"><div class="wrap"><p class="caps">Этап 05 · кадры</p><h2>Карточки кадров появятся после раскадровки.</h2><p class="muted">Каждый кадр получит номер, крупность, движение, объектив, длительность, промпт, варианты и статус. Красный кадр не идёт в рендер, пока режиссёр не сделал его зелёным.</p></div></section>'
        items = []
        for c in kadry:
            st = c["status"]; img = f'<img src="{c["src"]}" width="1280" height="720" alt="" loading="lazy">' if c.get("src") else ""
            specs = " ".join(f"<span>{E(x)}</span>" for x in (c["krupnost"], c["dvizhenie"], c["obektiv"], c["dlitelnost"]) if x)
            items.append(f'<li class="board"><div class="board__frame">{img}<span class="board__id">{E(c["id"])}</span><span class="board__st {STATUS_CLS.get(st,"d")}">{STATUS_RU.get(st,st)}</span></div><div class="board__specs">{specs}</div><p class="board__action">{E(c["deystvie"])}</p>{"<p class=board__note>Замечание: "+E(c["zamechanie"])+"</p>" if c["zamechanie"] else ""}{"<p class=board__who>Принял: "+E(c["prinyal"])+"</p>" if c["prinyal"] else ""}</li>')
        return f'<section id="kadry"><div class="wrap"><p class="caps">Этап 05 · кадры · {len(kadry)}</p><h2>Каждый кадр — своя карточка.</h2><ol class="boards">{"".join(items)}</ol></div></section>'

    def path_html():
        rows = []
        for n, (name, what) in enumerate(etapy, 1):
            cls = "done" if n < etap else ("now" if n == etap else "")
            veha = {1: "1", 3: "2", 5: "3", 6: "4"}.get(n)
            v = f'<span class="gate">◆ веха {veha}{(" · " + E(vehi.get(veha, ""))) if vehi.get(veha) else ""}</span>' if veha else ""
            rows.append(f'<li class="{cls}"><span class="n">0{n}</span><span class="t"><b>{name}</b><small>{what}</small></span>{v}</li>')
        return f'<section id="put"><div class="wrap"><p class="caps">Путь проекта</p><h2>Этап {etap} из 6.</h2><ol class="put">{"".join(rows)}</ol></div></section>'

    def karta_html():
        sec = section(proekt, "Карта производства")
        if not sec: return ""
        lines = [l for l in sec.splitlines() if l.startswith("|")]
        if len(lines) < 3: return ""
        head = [c.strip() for c in lines[0].strip("|").split("|")]
        rows = [[c.strip() for c in l.strip("|").split("|")] for l in lines[2:]]
        def cell(v):
            ch = v[:1]
            cls = {"○": "e", "●": "w", "✓": "d", "◆": "a", "✗": "r"}.get(ch, "e")
            txt = v[1:].strip()
            return f'<td class="k {cls}"><span class="k__sym">{E(ch) if ch in "○●✓◆✗" else ""}</span><span class="k__txt">{E(txt if ch in "○●✓◆✗" else v)}</span></td>'
        thead = "".join(f"<th>{E(h)}</th>" for h in head)
        tbody = "".join("<tr>" + f"<th scope='row'>{E(r[0])}</th>" + "".join(cell(c) for c in r[1:]) + "</tr>" for r in rows)
        note = first_italic(sec)
        return f'<section id="karta"><div class="wrap"><p class="caps">Карта производства</p><h2>Кто над чем работает сейчас.</h2>{"<p class=muted>"+inline(note)+"</p>" if note else ""}<div class="karta"><table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table></div></div></section>'

    def people_html():
        rows = "".join(f'<div class="cred"><span class="cred__rol">{E(p["rol"])}</span><span class="cred__imya">{E(p["imya"])}</span></div>' for p in cfg.get("lyudi", []))
        k = cfg.get("kontakt", {})
        kont = f'<p class="kontakt">Контакт продюсера: <b>{E(k.get("imya",""))}</b> · <a href="{E(k.get("telegram",""))}">Telegram</a> · <a href="mailto:{E(k.get("pochta",""))}">{E(k.get("pochta",""))}</a></p>' if k else ""
        return f'<section id="komanda"><div class="wrap"><p class="caps">Команда</p><h2>Кто делает.</h2><div class="creds">{rows}</div>{kont}</div></section>'

    def zhurnal_html():
        if not zhurnal: return ""
        return f'<section id="zhurnal"><div class="wrap"><p class="caps">Журнал решений</p><h2>Что решили и когда.</h2><div class="doc doc--zh">{md(zhurnal)}</div></div></section>'

    meta_line = "".join(f"<li>{E(m)}</li>" for m in cfg.get("meta", []))
    hero_img = f'<img src="img/{hero.name}" width="1920" height="1080" alt="" fetchpriority="high" style="object-position:{E(cfg.get("kadr_position","center"))}">' if hero else ""

    loglain_html = inline(re.sub(r"\s+", " ", loglain))
    credits_html = " · ".join(E(p["rol"]) + " <b>" + E(p["imya"]) + "</b>" for p in cfg.get("lyudi", [])[:2])
    podzag_html = "<p class='podzag'>" + inline(podzag) + "</p>" if podzag else ""
    obs_html = "<p class='caps' style='margin-top:1.5rem'>Ещё обсуждается</p><div class='doc'>" + md(obsuzhdaetsya) + "</div>" if obsuzhdaetsya else ""
    stil_html = "<section id='stil'><div class='wrap'><p class='caps'>Стиль и референсы</p><div class='doc'>" + md(stil) + "</div></div></section>" if stil else ""
    content = f'''
<header class="title-hero">
  <div class="title-hero__art" aria-hidden="true">{hero_img}</div>
  <div class="wrap title-hero__body">
    <p class="caps">{E(cfg.get("tip",""))} · {E(cfg.get("status",""))}</p>
    <h1>{E(cfg["nazvanie"])}</h1>
    <ul class="meta">{meta_line}</ul>
    <p class="logline">{loglain_html}</p>
    <div class="actions"><a class="btn btn--main" href="#put">Где мы сейчас</a><a class="btn btn--ghost" href="#zamysel">Замысел</a></div>
    <p class="credits-line">{credits_html}</p>
  </div>
</header>
{path_html()}
{karta_html()}
<section id="zamysel"><div class="wrap grid2">
  <div><p class="caps">Замысел</p><h2>О чём на самом деле.</h2><div class="doc big">{md(o_chyom)}</div>{podzag_html}</div>
  <div><p class="caps">Решено</p><div class="doc">{md(resheno)}</div>{obs_html}</div>
</div></section>
{lenta_html()}
<section id="sinopsis"><div class="wrap"><p class="caps">Синопсис</p><h2>История.</h2><div class="doc cols">{md(sinopsis)}</div></div></section>
<section id="geroi"><div class="wrap"><p class="caps">Герои</p><h2>Кто есть кто.</h2><div class="doc">{md(personazhi)}</div></div></section>
<section id="poepizodnik"><div class="wrap"><p class="caps">Поэпизодник</p><h2>Пятнадцать битов.</h2><div class="doc">{md(poepizodnik)}</div></div></section>
{stil_html}
{kadry_html()}
{people_html()}
<section id="smeta"><div class="wrap"><p class="caps">Смета и план · по PRO-коду</p><div id="pro"><form class="gate gate--inline" data-pro><input name="code" placeholder="PRO-код" autocomplete="off"><button class="btn btn--ghost" type="submit">Открыть</button></form></div></div></section>
{zhurnal_html()}
'''
    pro_html = f'<div class="doc">{md(smeta)}</div>' if smeta else '<p class="muted">Сметы пока нет.</p>'

    desc = E(re.sub(r"\s+", " ", re.sub(r"\[.*?\]", "", loglain))[:160])
    shell = (HERE / "shablon-proekta.html").read_text(encoding="utf-8")
    page = (shell.replace("__TITLE__", E(cfg["nazvanie"]) + " · Neyra Vision Studio")
                 .replace("__DESC__", desc)
                 .replace("__OG__", "img/og.jpg" if og else "")
                 .replace("__BG__", cfg.get("paletka", {}).get("bg", "oklch(0.14 0.008 70)"))
                 .replace("__ACCENT__", cfg.get("paletka", {}).get("accent", "oklch(0.82 0.13 80)"))
                 .replace("__PAYLOAD__", enc(content, cfg["kod_komandy"].upper()))
                 .replace("__PAYLOAD_PRO__", enc(pro_html, (cfg.get("kod_pro") or "NOPRO").upper()))
                 .replace("__NAZVANIE__", E(cfg["nazvanie"])))
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(page, encoding="utf-8")
    print(f"ok {out/'index.html'} · {(out/'index.html').stat().st_size//1024} КБ · код {cfg['kod_komandy']} · референсов {len(gal)} · кадров {len(kadry)}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--proekty", default=str(pathlib.Path.home() / "Documents/CODE/KINO-STANCIYA/PROEKTY"))
    ap.add_argument("--out", default=str(ROOT / "p"))
    a = ap.parse_args()
    build(a.slug, pathlib.Path(a.proekty).expanduser(), pathlib.Path(a.out))
