"""Блок «Видео»: промпт кадра и адаптер Seedance 2.5 / BytePlus на stdlib.

Без маршрутов, очереди, прав и хранения проекта. create() делает ровно один POST;
после сетевого сбоя повторный платный запуск решает вызывающее ядро.
"""

import base64
from decimal import Decimal, InvalidOperation
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
MODEL = "dreamina-seedance-2-5-260628"
RESOLUTIONS = ("480p", "720p", "1080p")
MAX_REFS = 6  # Первый кадр тоже занимает одно место.
API_TIMEOUT = 60
DOWNLOAD_TIMEOUT = 120
USD_PER_SECOND = {"480p": "0.103", "720p": "0.231", "1080p": "0.569"}
STATES = {name: name for name in ("queued", "running", "succeeded", "failed", "cancelled")}
STATES["expired"] = "failed"
LOCKED_CAMERA = "locked-off camera, do not change the camera position or the framing"
NO_MUSIC = "no music, only synchronized sound effects and dialogue"
_IMAGE_HANDLE = re.compile(r"@Image\s*(\d+)\b", re.IGNORECASE)
_TASK_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,199}\Z")


class VideoError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _invalid(message):
    raise VideoError(422, "VALIDATION", message)


def _text(value, name, required=False):
    if not isinstance(value, str):
        _invalid(name + " — строка.")
    value = value.strip()
    if required and not value:
        _invalid(name + " не может быть пустым.")
    return value


def _roles(refs_roles):
    if not isinstance(refs_roles, (list, tuple)) or len(refs_roles) > MAX_REFS:
        _invalid("Роли референсов — список, не более шести изображений с первым кадром.")
    lines = []
    for index, ref in enumerate(refs_roles, 1):
        hint = ""
        if isinstance(ref, str):
            description = _text(ref, "Роль референса", required=True)
        elif isinstance(ref, dict):
            role = ref.get("role")
            name = _text(ref.get("name", ""), "Название референса")
            if role == "character" and name:
                description = "герой " + name
                hint = "Сохраняй внешность, лицо, причёску и одежду; не переноси фон изображения."
            elif role == "location" and name:
                description = "локация " + name
                hint = "Сохраняй планировку, архитектуру и свет; не переноси людей из изображения."
            elif role == "first_frame":
                if index != 1:
                    _invalid("Первый кадр должен быть первым изображением.")
                description = "первый кадр" + (": " + name if name else "")
                hint = "Начни с этой композиции, поз, расположения предметов, света и направления камеры."
            else:
                _invalid("Роль — character, location с названием или first_frame.")
        else:
            _invalid("Каждая роль — описание строкой или объект role/name.")
        if _IMAGE_HANDLE.search(description):
            _invalid("В описании роли не нужны номера @Image: они назначаются по порядку.")
        lines.append(f"@Image{index} — это {description}." + (" " + hint if hint else ""))
    return lines


def _static_camera(movement):
    """Распознать статику камеры, не фиксированный фокус или неподвижного героя."""
    value = movement.casefold().strip().rstrip(".")
    aliases = {"static", "fixed", "stationary", "locked-off", "locked off", "статика",
               "статичный кадр", "статичная камера", "неподвижная камера",
               "без движения", "камера без движения", "қозғалыссыз", "қозғалыссыз камера"}
    if value in aliases:
        return True
    if re.search(r"\b(?:not|no|не)\b", value):
        return False
    return bool(re.search(r"\b(?:static|fixed|stationary|locked[ -]off) camera\b|"
                          r"\bcamera (?:is |remains )?(?:static|fixed|stationary|locked[ -]off)\b|"
                          r"\b(?:статичная|неподвижная) камера\b|\bкамера (?:статична|неподвижна)\b", value))


