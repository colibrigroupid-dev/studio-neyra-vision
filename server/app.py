#!/usr/bin/env python3
"""Хранение Neyra Vision Studio: только стандартная библиотека Python 3.9+."""

import argparse
import copy
from datetime import datetime, timezone
import hmac
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit
import uuid


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KEYS = Path.home() / ".config/neyra-studio/keys.json"
MAX_BODY = 2 * 1024 * 1024
SECTIONS = frozenset(("overview", "script", "storyboard", "shots", "animatic", "team", "post"))
ROLE_SECTIONS = {
    "admin": SECTIONS, "director": SECTIONS, "producer": SECTIONS,
    "writer": frozenset(("overview", "script")),
    "artist": frozenset(("overview", "storyboard", "shots")),
    "editor": frozenset(("overview", "animatic", "post")),
    "viewer": SECTIONS - {"team"},
}
MANAGERS = frozenset(("admin", "director", "producer"))
STATUSES = frozenset(("draft", "working", "review", "approved"))
SLUG = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z")
PUBLIC_EXTENSIONS = frozenset((
    ".html", ".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".webp", ".avif",
    ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm",
    ".mp3", ".wav", ".ogg",
))


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def invalid(message):
    raise ApiError(422, "VALIDATION_ERROR", message)


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def identifier(value, slug=False):
    pattern = SLUG if slug else IDENTIFIER
    if not isinstance(value, str) or not pattern.fullmatch(value):
        invalid("Некорректный slug или идентификатор.")
    return value


def text(value, name, limit=1000000, required=False):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        invalid("Некорректное текстовое поле: " + name)
    # Некорректный UTF-8 не должен приводить к ошибке при записи или выдаче.
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        invalid("Некорректный Unicode: " + name)
    return value


def fields(body, allowed, required=()):
    if set(body) - set(allowed) or set(required) - set(body):
        invalid("Неизвестные поля или отсутствуют обязательные поля.")


def enum(value, choices, name):
    if not isinstance(value, str) or value not in choices:
        invalid("Недопустимое значение: " + name)
    return value


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Повтор поля JSON")
        result[key] = value
    return result


def parse_json(raw):
    def bad_constant(value):
        raise ValueError("Недопустимая константа JSON")
    return json.loads(raw, object_pairs_hook=no_duplicates, parse_constant=bad_constant)


def load_keys(path):
    """Каждый запрос перечитывает конфиг: отзыв ключа действует без перезапуска."""
    try:
        config = parse_json(path.read_text(encoding="utf-8"))
        if not isinstance(config, dict) or set(config) != {"keys"}:
            raise ValueError()
        entries = config["keys"]
        if not isinstance(entries, list) or not entries:
            raise ValueError()
        result, secrets = {}, set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError()
            fields(entry, ("id", "key", "role", "projects", "sections"),
                   ("id", "key", "role", "projects", "sections"))
            key_id = identifier(entry["id"])
            role = enum(entry["role"], ROLE_SECTIONS, "role")
            secret = entry["key"]
            if (not isinstance(secret, str) or not 1 <= len(secret) <= 512
                    or any(ord(c) < 33 or ord(c) > 126 for c in secret)
                    or key_id in result or secret in secrets):
                raise ValueError()
            projects, sections = entry["projects"], entry["sections"]
            if not isinstance(projects, list) or not projects:
                raise ValueError()
            for slug in projects:
                if slug != "*":
                    identifier(slug, slug=True)
            if not isinstance(sections, list) or not sections:
                raise ValueError()
            for section in sections:
                enum(section, SECTIONS | {"*"}, "sections")
            scope = ROLE_SECTIONS[role] if "*" in sections else frozenset(sections)
            result[key_id] = dict(entry, sections=scope & ROLE_SECTIONS[role],
                                  projects=frozenset(projects))
            secrets.add(secret)
        return result
    except (OSError, ValueError, TypeError, RecursionError, ApiError):
        raise ApiError(503, "KEYS_UNAVAILABLE", "Конфигурация ключей недоступна или некорректна.") from None


def atomic_write(path, value):
    """Единственная точка фиксации — replace; до неё прежний JSON не меняется."""
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        payload = json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".project-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    except (OSError, ValueError):
        raise ApiError(500, "STORAGE_WRITE_FAILED", "Не удалось записать данные. Изменения не сохранены.") from None
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                pass


