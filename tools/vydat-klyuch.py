#!/usr/bin/env python3
"""Выпуск ключа участника на сервере команды (№35) без показа секрета в терминале.

  python3 tools/vydat-klyuch.py <slug> "<Имя Фамилия>" <роль> [--email адрес] [--create "<Название проекта>"] [--sections a,b,c]

Роли: producer, director, writer, cinematographer, artist, editor, viewer.
Доступ выдающего — ~/.config/neyra-studio/sync.json {url, key} (как у sync-project.py) или NV_URL/NV_KEY.
Ключ участника пишется в ~/.config/neyra-studio/KLYUCH-<slug>-<id>.txt (права 600) и на экран НЕ выводится.
"""
import argparse, json, os, pathlib, re, sys, urllib.request, urllib.error

HOME = pathlib.Path.home()
ROLE_SECTIONS = {
    "producer": "overview,script,breakdown,heroes,locations,world,storyboard,shots,continuity,sound,edit,plan,journal,animatic,team,post",
    "director": "overview,script,breakdown,heroes,locations,world,storyboard,shots,continuity,sound,edit,journal,animatic,team,post",
    "writer": "overview,script,breakdown,journal,team",
    "cinematographer": "overview,storyboard,shots,continuity,journal,team",
    "artist": "overview,heroes,locations,world,storyboard,shots,continuity,journal,team",
    "editor": "overview,edit,sound,animatic,post,journal,team",
    "viewer": "overview,script,breakdown,heroes,locations,world,storyboard,shots,continuity,sound,edit,journal,animatic,team,post",
}


def cfg():
    url, key = os.environ.get("NV_URL"), os.environ.get("NV_KEY")
    p = HOME / ".config/neyra-studio/sync.json"
    if (not url or not key) and p.exists():
        d = json.loads(p.read_text()); url, key = url or d.get("url"), key or d.get("key")
    if not url or not key:
        sys.exit("нет доступа: ~/.config/neyra-studio/sync.json {url, key} или NV_URL/NV_KEY")
    return url.rstrip("/"), key


def api(method, path, body=None):
    url, key = cfg()
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(url + path, data=data, method=method, headers={"X-Key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:  # noqa: BLE001
            return e.code, {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug"); ap.add_argument("name"); ap.add_argument("role", choices=sorted(ROLE_SECTIONS))
    ap.add_argument("--email", default=""); ap.add_argument("--create", default=""); ap.add_argument("--sections", default="")
    a = ap.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,60}", a.slug):
        sys.exit("slug — латиница, цифры, дефис")
    st, j = api("GET", "/api/projects/" + a.slug)
    if st == 404 and a.create:
        st, j = api("POST", "/api/projects", {"slug": a.slug, "title": a.create})
        if st != 201:
            sys.exit("не создал проект: %s %s" % (st, (j.get("error") or {}).get("message", j)))
        print("проект создан:", a.slug, "—", a.create)
    elif st != 200:
        sys.exit("проекта %s нет (добавьте --create \"Название\") или нет доступа: %s %s" % (a.slug, st, (j.get("error") or {}).get("message", "")))
    body = {"name": a.name, "role": a.role, "sections": (a.sections or ROLE_SECTIONS[a.role]).split(",")}
    if a.email:
        body["email"] = a.email
    st, j = api("POST", "/api/projects/%s/members" % a.slug, body)
    if st != 201 or not j.get("key"):
        sys.exit("ключ не выпущен: %s %s" % (st, json.dumps(j.get("error") or j, ensure_ascii=False)[:400]))
    m = j.get("data") or {}
    out = HOME / ".config/neyra-studio" / ("KLYUCH-%s-%s.txt" % (a.slug, m.get("id", "member")))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        "Ключ участника studio.neyra.vision\n"
        "Кому: %s · роль: %s · проект: %s\n"
        "Как войти: https://studio.neyra.vision/scenariy/ → кнопка «Сервер» → вставить ключ → «Проекты» → «Проекты команды на сервере».\n"
        "Кабинет проекта: https://studio.neyra.vision/studio/ → «Сервер» → тот же ключ.\n\n"
        "%s\n" % (a.name, a.role, a.slug, j["key"]), encoding="utf-8")
    os.chmod(out, 0o600)
    print("участник:", m.get("id"), "·", a.name, "·", a.role, "· разделы:", ",".join(m.get("sections") or body["sections"]))
    print("ключ записан в:", out, "(секрет на экран не выводится)")


if __name__ == "__main__":
    main()