def prompt(shot, scene, refs_roles, dialogue="", sfx=""):
    """Промпт из исходников кадра; refs_roles следуют порядку изображений payload()."""
    if not isinstance(shot, dict) or not isinstance(scene, dict):
        _invalid("Кадр и сцена — объекты.")
    lines = _roles(refs_roles)
    action = _text(shot.get("action") or shot.get("description") or shot.get("prompt") or "",
                   "Действие кадра", required=True)
    lines.append("Действие кадра: " + action)
    for field, label in (("title", "Сцена"), ("location", "Локация"),
                         ("time", "Время суток"), ("ton", "Эмоциональный тон"),
                         ("vizual", "Авторские требования к изображению")):
        if scene.get(field):
            lines.append(label + ": " + _text(scene[field], label))
    # Дословный визуальный промпт Director дополняет действие, если это разные поля.
    visual_prompt = _text(shot.get("prompt") or "", "Визуальный промпт")
    if visual_prompt and visual_prompt != action:
        lines.append("Визуальный замысел кадра: " + visual_prompt)
    camera = shot.get("camera") or {}
    if not isinstance(camera, dict):
        _invalid("Камера — объект size/angle/movement.")
    size = shot.get("size") or shot.get("shotSize") or camera.get("size") or ""
    angle = shot.get("angle") or camera.get("angle") or ""
    movement = _text(shot.get("movement") or camera.get("movement") or "", "Движение камеры")
    for value, label in ((size, "Крупность"), (angle, "Ракурс"), (shot.get("lens"), "Объектив")):
        if value:
            lines.append(label + ": " + _text(value, label))
    if movement:
        lines.append("Движение камеры: " + (LOCKED_CAMERA if _static_camera(movement) else movement))
    lines.append("Single continuous unbroken take. Maintain spatial continuity and each subject's identity.")
    if isinstance(dialogue, dict):
        spoken = _text(dialogue.get("text", ""), "Диалог", required=True)
        language = dialogue.get("language", "")
        speaker = _text(dialogue.get("speaker", ""), "Говорящий")
        delivery = _text(dialogue.get("delivery", ""), "Подача реплики")
    else:
        spoken = _text(dialogue, "Диалог")
        language = shot.get("dialogueLanguage") or scene.get("dialogueLanguage") or scene.get("language") or ""
        speaker = delivery = ""
    if spoken:
        language = _text(language, "Язык диалога", required=True)
        lines.append("Dialogue language: " + language + ". "
                     + (speaker + " говорит. " if speaker else "")
                     + ("Подача: " + delivery + ". " if delivery else "")
                     + "{" + spoken + "}")
    sound = _text(sfx, "Шумы")
    if sound:
        lines.append("Synchronized sound effects: <" + sound + ">")
    lines.append("Формат кадра: 16:9.")
    lines.append(NO_MUSIC)
    result = "\n".join(lines)
    if any(not 1 <= int(match.group(1)) <= len(refs_roles) for match in _IMAGE_HANDLE.finditer(result)):
        _invalid("В тексте упомянут @Image без референса и пояснения роли.")
    return result


def _url(value, allow_data=False):
    value = _text(value, "Адрес материала", required=True)
    if allow_data and value.startswith("data:image/png;base64,"):
        try:
            blob = base64.b64decode(value.split(",", 1)[1], validate=True)
        except ValueError:
            _invalid("Некорректный base64 PNG.")
        if not blob:
            _invalid("Референс PNG пустой.")
        return value
    try:
        parsed = urllib.parse.urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname and not parsed.username
                 and not parsed.password and not parsed.fragment)
        parsed.port  # Проверяет некорректный порт.
    except ValueError:
        valid = False
    if not valid or re.search(r"\s|\\", value):
        _invalid("Материал — HTTPS-ссылка" + (" или data:image/png;base64." if allow_data else "."))
    return value


def payload(text, refs, duration=5, resolution="720p", first_frame=None):
    """Тело POST: текст и до шести картинок; первый кадр всегда перед референсами."""
    text = _text(text, "Промпт", required=True)
    if isinstance(duration, bool) or not isinstance(duration, int) or not 4 <= duration <= 15:
        _invalid("Длительность — целое число от 4 до 15 секунд.")
    if resolution not in RESOLUTIONS:
        _invalid("Разрешение — 480p, 720p или 1080p.")
    if not isinstance(refs, (list, tuple)) or len(refs) + (first_frame is not None) > MAX_REFS:
        _invalid("Не более шести изображений, включая первый кадр.")
    content = [{"type": "text", "text": text}]
    images = ([] if first_frame is None else [(first_frame, "first_frame")])
    images += [(ref, "reference_image") for ref in refs]
    for url, role in images:
        content.append({"type": "image_url", "image_url": {"url": _url(url, allow_data=True)}, "role": role})
    return {"model": MODEL, "content": content, "duration": duration, "resolution": resolution,
            "ratio": "16:9", "generate_audio": True, "watermark": False}


def api_key():
    """Ключ остаётся на сервере; отсутствие проверяется перед реальным API-вызовом."""
    key = os.environ.get("ARK_API_KEY", "").strip()
    if key:
        return key
    try:
        return (Path.home() / ".config/neyra-studio/ark-key").read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return ""


