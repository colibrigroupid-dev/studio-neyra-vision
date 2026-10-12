#!/usr/bin/env python3
"""Локальный сервер блока «Сценарий» studio.neyra.vision.

Раздаёт папку сайта и проксирует запросы ассистента NEYRA к API модели.
Ключ: переменная ANTHROPIC_API_KEY или файл ~/.config/neyra-studio/key (одна строка).

    python3 scenariy/server.py --port 8769
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
API_URL = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("NEYRA_MODEL", "claude-sonnet-5-5")
ROLE_FILE = HERE / "NEYRA-SCENARIST.md"


def load_key():
    k = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if k:
        return k
    f = Path.home() / ".config" / "neyra-studio" / "key"
    if f.exists():
        return f.read_text(encoding="utf-8").strip()
    return ""


def load_role():
    if ROLE_FILE.exists():
        return ROLE_FILE.read_text(encoding="utf-8")
    return "Ты — сценарный редактор студии Neyra Vision. Отвечай по-русски, конкретно, без лести."


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/status":
            return self._json(200, {"ok": True, "key": bool(load_key()), "model": MODEL})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/ask":
            return self._json(404, {"error": "нет такой ручки"})
        key = load_key()
        if not key:
            return self._json(503, {"error": "Ключ API не задан: ANTHROPIC_API_KEY или ~/.config/neyra-studio/key"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception as e:  # noqa: BLE001
            return self._json(400, {"error": "плохой запрос: %s" % e})

        messages = req.get("messages") or []
        if not messages:
            return self._json(400, {"error": "пустой запрос"})
        system = load_role()
        if req.get("system"):
            system = system + "\n\n" + str(req["system"])
        payload = {
            "model": req.get("model") or MODEL,
            "max_tokens": int(req.get("max_tokens") or 4096),
            "system": system,
            "messages": messages,
        }
        data = json.dumps(payload).encode("utf-8")
        r = urllib.request.Request(API_URL, data=data, method="POST", headers={
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        })
        try:
            with urllib.request.urlopen(r, timeout=300) as resp:
                out = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace")
            try:
                msg = json.loads(txt).get("error", {}).get("message", txt)
            except Exception:  # noqa: BLE001
                msg = txt
            return self._json(502, {"error": "API %s: %s" % (e.code, msg[:500])})
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": "сеть: %s" % e})
        text = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
        usage = out.get("usage", {})
        return self._json(200, {"text": text, "usage": usage, "model": out.get("model")})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8769)
    ap.add_argument("--root", default=str(ROOT))
    a = ap.parse_args()
    handler = partial(Handler, directory=a.root)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), handler)
    print("studio.neyra.vision локально: http://127.0.0.1:%d/scenariy/  (ключ: %s, модель задана)" % (
        a.port, "есть" if load_key() else "НЕТ"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
