"""Схемы и план импорта разбивки; без HTTP, прав и доступа к файлам."""

import copy
from datetime import datetime, timezone
import secrets
import unicodedata
from urllib.parse import urlsplit


class ValidationError(Exception):
    pass


def invalid(message):
    raise ValidationError(message)


def fields(value, allowed, required=()):
    if (not isinstance(value, dict) or set(value) - set(allowed)
            or set(required) - set(value)):
        invalid("Неизвестные поля или отсутствуют обязательные поля разбивки/паспорта.")


def text(value, name, limit=240, required=False):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        invalid("Некорректное текстовое поле: " + name)
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        invalid("Некорректный Unicode: " + name)
    return value


def name_key(value):
    return " ".join(unicodedata.normalize("NFC", value).split()).casefold()


def integer(value, name, minimum=1, maximum=1000000):
    if type(value) is not int or not minimum <= value <= maximum:
        invalid("Некорректное целое число: " + name)
    return value


def array(value, name, limit=10000):
    if not isinstance(value, list) or len(value) > limit:
        invalid("Некорректный список: " + name)
    return value


def numbers(value, name="scenes"):
    result = [integer(n, name) for n in array(value, name)]
    if len(set(result)) != len(result):
        invalid("Повтор номера сцены: " + name)
    return result


def strings(value, name, count=1000, length=240, required=False, unique=False):
    result = [text(v, name, length, required) for v in array(value, name, count)]
    if unique and len({name_key(v) for v in result}) != len(result):
        invalid("Повтор имени: " + name)
    return result


def taboo(value):
    return strings(value, "taboo", count=10, length=500, required=True)


def refs(value):
    result = []
    for ref in array(value, "refs", 100):
        fields(ref, ("path", "role"), ("path", "role"))
        path = text(ref["path"], "refs.path", 2048, required=True)
        try:
            url = urlsplit(path)
        except ValueError:
            invalid("Некорректный путь референса.")
        if (any(ord(c) < 32 or ord(c) == 127 for c in path) or "\\" in path
                or (url.scheme and (url.scheme not in ("http", "https") or not url.netloc))
                or (not url.scheme and (url.netloc or url.path.startswith("/")))
                or ".." in url.path.split("/")):
            invalid("Нужен относительный путь или HTTP(S)-ссылка референса.")
        role = ref["role"]
        if not isinstance(role, str) or role not in ("identity", "environment", "costume", "composition"):
            invalid("Недопустимая роль референса.")
        result.append({"path": path, "role": role})
    return result


def translations(value):
    fields(value, ("ru", "kk"))
    result = {}
    for language, translation in value.items():
        fields(translation, ("name", "role", "identity", "height", "taboo"))
        result[language] = {k: taboo(v) if k == "taboo" else text(v, "translations." + k,
                           2000 if k == "identity" else 240) for k, v in translation.items()}
    return result


def aliases(value):
    return strings(value, "aliases", count=20, length=120, required=True, unique=True)


def find_passport(items, name, allow_partial=True):
    """Паспорт по имени, псевдониму или единственному совпадению по целому слову («ТӨСТІК» → «Ер Төстік»)."""
    key = name_key(name)
    for item in items:
        if name_key(item["name"]) == key:
            return item
    for item in items:
        if any(name_key(a) == key for a in item.get("aliases", [])):
            return item
    if not allow_partial:
        return None
    words = set(key.split())
    candidates = [item for item in items
                  if words and (words <= set(name_key(item["name"]).split()) or set(name_key(item["name"]).split()) <= words)
                  and name_key(item["name"]) != key]
    return candidates[0] if len(candidates) == 1 else None


def passport_input(body, create=False):
    fields(body, ("name", "role", "identity", "taboo", "height", "refs", "status", "scenes", "translations", "aliases"),
           ("name",) if create else ())
    result = {}
    for key in ("name", "role", "identity", "height"):
        if key in body:
            result[key] = text(body[key], key, 2000 if key == "identity" else 240, key == "name")
    if "name" in result:
        result["name"] = result["name"].strip()
    for key, validator in (("taboo", taboo), ("refs", refs), ("scenes", numbers),
                           ("translations", translations), ("aliases", aliases)):
        if key in body:
            result[key] = validator(body[key])
    if "status" in body:
        if not isinstance(body["status"], str) or body["status"] not in ("draft", "locked"):
            invalid("Недопустимый статус паспорта.")
        result["status"] = body["status"]
    if create:
        defaults = {"role": "", "identity": "", "taboo": [], "height": "", "refs": [],
                    "status": "draft", "scenes": [], "translations": {}, "aliases": []}
        result = dict(defaults, **result)
    return result


def age(value):
    return None if value is None else integer(value, "age", 0, 150)