def _api(path, body=None):
    key = api_key()
    if not key:
        raise VideoError(503, "VIDEO_KEY_MISSING",
                         "Видео ещё не подключено: на сервере нет ARK_API_KEY или ~/.config/neyra-studio/ark-key.")
    try:
        req = urllib.request.Request(BASE_URL + path,
                                     data=None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                     headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
                                     method="GET" if body is None else "POST")
        with urllib.request.urlopen(req, timeout=API_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read(600).decode("utf-8", "replace")
        raise VideoError(502, "VIDEO_UPSTREAM", f"Видео API ответило ошибкой {error.code}: {detail}") from None
    except (OSError, ValueError, HTTPException) as error:
        raise VideoError(502, "VIDEO_UPSTREAM", f"Видео API недоступно: {error}") from None
    if not isinstance(data, dict):
        raise VideoError(502, "VIDEO_UPSTREAM", "Видео API вернуло некорректный объект ответа.")
    return data


def create(payload):
    """Один POST без повторов; вызывающий код передаёт результат функции payload()."""
    if os.environ.get("NEYRA_ASSISTANT_FAKE") == "1":
        return "fake-" + secrets.token_hex(12)
    data = _api("/contents/generations/tasks", payload)
    task_id = data.get("id")
    if not isinstance(task_id, str) or not _TASK_ID.fullmatch(task_id):
        raise VideoError(502, "VIDEO_UPSTREAM", "Видео API не вернуло идентификатор задачи.")
    return task_id


def status(task_id):
    """Один GET без ожидания: очередь и период опроса задаёт вызывающий код."""
    if not isinstance(task_id, str) or not _TASK_ID.fullmatch(task_id):
        _invalid("Некорректный идентификатор видеозадачи.")
    if os.environ.get("NEYRA_ASSISTANT_FAKE") == "1" or re.fullmatch(r"fake-[0-9a-f]+", task_id):
        return {"state": "succeeded", "video_url": None, "error": None, "usage": {}, "fake": True}
    data = _api("/contents/generations/tasks/" + task_id)
    raw_state = data.get("status")
    if not isinstance(raw_state, str) or raw_state not in STATES:
        raise VideoError(502, "VIDEO_UPSTREAM", "Видео API вернуло неизвестный статус задачи.")
    content, error, usage = data.get("content"), data.get("error"), data.get("usage")
    content = {} if content is None else content
    usage = {} if usage is None else usage
    if not isinstance(content, dict) or not isinstance(usage, dict) or (error is not None and not isinstance(error, dict)):
        raise VideoError(502, "VIDEO_UPSTREAM", "Видео API вернуло некорректные данные задачи.")
    video_url = content.get("video_url")
    if video_url is not None and not isinstance(video_url, str):
        raise VideoError(502, "VIDEO_UPSTREAM", "Видео API вернуло некорректный адрес видео.")
    if raw_state == "succeeded" and not video_url:
        raise VideoError(502, "VIDEO_UPSTREAM", "Видео API сообщило об успехе без адреса видео.")
    if raw_state == "expired" and not error:
        error = {"code": "VIDEO_EXPIRED", "message": "Время выполнения задачи у провайдера истекло."}
    return {"state": STATES[raw_state], "video_url": video_url, "error": error, "usage": usage}


def usd(seconds, resolution):
    """Оценка себестоимости по RAZBOR/15, без наценки и списания токенов."""
    if not isinstance(resolution, str) or resolution not in USD_PER_SECOND:
        _invalid("Разрешение — 480p, 720p или 1080p.")
    try:
        amount = Decimal(str(seconds))
    except (InvalidOperation, ValueError):
        _invalid("Секунды — неотрицательное конечное число.")
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float, Decimal)) or not amount.is_finite() or amount < 0:
        _invalid("Секунды — неотрицательное конечное число.")
    return float(amount * Decimal(USD_PER_SECOND[resolution]))


class _HTTPSRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            _url(newurl)
        except VideoError:
            raise VideoError(502, "VIDEO_UPSTREAM", "Скачивание видео перенаправлено на недопустимый адрес.") from None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, path):
    """Скачать video/* атомарно; каталог и управляемый путь файла задаёт ядро."""
    url = _url(url)
    destination = Path(path)
    temporary = None
    try:
        opener = urllib.request.build_opener(_HTTPSRedirectHandler())
        with opener.open(url, timeout=DOWNLOAD_TIMEOUT) as resp:
            mime = resp.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if not mime.startswith("video/") or not mime[6:]:
                raise VideoError(502, "VIDEO_UPSTREAM", "Ссылка на видео вернула другой Content-Type.")
            expected = resp.headers.get("Content-Length")
            size = 0
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".video-", suffix=".part", delete=False) as out:
                temporary = Path(out.name)
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    size += len(chunk)
            if not size or (expected is not None and size != int(expected)):
                raise VideoError(502, "VIDEO_UPSTREAM", "Видео скачалось не полностью.")
        temporary.replace(destination)
        return destination
    except (OSError, ValueError, HTTPException) as error:
        raise VideoError(502, "VIDEO_UPSTREAM", f"Не удалось скачать видео: {error}") from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