def project_scope(principal, slug):
    return "*" in principal["projects"] or slug in principal["projects"]


def authorize(principal, slug, section, project=None, write=False, manager=False):
    allowed = principal["sections"]
    if project is not None and principal["role"] != "admin":
        member = next((m for m in project["members"] if m["keyId"] == principal["id"]), None)
        if member is None or member["role"] != principal["role"]:
            raise ApiError(403, "FORBIDDEN", "Нет доступа к проекту.")
        allowed = allowed & set(member["sections"])
    if (not project_scope(principal, slug) or section not in allowed
            or (write and principal["role"] == "viewer")
            or (manager and principal["role"] not in MANAGERS)):
        raise ApiError(403, "FORBIDDEN", "Нет прав на этот проект или раздел.")


def metadata(project):
    return {field: project[field] for field in
            ("slug", "title", "synopsis", "language", "createdAt", "updatedAt", "revision")}


def get_item(items, item_id):
    for item in items:
        if item["id"] == item_id:
            return item
    raise ApiError(404, "NOT_FOUND", "Объект не найден.")


def script_input(body, current):
    fields(body, ("text", "language", "status"), ("text",))
    return {
        "text": text(body["text"], "text"),
        "language": enum(body.get("language", current["language"]), ("ru", "kk"), "language"),
        "status": enum(body.get("status", "draft"), STATUSES, "status"),
        "updatedAt": timestamp(),
    }


def scene_input(body, create=False):
    fields(body, ("id", "title", "text") if create else ("title", "text"),
           ("title",) if create else ())
    result = {}
    for name, limit in (("title", 240), ("text", 1000000)):
        if name in body:
            result[name] = text(body[name], name, limit, required=(name == "title"))
    if create:
        result.update(id=identifier(body.get("id", uuid.uuid4().hex)))
        result.setdefault("text", "")
    return result


def media_url(value, name):
    value = text(value, name, 2048)
    try:
        url = urlsplit(value)
    except ValueError:
        invalid("Некорректный адрес материала.")
    if value and (any(ord(c) < 32 for c in value) or "\\" in value
                  or (url.scheme and url.scheme not in ("http", "https"))
                  or (url.scheme and not url.netloc) or (not url.scheme and url.netloc)):
        invalid("Некорректный адрес материала.")
    return value


def shot_input(body, project, create=False):
    names = ("sceneId", "title", "description", "prompt", "duration", "status",
             "owner", "lens", "movement", "imageUrl", "videoUrl")
    fields(body, names + (("id",) if create else ()), ("sceneId", "title") if create else ())
    result = {}
    for name in ("title", "description", "prompt", "owner", "lens", "movement"):
        if name in body:
            result[name] = text(body[name], name, 240 if name == "title" else 8000,
                                required=(name == "title"))
    if "sceneId" in body:
        result["sceneId"] = identifier(body["sceneId"])
        get_item(project["scenes"], result["sceneId"])
    if "status" in body:
        result["status"] = enum(body["status"], STATUSES, "status")
    if "duration" in body:
        value = body["duration"]
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not 0 < value <= 3600 or not math.isfinite(value)):
            invalid("Длительность должна быть числом от 0 (исключая) до 3600 секунд.")
        result["duration"] = value
    for name in ("imageUrl", "videoUrl"):
        if name in body:
            result[name] = media_url(body[name], name)
    if create:
        result.update(id=identifier(body.get("id", uuid.uuid4().hex)), aspectRatio="16:9", needsReview=False)
        for name in ("description", "prompt", "owner", "lens", "movement", "imageUrl", "videoUrl"):
            result.setdefault(name, "")
        result.setdefault("duration", 5)
        result.setdefault("status", "draft")
    return result


def member_input(body, slug, keys, current=None):
    fields(body, ("name", "role", "sections", "keyId"),
           ("name", "role", "sections", "keyId") if current is None else ())
    result = dict(current or {}, **body)
    result["name"] = text(result["name"], "name", 240, required=True)
    role = enum(result["role"], ROLE_SECTIONS, "role")
    key_id = identifier(result["keyId"])
    sections = result["sections"]
    target = keys.get(key_id)
    if (not isinstance(sections, list) or not sections
            or any(not isinstance(s, str) or s not in SECTIONS for s in sections)
            or len(set(sections)) != len(sections)
            or target is None or role != target["role"] or not project_scope(target, slug)
            or not set(sections) <= target["sections"]):
        invalid("Роль, проект и разделы участника должны соответствовать внешнему ключу.")
    if current is None:
        result["id"] = uuid.uuid4().hex
    return result


