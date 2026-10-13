#!/usr/bin/env python3
"""Хранение Neyra Vision Studio: только стандартная библиотека Python 3.9+."""

import argparse
import copy
from datetime import datetime, timezone
import hashlib
import hmac
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit
import uuid

if __package__:
    from .blocks import breakdown
else:
    from blocks import breakdown


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KEYS = Path.home() / ".config/neyra-studio/keys.json"
MAX_BODY = 2 * 1024 * 1024
SECTIONS = frozenset(("overview", "script", "breakdown", "heroes", "locations", "world",
                      "storyboard", "shots", "continuity", "sound", "edit", "plan", "journal",
                      "animatic", "team", "post"))
# Роль даёт набор разделов по умолчанию; продюсер может открыть участнику любой раздел
# в пределах своих прав (authorize_grant). Роль по-прежнему решает, где участник пишет.
ROLE_SECTIONS = {
    "admin": SECTIONS, "director": SECTIONS - {"plan"}, "producer": SECTIONS,
    "writer": frozenset(("overview", "script", "breakdown", "journal", "team")),
    "artist": frozenset(("overview", "heroes", "locations", "world", "storyboard", "shots", "continuity", "journal", "team")),
    "editor": frozenset(("overview", "edit", "sound", "animatic", "post", "journal", "team")),
    "assistant_director": frozenset(("overview", "script", "breakdown", "journal", "team")),
    "cinematographer": frozenset(("overview", "storyboard", "shots", "continuity", "journal", "team")),
    "viewer": SECTIONS - {"plan"},
}
MEMBER_ROLES = frozenset(("producer", "director", "writer", "cinematographer", "artist", "editor", "viewer"))
READ_ONLY_SECTIONS = {"writer": frozenset(("breakdown",)), "editor": frozenset(("sound",))}
MANAGERS = frozenset(("admin", "director", "producer"))
STATUSES = frozenset(("draft", "working", "review", "approved"))
STAGES = ("script", "breakdown", "heroes", "locations", "storyboard", "shots", "video", "sound", "edit")
STAGE_LABELS = dict(zip(STAGES, ("Сценарий", "Разбивка", "Герои", "Локации", "Раскадровка",
                                      "Кадры", "Видео", "Звук", "Монтаж")))
STAGE_SECTIONS = dict(zip(STAGES, ("script", "script", "storyboard", "storyboard", "storyboard",
                                        "shots", "animatic", "post", "post")))
APPROVER_ROLES = {
    "script": ("producer", "writer"), "breakdown": ("assistant_director",),
    "heroes": ("director",), "locations": ("director",),
    "storyboard": ("director", "cinematographer"), "shots": ("director",),
    "video": ("director",), "sound": ("director",), "edit": ("producer", "director"),
}
CELL_STATUSES = frozenset(("empty", "working", "done", "awaiting", "approved", "returned"))
OBJECT_TYPES = frozenset(("scene", "shot", "teaser", "episode"))
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
            result[key_id] = dict(entry, sections=scope,
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
        if member is None or member["role"] != principal["role"] or member.get("revokedAt"):
            raise ApiError(403, "FORBIDDEN", "Нет доступа к проекту.")
        allowed = allowed & set(member["sections"])
    if (not project_scope(principal, slug) or section not in allowed
            or (write and principal["role"] == "viewer")
            or (write and section in READ_ONLY_SECTIONS.get(principal["role"], ()))
            or (manager and principal["role"] not in MANAGERS)):
        raise ApiError(403, "FORBIDDEN", "Нет прав на этот проект или раздел.")


def metadata(project):
    result = {field: project[field] for field in
              ("slug", "title", "synopsis", "language", "createdAt", "updatedAt", "revision")}
    if "translations" in project:
        result["translations"] = project["translations"]
    return result


def get_item(items, item_id):
    for item in items:
        if item["id"] == item_id:
            return item
    raise ApiError(404, "NOT_FOUND", "Объект не найден.")


def translations_input(value, names=None):
    if not isinstance(value, dict) or set(value) - {"ru", "kk"}:
        invalid("translations должен быть объектом с языками ru и kk.")
    result = {}
    for language, translation in value.items():
        if names is None:
            result[language] = text(translation, "translations." + language)
            continue
        if not isinstance(translation, dict):
            invalid("Перевод должен быть объектом JSON.")
        fields(translation, names)
        result[language] = {name: text(item, "translations." + language + "." + name,
                                      names[name])
                            for name, item in translation.items()}
    return result


def script_input(body, current):
    fields(body, ("text", "language", "status", "translations"), ("text",))
    result = {
        "text": text(body["text"], "text"),
        "language": enum(body.get("language", current["language"]), ("ru", "kk"), "language"),
        "status": enum(body.get("status", "draft"), STATUSES, "status"),
        "updatedAt": timestamp(),
    }
    if "translations" in body or "translations" in current:
        result["translations"] = (translations_input(body["translations"])
                                  if "translations" in body else copy.deepcopy(current["translations"]))
        result["translations"][result["language"]] = result["text"]
    return result


def scene_input(body, create=False):
    fields(body, ("id", "title", "text", "translations") if create else ("title", "text", "translations"),
           ("title",) if create else ())
    result = {}
    for name, limit in (("title", 240), ("text", 1000000)):
        if name in body:
            result[name] = text(body[name], name, limit, required=(name == "title"))
    if "translations" in body:
        result["translations"] = translations_input(body["translations"], {"title": 240, "text": 1000000})
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
             "owner", "lens", "movement", "imageUrl", "videoUrl", "translations", "comments")
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
    if "translations" in body:
        result["translations"] = translations_input(body["translations"], {
            "title": 240, "description": 8000, "prompt": 8000, "movement": 8000})
    if "comments" in body:
        comments = body["comments"]
        if not isinstance(comments, list) or len(comments) > 500:
            invalid("comments должен быть списком не более 500 комментариев.")
        result["comments"] = []
        for comment in comments:
            if not isinstance(comment, dict):
                invalid("Комментарий должен быть объектом JSON.")
            fields(comment, ("author", "text", "date"), ("author", "text", "date"))
            result["comments"].append({
                "author": text(comment["author"], "author", 240, required=True),
                "text": text(comment["text"], "comment.text", 8000),
                "date": text(comment["date"], "date", 80),
            })
    if create:
        result.update(id=identifier(body.get("id", uuid.uuid4().hex)), aspectRatio="16:9", needsReview=False)
        for name in ("description", "prompt", "owner", "lens", "movement", "imageUrl", "videoUrl"):
            result.setdefault(name, "")
        result.setdefault("duration", 5)
        result.setdefault("status", "draft")
    return result


