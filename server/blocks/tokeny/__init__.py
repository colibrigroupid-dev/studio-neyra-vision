"""Блок «Токены»: кошельки участников, пробный пакет, заявки на пополнение, списание.

Чистые функции над одним словарём `tokeny.json` в папке данных студии. Без HTTP:
маршруты, права и запись на диск — в app.py. Цены и способы оплаты читаются из
конфигурации при каждом вызове, чтобы Александр менял их файлом без перезапуска.

Файл данных:
{
  "koshelki": {"<keyId>": {"keyId", "name", "email", "balance", "unlimited", "history": [...]}},
  "zayavki":  [{"id", "keyId", "name", "email", "tokeny", "sposob", "kommentariy",
                "createdAt", "status": "new"|"done"|"declined", "closedAt", "closedBy", "nachisleno"}]
}
"""

from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import uuid

# Себестоимость по официальным тарифам на 13.10.2026 (USD). Токен — 1 цент, платформе 10 % сверху.
# Модели: Anthropic API — Sonnet 5.5 $2/$10 за 1M токенов входа/выхода, Opus 5.5 $4/$20 (режим PRO).
# Картинки: Nano Banana 2 (Gemini 3.1 Flash Image, прямой ключ Google) 1K $0.067, 2K $0.101, 4K $0.151.
# Видео: Seedance 2.5 (BytePlus ModelArk, прямой ключ) 720p $0.231/с, 1080p $0.569/с.
# Higgsfield как запасное окно: ≈$0.055 за кредит (докупка), картинка 2K = 2 кр, видео 5 с 720p = 35 кр — дороже прямых ключей.
TARIFY_DEFAULT = {
    "token_usd": 0.01, "nacenka": 0.10, "probnyy_paket": 300, "kurs_kzt": 0,
    "modeli_usd_1m": {"claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20]},
    "kartinka_usd": {"1k": 0.067, "2k": 0.101, "4k": 0.151, "karandash": 0.0336, "pro": 0.134, "pro_4k": 0.24},
    "video_usd_sek": {"720p": 0.231, "1080p": 0.569},
    "pakety": [{"tokeny": 500}, {"tokeny": 2000}, {"tokeny": 10000}],
}
MIN_VOPROS = {"standard": 1, "pro": 5}   # минимальный остаток, чтобы задать вопрос (и минимальное списание)
OPLATA_DEFAULT = {"sposoby": [], "ssylka": "", "podskazka": ""}
MAX_HISTORY = 200
MAX_OPEN_ZAYAVOK = 5
MAX_TOKENY = 1_000_000


class TokenyError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _config(env_name, default_name, fallback, shape):
    path = Path(os.environ.get(env_name, str(Path.home() / ".config/neyra-studio" / default_name)))
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return json.loads(json.dumps(fallback))
    result = json.loads(json.dumps(fallback))
    if isinstance(raw, dict):
        for key, kind in shape.items():
            if key in raw and isinstance(raw[key], kind):
                result[key] = raw[key]
    return result


def tarify():
    result = _config("NEYRA_TARIFY_FILE", "tarify.json", TARIFY_DEFAULT,
                     {"token_usd": (int, float), "nacenka": (int, float), "probnyy_paket": int, "kurs_kzt": (int, float),
                      "modeli_usd_1m": dict, "kartinka_usd": dict, "video_usd_sek": dict, "pakety": list})
    result["token_usd"] = max(0.001, float(result["token_usd"]))
    result["nacenka"] = max(0.0, float(result["nacenka"]))
    result["kurs_kzt"] = max(0.0, float(result["kurs_kzt"]))
    result["probnyy_paket"] = max(0, min(int(result["probnyy_paket"]), MAX_TOKENY))
    result["pakety"] = [p for p in result["pakety"] if isinstance(p, dict) and isinstance(p.get("tokeny"), int) and p["tokeny"] > 0][:8]
    return result


def tokens_for_usd(usd, minimum=1):
    """Себестоимость в USD → токены с наценкой, вверх до целого."""
    t = tarify()
    return max(minimum, math.ceil(usd * (1 + t["nacenka"]) / t["token_usd"] - 1e-9))


def cena_voprosa(model, usage, tier="standard"):
    """Вопрос помощнику: по реальному расходу модели (usage из ответа API). Без usage — минимум режима."""
    t = tarify()
    rates = t["modeli_usd_1m"].get(model) or t["modeli_usd_1m"].get("claude-opus-5-5" if tier == "pro" else "claude-sonnet-5-5") or [2, 10]
    inp = int((usage or {}).get("input_tokens") or 0) + int((usage or {}).get("cache_creation_input_tokens") or 0)
    cached = int((usage or {}).get("cache_read_input_tokens") or 0)
    out = int((usage or {}).get("output_tokens") or 0)
    usd = (inp * rates[0] + cached * rates[0] * 0.1 + out * rates[1]) / 1_000_000
    return tokens_for_usd(usd, MIN_VOPROS.get(tier, 1))


KARTINKA_USD_DEFAULT = {"1k": 0.067, "2k": 0.101, "4k": 0.151, "karandash": 0.0336, "pro": 0.134, "pro_4k": 0.24}


def cena_kartinki(size="2k"):
    """size: 1k|2k|4k (Nano Banana 2), karandash (Lite 1K, черновик), pro / pro_4k (Nano Banana Pro)."""
    table = dict(KARTINKA_USD_DEFAULT, **tarify()["kartinka_usd"])
    return tokens_for_usd(table.get(size, 0.101))


def cena_video(sekundy=5, kachestvo="720p"):
    return tokens_for_usd(tarify()["video_usd_sek"].get(kachestvo, 0.231) * max(1, int(sekundy)))


def ceny():
    """Таблица для окна: что сколько стоит в токенах (вопрос — диапазон по типичному расходу)."""
    t = tarify()
    def vopros(model, in_tok, out_tok, tier):
        return cena_voprosa(model, {"input_tokens": in_tok, "output_tokens": out_tok}, tier)
    table = {
        "vopros": [vopros("claude-sonnet-5-5", 5000, 300, "standard"), vopros("claude-sonnet-5-5", 20000, 2500, "standard")],
        "vopros_pro": [vopros("claude-opus-5-5", 5000, 1500, "pro"), vopros("claude-opus-5-5", 20000, 6000, "pro")],
        "kartinka_2k": cena_kartinki("2k"), "kartinka_4k": cena_kartinki("4k"), "kartinka_karandash": cena_kartinki("karandash"), "kartinka_pro": cena_kartinki("pro"),
        "video_5s_720p": cena_video(5, "720p"), "video_5s_1080p": cena_video(5, "1080p"),
        "token_usd": t["token_usd"], "nacenka": t["nacenka"], "kurs_kzt": t["kurs_kzt"],
    }
    return table


def pakety():
    t = tarify()
    result = []
    for p in t["pakety"]:
        usd = round(p["tokeny"] * t["token_usd"], 2)
        item = {"tokeny": p["tokeny"], "usd": usd}
        if t["kurs_kzt"]:
            item["kzt"] = int(round(usd * t["kurs_kzt"] / 10.0) * 10)
        if p.get("cena"):
            item["cena"] = str(p["cena"])[:40]
        result.append(item)
    return result


def oplata():
    result = _config("NEYRA_OPLATA_FILE", "oplata.json", OPLATA_DEFAULT,
                     {"sposoby": list, "ssylka": str, "podskazka": str})
    result["sposoby"] = [s for s in result["sposoby"] if isinstance(s, dict) and isinstance(s.get("nazvanie"), str)][:6]
    return result


def empty():
    return {"koshelki": {}, "zayavki": []}


def validate(data):
    if (not isinstance(data, dict) or not isinstance(data.get("koshelki"), dict)
            or not isinstance(data.get("zayavki"), list)):
        raise ValueError("tokeny.json: неверная форма")
    for key_id, wallet in data["koshelki"].items():
        if (not isinstance(wallet, dict) or wallet.get("keyId") != key_id
                or not isinstance(wallet.get("balance"), int) or not isinstance(wallet.get("history"), list)):
            raise ValueError("tokeny.json: неверный кошелёк " + str(key_id))
    return data


def ensure_wallet(data, principal, name="", email=""):
    """Кошелёк создаётся при первом касании: пробный пакет всем, admin без лимита."""
    wallet = data["koshelki"].get(principal["id"])
    if wallet is None:
        unlimited = principal.get("role") == "admin"
        start = 0 if unlimited else tarify()["probnyy_paket"]
        wallet = {"keyId": principal["id"], "name": name, "email": email, "balance": start,
                  "unlimited": unlimited, "createdAt": timestamp(), "history": []}
        if start:
            wallet["history"].append({"at": wallet["createdAt"], "delta": start, "reason": "probnyy_paket", "by": "system"})
        data["koshelki"][principal["id"]] = wallet
    else:
        if name and not wallet.get("name"):
            wallet["name"] = name
        if email and not wallet.get("email"):
            wallet["email"] = email
    return wallet


def can_spend(wallet, tokeny):
    return wallet.get("unlimited") or wallet["balance"] >= tokeny


def spend(data, principal, operation, tokeny, note=""):
    """Списать tokeny за операцию. Остаток может уйти чуть ниже нуля, если реальный расход превысил предварительную проверку."""
    wallet = ensure_wallet(data, principal)
    if wallet.get("unlimited") or tokeny <= 0:
        return wallet, 0
    if wallet["balance"] <= 0:
        raise TokenyError(402, "TOKENY_EMPTY", "Токены закончились. Пополните счёт, и помощник продолжит.")
    wallet["balance"] -= tokeny
    _append(wallet, {"at": timestamp(), "delta": -tokeny, "reason": operation, "by": principal["id"], "note": note[:120]})
    return wallet, tokeny


def grant(data, key_id, tokeny, by, note=""):
    wallet = data["koshelki"].get(key_id)
    if wallet is None:
        raise TokenyError(404, "NOT_FOUND", "Кошелёк участника не найден: он ещё не входил в окно.")
    if not isinstance(tokeny, int) or not 1 <= tokeny <= MAX_TOKENY:
        raise TokenyError(422, "VALIDATION", "Сколько токенов начислить: целое число от 1 до 1 000 000.")
    wallet["balance"] += tokeny
    _append(wallet, {"at": timestamp(), "delta": tokeny, "reason": "popolnenie", "by": by, "note": note[:120]})
    return wallet


def request_topup(data, principal, tokeny, sposob="", kommentariy=""):
    wallet = ensure_wallet(data, principal)
    if not isinstance(tokeny, int) or not 1 <= tokeny <= MAX_TOKENY:
        raise TokenyError(422, "VALIDATION", "Сколько токенов нужно: целое число от 1 до 1 000 000.")
    if not isinstance(sposob, str) or len(sposob) > 60 or not isinstance(kommentariy, str) or len(kommentariy) > 500:
        raise TokenyError(422, "VALIDATION", "Способ оплаты — до 60 знаков, комментарий — до 500.")
    open_mine = [z for z in data["zayavki"] if z["keyId"] == principal["id"] and z["status"] == "new"]
    if len(open_mine) >= MAX_OPEN_ZAYAVOK:
        raise TokenyError(409, "TOO_MANY", "У вас уже есть открытые заявки. Дождитесь ответа продюсера.")
    zayavka = {"id": uuid.uuid4().hex, "keyId": principal["id"], "name": wallet.get("name", ""),
               "email": wallet.get("email", ""), "tokeny": tokeny, "sposob": sposob.strip(),
               "kommentariy": kommentariy.strip(), "createdAt": timestamp(), "status": "new"}
    data["zayavki"].append(zayavka)
    return zayavka


def close_request(data, zayavka_id, by, nachisleno=0, declined=False):
    zayavka = next((z for z in data["zayavki"] if z["id"] == zayavka_id), None)
    if zayavka is None:
        raise TokenyError(404, "NOT_FOUND", "Заявка не найдена.")
    if zayavka["status"] != "new":
        raise TokenyError(409, "ALREADY_CLOSED", "Заявка уже закрыта.")
    zayavka.update(status="declined" if declined else "done", closedAt=timestamp(), closedBy=by, nachisleno=nachisleno)
    return zayavka


def public_wallet(wallet):
    return {"keyId": wallet["keyId"], "name": wallet.get("name", ""), "email": wallet.get("email", ""),
            "balance": wallet["balance"], "unlimited": bool(wallet.get("unlimited")),
            "history": wallet["history"][-20:]}


def summary(wallet):
    return {"balance": wallet["balance"], "unlimited": bool(wallet.get("unlimited")), "cena_voprosa": MIN_VOPROS["standard"]}


def _append(wallet, entry):
    wallet["history"].append(entry)
    if len(wallet["history"]) > MAX_HISTORY:
        del wallet["history"][:-MAX_HISTORY]