def parse_input(body):
    """Принимает как минимальный контракт, так и прямой результат razbivka.parse."""
    fields(body, ("scenes", "characters", "locations", "title", "pages_est", "caps_mentions"),
           ("scenes", "characters", "locations"))
    result = copy.deepcopy(body)
    scene_fields = ("n", "heading", "type", "location", "time", "act", "chars", "page_from", "page_to")
    for scene in array(result["scenes"], "scenes"):
        fields(scene, scene_fields + ("line_from", "line_to", "intros", "caps", "lines"), scene_fields)
        for key in ("heading", "type", "location", "time", "act"):
            text(scene[key], key, 8000 if key == "act" else 240, key in ("heading", "location"))
        for key in ("n", "page_from", "page_to", "line_from", "line_to", "lines"):
            if key in scene:
                integer(scene[key], key)
        if (scene["page_to"] < scene["page_from"]
                or scene.get("line_to", 1) < scene.get("line_from", 1)):
            invalid("Некорректный диапазон страниц или строк сцены.")
        scene["chars"] = strings(scene["chars"], "chars", required=True, unique=True)
        if "caps" in scene:
            scene["caps"] = strings(scene["caps"], "caps", required=True)
        for intro in array(scene.get("intros", []), "intros", 1000):
            fields(intro, ("name", "age"), ("name", "age"))
            text(intro["name"], "intros.name", required=True)
            age(intro["age"])
    scene_numbers = {s["n"] for s in result["scenes"]}
    if len(scene_numbers) != len(result["scenes"]):
        invalid("Повтор номера сцены в разбивке.")
    for collection in ("characters", "locations"):
        seen = set()
        for item in array(result[collection], collection):
            required = (("name", "age", "lines", "scenes", "first_scene") if collection == "characters"
                        else ("name", "parent", "types", "times", "scenes"))
            fields(item, required, required)
            item["name"] = text(item["name"], "name", required=True).strip()
            key = name_key(item["name"])
            if key in seen:
                invalid("Повтор имени в разбивке: " + item["name"])
            seen.add(key)
            item["scenes"] = numbers(item["scenes"])
            if not set(item["scenes"]) <= scene_numbers:
                invalid("Ссылка на сцену вне импортируемой разбивки.")
            if collection == "characters":
                age(item["age"])
                integer(item["lines"], "lines", 0)
                integer(item["first_scene"], "first_scene")
                if item["first_scene"] not in item["scenes"]:
                    invalid("Первое появление отсутствует в списке сцен героя.")
            else:
                text(item["parent"], "parent", required=True)
                item["types"] = strings(item["types"], "types", count=100, unique=True)
                item["times"] = strings(item["times"], "times", count=100, unique=True)
    if "title" in result:
        if not isinstance(result["title"], dict) or len(result["title"]) > 100:
            invalid("title должен быть объектом заголовочных полей Fountain.")
        for key, value in result["title"].items():
            text(key, "title.key", required=True)
            text(value, "title", 8000)
    if "pages_est" in result:
        integer(result["pages_est"], "pages_est")
    for mention in array(result.get("caps_mentions", []), "caps_mentions"):
        fields(mention, ("word", "scenes"), ("word", "scenes"))
        text(mention["word"], "caps_mentions.word", required=True)
        if not set(numbers(mention["scenes"])) <= scene_numbers:
            invalid("Упоминание ссылается на сцену вне разбивки.")
    return result


def ulid():
    """48 бит времени в миллисекундах и 80 случайных бит, Crockford base32."""
    value = (int(datetime.now(timezone.utc).timestamp() * 1000) << 80) | secrets.randbits(80)
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "".join(alphabet[(value >> shift) & 31] for shift in range(125, -1, -5))


def import_data(document, scenes, characters, locations, stamp, studio_id):
    """Меняет только переданные коллекции в памяти; ядро фиксирует их одним save."""
    response = {"scenes": [], "characters": [], "locations": [], "summary": {}}
    events = []
    headings = [name_key(s["heading"]) for s in document["scenes"]]
    numbered_scenes = {s["n"]: s for s in scenes if "n" in s}
    manual_scenes = {}
    for scene in scenes:
        if "n" not in scene:
            manual_scenes.setdefault(name_key(scene["title"]), []).append(scene)
    for collection, items in (("scenes", scenes), ("characters", characters), ("locations", locations)):
        counts = {"created": 0, "updated": 0, "unchanged": 0}
        for row in document[collection]:
            if collection == "scenes":
                changes = {k: copy.deepcopy(v) for k, v in row.items() if k != "heading"}
                changes["title"] = row["heading"]
                item = numbered_scenes.get(row["n"])
                candidates = manual_scenes.get(name_key(row["heading"]), [])
                if item is None and len(candidates) == 1 and headings.count(name_key(row["heading"])) == 1:
                    item = candidates[0]
            else:
                item = find_passport(items, row["name"])
                changes = {k: copy.deepcopy(v) for k, v in row.items() if k != "name"}
                if item is not None and name_key(item["name"]) != name_key(row["name"]) \
                        and not any(name_key(a) == name_key(row["name"]) for a in item.get("aliases", [])):
                    # имя из сценария запоминаем как псевдоним, чтобы следующий разбор сошёлся сразу
                    changes["aliases"] = list(item.get("aliases", [])) + [row["name"]]
            kind = {"scenes": "scene", "characters": "character", "locations": "location"}[collection]
            if item is None:
                item = (passport_input({"name": row["name"]}, create=True) if collection != "scenes"
                        else {"text": ""})
                item.update(changes, id=ulid(), createdAt=stamp, updatedAt=stamp, studio_id=studio_id)
                items.append(item)
                change = "created"
            elif any(item.get(k) != v for k, v in changes.items()):
                item.update(changes, updatedAt=stamp)
                item.setdefault("createdAt", stamp)
                item.setdefault("studio_id", studio_id)
                item.setdefault("text", "") if collection == "scenes" else None
                change = "updated"
            else:
                change = "unchanged"
            counts[change] += 1
            response[collection].append({"id": item["id"], "n": item["n"]} if collection == "scenes"
                                        else {"id": item["id"], "name": item["name"]})
            if change != "unchanged":
                events.append((kind + "." + change, {"type": kind, "id": item["id"]}, copy.deepcopy(item)))
        response["summary"][collection] = counts
    return response, events