def post_input(body):
    fields(body, ("tasks",), ("tasks",))
    tasks = body["tasks"]
    if not isinstance(tasks, list) or len(tasks) > 4:
        invalid("tasks должен быть списком не более четырёх задач.")
    result, ids = [], set()
    for task in tasks:
        if not isinstance(task, dict):
            invalid("Задача поста должна быть объектом JSON.")
        fields(task, ("id", "done"), ("id", "done"))
        task_id = enum(task["id"], ("edit", "color", "sound", "vfx"), "task.id")
        if task_id in ids or not isinstance(task["done"], bool):
            invalid("ID задач не повторяются; done должен быть boolean.")
        ids.add(task_id)
        result.append({"id": task_id, "done": task["done"]})
    return result


def legacy_member_input(body, slug, keys, current=None):
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


def member_input(body, current=None):
    fields(body, ("name", "email", "role", "sections"),
           ("name", "email", "role", "sections") if current is None else ())
    result = dict(current or {}, **body)
    result["name"] = text(result["name"], "name", 240, required=True)
    email = text(result["email"], "email", 254, required=True).strip()
    if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", email):
        invalid("Нужен корректный e-mail участника.")
    result["email"] = email
    role = enum(result["role"], MEMBER_ROLES, "role")
    sections = result["sections"]
    if (not isinstance(sections, list) or not sections or len(sections) > len(SECTIONS)
            or any(not isinstance(s, str) or s not in SECTIONS for s in sections)
            or len(set(sections)) != len(sections)):
        invalid("Разделы участника: список известных разделов без повторов.")
    if current is None:
        result.update(id=uuid.uuid4().hex, createdAt=timestamp())
        result["keyId"] = "member-" + result["id"]
    return result


def issued_principal(member, slug):
    if not member.get("keyHash") or member.get("revokedAt"):
        return None
    return {"id": member["keyId"], "role": member["role"], "projects": frozenset((slug,)),
            "sections": frozenset(member["sections"]), "source": "member"}


def public_member(member, slug, keys):
    # Allowlist: secret material never enters responses or operation content hashes.
    result = {name: member[name] for name in
              ("id", "name", "email", "role", "keyId", "sections", "createdAt", "revokedAt")
              if name in member}
    target = issued_principal(member, slug) or keys.get(member["keyId"])
    active = (target is not None and target["role"] == member["role"] and project_scope(target, slug))
    result["keySource"] = "issued" if member.get("keyHash") or member.get("revokedAt") else "external"
    result["accessStatus"] = "revoked" if member.get("revokedAt") else "active" if active else "unavailable"
    return result


def principal_info(principal):
    return {"id": principal["id"], "role": principal["role"],
            "projects": sorted(principal["projects"]), "sections": sorted(principal["sections"])}


def project_access(project, principal):
    result = metadata(project)
    result["principal"] = principal_info(principal)
    try:
        authorize(principal, project["slug"], "team", project, write=True, manager=True)
        manage = True
    except ApiError:
        manage = False
    result["capabilities"] = {"manageTeam": manage}
    return result


def stage_section(principal, stage):
    # Keep №31's legacy scopes; issued team keys use the cinema section names.
    return ("animatic" if stage == "video" else stage) if principal.get("source") == "member" else STAGE_SECTIONS[stage]


def authorize_grant(principal, project, sections):
    effective = set(principal["sections"])
    if principal["role"] != "admin":
        effective &= set(next(m for m in project["members"] if m["keyId"] == principal["id"])["sections"])
    if not set(sections) <= effective:
        raise ApiError(403, "FORBIDDEN", "Нельзя выдать разделы за пределами своих прав.")


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