def snapshot(project, principal, kind, label="", source=None):
    version = {
        "id": uuid.uuid4().hex, "number": len(project["versions"]) + 1,
        "kind": kind, "label": label, "script": copy.deepcopy(project["script"]),
        "scenes": copy.deepcopy(project["scenes"]), "createdAt": timestamp(),
        "createdBy": principal["id"],
    }
    if source is not None:
        version["sourceVersionId"] = source
    project["versions"].append(version)
    return version


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        # Один процесс, несколько потоков: блокировка покрывает чтение → проверку → запись.
        self.lock = threading.RLock()

    def path(self, slug):
        identifier(slug, slug=True)
        path = self.root / slug / "project.json"
        # В data/ не допускаются ссылки: путь всегда принадлежит этому проекту.
        if path.parent.is_symlink() or path.is_symlink() or path.resolve() != path:
            raise ApiError(403, "FORBIDDEN", "Недопустимый путь хранения.")
        return path

    def read(self, slug):
        try:
            project = parse_json(self.path(slug).read_text(encoding="utf-8"))
            if not isinstance(project, dict) or project.get("slug") != slug:
                raise ValueError()
            required = {"slug", "title", "synopsis", "language", "createdAt", "updatedAt",
                        "revision", "script", "scenes", "shots", "members", "versions"}
            if (not required <= project.keys() or type(project["revision"]) is not int
                    or project["revision"] < 1 or not isinstance(project["script"], dict)
                    or not {"text", "language", "status", "updatedAt"} <= project["script"].keys()):
                raise ValueError()
            for collection in ("scenes", "shots", "members", "versions"):
                if (not isinstance(project[collection], list)
                        or any(not isinstance(item, dict) or "id" not in item for item in project[collection])):
                    raise ValueError()
            return project
        except FileNotFoundError:
            raise ApiError(404, "NOT_FOUND", "Проект не найден.") from None
        except (OSError, ValueError, TypeError, RecursionError):
            raise ApiError(500, "STORAGE_READ_FAILED", "Не удалось прочитать проект.") from None

    def save(self, project):
        try:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        except OSError:
            raise ApiError(500, "STORAGE_WRITE_FAILED", "Не удалось записать данные. Изменения не сохранены.") from None
        atomic_write(self.path(project["slug"]), project)


