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
import os
from pathlib import Path
import uuid

# Значения по умолчанию, пока Александр не задал свои в ~/.config/neyra-studio/tarify.json.
# Пробный пакет — 100 токенов; вопрос помощнику — 1 токен. Деньги за токен здесь не
# придумываем: цену и способы оплаты задаёт владелец в oplata.json (см. README).
TARIFY_DEFAULT = {"probnyy_paket": 100, "ceny": {"vopros": 1, "kartinka": 5, "video": 40}, "pakety": []}
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
                     {"probnyy_paket": int, "ceny": dict, "pakety": list})
    result["probnyy_paket"] = max(0, min(int(result["probnyy_paket"]), MAX_TOKENY))
    result["ceny"] = {k: max(0, int(v)) for k, v in result["ceny"].items() if isinstance(k, str) and isinstance(v, int)}
    result["pakety"] = [p for p in result["pakety"] if isinstance(p, dict) and isinstance(p.get("tokeny"), int) and p["tokeny"] > 0][:8]
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


def price(operation):
    return tarify()["ceny"].get(operation, 0)


def can_spend(wallet, operation):
    return wallet.get("unlimited") or wallet["balance"] >= price(operation)


def spend(data, principal, operation, note=""):
    wallet = ensure_wallet(data, principal)
    cost = price(operation)
    if wallet.get("unlimited") or cost == 0:
        return wallet, 0
    if wallet["balance"] < cost:
        raise TokenyError(402, "TOKENY_EMPTY", "Токены закончились. Пополните счёт, и помощник продолжит.")
    wallet["balance"] -= cost
    _append(wallet, {"at": timestamp(), "delta": -cost, "reason": operation, "by": principal["id"], "note": note[:120]})
    return wallet, cost


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
    return {"balance": wallet["balance"], "unlimited": bool(wallet.get("unlimited")), "cena_voprosa": price("vopros")}


def _append(wallet, entry):
    wallet["history"].append(entry)
    if len(wallet["history"]) > MAX_HISTORY:
        del wallet["history"][:-MAX_HISTORY]
