"""Блок «Картинки»: образы героев и локаций через Nano Banana (Gemini Image) с ключом на сервере.

Чистые функции: промпт из паспорта, вызов модели, подпись ссылок на файлы. Без HTTP-маршрутов,
прав и записи на диск — это ядро (app.py). Установка Александра 13.10 12:53: продюсеру — все механизмы
картинок (нарисовать по паспорту, приложить референс, правка словами, варианты, утверждение);
паспорт с утверждёнными ракурсами = «лора» героя, его образы подкладываются в следующие кадры.
"""

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta"
MODEL = os.environ.get("NEYRA_IMAGE_MODEL", "gemini-3.1-flash-image")
# Уровни (установка Александра 14.10 15:01): черновая раскадровка — карандашом на дешёвой модели,
# герои/аватары и чистовые кадры — Nano Banana Pro 2K. Ключ — уровень, значение — (модель, размер, ключ цены).
UROVNI = {
    "karandash": (os.environ.get("NEYRA_IMAGE_MODEL_DRAFT", "gemini-3.1-flash-lite-image"), "1K", "karandash"),
    "standard": (MODEL, "2K", "2k"),
    "pro": (os.environ.get("NEYRA_IMAGE_MODEL_PRO", "gemini-3-pro-image"), "2K", "pro"),
}
# Вшитый стиль черновика: не виден пользователю, одинаков для всех кадров проекта.
KARANDASH_STYLE = ("черновой карандашный набросок раскадровки: графитовый карандаш на белой бумаге, строго чёрно-белый, "
                   "быстрые уверенные контуры и штриховка тенями, без цвета, без заливок, без текста, подписей и стрелок, "
                   "кадр 16:9, ясная композиция и крупность, фигуры узнаваемы по силуэту, позе и костюму, "
                   "направление взгляда и движения читается сразу — как лист раскадровки оператора")
SIZES = ("1K", "2K", "4K")
RAKURSY = {
    "characters": (("anfas", "Анфас", "портрет анфас, взгляд в камеру, плечи в кадре"),
                   ("tri-chetverti", "Три четверти", "портрет в три четверти, лёгкий поворот головы"),
                   ("profil-levyy", "Левый профиль", "строгий левый профиль"),
                   ("profil-pravyy", "Правый профиль", "строгий правый профиль"),
                   ("rost", "В полный рост", "в полный рост, нейтральная поза, видна вся одежда и обувь")),
    "locations": (("master", "Мастер-пластина", "общий план места целиком, камера на уровне глаз, широкий объектив"),
                  ("den", "День", "то же место днём, естественный свет"),
                  ("noch", "Ночь", "то же место ночью, практические источники света"),
                  ("detal", "Деталь", "характерная деталь места крупно")),
}
STYLE_DEFAULT = "кинокадр, 16:9, реалистичная оптика, естественный свет, без текста, подписей и водяных знаков"
# 1×1 прозрачный PNG — ответ пробного режима (тесты, стенд без ключа)
FAKE_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


class KartinkiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def rakurs_info(collection, rakurs):
    for key, title, hint in RAKURSY.get(collection, ()):
        if key == rakurs:
            return title, hint
    raise KartinkiError(422, "VALIDATION", "Неизвестный ракурс: " + str(rakurs)[:40])


def api_key():
    key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if key:
        return key
    path = Path(os.environ.get("NEYRA_GOOGLE_KEY_FILE", str(Path.home() / ".config/neyra-studio/google-key")))
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def prompt(passport, collection, rakurs, pravka="", style="", has_refs=False):
    """Текст для модели: стиль проекта, паспорт (внешность, табу), ракурс, правка словами."""
    title, hint = rakurs_info(collection, rakurs)
    who = "Герой" if collection == "characters" else "Локация"
    lines = [f"{who}: {passport.get('name', '')}."]
    if passport.get("role"):
        lines.append(f"Роль в истории: {passport['role']}.")
    if passport.get("identity"):
        lines.append(("Внешность (сохранять точно): " if collection == "characters" else "Как выглядит (сохранять точно): ") + passport["identity"])
    if passport.get("height"):
        lines.append(f"Рост: {passport['height']}.")
    lines.append(f"Ракурс: {title} — {hint}.")
    if has_refs:
        lines.append("На референсах — этот же " + ("герой" if collection == "characters" else "объект")
                     + ": сохрани лицо, причёску, одежду, фактуры и цвета один в один.")
    if passport.get("taboo"):
        lines.append("Не рисовать: " + "; ".join(str(t) for t in passport["taboo"]) + ".")
    if pravka:
        lines.append("Правка художника: " + pravka.strip() + ".")
    lines.append("Стиль: " + (style or STYLE_DEFAULT) + ".")
    return "\n".join(lines)


def generate(text, refs=(), size="2K", aspect="16:9", fake=False, model=None):
    """→ (png_bytes, usage_dict, model). refs — список (mime, bytes). model — из UROVNI, иначе стандартная."""
    model = model or MODEL
    if size not in SIZES:
        raise KartinkiError(422, "VALIDATION", "Размер — 1K, 2K или 4K.")
    if fake or os.environ.get("NEYRA_ASSISTANT_FAKE") == "1":
        return FAKE_PNG, {"fake": True}, "fake-" + model
    key = api_key()
    if not key:
        raise KartinkiError(503, "IMAGE_KEY_MISSING", "Картинки ещё не подключены: на сервере нет ключа Google (~/.config/neyra-studio/google-key).")
    parts = [{"text": text}]
    for mime, blob in refs[:6]:
        parts.append({"inline_data": {"mime_type": mime or "image/png", "data": base64.b64encode(blob).decode()}})
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE", "TEXT"], "imageConfig": {"aspectRatio": aspect, "imageSize": size}}}
    data = None
    for attempt in (0, 1):
        req = urllib.request.Request(f"{GOOGLE_API}/models/{model}:generateContent", data=json.dumps(body).encode("utf-8"),
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            # Не каждая модель принимает imageSize (Lite): отказ 400 бесплатный — повторяем один раз без размера.
            if attempt == 0 and error.code == 400 and "image" in detail.lower() and "size" in detail.lower():
                body["generationConfig"]["imageConfig"].pop("imageSize", None)
                continue
            raise KartinkiError(502, "IMAGE_UPSTREAM", f"Модель картинок ответила ошибкой {error.code}: {detail}") from None
        except (OSError, ValueError) as error:
            raise KartinkiError(502, "IMAGE_UPSTREAM", f"Модель картинок недоступна: {error}") from None
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                return base64.b64decode(blob["data"]), data.get("usageMetadata", {}), model
    reason = "; ".join(p.get("text", "")[:200] for c in data.get("candidates", []) for p in c.get("content", {}).get("parts", []) if p.get("text"))
    raise KartinkiError(502, "IMAGE_EMPTY", "Модель не вернула картинку" + (": " + reason if reason else ". Попробуйте изменить формулировку."))


def sign(secret, slug, file_id, expires):
    message = f"{slug}:{file_id}:{expires}".encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()[:32]


def check(secret, slug, file_id, expires, token, now):
    try:
        expires = int(expires)
    except (TypeError, ValueError):
        return False
    return expires >= now and hmac.compare_digest(sign(secret, slug, file_id, expires), str(token or ""))