class Handler(SimpleHTTPRequestHandler):
    server_version = "NeyraStudio/1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(args[2].repo_root), **kwargs)

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, format, *args):
        # URL может содержать пользовательские данные. Не записываем его или X-Key.
        pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def send_json(self, status, payload, revision=None, head=False):
        # Экранирование на проводе сохраняет текст автора после JSON.parse.
        raw = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        raw = raw.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
        data = raw.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if revision is not None:
            self.send_header("ETag", '"%s"' % revision)
        self.end_headers()
        if not head:
            self.wfile.write(data)

    def body(self):
        if self.headers.get("Transfer-Encoding") is not None:
            raise ApiError(400, "BAD_REQUEST", "Transfer-Encoding не поддерживается.")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0]):
            raise ApiError(400, "BAD_REQUEST", "Нужен корректный Content-Length.")
        size = int(lengths[0])
        if size > MAX_BODY:
            raise ApiError(413, "PAYLOAD_TOO_LARGE", "Размер JSON превышает 2 МиБ.")
        if self.headers.get_content_type() != "application/json":
            raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Нужен Content-Type: application/json.")
        try:
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError()
            value = parse_json(raw.decode("utf-8"))
        except (ValueError, RecursionError):
            raise ApiError(400, "INVALID_JSON", "Некорректный JSON в кодировке UTF-8.") from None
        if not isinstance(value, dict):
            invalid("Тело запроса должно быть объектом JSON.")
        return value

    def principal(self):
        supplied = self.headers.get_all("X-Key", [])
        if len(supplied) != 1 or not supplied[0] or len(supplied[0]) > 512:
            raise ApiError(401, "UNAUTHORIZED", "Нужен действующий ключ в заголовке X-Key.")
        keys = load_keys(self.server.keys_path)
        # Сравнение байтов допускает ошибочный не-ASCII заголовок без исключения.
        for principal in keys.values():
            if hmac.compare_digest(principal["key"].encode("ascii"), supplied[0].encode("utf-8")):
                return principal, keys
        raise ApiError(401, "UNAUTHORIZED", "Нужен действующий ключ в заголовке X-Key.")

    def listing(self, items, query):
        params = parse_qs(query, keep_blank_values=True)
        if set(params) - {"offset", "limit"}:
            raise ApiError(400, "BAD_REQUEST", "Неизвестный параметр списка.")
        try:
            if any(len(v) != 1 or not re.fullmatch(r"[0-9]{1,10}", v[0]) for v in params.values()):
                raise ValueError()
            offset, limit = int(params.get("offset", ["0"])[0]), int(params.get("limit", ["50"])[0])
            if not 1 <= limit <= 200:
                raise ValueError()
        except ValueError:
            raise ApiError(400, "BAD_REQUEST", "Нужны offset ≥ 0 и limit от 1 до 200.") from None
        return {"data": items[offset:offset + limit], "pagination": {
            "offset": offset, "limit": limit, "total": len(items)}}

    def check_revision(self, project):
        match = self.headers.get("If-Match")
        if match is None:
            return
        if not re.fullmatch(r'"[0-9]+"', match):
            raise ApiError(400, "BAD_REQUEST", 'If-Match должен иметь вид "<revision>".')
        if match != '"%s"' % project["revision"]:
            raise ApiError(409, "REVISION_CONFLICT", "Проект изменился. Загрузите актуальные данные.")

    def route(self, parts, query, principal, keys):
        method, store = self.command, self.server.store
        if parts == ["api", "projects"]:
            if method == "GET":
                projects = []
                try:
                    directories = sorted(store.root.iterdir()) if store.root.exists() else []
                except OSError:
                    raise ApiError(500, "STORAGE_READ_FAILED", "Не удалось прочитать список проектов.") from None
                for directory in directories:
                    if not SLUG.fullmatch(directory.name) or not project_scope(principal, directory.name):
                        continue
                    if not directory.is_dir() or directory.is_symlink():
                        continue
                    try:
                        project = store.read(directory.name)
                        authorize(principal, directory.name, "overview", project)
                    except ApiError as error:
                        if error.status in (403, 404):
                            continue
                        raise
                    projects.append(metadata(project))
                return 200, self.listing(projects, query), None
            if method == "POST":
                body = self.body()
                fields(body, ("slug", "title", "synopsis", "language"), ("slug", "title"))
                slug = identifier(body["slug"], slug=True)
                authorize(principal, slug, "overview", write=True, manager=True)
                if store.path(slug).exists():
                    raise ApiError(409, "ALREADY_EXISTS", "Проект с таким slug уже существует.")
                date = timestamp()
                project = {
                    "slug": slug, "title": text(body["title"], "title", 240, required=True),
                    "synopsis": text(body.get("synopsis", ""), "synopsis", 8000),
                    "language": enum(body.get("language", "ru"), ("ru", "kk"), "language"),
                    "createdAt": date, "updatedAt": date, "revision": 1,
                    "scenes": [], "shots": [], "versions": [],
                    "members": [{"id": uuid.uuid4().hex, "name": "Создатель проекта",
                                 "role": principal["role"], "keyId": principal["id"],
                                 "sections": sorted(principal["sections"])}],
                }
                project["script"] = {"text": "", "language": project["language"],
                                     "status": "draft", "updatedAt": date}
                store.save(project)
                return 201, {"data": metadata(project)}, 1
            raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
        if len(parts) < 3 or parts[:2] != ["api", "projects"]:
            raise ApiError(404, "NOT_FOUND", "Маршрут не найден.")
        slug = identifier(parts[2], slug=True)
        # Scope проверяется до чтения, чтобы чужой ключ не узнавал о проекте.
        if not project_scope(principal, slug):
            raise ApiError(403, "FORBIDDEN", "Нет доступа к проекту.")
        project = store.read(slug)
        section = parts[3] if len(parts) > 3 else "overview"
        section = {"versions": "script", "scenes": "script", "members": "team"}.get(section, section)
        write = method != "GET"
        authorize(principal, slug, section, project, write=write,
                  manager=write and section in ("overview", "team"))
        if write:
            self.check_revision(project)
        if len(parts) == 3:
            if method == "GET":
                return 200, {"data": metadata(project)}, project["revision"]
            if method != "PATCH":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
            body = self.body()
            fields(body, ("title", "synopsis", "language"))
            for name, limit in (("title", 240), ("synopsis", 8000)):
                if name in body:
                    project[name] = text(body[name], name, limit, required=(name == "title"))
            if "language" in body:
                project["language"] = enum(body["language"], ("ru", "kk"), "language")
            data, status = metadata(project), 200
        elif parts[3] == "script" and len(parts) == 4:
            if method == "GET":
                return 200, {"data": project["script"]}, project["revision"]
            if method != "PUT":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
            draft = script_input(self.body(), project["script"])
            if draft["text"] != project["script"]["text"]:
                for shot in project["shots"]:
                    shot["needsReview"] = True
            project["script"] = draft
            data, status = draft, 200
        elif parts[3] == "versions":
            if method == "GET" and len(parts) == 4:
                # Тексты и сцены — только в GET отдельной версии.
                versions = [{k: v for k, v in item.items() if k not in ("script", "scenes")}
                            for item in project["versions"]]
                return 200, self.listing(versions, query), project["revision"]
            if method == "GET" and len(parts) == 5:
                return 200, {"data": get_item(project["versions"], parts[4])}, project["revision"]
            if method == "POST" and len(parts) == 4:
                body = self.body()
                fields(body, ("label",))
                data = snapshot(project, principal, "saved", text(body.get("label", ""), "label", 240))
            elif method == "POST" and len(parts) == 6 and parts[5] == "restore":
                fields(self.body(), ())
                source = get_item(project["versions"], parts[4])
                backup = snapshot(project, principal, "backup")
                project["script"] = copy.deepcopy(source["script"])
                project["script"].update(status="draft", updatedAt=timestamp())
                project["scenes"] = copy.deepcopy(source["scenes"])
                for shot in project["shots"]:
                    shot["needsReview"] = True
                restored = snapshot(project, principal, "restored", source=source["id"])
                data = {"script": project["script"], "backupVersionId": backup["id"],
                        "restoredVersionId": restored["id"]}
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
            status = 201
        elif parts[3] in ("scenes", "shots", "members") and len(parts) in (4, 5):
            collection = parts[3]
            items = project[collection]
            item = get_item(items, parts[4]) if len(parts) == 5 else None
            if method == "GET":
                response = {"data": item} if item is not None else self.listing(items, query)
                return 200, response, project["revision"]
            create = method == "POST" and item is None
            if create or (method == "PATCH" and item is not None):
                body = self.body()
                if collection == "scenes":
                    changes = scene_input(body, create)
                elif collection == "shots":
                    changes = shot_input(body, project, create)
                else:
                    changes = member_input(body, slug, keys, item)
                    if any(m["keyId"] == changes["keyId"] and m is not item for m in items):
                        raise ApiError(409, "ALREADY_EXISTS", "Ключ уже привязан к участнику.")
                if create:
                    if any(existing["id"] == changes["id"] for existing in items):
                        raise ApiError(409, "ALREADY_EXISTS", "Идентификатор уже существует.")
                    items.append(changes)
                    data, status = changes, 201
                else:
                    changed = any(item.get(k) != v for k, v in changes.items())
                    item.update(changes)
                    if collection == "scenes" and changed:
                        for shot in project["shots"]:
                            if shot["sceneId"] == item["id"]:
                                shot["needsReview"] = True
                    if collection == "shots" and changes.get("status") == "approved":
                        item["needsReview"] = False
                    data, status = item, 200
            elif method == "DELETE" and item is not None:
                if collection == "scenes" and any(s["sceneId"] == item["id"] for s in project["shots"]):
                    raise ApiError(409, "SCENE_IN_USE", "Сначала перенесите или удалите кадры этой сцены.")
                items.remove(item)
                data, status = {"id": item["id"], "deleted": True}, 200
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
        else:
            raise ApiError(404, "NOT_FOUND", "Маршрут не найден.")
        project["revision"] += 1
        project["updatedAt"] = timestamp()
        store.save(project)
        if len(parts) == 3:
            data = metadata(project)
        return status, {"data": data}, project["revision"]

    def static(self, path, head=False):
        parts = path.strip("/").split("/") if path != "/" else []
        target = self.server.repo_root.joinpath(*parts)
        resolved = target.resolve()
        relative = resolved.relative_to(self.server.repo_root) if resolved.is_relative_to(self.server.repo_root) else None
        # Проверяем и исходный, и разрешённый путь, в том числе ссылки внутри repo.
        def public(path_parts):
            return (not any(p.startswith(".") for p in path_parts)
                    and (not path_parts or path_parts[0] in ("assets", "studio", "scenariy", "p")
                         or (len(path_parts) == 1 and (Path(path_parts[0]).suffix in PUBLIC_EXTENSIONS
                                                     or path_parts[0] == "version.txt"))))
        if (relative is None or not public(parts) or not public(relative.parts)
                or resolved == self.server.keys_path or resolved == self.server.store.root
                or self.server.store.root in resolved.parents):
            raise ApiError(404, "NOT_FOUND", "Файл не найден.")
        if resolved.is_dir():
            if not path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", quote(path, safe="/") + "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            target = resolved / "index.html"
            if target.is_symlink() or not target.is_file():
                raise ApiError(404, "NOT_FOUND", "Файл не найден.")
        else:
            target = resolved
        if (target.suffix.lower() not in PUBLIC_EXTENSIONS and target.name != "version.txt") or not target.is_file():
            raise ApiError(404, "NOT_FOUND", "Файл не найден.")
        # Не передаём путь в translate_path: там URL декодировался бы второй раз.
        try:
            stream = target.open("rb")
        except OSError:
            raise ApiError(404, "NOT_FOUND", "Файл не найден.") from None
        with stream:
            info = os.fstat(stream.fileno())
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(str(target)))
            self.send_header("Content-Length", str(info.st_size))
            self.send_header("Last-Modified", self.date_time_string(info.st_mtime))
            self.end_headers()
            if not head:
                self.copyfile(stream, self.wfile)

    def dispatch(self, head=False):
        try:
            url = urlsplit(self.path)
            path = unquote(url.path, errors="strict")
            if (path.startswith("//") or "\\" in path or any(ord(c) < 32 for c in path)
                    or any(p in (".", "..") for p in path.split("/"))):
                raise ApiError(400, "BAD_REQUEST", "Некорректный путь.")
            if path == "/api" or path.startswith("/api/"):
                principal, keys = self.principal()
                if head or self.command not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                    raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
                parts = path.rstrip("/").split("/")[1:]
                with self.server.store.lock:
                    status, payload, revision = self.route(parts, url.query, principal, keys)
                self.send_json(status, payload, revision)
            elif self.command in ("GET", "HEAD"):
                self.static(path, head)
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
        except ApiError as error:
            self.send_json(error.status, {"error": {"code": error.code, "message": error.message}}, head=head)
        except (ValueError, UnicodeError):
            self.send_json(400, {"error": {"code": "BAD_REQUEST", "message": "Некорректный запрос."}}, head=head)
        except (TimeoutError, OSError):
            self.send_json(500, {"error": {"code": "IO_ERROR", "message": "Ошибка ввода-вывода."}}, head=head)
        except Exception:
            self.send_json(500, {"error": {"code": "INTERNAL_ERROR", "message": "Внутренняя ошибка сервера."}}, head=head)

    def do_GET(self):
        self.dispatch()

    def do_HEAD(self):
        self.dispatch(head=True)

    def do_POST(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_PATCH(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    def do_OPTIONS(self):
        self.dispatch()


def make_server(host="127.0.0.1", port=8770, repo_root=REPO_ROOT, data_root=None,
                keys_path=DEFAULT_KEYS, bind_and_activate=True):
    repo_root = Path(repo_root).resolve()
    keys_path = Path(keys_path).expanduser().resolve()
    load_keys(keys_path)
    server = ThreadingHTTPServer((host, port), Handler, bind_and_activate=bind_and_activate)
    server.repo_root = repo_root
    server.keys_path = keys_path
    server.store = Store(data_root if data_root is not None else REPO_ROOT / "server/data")
    return server


def main():
    parser = argparse.ArgumentParser(description="Локальный сервер Neyra Vision Studio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8770, type=int)
    parser.add_argument("--data-dir", type=Path, default=REPO_ROOT / "server/data")
    parser.add_argument("--keys-file", type=Path, default=DEFAULT_KEYS)
    options = parser.parse_args()
    try:
        server = make_server(options.host, options.port, data_root=options.data_dir, keys_path=options.keys_file)
    except (ApiError, OSError) as error:
        parser.exit(1, (error.message if isinstance(error, ApiError) else "Не удалось открыть порт сервера.") + "\n")
    print("Neyra Vision Studio: http://%s:%s/" % server.server_address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