def content_hash(value):
    canonical = json.dumps(value, ensure_ascii=False, allow_nan=False,
                           sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def activity(project, principal, action, obj, data, stage=None, invalidated=()):
    """История фиксируется вместе с результатом операции, без секретов и исходных текстов."""
    journal = project["activity"]
    member = next((m for m in project["members"] if m["keyId"] == principal["id"]), None)
    event = {
        "id": breakdown.ulid(), "studio_id": project["studio_id"], "sequence": len(journal) + 1,
        "keyId": principal["id"], "name": member["name"] if member else principal["id"],
        "createdAt": timestamp(), "action": action, "object": copy.deepcopy(obj),
        "contentHash": content_hash(data), "previousHash": journal[-1]["hash"] if journal else None,
    }
    if stage is not None:
        event["stage"] = stage
        event.update(cellId=data.get("cellId", data["id"]), version=data["version"],
                     variant=data["variant"], status=data.get("status", data.get("verdict")))
        if "verdict" in data:
            event["approvalId"] = data["id"]
    if invalidated:
        event["invalidatedCellIds"] = sorted(set(invalidated))
    event["hash"] = content_hash(event)
    journal.append(event)


def object_input(value, project):
    if not isinstance(value, dict):
        invalid("object должен содержать type и id.")
    fields(value, ("type", "id"), ("type", "id"))
    obj = {"type": enum(value["type"], OBJECT_TYPES, "object.type"),
           "id": identifier(value["id"])}
    if obj["type"] in ("scene", "shot"):
        get_item(project["scenes" if obj["type"] == "scene" else "shots"], obj["id"])
    return obj


def date_input(value):
    if value is None:
        return None
    value = text(value, "dueAt", 80, required=True)
    try:
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            datetime.strptime(value, "%Y-%m-%d")
        else:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if "T" not in value or parsed.tzinfo is None:
                raise ValueError()
    except ValueError:
        invalid("dueAt: нужна дата YYYY-MM-DD или дата и время ISO 8601 с часовым поясом.")
    return value


def assignee_input(value, project, keys, stage):
    if not isinstance(value, dict):
        invalid("assignee должен содержать keyId и name.")
    fields(value, ("keyId", "name"))
    key_id = value.get("keyId")
    name = text(value.get("name", ""), "assignee.name", 240)
    if key_id is not None:
        identifier(key_id)
        member = next((m for m in project["members"] if m["keyId"] == key_id), None)
        target = issued_principal(member, project["slug"]) if member is not None else None
        target = target or keys.get(key_id)
        if target is None:
            invalid("Ключ исполнителя не найден.")
        try:
            authorize(target, project["slug"], stage_section(target, stage), project, write=True)
        except ApiError:
            invalid("У исполнителя нет доступа к проекту или этапу.")
        member = next((m for m in project["members"] if m["keyId"] == key_id), None)
        if not name:
            name = member["name"] if member else key_id
    return {"keyId": key_id, "name": name}


def map_cell(project, obj, stage):
    return next((c for c in project["cells"] if c["object"] == obj and c["stage"] == stage), None)


def dependency_blockers(project, cell):
    obj, stage = cell["object"], cell["stage"]
    if obj["type"] == "scene" and not any(s["id"] == obj["id"] for s in project["scenes"]):
        return ["сцена отсутствует в текущей версии"]
    if obj["type"] == "shot":
        shot = next((s for s in project["shots"] if s["id"] == obj["id"]), None)
        if shot is None:
            return ["кадр отсутствует"]
        obj = {"type": "scene", "id": shot["sceneId"]}
        if not any(s["id"] == obj["id"] for s in project["scenes"]):
            return ["сцена кадра отсутствует в текущей версии"]
    if stage == "edit":
        if not project["scenes"]:
            return ["в проекте ещё нет сцен с утверждённым видео"]
        required = [({"type": "scene", "id": s["id"]}, "video") for s in project["scenes"]]
    elif stage == "shots":
        required = [(obj, "storyboard"), (obj, "heroes")]
    elif stage == "video":
        required = [(obj, "shots")]
    else:
        required = []
    blockers = []
    for reference, prerequisite in required:
        current = map_cell(project, reference, prerequisite)
        if current is None or current["status"] != "approved":
            kind = {"scene": "сцена", "shot": "кадр", "teaser": "тизер", "episode": "серия"}[reference["type"]]
            blockers.append("не утверждён этап «" + STAGE_LABELS[prerequisite] + "»: " + kind + " " + reference["id"])
    return blockers


def check_dependencies(project, cell):
    blockers = dependency_blockers(project, cell)
    if blockers:
        raise ApiError(409, "DEPENDENCY_CONFLICT", "Этап «" + STAGE_LABELS[cell["stage"]]
                       + "» заблокирован: " + "; ".join(blockers) + ".")


def cell_input(body, project, principal, keys, current=None):
    create = current is None
    names = ("object", "stage", "assignee", "approverRole", "status", "dueAt", "comment", "version", "variant")
    fields(body, names if create else names[2:], ("object", "stage") if create else ())
    result = copy.deepcopy(current) if current else {
        "id": uuid.uuid4().hex, "project": project["slug"],
        "object": object_input(body["object"], project),
        "stage": enum(body["stage"], STAGES, "stage"), "createdAt": timestamp(),
        "status": "empty", "dueAt": None, "comment": "", "version": None, "variant": None,
    }
    stage = result["stage"]
    authorize(principal, project["slug"], stage_section(principal, stage), project, write=True)
    manager = principal["role"] in MANAGERS
    if (create and not manager) or (not create and not manager and
            (result["assignee"]["keyId"] != principal["id"]
             or set(body) - {"status", "comment", "version", "variant"})):
        raise ApiError(403, "FORBIDDEN", "Менять задачу может её исполнитель, назначать — руководитель проекта.")
    if create or "assignee" in body:
        result["assignee"] = assignee_input(body.get("assignee", {}), project, keys, stage)
    if create or "approverRole" in body:
        result["approverRole"] = enum(body.get("approverRole", APPROVER_ROLES[stage][0]),
                                      APPROVER_ROLES[stage], "approverRole")
    if "status" in body:
        result["status"] = enum(body["status"], CELL_STATUSES - {"approved", "returned"}, "status")
    if "dueAt" in body:
        result["dueAt"] = date_input(body["dueAt"])
    if "comment" in body:
        result["comment"] = text(body["comment"], "comment", 8000)
    for name in ("version", "variant"):
        if name in body:
            result[name] = (None if body[name] is None else text(body[name], name, 240, required=True))
    if current and any(result[k] != current[k] for k in ("version", "variant", "approverRole")):
        if result["status"] in ("approved", "awaiting"):
            # Новый вариант или новый утверждающий требуют отдельной отправки на апрув.
            result["status"] = "done" if "status" not in body else result["status"]
            if result["status"] == "approved":
                result["status"] = "done"
    if result["status"] == "awaiting" and not (result["version"] or result["variant"]):
        invalid("Для апрува укажите version или variant.")
    if (create or "status" in body) and result["status"] in ("working", "done", "awaiting"):
        check_dependencies(project, result)
    result["updatedAt"] = timestamp()
    return result


def can_approve(principal, project, cell):
    authorize(principal, project["slug"], stage_section(principal, cell["stage"]), project, write=True)
    if principal["role"] not in (cell["approverRole"], "admin", "producer"):
        raise ApiError(403, "FORBIDDEN", "Вердикт может поставить роль " + cell["approverRole"]
                       + ", администратор или продюсер.")


def approval_input(body, project, principal):
    fields(body, ("object", "stage", "version", "variant", "verdict", "comment"),
           ("object", "stage", "verdict"))
    obj = object_input(body["object"], project)
    stage = enum(body["stage"], STAGES, "stage")
    cell = map_cell(project, obj, stage)
    if cell is None:
        raise ApiError(404, "NOT_FOUND", "Клетка карты не найдена.")
    can_approve(principal, project, cell)
    result = {"id": uuid.uuid4().hex, "project": project["slug"], "cellId": cell["id"],
              "object": obj, "stage": stage, "keyId": principal["id"], "createdAt": timestamp(),
              "verdict": enum(body["verdict"], ("approved", "returned"), "verdict"),
              "comment": text(body.get("comment", ""), "comment", 8000)}
    for name in ("version", "variant"):
        result[name] = None if body.get(name) is None else text(body[name], name, 240, required=True)
    if not (result["version"] or result["variant"]):
        invalid("Укажите утверждаемую версию или вариант.")
    if any(result[name] != cell[name] for name in ("version", "variant")):
        raise ApiError(409, "APPROVAL_CONFLICT", "Вариант или версия клетки изменились. Загрузите актуальные данные.")
    if cell["status"] != "awaiting":
        raise ApiError(409, "CELL_NOT_AWAITING", "Клетка не ждёт апрува. Сначала отправьте результат на утверждение.")
    if result["verdict"] == "approved":
        check_dependencies(project, cell)
    cell.update(status=result["verdict"], comment=result["comment"], updatedAt=result["createdAt"])
    return result


def invalidate_cells(project, predicate):
    invalidated = []
    for cell in project["cells"]:
        if cell["status"] in ("approved", "awaiting") and predicate(cell):
            cell.update(status="done", updatedAt=timestamp())
            invalidated.append(cell["id"])
    return invalidated


def invalidate_dependencies(project):
    # Сначала кадры, затем видео, затем монтаж: каскад не зависит от порядка создания клеток.
    invalidated = []
    for stage in ("shots", "video", "edit"):
        invalidated.extend(invalidate_cells(project, lambda c: c["stage"] == stage
                                            and bool(dependency_blockers(project, c))))
    return invalidated


ASSISTANT_API = "https://api.anthropic.com/v1/messages"
ASSISTANT_MODEL = os.environ.get("NEYRA_MODEL", "claude-sonnet-5-5")
ASSISTANT_ROLE = ("Ты — помощник проекта Neyra Vision Studio: одно окно на все этапы кино, помнишь весь проект. "
                  "Отвечай на языке вопроса (русский или казахский), коротко и по делу, с номерами сцен и именами. "
                  "Фильм пишет человек: предлагай варианты, не переписывай без просьбы. Ничего платного не запускай — "
                  "если нужна генерация, скажи, что покажешь список и цену, и подождёшь «да». Факты только из контекста проекта; "
                  "чего нет в контексте — скажи, что не знаешь.")
ASSISTANT_MODES = {"script": "Режим: сценарный редактор (структура, сцены, диалог).", "breakdown": "Режим: второй режиссёр (что нужно для сцены).",
                   "heroes": "Режим: кастинг и художник (паспорта, замки внешности).", "locations": "Режим: художник-постановщик (локации, пластины).",
                   "storyboard": "Режим: оператор (крупность, движение, объектив).", "shots": "Режим: критик кадра и непрерывности.",
                   "map": "Режим: продюсер (кто тормозит, что ждёт решения).", "team": "Режим: продюсер (команда и права)."}


def assistant_key():
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if key:
        return key
    path = Path(os.environ.get("NEYRA_ASSISTANT_KEY_FILE", str(Path.home() / ".config/neyra-studio/key")))
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def assistant_context(project, principal, section=""):
    """Весь проект одной страницей текста: метаданные, сценарий, сцены, паспорта, карта, лента. Это и есть «память проекта»."""
    board = production_map(project, principal)
    lines = [f"ПРОЕКТ: {project['title']} ({project['slug']}), язык {project.get('language', 'ru')}, ревизия {project['revision']}."]
    if project.get("synopsis"):
        lines.append("СИНОПСИС: " + project["synopsis"][:1500])
    script = (project.get("script") or {}).get("text", "")
    if script:
        lines.append(f"СЦЕНАРИЙ (черновик, {len(script)} знаков, первые 6000):\n" + script[:6000])
    scenes = project.get("scenes", [])
    if scenes:
        lines.append("СЦЕНЫ (" + str(len(scenes)) + "): " + "; ".join(
            f"{sc.get('n', '?')} {sc.get('title') if isinstance(sc.get('title'), str) else (sc.get('title') or {}).get('ru', '')}"
            + (f" [{', '.join(sc.get('chars', []))}]" if sc.get("chars") else "") for sc in scenes[:80]))
    for coll, label in (("characters", "ГЕРОИ"), ("locations", "ЛОКАЦИИ")):
        items = project.get(coll, [])
        if items:
            lines.append(f"{label} ({len(items)}): " + "; ".join(
                f"{it.get('name', '')}" + (f" — {it.get('role')}" if it.get("role") else "") + (f": {it.get('identity', '')[:160]}" if it.get("identity") else "")
                + (f" (табу: {'; '.join(it.get('taboo', []))})" if it.get("taboo") else "") + f" [{it.get('status', 'draft')}]" for it in items[:60]))
    cells = project.get("cells", [])
    if cells:
        counts = {}
        for c in cells:
            counts[c["status"]] = counts.get(c["status"], 0) + 1
        lines.append("КАРТА ПРОИЗВОДСТВА: клеток " + str(len(cells)) + ", по статусам " + ", ".join(f"{k}: {v}" for k, v in counts.items())
                     + "; ждёт решения этого участника: " + str(len(board["awaitingMe"])) + "; его задач: " + str(len(board["myTasks"])) + ".")
        waiting = board["awaitingMe"][:10]
        if waiting:
            lines.append("ЖДЁТ РЕШЕНИЯ: " + "; ".join(f"{c['object']['type']} {c['object']['id']} · {c['stage']} · версия {c.get('version') or '—'}" for c in waiting))
    act = project.get("activity", [])
    if act:
        lines.append("ПОСЛЕДНИЕ СОБЫТИЯ: " + "; ".join(f"{a.get('createdAt', '')[:16]} {a.get('action', '')}" for a in act[-12:]))
    mode = ASSISTANT_MODES.get(section, "")
    return ("\n\n".join(lines))[:60000], mode


def assistant_answer(question, context, mode, history):
    key = assistant_key()
    if os.environ.get("NEYRA_ASSISTANT_FAKE") == "1":
        return {"answer": f"[проба без модели] Контекст {len(context)} знаков. {mode} Вопрос: {question[:120]}", "model": "fake", "usage": {}}
    if not key:
        raise ApiError(503, "ASSISTANT_KEY_MISSING", "Помощник ещё не подключён: на сервере нет ключа модели (~/.config/neyra-studio/key).")
    import urllib.request
    import urllib.error
    messages = [{"role": m["role"], "content": m["content"]} for m in history if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)][-10:]
    messages.append({"role": "user", "content": question})
    payload = {"model": ASSISTANT_MODEL, "max_tokens": 1500, "system": ASSISTANT_ROLE + ("\n" + mode if mode else "") + "\n\nКОНТЕКСТ ПРОЕКТА:\n" + context,
               "messages": messages}
    req = urllib.request.Request(ASSISTANT_API, data=json.dumps(payload).encode("utf-8"), method="POST",
                                 headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        raise ApiError(502, "ASSISTANT_UPSTREAM", f"Модель ответила ошибкой {error.code}: {detail}") from None
    except (OSError, ValueError) as error:
        raise ApiError(502, "ASSISTANT_UPSTREAM", f"Модель недоступна: {error}") from None
    text_out = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
    return {"answer": text_out, "model": out.get("model", ASSISTANT_MODEL), "usage": out.get("usage", {})}


def production_map(project, principal):
    objects = [{"type": "scene", "id": s["id"]} for s in project["scenes"]]
    objects.extend({"type": "shot", "id": s["id"]} for s in project["shots"])
    seen = {(obj["type"], obj["id"]) for obj in objects}
    for cell in project["cells"]:
        key = (cell["object"]["type"], cell["object"]["id"])
        if key not in seen:
            objects.append(cell["object"])
            seen.add(key)
    cells = project["cells"]
    by_stage = {(c["object"]["type"], c["object"]["id"], c["stage"]): c for c in cells}
    awaiting = []
    for cell in cells:
        if cell["status"] != "awaiting":
            continue
        try:
            can_approve(principal, project, cell)
        except ApiError:
            continue
        awaiting.append(cell)
    return {"project": project["slug"], "stages": list(STAGES), "objects": objects, "cells": cells,
            "grid": [{"object": obj, "stages": {s: by_stage.get((obj["type"], obj["id"], s)) for s in STAGES}}
                     for obj in objects],
            "myTasks": [c for c in cells if c["assignee"]["keyId"] == principal["id"]],
            "awaitingMe": awaiting}


class Store:
    def __init__(self, root, studio_id="default"):
        self.root = Path(root).resolve()
        self.studio_id = identifier(studio_id)
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
            project.setdefault("studio_id", self.studio_id)
            if project["studio_id"] != self.studio_id:
                raise ApiError(403, "FORBIDDEN", "Проект принадлежит другой студии.")
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
            # Старые проекты читаются без записи на GET; прежнюю историю не выдумываем.
            for collection in ("cells", "approvals", "activity", "characters", "locations"):
                project.setdefault(collection, [])
                if (not isinstance(project[collection], list)
                        or any(not isinstance(item, dict) or "id" not in item for item in project[collection])):
                    raise ValueError()
            previous = None
            for sequence, event in enumerate(project["activity"], 1):
                if (event.get("sequence") != sequence or event.get("previousHash") != previous
                        or event.get("hash") != content_hash({k: v for k, v in event.items() if k != "hash"})):
                    raise ValueError()
                previous = event["hash"]
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
        if getattr(self, "api_response", False):
            self.send_header("Vary", "Origin")
            origin = self.cors_origin()
            if origin is not None:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Expose-Headers", "ETag")
        super().end_headers()

    def cors_origin(self):
        origins = self.headers.get_all("Origin", [])
        if len(origins) != 1:
            return None
        try:
            origin = urlsplit(origins[0])
            if (origin.scheme in ("http", "https") and origin.hostname and origin.port != 0
                    and origin.username is None and origin.password is None
                    and not origin.path and not origin.query and not origin.fragment):
                return origins[0]
        except ValueError:
            pass
        return None

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

    def body(self, allow_empty=False):
        if self.headers.get("Transfer-Encoding") is not None:
            raise ApiError(400, "BAD_REQUEST", "Transfer-Encoding не поддерживается.")
        lengths = self.headers.get_all("Content-Length", [])
        if allow_empty and not lengths:
            return {}
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0]):
            raise ApiError(400, "BAD_REQUEST", "Нужен корректный Content-Length.")
        size = int(lengths[0])
        if size > MAX_BODY:
            raise ApiError(413, "PAYLOAD_TOO_LARGE", "Размер JSON превышает 2 МиБ.")
        if allow_empty and size == 0:
            return {}
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
            raise ApiError(400, "BAD_REQUEST", "Тело запроса должно быть объектом JSON.")
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
        parts = supplied[0].split(".")
        if (len(parts) == 4 and parts[0] == "nv1" and SLUG.fullmatch(parts[1])
                and IDENTIFIER.fullmatch(parts[2])):
            try:
                project = self.server.store.read(parts[1])
            except ApiError as error:
                if error.status != 404:
                    raise
            else:
                member = next((m for m in project["members"] if m["keyId"] == parts[2]), None)
                target = issued_principal(member, project["slug"]) if member is not None else None
                digest = hashlib.sha256(supplied[0].encode("utf-8")).hexdigest()
                if target and hmac.compare_digest(member["keyHash"], digest):
                    return target, keys
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
        if parts == ["api", "session"]:
            if method != "GET":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Сессию можно только читать.")
            return 200, {"data": principal_info(principal)}, None
        if parts == ["api", "me"]:
            # №36 кабинет участника: кто я и мои проекты с личными счётчиками (ждёт меня / мои задачи)
            if method != "GET":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Кабинет можно только читать.")
            mine = []
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
                membership = next((m for m in project.get("members", []) if m.get("keyId") == principal["id"]), None)
                board = production_map(project, principal)
                item = metadata(project)
                item.update({"role": membership["role"] if membership else principal["role"],
                             "sections": sorted(membership["sections"]) if membership else sorted(principal["sections"]),
                             "awaitingMe": len(board["awaitingMe"]), "myTasks": len(board["myTasks"]),
                             "sceneCount": len(project.get("scenes", [])), "shotCount": len(project.get("shots", []))})
                mine.append(item)
            return 200, {"data": {"principal": principal_info(principal), "projects": mine,
                                  "awaitingMe": sum(p["awaitingMe"] for p in mine), "myTasks": sum(p["myTasks"] for p in mine)}}, None
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
                fields(body, ("slug", "title", "synopsis", "language", "translations"), ("slug", "title"))
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
                    "studio_id": store.studio_id, "characters": [], "locations": [],
                    "scenes": [], "shots": [], "versions": [], "cells": [], "approvals": [], "activity": [],
                    "post": [{"id": task_id, "done": False} for task_id in ("edit", "color", "sound", "vfx")],
                    "members": [{"id": uuid.uuid4().hex, "name": "Создатель проекта",
                                 "role": principal["role"], "keyId": principal["id"],
                                 "sections": sorted(principal["sections"])}],
                }
                project["script"] = {"text": "", "language": project["language"],
                                     "status": "draft", "updatedAt": date}
                if "translations" in body:
                    project["translations"] = translations_input(body["translations"], {"title": 240, "synopsis": 8000})
                activity(project, principal, "project.created", {"type": "project", "id": slug}, metadata(project))
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
        resource = parts[3] if len(parts) > 3 else "project"
        section = {"versions": "script", "scenes": "script", "members": "overview" if method == "GET" else "team", "project": "overview",
                   "map": "overview", "cells": "overview", "approvals": "overview",
                   "activity": "overview", "characters": "overview" if method == "GET" else "heroes",
                   "locations": "overview" if method == "GET" else "locations"}.get(resource, resource)
        if resource == "assistant":
            # №46 помощник: читает весь проект (раздел overview), ничего не изменяет, память диалога — у клиента
            if method != "POST":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Помощнику можно только задать вопрос (POST).")
            authorize(principal, slug, "overview", project)
            body = self.body()
            fields(body, ("question", "section", "history"), ("question",))
            question = text(body["question"], "question", 60000, required=True)
            mode_section = body.get("section", "")
            if not isinstance(mode_section, str) or len(mode_section) > 40:
                raise ApiError(422, "VALIDATION", "Поле section — короткая строка.")
            history = body.get("history", [])
            if not isinstance(history, list) or len(history) > 20:
                raise ApiError(422, "VALIDATION", "history — список до 20 реплик.")
            context, mode = assistant_context(project, principal, mode_section)
            answer = assistant_answer(question, context, mode, history)
            answer["context"] = {"chars": len(context), "scenes": len(project.get("scenes", [])), "characters": len(project.get("characters", [])), "locations": len(project.get("locations", []))}
            return 200, {"data": answer}, None
        write = method != "GET"
        authorize(principal, slug, section, project, write=write,
                  manager=write and resource in ("project", "members"))
        if write:
            self.check_revision(project)
        invalidated = []
        import_events = []
        if len(parts) == 3:
            if method == "GET":
                return 200, {"data": project_access(project, principal)}, project["revision"]
            if method != "PATCH":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
            body = self.body()
            fields(body, ("title", "synopsis", "language", "translations"))
            for name, limit in (("title", 240), ("synopsis", 8000)):
                if name in body:
                    project[name] = text(body[name], name, limit, required=(name == "title"))
            if "language" in body:
                project["language"] = enum(body["language"], ("ru", "kk"), "language")
            if "translations" in body:
                project["translations"] = translations_input(body["translations"], {"title": 240, "synopsis": 8000})
            data, status = metadata(project), 200
        elif parts[3] == "script" and len(parts) == 4:
            if method == "GET":
                return 200, {"data": project["script"]}, project["revision"]
            if method != "PUT":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
            draft = script_input(self.body(), project["script"])
            if (draft["text"] != project["script"]["text"]
                    or draft.get("translations") != project["script"].get("translations")):
                for shot in project["shots"]:
                    shot["needsReview"] = True
                invalidated.extend(invalidate_cells(project, lambda c: c["object"]["type"] in ("scene", "shot")))
            project["script"] = draft
            data, status = draft, 200
        elif resource == "breakdown" and len(parts) == 4:
            if method != "POST":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Разбивка импортируется методом POST.")
            document = breakdown.parse_input(self.body())
            data, import_events = breakdown.import_data(
                document, project["scenes"], project["characters"], project["locations"],
                timestamp(), project["studio_id"])
            changed_scene_ids = {obj["id"] for action, obj, _ in import_events if action == "scene.updated"}
            affected_shots = {s["id"] for s in project["shots"] if s["sceneId"] in changed_scene_ids}
            if changed_scene_ids:
                invalidated.extend(invalidate_cells(project, lambda c:
                    (c["object"]["type"] == "scene" and c["object"]["id"] in changed_scene_ids)
                    or (c["object"]["type"] == "shot" and c["object"]["id"] in affected_shots)))
                for shot in project["shots"]:
                    if shot["id"] in affected_shots:
                        shot["needsReview"] = True
            status = 200
        elif resource in ("characters", "locations") and len(parts) in (4, 5):
            items = project[resource]
            item = get_item(items, parts[4]) if len(parts) == 5 else None
            if method == "GET":
                return 200, ({"data": item} if item is not None else self.listing(items, query)), project["revision"]
            create = method == "POST" and item is None
            if create or (method == "PATCH" and item is not None):
                changes = breakdown.passport_input(self.body(), create)
                name = changes.get("name", item["name"] if item is not None else "")
                if any(existing is not item and breakdown.name_key(existing["name"]) == breakdown.name_key(name)
                       for existing in items):
                    raise ApiError(409, "ALREADY_EXISTS", "Паспорт с этим именем уже существует.")
                date = timestamp()
                if create:
                    item = dict(changes, id=breakdown.ulid(), createdAt=date, updatedAt=date,
                                studio_id=project["studio_id"])
                    items.append(item)
                else:
                    item.update(changes, updatedAt=date)
                data, status = item, 201 if create else 200
            elif method == "DELETE" and item is not None:
                items.remove(item)
                data, status = {"id": item["id"], "deleted": True}, 200
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
        elif resource == "map" and len(parts) == 4:
            if method != "GET":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Карту можно только читать; задачи меняются через cells.")
            if query:
                raise ApiError(400, "BAD_REQUEST", "Карта целиком возвращается по ключу X-Key без параметров.")
            return 200, {"data": production_map(project, principal)}, project["revision"]
        elif resource in ("activity", "approvals") and len(parts) in (4, 5):
            if method == "GET":
                data = ({"data": get_item(project[resource], parts[4])} if len(parts) == 5
                        else self.listing(project[resource], query))
                return 200, data, project["revision"]
            if resource == "approvals" and method == "POST" and len(parts) == 4:
                data = approval_input(self.body(), project, principal)
                project["approvals"].append(data)
                status = 201
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Историю нельзя менять или удалять; апрувы только добавляются.")
        elif resource == "cells" and len(parts) in (4, 5):
            items = project["cells"]
            item = get_item(items, parts[4]) if len(parts) == 5 else None
            if method == "GET":
                return 200, ({"data": item} if item else self.listing(items, query)), project["revision"]
            create = method == "POST" and item is None
            if create or (method == "PATCH" and item is not None):
                changes = cell_input(self.body(), project, principal, keys, item)
                if create:
                    if map_cell(project, changes["object"], changes["stage"]) is not None:
                        raise ApiError(409, "ALREADY_EXISTS", "Клетка этого объекта и этапа уже существует.")
                    items.append(changes)
                else:
                    if item["status"] in ("approved", "awaiting") and changes["status"] == "done":
                        invalidated.append(item["id"])
                    item.update(changes)
                data, status = changes, 201 if create else 200
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Клетки создаются и изменяются без удаления истории.")
        elif parts[3] == "post" and len(parts) == 4:
            if method == "GET":
                return 200, {"data": {"tasks": project.get("post", [])}}, project["revision"]
            if method != "PUT":
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
            project["post"] = post_input(self.body())
            data, status = {"tasks": project["post"]}, 200
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
                fields(self.body(allow_empty=True), ())
                source = get_item(project["versions"], parts[4])
                backup = snapshot(project, principal, "backup")
                project["script"] = copy.deepcopy(source["script"])
                project["script"].update(status="draft", updatedAt=timestamp())
                project["scenes"] = copy.deepcopy(source["scenes"])
                for shot in project["shots"]:
                    shot["needsReview"] = True
                invalidated.extend(invalidate_cells(project, lambda c: c["object"]["type"] in ("scene", "shot")))
                restored = snapshot(project, principal, "restored", source=source["id"])
                data = {"script": project["script"], "backupVersionId": backup["id"],
                        "restoredVersionId": restored["id"]}
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
            status = 201
        elif resource == "members" and len(parts) in (4, 5):
            items = project["members"]
            item = get_item(items, parts[4]) if len(parts) == 5 else None
            if method == "GET":
                return 200, ({"data": public_member(item, slug, keys)} if item is not None
                             else self.listing([public_member(m, slug, keys) for m in items], query)), project["revision"]
            if method == "POST" and item is None:
                body = self.body()
                if "keyId" in body:
                    member = legacy_member_input(body, slug, keys)
                else:
                    member = member_input(body)
                    # An invitation may not exceed the issuer's project scope.
                    authorize_grant(principal, project, member["sections"])
                    if any(m.get("email", "").casefold() == member["email"].casefold()
                           and not m.get("revokedAt") for m in items):
                        raise ApiError(409, "ALREADY_EXISTS", "Участник с этим e-mail уже имеет доступ.")
                    if member["keyId"] in keys:
                        raise ApiError(409, "ALREADY_EXISTS", "Идентификатор ключа уже существует.")
                    issued_key = "nv1." + slug + "." + member["keyId"] + "." + secrets.token_urlsafe(32)
                    member["keyHash"] = hashlib.sha256(issued_key.encode("ascii")).hexdigest()
                if any(m["keyId"] == member["keyId"] for m in items):
                    raise ApiError(409, "ALREADY_EXISTS", "Ключ уже привязан к участнику.")
                authorize_grant(principal, project, member["sections"])
                items.append(member)
                data, status = public_member(member, slug, keys), 201
            elif method == "PATCH" and item is not None:
                if item.get("revokedAt"):
                    raise ApiError(409, "ACCESS_REVOKED", "Доступ отозван; добавьте участника заново.")
                if item.get("keyHash"):
                    changes = member_input(self.body(), item)
                    if any(m is not item and m.get("email", "").casefold() == changes["email"].casefold()
                           and not m.get("revokedAt") for m in items):
                        raise ApiError(409, "ALREADY_EXISTS", "Участник с этим e-mail уже имеет доступ.")
                else:
                    changes = legacy_member_input(self.body(), slug, keys, item)
                authorize_grant(principal, project, changes["sections"])
                item.update(changes)
                data, status = public_member(item, slug, keys), 200
            elif method == "DELETE" and item is not None:
                if item.get("keyHash") or item.get("revokedAt"):
                    item.pop("keyHash", None)
                    item.setdefault("revokedAt", timestamp())
                    data = public_member(item, slug, keys)
                else:
                    items.remove(item)
                    data = {"id": item["id"], "deleted": True}
                status = 200
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
        elif parts[3] in ("scenes", "shots") and len(parts) in (4, 5):
            collection = parts[3]
            items = project[collection]
            item = get_item(items, parts[4]) if len(parts) == 5 else None
            if method == "GET":
                response = {"data": item} if item is not None else self.listing(items, query)
                return 200, response, project["revision"]
            create = method == "POST" and item is None
            if create or (method == "PATCH" and item is not None):
                body = self.body()
                changes = scene_input(body, create) if collection == "scenes" else shot_input(body, project, create)
                if create:
                    if any(existing["id"] == changes["id"] for existing in items):
                        raise ApiError(409, "ALREADY_EXISTS", "Идентификатор уже существует.")
                    items.append(changes)
                    if collection == "shots":
                        invalidated.extend(invalidate_cells(project, lambda c:
                            c["object"] == {"type": "scene", "id": changes["sceneId"]}
                            and c["stage"] in ("shots", "video", "edit")))
                    data, status = changes, 201
                else:
                    changed = any(item.get(k) != v for k, v in changes.items())
                    if changed and collection == "scenes":
                        shot_ids = {s["id"] for s in project["shots"] if s["sceneId"] == item["id"]}
                        invalidated.extend(invalidate_cells(project, lambda c:
                            c["object"] == {"type": "scene", "id": item["id"]}
                            or (c["object"]["type"] == "shot" and c["object"]["id"] in shot_ids)))
                    if changed and collection == "shots":
                        scene_ids = {item["sceneId"], changes.get("sceneId", item["sceneId"])}
                        invalidated.extend(invalidate_cells(project, lambda c:
                            c["object"] == {"type": "shot", "id": item["id"]}
                            or (c["object"]["type"] == "scene" and c["object"]["id"] in scene_ids
                                and c["stage"] in ("shots", "video", "edit"))))
                    item.update(changes)
                    if collection == "scenes" and changed:
                        for shot in project["shots"]:
                            if shot["sceneId"] == item["id"]:
                                shot["needsReview"] = True
                    if collection == "shots" and changes.get("status") == "approved":
                        item["needsReview"] = False
                    data, status = item, 200
            elif method == "DELETE" and item is not None:
                if collection in ("scenes", "shots") and any(
                        c["object"] == {"type": "scene" if collection == "scenes" else "shot", "id": item["id"]}
                        for c in project["cells"]):
                    raise ApiError(409, "OBJECT_IN_MAP", "Объект используется картой производства и не может быть удалён.")
                if collection == "scenes" and any(s["sceneId"] == item["id"] for s in project["shots"]):
                    raise ApiError(409, "SCENE_IN_USE", "Сначала перенесите или удалите кадры этой сцены.")
                if collection == "shots":
                    invalidated.extend(invalidate_cells(project, lambda c:
                        c["object"] == {"type": "scene", "id": item["sceneId"]}
                        and c["stage"] in ("shots", "video", "edit")))
                items.remove(item)
                data, status = {"id": item["id"], "deleted": True}, 200
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
        else:
            raise ApiError(404, "NOT_FOUND", "Маршрут не найден.")
        invalidated.extend(invalidate_dependencies(project))
        project["revision"] += 1
        project["updatedAt"] = timestamp()
        if len(parts) == 3:
            data = metadata(project)
        stage = None
        if resource in ("cells", "approvals"):
            obj, stage = data["object"], data["stage"]
            action = ("approval." + data["verdict"] if resource == "approvals"
                      else "cell." + ("created" if status == 201 else "updated"))
        else:
            kind = {"scenes": "scene", "shots": "shot", "members": "member", "versions": "version",
                    "characters": "character", "locations": "location"}.get(resource, resource)
            obj = {"type": kind, "id": data.get("id", slug)}
            action = kind + "." + ("deleted" if method == "DELETE" else "created" if status == 201 else "updated")
            if resource == "versions" and len(parts) == 6:
                action, obj = "version.restored", {"type": "version", "id": data["restoredVersionId"]}
            if resource == "breakdown":
                action = "breakdown.imported"
        for import_action, import_object, import_data in import_events:
            activity(project, principal, import_action, import_object, import_data)
        activity(project, principal, action, obj, data, stage, invalidated)
        store.save(project)
        payload = {"data": data}
        if resource == "members" and method == "POST" and "issued_key" in locals():
            payload["key"] = issued_key
        return status, payload, project["revision"]

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
                self.api_response = True
                if self.command == "OPTIONS":
                    requested_method = self.headers.get("Access-Control-Request-Method", "GET")
                    requested_headers = {name.strip().lower() for name in
                                         self.headers.get("Access-Control-Request-Headers", "").split(",") if name.strip()}
                    if (requested_method not in ("GET", "POST", "PUT", "PATCH", "DELETE")
                            or requested_headers - {"x-key", "content-type", "if-match"}
                            or (self.headers.get("Origin") is not None and self.cors_origin() is None)):
                        raise ApiError(400, "BAD_REQUEST", "Некорректный CORS preflight.")
                    self.send_response(204)
                    self.send_header("Content-Length", "0")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
                    self.send_header("Access-Control-Allow-Headers", "X-Key, Content-Type, If-Match")
                    self.end_headers()
                    return
                if head or self.command not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                    raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
                parts = path.rstrip("/").split("/")[1:]
                with self.server.store.lock:
                    principal, keys = self.principal()
                    status, payload, revision = self.route(parts, url.query, principal, keys)
                self.send_json(status, payload, revision)
            elif self.command in ("GET", "HEAD"):
                self.static(path, head)
            else:
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.")
        except ApiError as error:
            self.send_json(error.status, {"error": {"code": error.code, "message": error.message}}, head=head)
        except breakdown.ValidationError as error:
            self.send_json(422, {"error": {"code": "VALIDATION_ERROR", "message": str(error)}}, head=head)
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
                keys_path=DEFAULT_KEYS, bind_and_activate=True, studio_id="default"):
    repo_root = Path(repo_root).resolve()
    keys_path = Path(keys_path).expanduser().resolve()
    load_keys(keys_path)
    server = ThreadingHTTPServer((host, port), Handler, bind_and_activate=bind_and_activate)
    server.repo_root = repo_root
    server.keys_path = keys_path
    server.store = Store(data_root if data_root is not None else REPO_ROOT / "server/data", studio_id)
    return server


def main():
    parser = argparse.ArgumentParser(description="Локальный сервер Neyra Vision Studio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8770, type=int)
    parser.add_argument("--data-dir", type=Path, default=REPO_ROOT / "server/data")
    parser.add_argument("--keys-file", type=Path, default=DEFAULT_KEYS)
    parser.add_argument("--studio-id", default="default", help="Идентификатор студии этого хранилища")
    options = parser.parse_args()
    try:
        server = make_server(options.host, options.port, data_root=options.data_dir, keys_path=options.keys_file,
                             studio_id=options.studio_id)
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
