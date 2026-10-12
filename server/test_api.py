"""Проверки JSON API на HTTP-сервере и временных файлах.

Запуск из корня репозитория: python3 -m unittest server.test_api -v
Явный режим без сетевого bind: NEYRA_TEST_TRANSPORT=inprocess python3 -m unittest server.test_api -v
Он передаёт HTTP-байты настоящему Handler и разбирает его HTTP-ответы,
но не проверяет TCP-транспорт. По умолчанию всегда используется TCP,
автоматической подмены транспорта и пропуска сетевых ошибок нет.
Ключи ниже — вымышленные значения из изолированной временной папки.
"""

import concurrent.futures
import copy
from datetime import datetime
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from server import app
from tools.razbivka import parse as parse_breakdown


class MemorySocket:
    """Транспорт HTTP-байтов для явного режима inprocess без настоящего сокета."""

    def __init__(self, incoming):
        self.incoming = io.BytesIO(incoming)
        self.outgoing = bytearray()

    def makefile(self, mode, buffering=None):
        if mode != "rb":
            raise ValueError("Поддерживается только чтение входящих HTTP-байтов")
        return self.incoming

    def sendall(self, data):
        self.outgoing.extend(data)

    def settimeout(self, timeout):
        pass


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.transport = os.environ.get("NEYRA_TEST_TRANSPORT", "tcp")
        if self.transport not in ("tcp", "inprocess"):
            raise ValueError("NEYRA_TEST_TRANSPORT должен быть tcp или inprocess")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        (self.repo / "index.html").write_text("<h1>Витрина</h1>", encoding="utf-8")
        self.data = self.repo / "server" / "data"
        self.keys = self.root / "keys.json"
        self.keys.write_text(json.dumps({"keys": [
            {"id": "admin", "key": "temporary-admin", "role": "admin",
             "projects": ["*"], "sections": ["*"]},
            {"id": "writer", "key": "temporary-writer", "role": "writer",
             "projects": ["film"], "sections": ["overview", "script"]},
            {"id": "artist", "key": "temporary-artist", "role": "artist",
             "projects": ["film"], "sections": ["overview", "storyboard", "shots"]},
            {"id": "viewer", "key": "temporary-viewer", "role": "viewer",
             "projects": ["film"], "sections": ["overview", "script", "shots"]},
        ]}), encoding="utf-8")
        self.start_server()

    def start_server(self):
        self.httpd = app.make_server(
            host="127.0.0.1", port=0, repo_root=self.repo,
            data_root=self.data, keys_path=self.keys,
            bind_and_activate=(self.transport == "tcp"),
        )
        if self.transport == "tcp":
            self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
            self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        if self.httpd is not None:
            if self.transport == "tcp":
                self.httpd.shutdown()
                self.thread.join(timeout=2)
            self.httpd.server_close()
            self.httpd = None

    def request(self, method, path, payload=None, key="temporary-admin", headers=None,
                include_headers=False, raw_body=None):
        headers = dict(headers or {})
        if key is not None:
            headers["X-Key"] = key
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if raw_body is not None:
            body = raw_body
            headers["Content-Type"] = "application/json"
        if self.transport == "inprocess":
            headers["Content-Length"] = str(len(body or b""))
            request_line = f"{method} {path} HTTP/1.0\r\n"
            header_lines = "".join(f"{name}: {value}\r\n" for name, value in headers.items())
            socket = MemorySocket((request_line + header_lines + "\r\n").encode("ascii") + (body or b""))
            self.httpd.RequestHandlerClass(socket, ("127.0.0.1", 12345), self.httpd)
            response = http.client.HTTPResponse(MemorySocket(bytes(socket.outgoing)), method=method)
            response.begin()
            return self.read_response(response, include_headers)
        conn = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        try:
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            return self.read_response(response, include_headers)
        finally:
            conn.close()

    @staticmethod
    def read_response(response, include_headers):
        raw = response.read()
        content_type = response.getheader("Content-Type", "")
        parsed = json.loads(raw) if raw and "application/json" in content_type else None
        result = (response.status, parsed, raw)
        if include_headers:
            result += (dict(response.getheaders()),)
        response.close()
        return result

    def api(self, method, path, payload=None, status=200, key="temporary-admin", headers=None):
        actual, parsed, raw = self.request(method, path, payload, key, headers)
        self.assertEqual(actual, status, raw.decode("utf-8", errors="replace"))
        self.assertIsInstance(parsed, dict)
        return parsed

    def create(self, slug="film", title="Проверочный проект"):
        return self.api("POST", "/api/projects", {"slug": slug, "title": title}, 201)["data"]

    def member(self, role, sections):
        return self.api("POST", "/api/projects/film/members", {
            "name": role, "role": role, "sections": sections, "keyId": role,
        }, 201)["data"]

    def test_create_list_and_get_project(self):
        created = self.create()
        self.assertEqual(created["slug"], "film")
        self.assertEqual(created["title"], "Проверочный проект")
        listed = self.api("GET", "/api/projects")
        self.assertEqual([p["slug"] for p in listed["data"]], ["film"])
        self.assertEqual(listed["pagination"]["total"], 1)
        metadata = self.api("GET", "/api/projects/film")["data"]
        self.assertEqual(metadata["title"], created["title"])
        self.assertTrue({"script", "scenes", "shots", "members"}.isdisjoint(metadata))
        self.assertTrue((self.data / "film" / "project.json").is_file())
        self.api("POST", "/api/projects", {"slug": "film", "title": "Дубликат"}, 409)

    def test_restore_keeps_current_draft_as_version(self):
        self.create()
        self.api("PUT", "/api/projects/film/script", {"text": "Первая версия", "language": "ru"})
        self.api("POST", "/api/projects/film/scenes", {"id": "one", "title": "Раннее название", "text": "Сцена A"}, 201)
        version = self.api("POST", "/api/projects/film/versions", {"label": "Первая"}, 201)["data"]
        self.api("PUT", "/api/projects/film/script", {"text": "Несохранённый черновик", "language": "kk"})
        self.api("PATCH", "/api/projects/film/scenes/one", {"title": "Новое название", "text": "Сцена B"})
        restored = self.api("POST", f"/api/projects/film/versions/{version['id']}/restore", {}, 201)["data"]
        self.assertEqual(restored["script"]["text"], "Первая версия")
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"], "Первая версия")
        backup = self.api("GET", f"/api/projects/film/versions/{restored['backupVersionId']}")["data"]
        self.assertEqual(backup["script"]["text"], "Несохранённый черновик")
        self.assertEqual(backup["script"]["language"], "kk")
        self.assertEqual(backup["scenes"][0]["text"], "Сцена B")
        current_scene = self.api("GET", "/api/projects/film/scenes/one")["data"]
        self.assertEqual(current_scene["text"], "Сцена A")
        history = self.api("GET", "/api/projects/film/versions")["data"]
        self.assertEqual(len(history), 3)
        self.assertIn(restored["restoredVersionId"], [v["id"] for v in history])

    def test_missing_and_unknown_keys_are_rejected(self):
        for key in (None, "not-a-configured-key"):
            with self.subTest(key=key):
                result = self.api("GET", "/api/projects", status=401, key=key)
                self.assertIn("code", result["error"])
                self.api("POST", "/api/projects", {"slug": "film", "title": "Нет ключа"}, 401, key)
        self.assertFalse((self.data / "film" / "project.json").exists())

    def test_restore_accepts_empty_post_with_or_without_content_length(self):
        self.create()
        self.api("PUT", "/api/projects/film/script", {"text": "Первая"})
        version = self.api("POST", "/api/projects/film/versions", {}, 201)["data"]
        path = f"/api/projects/film/versions/{version['id']}/restore"
        self.api("PUT", "/api/projects/film/script", {"text": "Черновик с Content-Length"})
        self.api("POST", path, status=201)
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"], "Первая")
        self.api("PUT", "/api/projects/film/script", {"text": "Черновик без Content-Length"})
        incoming = (f"POST {path} HTTP/1.0\r\nX-Key: temporary-admin\r\n\r\n").encode("ascii")
        connection = MemorySocket(incoming)
        self.httpd.RequestHandlerClass(connection, ("127.0.0.1", 12345), self.httpd)
        response = http.client.HTTPResponse(MemorySocket(bytes(connection.outgoing)))
        response.begin()
        status, restored, _ = self.read_response(response, False)
        self.assertEqual(status, 201)
        backup = self.api("GET", f"/api/projects/film/versions/{restored['data']['backupVersionId']}")["data"]
        self.assertEqual(backup["script"]["text"], "Черновик без Content-Length")
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"], "Первая")

    def test_json_syntax_and_top_level_shape_have_documented_errors(self):
        for payload in ([], [1], "text", True, 1, 1.5):
            with self.subTest(payload=payload):
                result = self.api("POST", "/api/projects", payload, 400)
                self.assertEqual(result["error"]["code"], "BAD_REQUEST")
        status, result, _ = self.request("POST", "/api/projects", raw_body=b"null")
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "BAD_REQUEST")
        for raw in (b"{broken", b'{"slug":"a","slug":"b"}', b'{"n":NaN}', b"\xff"):
            with self.subTest(raw=raw):
                status, result, _ = self.request("POST", "/api/projects", raw_body=raw)
                self.assertEqual(status, 400)
                self.assertEqual(result["error"]["code"], "INVALID_JSON")
        self.api("POST", "/api/projects", {}, 422)
        self.assertFalse((self.data / "film" / "project.json").exists())

    def test_cors_preflight_allows_role_headers_and_actual_errors_are_readable(self):
        for origin in ("http://127.0.0.1:8769", "https://studio.example.org"):
            with self.subTest(origin=origin):
                status, _, raw, headers = self.request("OPTIONS", "/api/projects", key=None,
                    headers={"Origin": origin, "Access-Control-Request-Method": "PATCH",
                             "Access-Control-Request-Headers": "x-key, content-type, if-match"},
                    include_headers=True)
                self.assertEqual(status, 204)
                self.assertEqual(raw, b"")
                self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
                self.assertIn("X-Key", headers["Access-Control-Allow-Headers"])
                self.assertIn("If-Match", headers["Access-Control-Allow-Headers"])
                status, _, _, headers = self.request("GET", "/api/projects", key=None,
                    headers={"Origin": origin}, include_headers=True)
                self.assertEqual(status, 401)
                self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
                self.assertEqual(headers["Access-Control-Expose-Headers"], "ETag")
        for origin in ("null", "file://local", "https://example.org/path", "https://user@example.org"):
            with self.subTest(origin=origin):
                status, _, _, headers = self.request("OPTIONS", "/api/projects", key=None,
                    headers={"Origin": origin}, include_headers=True)
                self.assertEqual(status, 400)
                self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.api("OPTIONS", "/api/projects", status=400, key=None,
                 headers={"Origin": "https://example.org", "Access-Control-Request-Headers": "Authorization"})

    def test_translations_comments_and_post_survive_round_trip_and_versions(self):
        project_translations = {"ru": {"title": "Фильм", "synopsis": "Замысел"},
                                "kk": {"title": "Фильм Ә", "synopsis": "Ғ Қ Ң Ө Ұ Ү Һ І"}}
        created = self.api("POST", "/api/projects", {
            "slug": "film", "title": "Фильм", "translations": project_translations}, 201)["data"]
        self.assertEqual(created["translations"], project_translations)
        self.api("PATCH", "/api/projects/film", {"synopsis": "Исправленный замысел"})
        self.assertEqual(self.api("GET", "/api/projects/film")["data"]["translations"], project_translations)
        scene_translations = {"ru": {"title": "Комната", "text": "Начало"},
                              "kk": {"title": "Бөлме", "text": "Ә Ғ Қ"}}
        scene = self.api("POST", "/api/projects/film/scenes", {
            "id": "one", "title": "Комната", "translations": scene_translations}, 201)["data"]
        self.assertEqual(scene["translations"], scene_translations)
        self.api("PATCH", "/api/projects/film/scenes/one", {"text": "Авторский текст"})
        shot_translations = {"ru": {"title": "Кадр", "description": "Описание", "prompt": "Свет", "movement": "Вперёд"},
                             "kk": {"title": "Кадр Ә", "description": "Ғ", "prompt": "Қ", "movement": "Ң"}}
        comments = [{"author": "<b>Автор</b>", "text": "<script>текст &</script>", "date": "13.10.2026"}]
        shot = self.api("POST", "/api/projects/film/shots", {
            "id": "shot-one", "sceneId": "one", "title": "Кадр",
            "translations": shot_translations, "comments": comments}, 201)["data"]
        self.assertEqual(shot["translations"], shot_translations)
        self.assertEqual(shot["comments"], comments)
        self.api("PATCH", "/api/projects/film/shots/shot-one", {"status": "review"})
        self.assertEqual(self.api("GET", "/api/projects/film/shots/shot-one")["data"]["comments"], comments)
        _, _, raw = self.request("GET", "/api/projects/film/shots/shot-one")
        self.assertNotIn(b"<", raw)
        self.assertNotIn(b"&", raw)
        draft = self.api("PUT", "/api/projects/film/script", {
            "text": "Русский", "translations": {"ru": "Исходный", "kk": "Қазақша"}})["data"]
        self.assertEqual(draft["translations"], {"ru": "Русский", "kk": "Қазақша"})
        version = self.api("POST", "/api/projects/film/versions", {}, 201)["data"]
        changed = self.api("PUT", "/api/projects/film/script", {"text": "Новый русский"})["data"]
        self.assertEqual(changed["translations"], {"ru": "Новый русский", "kk": "Қазақша"})
        self.api("PATCH", "/api/projects/film/scenes/one", {
            "translations": {"kk": {"title": "Жаңа бөлме"}}})
        self.api("POST", f"/api/projects/film/versions/{version['id']}/restore", {}, 201)
        restored = self.api("GET", "/api/projects/film/script")["data"]
        self.assertEqual(restored["translations"], draft["translations"])
        self.assertEqual(self.api("GET", "/api/projects/film/scenes/one")["data"]["translations"], scene_translations)
        # Файл прежнего сервера не обязан содержать новое поле post.
        project_path = self.data / "film" / "project.json"
        persisted = json.loads(project_path.read_text(encoding="utf-8"))
        persisted.pop("post")
        project_path.write_text(json.dumps(persisted, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(self.api("GET", "/api/projects/film/post")["data"], {"tasks": []})
        tasks = [{"id": "edit", "done": True}, {"id": "sound", "done": False}]
        self.assertEqual(self.api("PUT", "/api/projects/film/post", {"tasks": tasks})["data"], {"tasks": tasks})
        self.stop_server()
        self.start_server()
        self.assertEqual(self.api("GET", "/api/projects/film/post")["data"], {"tasks": tasks})
        self.assertEqual(self.api("GET", "/api/projects/film/shots/shot-one")["data"]["translations"], shot_translations)

    def test_new_fields_validate_shape_and_post_checks_section_and_write_role(self):
        self.create()
        self.assertEqual(self.api("GET", "/api/projects/film/post")["data"], {"tasks": [
            {"id": task_id, "done": False} for task_id in ("edit", "color", "sound", "vfx")]})
        for translations in ([], {"en": {}}, {"kk": []}, {"ru": {"secret": "Нет"}}):
            with self.subTest(translations=translations):
                self.api("PATCH", "/api/projects/film", {"translations": translations}, 422)
        self.api("POST", "/api/projects/film/scenes", {"id": "one", "title": "Комната"}, 201)
        for comments in ({}, [{"author": "A", "text": "B"}], [{"author": "A", "text": 5, "date": ""}],
                         [{"author": "A", "text": "B", "date": "", "key": "secret"}]):
            with self.subTest(comments=comments):
                self.api("POST", "/api/projects/film/shots", {
                    "sceneId": "one", "title": "Кадр", "comments": comments}, 422)
        for tasks in ({}, [{"id": "unknown", "done": False}], [{"id": "edit", "done": 1}],
                      [{"id": "edit", "done": True}, {"id": "edit", "done": False}]):
            with self.subTest(tasks=tasks):
                self.api("PUT", "/api/projects/film/post", {"tasks": tasks}, 422)
        self.member("writer", ["overview", "script"])
        self.api("GET", "/api/projects/film/post", status=403, key="temporary-writer")
        config = json.loads(self.keys.read_text(encoding="utf-8"))
        config["keys"].append({"id": "editor", "key": "temporary-editor", "role": "editor",
                               "projects": ["film"], "sections": ["overview", "post"]})
        config["keys"][3]["sections"].append("post")
        self.keys.write_text(json.dumps(config), encoding="utf-8")
        self.member("editor", ["overview", "post"])
        self.member("viewer", ["overview", "post"])
        self.api("PUT", "/api/projects/film/post", {"tasks": [{"id": "color", "done": True}]}, key="temporary-editor")
        self.api("GET", "/api/projects/film/post", key="temporary-viewer")
        self.api("PUT", "/api/projects/film/post", {"tasks": []}, 403, key="temporary-viewer")
        self.assertEqual(self.api("GET", "/api/projects/film/post")["data"],
                         {"tasks": [{"id": "color", "done": True}]})

    def test_role_membership_and_project_scope_are_checked(self):
        self.create()
        self.create("other")
        self.api("GET", "/api/projects/film", status=403, key="temporary-writer")
        self.member("writer", ["overview", "script"])
        self.member("artist", ["overview", "storyboard", "shots"])
        self.api("PUT", "/api/projects/film/script", {"text": "Авторский текст"}, key="temporary-writer")
        self.api("PUT", "/api/projects/film/script", {"text": "Чужая правка"}, 403, "temporary-artist")
        self.api("GET", "/api/projects/other", status=403, key="temporary-writer")
        self.api("POST", "/api/projects/film/members", {
            "name": "Нельзя", "role": "writer", "sections": ["script"], "keyId": "writer",
        }, 403, "temporary-writer")
        visible = self.api("GET", "/api/projects", key="temporary-writer")["data"]
        self.assertEqual([p["slug"] for p in visible], ["film"])
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"], "Авторский текст")

    def test_failed_write_returns_500_and_keeps_existing_bytes(self):
        self.create()
        self.api("PUT", "/api/projects/film/script", {"text": "Сохранённый черновик"})
        path = self.data / "film" / "project.json"
        old = path.read_bytes()
        with patch.object(app.os, "replace", side_effect=OSError("имитация отказа диска")):
            result = self.api("PUT", "/api/projects/film/script", {"text": "Не записано"}, 500)
        self.assertEqual(result["error"]["code"], "STORAGE_WRITE_FAILED")
        self.assertEqual(path.read_bytes(), old)
        self.assertEqual([p.name for p in path.parent.iterdir()], ["project.json"])
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"], "Сохранённый черновик")

    def test_failed_project_creation_never_exposes_partial_project(self):
        with patch.object(app.os, "replace", side_effect=OSError("имитация отказа диска")):
            result = self.api("POST", "/api/projects", {"slug": "film", "title": "Не записан"}, 500)
        self.assertEqual(result["error"]["code"], "STORAGE_WRITE_FAILED")
        self.assertFalse((self.data / "film" / "project.json").exists())
        self.assertEqual(self.api("GET", "/api/projects")["data"], [])
        self.api("GET", "/api/projects/film", status=404)
        self.assertEqual(list(self.data.rglob("*.tmp")), [])

    def test_fsync_failure_returns_500_keeps_existing_bytes_and_cleans_temp(self):
        self.create()
        self.api("PUT", "/api/projects/film/script", {"text": "Зафиксированный черновик"})
        path = self.data / "film" / "project.json"
        before = path.read_bytes()
        with patch.object(app.os, "fsync", side_effect=OSError("имитация отказа fsync")):
            result = self.api("PUT", "/api/projects/film/script", {"text": "Не зафиксировано"}, 500)
        self.assertEqual(result["error"]["code"], "STORAGE_WRITE_FAILED")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual([p.name for p in path.parent.iterdir()], ["project.json"])

    def test_failed_restore_is_atomic_for_draft_and_history(self):
        self.create()
        self.api("PUT", "/api/projects/film/script", {"text": "Версия A"})
        version = self.api("POST", "/api/projects/film/versions", {}, 201)["data"]
        self.api("PUT", "/api/projects/film/script", {"text": "Важный черновик B"})
        path = self.data / "film" / "project.json"
        old = path.read_bytes()
        with patch.object(app.os, "replace", side_effect=OSError("имитация отказа диска")):
            result = self.api("POST", f"/api/projects/film/versions/{version['id']}/restore", {}, 500)
        self.assertEqual(result["error"]["code"], "STORAGE_WRITE_FAILED")
        self.assertEqual(path.read_bytes(), old)
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"], "Важный черновик B")
        self.assertEqual(len(self.api("GET", "/api/projects/film/versions")["data"]), 1)
        self.assertEqual([p.name for p in path.parent.iterdir()], ["project.json"])

    def test_script_output_is_escaped_without_changing_author_text(self):
        author_text = '<script>alert("тест & Ә Ғ Қ Ң Ө Ұ Ү Һ І")</script>\nINT. КОМНАТА'
        self.create(title="<b>Проект & название</b>")
        self.api("PUT", "/api/projects/film/script", {"text": author_text, "language": "kk"})
        status, parsed, raw = self.request("GET", "/api/projects/film/script")
        self.assertEqual(status, 200)
        self.assertEqual(parsed["data"]["text"], author_text)
        for character in (b"<", b">", b"&"):
            self.assertNotIn(character, raw)
        for escaped in (b"\\u003c", b"\\u003e", b"\\u0026"):
            self.assertIn(escaped, raw.lower())
        persisted = json.loads((self.data / "film" / "project.json").read_text(encoding="utf-8"))
        self.assertEqual(persisted["script"]["text"], author_text)

    def test_data_survives_server_restart(self):
        self.create()
        self.api("PUT", "/api/projects/film/script", {"text": "После перезапуска"})
        version = self.api("POST", "/api/projects/film/versions", {"label": "Сохранено"}, 201)["data"]
        self.stop_server()
        self.start_server()
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"], "После перезапуска")
        self.assertEqual(self.api("GET", f"/api/projects/film/versions/{version['id']}")["data"]["script"]["text"], "После перезапуска")

    def test_concurrent_mutations_do_not_overwrite_other_scenes(self):
        self.create()

        def add_scene(number):
            return self.api("POST", "/api/projects/film/scenes", {
                "id": f"scene-{number}", "title": f"Сцена {number}",
            }, 201)["data"]["id"]

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            ids = set(pool.map(add_scene, range(12)))
        scenes = self.api("GET", "/api/projects/film/scenes")["data"]
        self.assertEqual({scene["id"] for scene in scenes}, ids)
        self.assertEqual(len(scenes), 12)
        json.loads((self.data / "film" / "project.json").read_text(encoding="utf-8"))

    def test_etag_and_stale_if_match_prevent_lost_updates(self):
        self.create()
        status, parsed, _, headers = self.request("GET", "/api/projects/film", include_headers=True)
        self.assertEqual(status, 200)
        original_etag = headers["ETag"]
        self.assertEqual(original_etag, '"%s"' % parsed["data"]["revision"])
        self.api("PUT", "/api/projects/film/script", {"text": "Первое изменение"},
                 headers={"If-Match": original_etag})
        conflict = self.api("PUT", "/api/projects/film/script", {"text": "Устаревшая правка"}, 409,
                            headers={"If-Match": original_etag})
        self.assertEqual(conflict["error"]["code"], "REVISION_CONFLICT")
        status, draft, _, headers = self.request("GET", "/api/projects/film/script", include_headers=True)
        self.assertEqual(status, 200)
        self.assertEqual(draft["data"]["text"], "Первое изменение")
        self.assertNotEqual(headers["ETag"], original_etag)
        self.api("PUT", "/api/projects/film/script", {"text": "Следующее изменение"},
                 headers={"If-Match": headers["ETag"]})
        self.api("PUT", "/api/projects/film/script", {"text": "Без кавычек"}, 400,
                 headers={"If-Match": "1"})

    def test_scene_changes_mark_related_shots_for_review_and_keep_media(self):
        self.create()
        for scene_id in ("one", "two"):
            self.api("POST", "/api/projects/film/scenes", {"id": scene_id, "title": scene_id}, 201)
        shot = self.api("POST", "/api/projects/film/shots", {
            "id": "shot-one", "sceneId": "one", "title": "Общий план", "status": "approved",
            "imageUrl": "https://example.com/frame.jpg", "videoUrl": "https://example.com/shot.mp4",
        }, 201)["data"]
        self.api("POST", "/api/projects/film/shots", {
            "id": "shot-two", "sceneId": "two", "title": "Крупный план", "status": "draft",
        }, 201)
        self.api("PATCH", "/api/projects/film/scenes/one", {"text": "Новый текст"})
        updated = self.api("GET", "/api/projects/film/shots/shot-one")["data"]
        self.assertTrue(updated["needsReview"])
        self.assertEqual(updated["imageUrl"], shot["imageUrl"])
        self.assertEqual(updated["videoUrl"], shot["videoUrl"])
        self.assertEqual(updated["status"], "approved")
        unrelated = self.api("GET", "/api/projects/film/shots/shot-two")["data"]
        self.assertFalse(unrelated.get("needsReview", False))
        self.api("PUT", "/api/projects/film/script", {"text": "Переписанный сценарий"})
        self.assertTrue(self.api("GET", "/api/projects/film/shots/shot-two")["data"]["needsReview"])

    def test_shot_statuses_and_entity_delete(self):
        self.create()
        self.api("POST", "/api/projects/film/scenes", {"id": "one", "title": "Комната"}, 201)
        shot = self.api("POST", "/api/projects/film/shots", {
            "sceneId": "one", "title": "Кадр", "duration": 2.5,
        }, 201)["data"]
        self.assertEqual(shot["status"], "draft")
        for status in ("working", "review", "approved", "draft"):
            changed = self.api("PATCH", f"/api/projects/film/shots/{shot['id']}", {"status": status})["data"]
            self.assertEqual(changed["status"], status)
        self.api("PATCH", f"/api/projects/film/shots/{shot['id']}", {"status": "done"}, 422)
        self.api("DELETE", f"/api/projects/film/shots/{shot['id']}")
        self.api("GET", f"/api/projects/film/shots/{shot['id']}", status=404)
        self.api("DELETE", "/api/projects/film/scenes/one")
        self.api("GET", "/api/projects/film/scenes/one", status=404)

    def test_huge_duration_is_validation_error_and_does_not_modify_project(self):
        self.create()
        self.api("POST", "/api/projects/film/scenes", {"id": "one", "title": "Комната"}, 201)
        shot = self.api("POST", "/api/projects/film/shots", {
            "sceneId": "one", "title": "Кадр", "duration": 2,
        }, 201)["data"]
        path = self.data / "film" / "project.json"
        before = path.read_bytes()
        failure = self.api("PATCH", f"/api/projects/film/shots/{shot['id']}", {"duration": 10 ** 400}, 422)
        self.assertEqual(failure["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(path.read_bytes(), before)

    def test_members_are_key_references_and_viewer_is_read_only(self):
        self.create()
        viewer = self.member("viewer", ["overview", "script", "shots"])
        _, _, raw = self.request("GET", "/api/projects/film/members")
        self.assertNotIn(b"temporary-", raw)
        self.assertEqual(viewer["keyId"], "viewer")
        self.assertNotIn("key", viewer)
        self.api("GET", "/api/projects/film/script", key="temporary-viewer")
        self.api("PUT", "/api/projects/film/script", {"text": "Запрещено"}, 403, "temporary-viewer")
        self.api("GET", "/api/projects/film/members", key="temporary-viewer")
        self.api("POST", "/api/projects/film/members", {
            "name": "Секрет в запросе", "role": "writer", "sections": ["script"],
            "keyId": "writer", "key": "should-not-be-persisted",
        }, 422)
        writer = self.member("writer", ["overview", "script"])
        self.api("PATCH", f"/api/projects/film/members/{writer['id']}", {"sections": ["overview"]})
        self.api("GET", "/api/projects/film/script", status=403, key="temporary-writer")
        self.api("DELETE", f"/api/projects/film/members/{writer['id']}")
        self.api("GET", "/api/projects/film", status=403, key="temporary-writer")

    def test_configured_key_revocation_takes_effect_without_restart(self):
        self.create()
        self.member("writer", ["overview", "script"])
        self.api("GET", "/api/projects/film/script", key="temporary-writer")
        config = json.loads(self.keys.read_text(encoding="utf-8"))
        config["keys"] = [record for record in config["keys"] if record["id"] != "writer"]
        self.keys.write_text(json.dumps(config), encoding="utf-8")
        self.api("GET", "/api/projects/film/script", status=401, key="temporary-writer")
        self.keys.write_text("{broken-json", encoding="utf-8")
        self.api("GET", "/api/projects", status=503)

    def test_duplicate_key_ids_or_secret_values_make_config_unavailable(self):
        original = self.keys.read_text(encoding="utf-8")
        for duplicate_field in ("id", "key"):
            with self.subTest(duplicate_field=duplicate_field):
                config = json.loads(original)
                copied = dict(config["keys"][0])
                if duplicate_field == "id":
                    copied["key"] = "different-temporary-secret"
                else:
                    copied["id"] = "different-id"
                config["keys"].append(copied)
                self.keys.write_text(json.dumps(config), encoding="utf-8")
                result = self.api("GET", "/api/projects", status=503)
                self.assertEqual(result["error"]["code"], "KEYS_UNAVAILABLE")
                self.keys.write_text(original, encoding="utf-8")

    def test_pagination_and_semantic_validation(self):
        for slug in ("film-a", "film-b", "film-c"):
            self.create(slug)
        page = self.api("GET", "/api/projects?offset=1&limit=1")
        self.assertEqual(len(page["data"]), 1)
        self.assertEqual(page["pagination"], {"offset": 1, "limit": 1, "total": 3})
        self.api("GET", "/api/projects?limit=-1", status=400)
        self.api("POST", "/api/projects", {"slug": "../escape", "title": "Нельзя"}, 422)
        self.create()
        self.api("PUT", "/api/projects/film/script", {"text": "Текст", "language": "xx"}, 422)
        self.api("PUT", "/api/projects/film/script", {"text": "Текст", "status": "done"}, 422)

    def test_static_files_never_expose_private_paths_or_symlink_targets(self):
        self.create()
        private_git = self.repo / ".git"
        private_git.mkdir()
        (private_git / "config").write_text("GIT_PRIVATE_MARKER", encoding="utf-8")
        outside = self.root / "outside.txt"
        outside.write_text("OUTSIDE_PRIVATE_MARKER", encoding="utf-8")
        (self.repo / "outside-link.txt").symlink_to(outside)
        (self.repo / "private-link").symlink_to(self.data, target_is_directory=True)
        status, _, raw = self.request("GET", "/", key=None)
        self.assertEqual(status, 200)
        self.assertIn("Витрина".encode("utf-8"), raw)
        for path in (
            "/server/data/film/project.json", "/.git/config", "/%2egit/config",
            "/server/%64ata/film/project.json", "/../outside.txt", "/%2e%2e/outside.txt",
            "/outside-link.txt", "/private-link/film/project.json",
        ):
            with self.subTest(path=path):
                status, _, raw = self.request("GET", path, key=None)
                self.assertGreaterEqual(status, 400)
                self.assertNotIn(b"PRIVATE_MARKER", raw)
                self.assertNotIn("Проверочный проект".encode("utf-8"), raw)

    def test_static_path_is_not_decoded_a_second_time(self):
        assets = self.repo / "assets"
        assets.mkdir()
        encoded_name = "%2e%2e%2f%2e%2e%2foutside.js"
        (assets / encoded_name).write_bytes(b"literal encoded asset")
        (self.root / "outside.js").write_bytes(b"OUTSIDE_PRIVATE_MARKER")
        status, _, raw = self.request("GET", "/assets/%252e%252e%252f%252e%252e%252foutside.js", key=None)
        self.assertEqual(status, 200)
        self.assertEqual(raw, b"literal encoded asset")
        self.assertNotIn(b"PRIVATE_MARKER", raw)

    def test_encoded_leading_slash_cannot_redirect_to_external_host(self):
        (self.repo / "studio").mkdir()
        (self.repo / "studio" / "index.html").write_text("studio", encoding="utf-8")
        status, _, _, headers = self.request("GET", "/%2fstudio", key=None, include_headers=True)
        self.assertEqual(status, 400)
        self.assertNotIn("Location", headers)

    def test_incomplete_body_is_rejected_before_creating_project(self):
        body = b'{"slug":"film","title":"Title"}'
        incoming = (b"POST /api/projects HTTP/1.0\r\nX-Key: temporary-admin\r\n"
                    b"Content-Type: application/json\r\nContent-Length: 200\r\n\r\n" + body)
        connection = MemorySocket(incoming)
        self.httpd.RequestHandlerClass(connection, ("127.0.0.1", 12345), self.httpd)
        response = http.client.HTTPResponse(MemorySocket(bytes(connection.outgoing)))
        response.begin()
        status, failure, _ = self.read_response(response, False)
        self.assertEqual(status, 400)
        self.assertEqual(failure["error"]["code"], "INVALID_JSON")
        self.assertFalse((self.data / "film" / "project.json").exists())

    def test_head_does_not_disclose_private_files_or_send_a_body(self):
        self.create()
        status, _, raw, headers = self.request("HEAD", "/", key=None, include_headers=True)
        self.assertEqual(status, 200)
        self.assertGreater(int(headers["Content-Length"]), 0)
        self.assertEqual(raw, b"")
        for path in ("/server/data/film/project.json", "/.git/config", "/%2e%2e/outside.txt"):
            with self.subTest(path=path):
                status, _, raw = self.request("HEAD", path, key=None)
                self.assertGreaterEqual(status, 400)
                self.assertEqual(raw, b"")

    def production_setup(self, scenes=("one",)):
        """Участники и ключи из временного проекта, без внешних аккаунтов."""
        self.create()
        for scene_id in scenes:
            self.api("POST", "/api/projects/film/scenes", {
                "id": scene_id, "title": "Сцена " + scene_id}, 201)
        config = json.loads(self.keys.read_text(encoding="utf-8"))
        roles = (
            ("director", "director", list(app.ROLE_SECTIONS["director"])),
            ("producer", "producer", list(app.SECTIONS)),
            ("assistant", "assistant_director", ["overview", "script"]),
            ("camera", "cinematographer", ["overview", "storyboard", "shots"]),
            ("editor", "editor", ["overview", "animatic", "post"]),
            ("artist-two", "artist", ["overview", "storyboard", "shots"]),
        )
        for key_id, role, sections in roles:
            config["keys"].append({"id": key_id, "key": "temporary-" + key_id,
                "role": role, "projects": ["film"], "sections": sections})
        self.keys.write_text(json.dumps(config), encoding="utf-8")
        for key_id, role, sections in roles:
            self.api("POST", "/api/projects/film/members", {
                "name": "Участник " + key_id, "role": role, "sections": sections,
                "keyId": key_id}, 201)
        self.member("writer", ["overview", "script"])
        self.member("artist", ["overview", "storyboard", "shots"])
        self.member("viewer", ["overview", "script", "shots"])

    def cell(self, stage, object_id="one", object_type="scene", **values):
        body = {"object": {"type": object_type, "id": object_id}, "stage": stage,
                "version": "v1"}
        body.update(values)
        return self.api("POST", "/api/projects/film/cells", body, 201)["data"]

    def approval(self, cell, verdict="approved", key="temporary-admin", status=201,
                 **values):
        body = {"object": cell["object"], "stage": cell["stage"], "verdict": verdict,
                "comment": "Принято" if verdict == "approved" else "Исправить свет"}
        for field in ("version", "variant"):
            if cell.get(field) is not None:
                body[field] = cell[field]
        body.update(values)
        return self.api("POST", "/api/projects/film/approvals", body, status, key)

    def approved_cell(self, stage, object_id="one", object_type="scene", **values):
        cell = self.cell(stage, object_id, object_type, status="awaiting", **values)
        self.approval(cell)
        return cell

    def project_bytes(self):
        return (self.data / "film" / "project.json").read_bytes()

    def test_production_cell_round_trip_defaults_references_and_unique_object_stage(self):
        self.production_setup()
        cell = self.cell("heroes", assignee={"keyId": "artist", "name": "Лена"},
                         dueAt="2026-10-20T12:00:00+00:00", comment="Портрет героя")
        self.assertEqual(cell["project"], "film")
        self.assertEqual(cell["object"], {"type": "scene", "id": "one"})
        self.assertEqual(cell["status"], "empty")
        self.assertEqual(cell["approverRole"], "director")
        self.assertEqual(cell["assignee"], {"keyId": "artist", "name": "Лена"})
        self.assertEqual(cell["dueAt"], "2026-10-20T12:00:00+00:00")
        self.assertEqual(cell["comment"], "Портрет героя")
        self.assertTrue(cell["id"])
        self.assertEqual(self.api("GET", f"/api/projects/film/cells/{cell['id']}")["data"], cell)
        before = self.project_bytes()
        self.api("POST", "/api/projects/film/cells", {
            "object": cell["object"], "stage": "heroes"}, 409)
        for object_type in ("scene", "shot"):
            with self.subTest(object_type=object_type):
                self.api("POST", "/api/projects/film/cells", {
                    "object": {"type": object_type, "id": "missing"}, "stage": "script"}, 404)
        self.assertEqual(self.project_bytes(), before)
        for object_type in ("teaser", "episode"):
            virtual = self.cell("script", "preview-" + object_type, object_type)
            self.assertEqual(virtual["object"]["type"], object_type)

    def test_production_cells_validate_input_and_cannot_forge_verdict_or_author(self):
        self.production_setup()
        valid = {"object": {"type": "scene", "id": "one"}, "stage": "heroes"}
        invalid_values = (
            {"status": "approved"}, {"status": "returned"}, {"status": "draft"},
            {"stage": "unknown"}, {"object": {"type": "hero", "id": "one"}},
            {"object": {"type": "scene", "id": "../outside"}},
            {"object": ["scene", "one"]}, {"assignee": "artist"},
            {"assignee": {"keyId": "artist", "name": "Лена", "role": "admin"}},
            {"assignee": {"keyId": "missing", "name": "Никто"}},
            {"approverRole": "viewer"}, {"approverRole": "writer"},
            {"dueAt": "завтра"}, {"comment": 4},
            {"version": []}, {"variant": {}}, {"keyId": "admin"}, {"project": "other"},
        )
        before = self.project_bytes()
        for values in invalid_values:
            with self.subTest(values=values):
                self.api("POST", "/api/projects/film/cells", dict(valid, **values), 422)
                self.assertEqual(self.project_bytes(), before)
        cell = self.cell("heroes")
        before = self.project_bytes()
        for status in ("approved", "returned"):
            self.api("PATCH", f"/api/projects/film/cells/{cell['id']}", {"status": status}, 422)
        self.assertEqual(self.project_bytes(), before)

    def test_production_grid_includes_scenes_and_shots_without_persisted_cells(self):
        self.production_setup(scenes=("one", "two"))
        self.api("POST", "/api/projects/film/shots", {
            "id": "one-shot", "sceneId": "one", "title": "Кадр"}, 201)
        result = self.api("GET", "/api/projects/film/map")["data"]
        expected = {("scene", "one"), ("scene", "two"), ("shot", "one-shot")}
        self.assertEqual({(obj["type"], obj["id"]) for obj in result["objects"]}, expected)
        self.assertEqual(result["cells"], [])
        self.assertEqual(len(result["grid"]), 3)
        for row in result["grid"]:
            self.assertEqual(set(row["stages"]), set(result["stages"]))
            self.assertTrue(all(cell is None for cell in row["stages"].values()))
        cell = self.cell("script", "preview", "teaser")
        result = self.api("GET", "/api/projects/film/map")["data"]
        self.assertEqual(len(result["grid"]), 4)
        row = next(row for row in result["grid"] if row["object"] == cell["object"])
        self.assertEqual(row["stages"]["script"], cell)
        self.assertIsNone(row["stages"]["video"])

    def test_production_only_managers_configure_cells_and_only_assignee_updates_work(self):
        self.production_setup()
        cell = self.cell("heroes", assignee={"keyId": "artist", "name": "Лена"})
        path = f"/api/projects/film/cells/{cell['id']}"
        before = self.project_bytes()
        for key in ("temporary-writer", "temporary-artist", "temporary-viewer"):
            self.api("POST", "/api/projects/film/cells", {
                "object": {"type": "scene", "id": "one"}, "stage": "locations"}, 403, key)
        self.api("PATCH", path, {"status": "working"}, 403, "temporary-artist-two")
        self.api("PATCH", path, {"assignee": {"keyId": "artist-two", "name": "Другой"}},
                 403, "temporary-artist")
        self.api("PATCH", path, {"approverRole": "producer"}, 403, "temporary-artist")
        self.api("PATCH", path, {"dueAt": None}, 403, "temporary-artist")
        self.assertEqual(self.project_bytes(), before)
        changed = self.api("PATCH", path, {"status": "working", "comment": "Эскиз готовлю",
            "version": "v2", "variant": "portrait-a"}, key="temporary-artist")["data"]
        self.assertEqual(changed["status"], "working")
        self.assertEqual(changed["version"], "v2")
        self.assertEqual(changed["variant"], "portrait-a")
        self.api("PATCH", path, {"assignee": {"keyId": "artist-two", "name": "Айнур"}},
                 key="temporary-director")
        self.api("PATCH", path, {"status": "done"}, 403, "temporary-artist")
        self.api("PATCH", path, {"status": "done"}, key="temporary-artist-two")

    def test_production_map_is_complete_and_personal_lists_use_authenticated_key(self):
        self.production_setup(scenes=())
        cells = [self.cell("script", "preview-%02d" % i, "teaser", status="awaiting",
                  assignee={"keyId": "writer", "name": "Сценарист"}, approverRole="writer")
                 for i in range(55)]
        unrelated = self.cell("script", "other", "episode",
                              assignee={"keyId": "admin", "name": "Продюсер"})
        result = self.api("GET", "/api/projects/film/map", key="temporary-writer")["data"]
        self.assertEqual(result["project"], "film")
        self.assertEqual(result["stages"], ["script", "breakdown", "heroes", "locations",
            "storyboard", "shots", "video", "sound", "edit"])
        self.assertEqual({cell["id"] for cell in result["cells"]},
                         {cell["id"] for cell in cells} | {unrelated["id"]})
        self.assertEqual({cell["id"] for cell in result["myTasks"]}, {cell["id"] for cell in cells})
        self.assertEqual({cell["id"] for cell in result["awaitingMe"]}, {cell["id"] for cell in cells})
        viewer = self.api("GET", "/api/projects/film/map", key="temporary-viewer")["data"]
        self.assertEqual(viewer["myTasks"], [])
        self.assertEqual(viewer["awaitingMe"], [])
        self.assertEqual(len(viewer["cells"]), 56)
        director = self.api("GET", "/api/projects/film/map", key="temporary-director")["data"]
        self.assertEqual(director["awaitingMe"], [])
        producer = self.api("GET", "/api/projects/film/map", key="temporary-producer")["data"]
        self.assertEqual(len(producer["awaitingMe"]), 55)

    def test_production_approval_default_roles_and_permitted_alternatives(self):
        self.production_setup()
        cases = (("script", "producer"), ("breakdown", "assistant_director"),
                 ("heroes", "director"), ("locations", "director"),
                 ("storyboard", "director"), ("shots", "director"),
                 ("video", "director"), ("sound", "director"), ("edit", "producer"))
        for stage, expected_role in cases:
            with self.subTest(stage=stage):
                cell = self.cell(stage)
                self.assertEqual(cell["approverRole"], expected_role)
        script = self.api("GET", "/api/projects/film/map")["data"]["cells"][0]
        self.api("PATCH", f"/api/projects/film/cells/{script['id']}", {
            "approverRole": "writer", "status": "awaiting"})
        self.approval(script, key="temporary-writer")
        camera_cell = self.cell("storyboard", "camera-preview", "teaser",
                                approverRole="cinematographer", status="awaiting")
        self.approval(camera_cell, key="temporary-camera")
        breakdown = self.cell("breakdown", "breakdown-preview", "teaser", status="awaiting")
        self.approval(breakdown, key="temporary-assistant")
        edit = self.cell("edit", "director-preview", "teaser", approverRole="director")
        self.assertEqual(edit["approverRole"], "director")

    def test_production_wrong_approver_denied_admin_and_producer_override(self):
        self.production_setup()
        cell = self.cell("heroes", status="awaiting", assignee={"keyId": "artist", "name": "Лена"})
        before = self.project_bytes()
        for key in ("temporary-artist", "temporary-camera", "temporary-writer", "temporary-viewer"):
            self.approval(cell, key=key, status=403)
            self.assertEqual(self.project_bytes(), before)
        approved = self.approval(cell, key="temporary-director")["data"]
        self.assertEqual(approved["keyId"], "director")
        datetime.fromisoformat(approved["createdAt"])
        self.assertEqual(approved["verdict"], "approved")
        for stage, key in (("locations", "temporary-producer"), ("storyboard", "temporary-admin")):
            pending = self.cell(stage, status="awaiting")
            self.assertEqual(self.approval(pending, key=key)["data"]["keyId"], key.removeprefix("temporary-"))

    def test_production_approval_requires_awaiting_current_version_and_records_return(self):
        self.production_setup()
        cell = self.cell("heroes", assignee={"keyId": "artist", "name": "Лена"}, variant="portrait-a")
        path = f"/api/projects/film/cells/{cell['id']}"
        before = self.project_bytes()
        self.approval(cell, status=409)
        self.assertEqual(self.project_bytes(), before)
        self.api("PATCH", path, {"status": "awaiting"}, key="temporary-artist")
        before = self.project_bytes()
        for stale in ({"version": "old"}, {"variant": "portrait-b"}, {"version": None}):
            with self.subTest(stale=stale):
                self.approval(cell, status=409, **stale)
                self.assertEqual(self.project_bytes(), before)
        returned = self.approval(cell, "returned", key="temporary-director")["data"]
        self.assertEqual(returned["comment"], "Исправить свет")
        self.assertEqual(self.api("GET", path)["data"]["status"], "returned")
        before = self.project_bytes()
        self.approval(cell, status=409)
        self.assertEqual(self.project_bytes(), before)
        revised = self.api("PATCH", path, {"status": "awaiting", "version": "v2"},
                           key="temporary-artist")["data"]
        self.approval(revised, key="temporary-director")
        history = self.api("GET", "/api/projects/film/approvals")["data"]
        self.assertEqual(history[0], returned)
        self.assertEqual([entry["verdict"] for entry in history], ["returned", "approved"])
        self.assertEqual([entry["version"] for entry in history], ["v1", "v2"])

    def test_production_scene_shots_requires_own_storyboard_and_heroes(self):
        self.production_setup(scenes=("one", "two"))
        self.approved_cell("storyboard", "two")
        self.approved_cell("heroes", "two")
        shots = self.cell("shots", "one")
        path = f"/api/projects/film/cells/{shots['id']}"
        before = self.project_bytes()
        for status in ("working", "done", "awaiting"):
            result = self.api("PATCH", path, {"status": status}, 409)
            self.assertTrue(result["error"]["message"])
            self.assertEqual(self.project_bytes(), before)
        self.approved_cell("storyboard", "one")
        before = self.project_bytes()
        self.api("PATCH", path, {"status": "working"}, 409)
        self.assertEqual(self.project_bytes(), before)
        self.approved_cell("heroes", "one")
        self.assertEqual(self.api("PATCH", path, {"status": "working"})["data"]["status"], "working")
        self.api("PATCH", path, {"status": "awaiting"})
        self.approval(shots)

    def test_production_dependencies_also_guard_creation_video_and_approval(self):
        self.production_setup()
        before = self.project_bytes()
        for stage in ("shots", "video"):
            for state in ("working", "done", "awaiting"):
                with self.subTest(stage=stage, state=state):
                    self.api("POST", "/api/projects/film/cells", {
                        "object": {"type": "scene", "id": "one"}, "stage": stage,
                        "status": state, "version": "v1"}, 409)
                    self.assertEqual(self.project_bytes(), before)
        storyboard = self.approved_cell("storyboard")
        self.approved_cell("heroes")
        shots = self.approved_cell("shots")
        video = self.cell("video", status="awaiting")
        # Другая версия кадра снимает прежний апрув перед новым решением по видео.
        self.api("PATCH", f"/api/projects/film/cells/{shots['id']}", {"version": "v2", "status": "working"})
        before = self.project_bytes()
        self.approval(video, status=409)
        self.assertEqual(self.project_bytes(), before)
        self.api("PATCH", f"/api/projects/film/cells/{shots['id']}", {"status": "awaiting"})
        revised = self.api("GET", f"/api/projects/film/cells/{shots['id']}")["data"]
        self.approval(revised)
        self.api("PATCH", f"/api/projects/film/cells/{video['id']}", {"status": "awaiting"})
        self.approval(video)
        self.assertEqual(self.api("GET", f"/api/projects/film/cells/{storyboard['id']}")["data"]["status"], "approved")

    def test_production_shot_dependencies_inherit_parent_scene_and_teaser_shots_video_have_own_chain(self):
        self.production_setup(scenes=("one", "two"))
        self.api("POST", "/api/projects/film/shots", {
            "id": "one-shot", "sceneId": "one", "title": "Кадр"}, 201)
        self.approved_cell("heroes", "two")
        self.approved_cell("storyboard", "two")
        shot = self.cell("shots", "one-shot", "shot")
        self.api("PATCH", f"/api/projects/film/cells/{shot['id']}", {"status": "working"}, 409)
        self.approved_cell("heroes", "one")
        self.approved_cell("storyboard", "one")
        self.api("PATCH", f"/api/projects/film/cells/{shot['id']}", {"status": "working"})
        video = self.cell("video", "one-shot", "shot")
        self.api("PATCH", f"/api/projects/film/cells/{video['id']}", {"status": "working"}, 409)
        self.approved_cell("shots", "one")
        self.api("PATCH", f"/api/projects/film/cells/{video['id']}", {"status": "working"})
        teaser = self.cell("shots", "preview", "teaser")
        self.api("PATCH", f"/api/projects/film/cells/{teaser['id']}", {"status": "working"}, 409)
        self.approved_cell("heroes", "preview", "teaser")
        self.approved_cell("storyboard", "preview", "teaser")
        self.api("PATCH", f"/api/projects/film/cells/{teaser['id']}", {"status": "awaiting"})
        self.approval(teaser)
        self.approved_cell("video", "preview", "teaser")
        self.api("POST", "/api/projects/film/cells", {
            "object": {"type": "teaser", "id": "preview"}, "stage": "edit", "status": "working"}, 409)

    def test_production_edit_waits_for_video_of_every_scene_and_empty_project_is_blocked(self):
        self.production_setup(scenes=("one", "two"))
        for stage in ("heroes", "storyboard", "shots", "video"):
            self.approved_cell(stage, "one")
        edit = self.cell("edit", "cut", "episode")
        path = f"/api/projects/film/cells/{edit['id']}"
        before = self.project_bytes()
        self.api("PATCH", path, {"status": "working"}, 409)
        self.assertEqual(self.project_bytes(), before)
        for stage in ("heroes", "storyboard", "shots", "video"):
            self.approved_cell(stage, "two")
        self.assertEqual(self.api("PATCH", path, {"status": "working"})["data"]["status"], "working")
        self.create("empty")
        result = self.api("POST", "/api/projects/empty/cells", {
            "object": {"type": "episode", "id": "cut"}, "stage": "edit", "status": "working"}, 409)
        self.assertTrue(result["error"]["message"])

    def test_production_map_and_journals_respect_membership_project_and_section_scope(self):
        self.production_setup()
        self.create("other")
        for resource in ("map", "cells", "approvals", "activity"):
            with self.subTest(resource=resource):
                self.api("GET", "/api/projects/film/" + resource, status=401, key=None)
                self.api("GET", "/api/projects/other/" + resource, status=403, key="temporary-writer")
        cell = self.cell("heroes", status="awaiting")
        config = json.loads(self.keys.read_text(encoding="utf-8"))
        next(k for k in config["keys"] if k["id"] == "director")["sections"] = ["overview"]
        self.keys.write_text(json.dumps(config), encoding="utf-8")
        before = self.project_bytes()
        self.approval(cell, key="temporary-director", status=403)
        self.assertEqual(self.project_bytes(), before)
        result = self.api("GET", "/api/projects/film/map", key="temporary-director")["data"]
        self.assertEqual(result["awaitingMe"], [])
        self.assertIn(cell["id"], [entry["id"] for entry in result["cells"]])
        writer_member = next(m for m in self.api("GET", "/api/projects/film/members")["data"]
                             if m["keyId"] == "writer")
        self.api("PATCH", f"/api/projects/film/members/{writer_member['id']}", {"sections": ["script"]})
        self.api("GET", "/api/projects/film/map", status=403, key="temporary-writer")
        self.api("GET", "/api/projects/film/activity", status=403, key="temporary-writer")
        director_member = next(m for m in self.api("GET", "/api/projects/film/members")["data"]
                               if m["keyId"] == "director")
        self.api("DELETE", f"/api/projects/film/members/{director_member['id']}")
        before = self.project_bytes()
        self.approval(cell, key="temporary-director", status=403)
        self.api("GET", "/api/projects/film/map", status=403, key="temporary-director")
        self.assertEqual(self.project_bytes(), before)

    def test_production_approvals_and_activity_are_append_only_and_paginated(self):
        self.production_setup()
        cell = self.cell("heroes", status="awaiting")
        approval = self.approval(cell)["data"]
        before = self.project_bytes()
        activity = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        for resource, entry_id in (("approvals", approval["id"]), ("activity", activity[0]["id"])):
            for suffix in ("", "/" + entry_id):
                for method in ("PUT", "PATCH", "DELETE"):
                    with self.subTest(resource=resource, suffix=suffix, method=method):
                        self.api(method, "/api/projects/film/" + resource + suffix, {}, 405)
                        self.assertEqual(self.project_bytes(), before)
        self.assertEqual(self.api("GET", f"/api/projects/film/approvals/{approval['id']}")["data"], approval)
        self.assertEqual(self.api("GET", f"/api/projects/film/activity/{activity[0]['id']}")["data"], activity[0])
        self.api("POST", "/api/projects/film/activity", {"action": "forged", "keyId": "admin"}, 405)
        page = self.api("GET", "/api/projects/film/activity?offset=1&limit=2")
        self.assertEqual(page["data"], activity[1:3])
        self.assertEqual(page["pagination"], {"offset": 1, "limit": 2, "total": len(activity)})
        self.assertEqual(self.api("GET", "/api/projects/film/approvals?offset=1&limit=1")["data"], [])

    def test_production_activity_covers_old_and_new_mutations_and_keeps_history_on_restore(self):
        self.production_setup()
        initial = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        self.assertEqual(initial[0]["action"], "project.created")
        self.api("PUT", "/api/projects/film/script", {"text": "Версия до возврата"}, key="temporary-writer")
        version = self.api("POST", "/api/projects/film/versions", {"label": "Драфт"}, 201)["data"]
        cell = self.cell("heroes", assignee={"keyId": "artist", "name": "Лена"})
        self.api("PATCH", f"/api/projects/film/cells/{cell['id']}", {"status": "awaiting"}, key="temporary-artist")
        approval = self.approval(cell, key="temporary-director")["data"]
        before_restore = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        self.api("POST", f"/api/projects/film/versions/{version['id']}/restore", {}, 201)
        events = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        self.assertEqual(events[:len(before_restore)], before_restore)
        self.assertGreater(len(events), len(before_restore))
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], [approval])
        self.assertEqual(self.api("GET", f"/api/projects/film/cells/{cell['id']}")["data"]["status"], "done")
        accepted = next(event for event in events if event.get("approvalId") == approval["id"])
        self.assertEqual(accepted["cellId"], cell["id"])
        self.assertEqual(accepted["status"], "approved")
        self.assertEqual(accepted["version"], "v1")
        self.assertIsNone(accepted["variant"])
        submitted = next(event for event in events if event["action"] == "cell.updated")
        self.assertEqual(submitted["status"], "awaiting")
        self.assertEqual(events[:len(initial)], initial)
        self.assertEqual([event["sequence"] for event in events], list(range(1, len(events) + 1)))
        self.assertEqual(len({event["id"] for event in events}), len(events))
        for i, event in enumerate(events):
            self.assertRegex(event["hash"], r"^[a-f0-9]{64}$")
            self.assertRegex(event["contentHash"], r"^[a-f0-9]{64}$")
            self.assertEqual(event["previousHash"], events[i - 1]["hash"] if i else None)
            unhashed = {name: value for name, value in event.items() if name != "hash"}
            canonical = json.dumps(unhashed, ensure_ascii=False, sort_keys=True,
                                   separators=(",", ":")).encode("utf-8")
            self.assertEqual(event["hash"], hashlib.sha256(canonical).hexdigest())
            self.assertTrue(event["keyId"])
            self.assertIsInstance(event["name"], str)
            self.assertIsInstance(event["object"], dict)
            datetime.fromisoformat(event["createdAt"])
        self.assertIn("writer", [event["keyId"] for event in events])
        self.assertIn("artist", [event["keyId"] for event in events])
        self.assertIn("director", [event["keyId"] for event in events])
        _, _, raw = self.request("GET", "/api/projects/film/activity?limit=100")
        self.assertNotIn(b"temporary-", raw)
        self.stop_server()
        self.start_server()
        self.assertEqual(self.api("GET", "/api/projects/film/activity?limit=100")["data"], events)
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], [approval])

    def test_production_failed_writes_never_leave_partial_cell_approval_or_event(self):
        self.production_setup()
        cell = self.cell("heroes", status="awaiting")
        before = self.project_bytes()
        with patch.object(app.os, "replace", side_effect=OSError("имитация отказа диска")):
            self.approval(cell, status=500)
        self.assertEqual(self.project_bytes(), before)
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], [])
        self.assertEqual(self.api("GET", f"/api/projects/film/cells/{cell['id']}")["data"]["status"], "awaiting")
        with patch.object(app.os, "fsync", side_effect=OSError("имитация отказа fsync")):
            self.api("PATCH", f"/api/projects/film/cells/{cell['id']}", {"status": "working"}, 500)
        self.assertEqual(self.project_bytes(), before)
        with patch.object(app.os, "replace", side_effect=OSError("имитация отказа диска")):
            self.api("POST", "/api/projects/film/cells", {
                "object": {"type": "scene", "id": "one"}, "stage": "locations"}, 500)
        self.assertEqual(self.project_bytes(), before)
        self.assertEqual(list(self.data.rglob("*.tmp")), [])

    def test_production_legacy_project_gains_empty_map_without_rewriting_on_read(self):
        self.create()
        path = self.data / "film" / "project.json"
        persisted = json.loads(path.read_text(encoding="utf-8"))
        for field in ("cells", "approvals", "activity"):
            persisted.pop(field, None)
        path.write_text(json.dumps(persisted, ensure_ascii=False), encoding="utf-8")
        before = path.read_bytes()
        result = self.api("GET", "/api/projects/film/map")["data"]
        self.assertEqual(result["cells"], [])
        self.assertEqual(result["myTasks"], [])
        self.assertEqual(result["awaitingMe"], [])
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], [])
        self.assertEqual(self.api("GET", "/api/projects/film/activity")["data"], [])
        self.assertEqual(path.read_bytes(), before)
        cell = self.cell("script", "legacy-preview", "teaser", status="awaiting")
        approval = self.approval(cell)["data"]
        events = self.api("GET", "/api/projects/film/activity")["data"]
        self.assertEqual(len(events), 2)
        self.stop_server()
        self.start_server()
        self.assertEqual(self.api("GET", "/api/projects/film/map")["data"]["cells"][0]["status"], "approved")
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], [approval])
        self.assertEqual(self.api("GET", "/api/projects/film/activity")["data"], events)

    def test_production_concurrent_cells_keep_all_operations_in_activity(self):
        self.production_setup(scenes=())
        prior = self.api("GET", "/api/projects/film/activity?limit=100")["data"]

        def add_cell(number):
            return self.cell("script", "parallel-%02d" % number, "teaser")["id"]

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            ids = set(pool.map(add_cell, range(12)))
        cells = self.api("GET", "/api/projects/film/map")["data"]["cells"]
        self.assertEqual({cell["id"] for cell in cells}, ids)
        events = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        self.assertEqual(events[:len(prior)], prior)
        self.assertEqual(len(events), len(prior) + 12)
        self.assertEqual([event["sequence"] for event in events], list(range(1, len(events) + 1)))

    def test_production_legacy_shot_approved_cannot_open_map_gates_or_delete_mapped_objects(self):
        self.production_setup()
        self.api("POST", "/api/projects/film/shots", {
            "id": "one-shot", "sceneId": "one", "title": "Кадр"}, 201,
            "temporary-artist")
        self.api("PATCH", "/api/projects/film/shots/one-shot", {"status": "approved"},
                 key="temporary-artist")
        shots = self.cell("shots")
        video = self.cell("video")
        shot_cell = self.cell("video", "one-shot", "shot")
        before = self.project_bytes()
        for cell in (shots, video, shot_cell):
            with self.subTest(stage=cell["stage"], object=cell["object"]):
                result = self.api("PATCH", f"/api/projects/film/cells/{cell['id']}",
                                  {"status": "working"}, 409)
                self.assertEqual(result["error"]["code"], "DEPENDENCY_CONFLICT")
                self.assertEqual(self.project_bytes(), before)
        for path in ("/api/projects/film/scenes/one", "/api/projects/film/shots/one-shot"):
            result = self.api("DELETE", path, status=409)
            self.assertEqual(result["error"]["code"], "OBJECT_IN_MAP")
            self.assertEqual(self.project_bytes(), before)
        self.assertEqual(self.api("GET", "/api/projects/film/shots/one-shot")["data"]["status"], "approved")

    def test_production_content_changes_and_restore_withdraw_current_approvals_without_erasing_history(self):
        self.production_setup()
        self.api("POST", "/api/projects/film/shots", {
            "id": "one-shot", "sceneId": "one", "title": "Кадр"}, 201)
        version = self.api("POST", "/api/projects/film/versions", {"label": "Исходник"}, 201)["data"]
        cells = {stage: self.cell(stage) for stage in ("heroes", "storyboard", "shots", "video", "sound")}
        cells["shot-sound"] = self.cell("sound", "one-shot", "shot")
        cells["episode-edit"] = self.cell("edit", "cut", "episode")
        mutations = (
            ("script", "PUT", "/api/projects/film/script", {"text": "Новый сценарий"}, 200),
            ("scene", "PATCH", "/api/projects/film/scenes/one", {"text": "Новый текст сцены"}, 200),
            ("shot", "PATCH", "/api/projects/film/shots/one-shot", {"description": "Другой ракурс"}, 200),
            ("new-shot", "POST", "/api/projects/film/shots", {
                "id": "new-shot", "sceneId": "one", "title": "Добавленный кадр"}, 201),
            ("delete-shot", "DELETE", "/api/projects/film/shots/new-shot", None, 200),
            ("restore", "POST", f"/api/projects/film/versions/{version['id']}/restore", {}, 201),
        )
        for kind, method, path, payload, status in mutations:
            with self.subTest(kind=kind):
                # Снова утверждаем текущий результат, чтобы каждый способ изменения
                # проверял снятие реального актуального апрува, а не уже пустую клетку.
                for stage in ("heroes", "storyboard", "shots", "video"):
                    self.api("PATCH", f"/api/projects/film/cells/{cells[stage]['id']}", {"status": "awaiting"})
                    self.approval(cells[stage])
                for stage in ("sound", "shot-sound", "episode-edit"):
                    self.api("PATCH", f"/api/projects/film/cells/{cells[stage]['id']}", {"status": "awaiting"})
                history = self.api("GET", "/api/projects/film/approvals")["data"]
                self.api(method, path, payload, status)
                self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], history)
                for stage, cell in cells.items():
                    expected = "done"
                    if kind in ("shot", "new-shot", "delete-shot") and stage in ("heroes", "storyboard"):
                        expected = "approved"
                    elif kind in ("shot", "new-shot", "delete-shot") and stage == "sound":
                        expected = "awaiting"
                    elif kind in ("new-shot", "delete-shot") and stage == "shot-sound":
                        expected = "awaiting"
                    current = self.api("GET", f"/api/projects/film/cells/{cell['id']}")["data"]
                    self.assertEqual(current["status"], expected, kind + " / " + stage)
                video_path = f"/api/projects/film/cells/{cells['video']['id']}"
                changed = self.api("PATCH", video_path, {
                    "comment": "Подготовить новую версию", "dueAt": "2026-10-21"})["data"]
                self.assertEqual(changed["status"], "done")
                self.assertEqual(changed["comment"], "Подготовить новую версию")
                self.assertEqual(changed["dueAt"], "2026-10-21")
                before = self.project_bytes()
                self.api("PATCH", video_path, {"status": "working"}, 409)
                self.assertEqual(self.project_bytes(), before)

    def test_production_changed_cell_version_or_approver_withdraws_gate_and_preserves_verdicts(self):
        self.production_setup()
        heroes = self.approved_cell("heroes")
        storyboard = self.approved_cell("storyboard")
        shots = self.approved_cell("shots")
        video = self.approved_cell("video")
        edit = self.cell("edit", "cut", "episode", status="awaiting")
        history = self.api("GET", "/api/projects/film/approvals")["data"]
        path = f"/api/projects/film/cells/{storyboard['id']}"
        revised = self.api("PATCH", path, {"version": "v2"})["data"]
        self.assertEqual(revised["status"], "done")
        for cell in (shots, video, edit):
            self.assertEqual(self.api("GET", f"/api/projects/film/cells/{cell['id']}")["data"]["status"], "done")
        self.assertEqual(self.api("GET", f"/api/projects/film/cells/{heroes['id']}")["data"]["status"], "approved")
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], history)
        self.api("PATCH", path, {"status": "awaiting"})
        self.approval(revised)
        history = self.api("GET", "/api/projects/film/approvals")["data"]
        changed = self.api("PATCH", path, {"approverRole": "cinematographer"})["data"]
        self.assertEqual(changed["status"], "done")
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], history)
        before = self.project_bytes()
        self.approval(changed, key="temporary-director", status=403)
        self.assertEqual(self.project_bytes(), before)
        self.api("PATCH", path, {"status": "awaiting"})
        self.approval(changed, key="temporary-camera")


class TeamAccessTests(unittest.TestCase):
    """№35: выпуск, ограничение прав и отзыв ключей внутри проекта."""

    # Используем настоящий HTTP Handler и те же изолированные файлы,
    # но не наследуем ApiTests, чтобы прежние тесты не запускались повторно.
    setUp = ApiTests.setUp
    start_server = ApiTests.start_server
    stop_server = ApiTests.stop_server
    request = ApiTests.request
    read_response = staticmethod(ApiTests.read_response)
    api = ApiTests.api
    create = ApiTests.create

    def issue(self, role="writer", sections=None, key="temporary-admin", slug="film", **fields):
        payload = {"name": "Участник проекта", "email": "member@example.test",
                   "role": role, "sections": sections or ["overview", "script"]}
        payload.update(fields)
        return self.api("POST", f"/api/projects/{slug}/members", payload, 201, key)

    def stored_project(self, slug="film"):
        return json.loads((self.data / slug / "project.json").read_text(encoding="utf-8"))

    def test_issued_keys_are_random_hash_only_and_never_returned_by_read_endpoints(self):
        self.create()
        configured_keys = self.keys.read_bytes()
        name = '<script>alert("команда")</script> Әлия & К'
        issued = self.issue(name=name, email="aliya@example.test")
        member, secret = issued["data"], issued["key"]
        self.assertEqual(member["name"], name)
        self.assertEqual(member["email"], "aliya@example.test")
        self.assertEqual(member["accessStatus"], "active")
        self.assertIsInstance(secret, str)
        self.assertGreaterEqual(len(secret), 32)
        self.assertNotIn("key", member)
        self.assertNotIn("keyHash", member)
        second = self.issue(email="other@example.test")
        self.assertNotEqual(secret, second["key"])
        self.assertNotEqual(member["id"], second["data"]["id"])
        self.assertEqual(self.keys.read_bytes(), configured_keys)
        stored = self.stored_project()
        persisted = next(m for m in stored["members"] if m["id"] == member["id"])
        digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()
        self.assertEqual(persisted["keyHash"], digest)
        for path in self.data.rglob("*"):
            if path.is_file():
                self.assertNotIn(secret.encode("ascii"), path.read_bytes(), str(path))
                self.assertNotIn(second["key"].encode("ascii"), path.read_bytes(), str(path))
        reads = ("/api/projects", "/api/projects/film", "/api/projects/film/members",
                 f"/api/projects/film/members/{member['id']}", "/api/projects/film/activity")
        for path in reads:
            with self.subTest(path=path):
                status, response, raw = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertNotIn(secret.encode("ascii"), raw)
                self.assertNotIn(digest.encode("ascii"), raw)
                self.assertNotIn(b'"keyHash"', raw)
                self.assertNotIn(b'"key"', raw)
        status, session, raw = self.request("GET", "/api/session", key=secret)
        self.assertEqual(status, 200)
        self.assertEqual(session["data"]["id"], member["keyId"])
        self.assertNotIn(secret.encode("ascii"), raw)
        self.assertNotIn(digest.encode("ascii"), raw)

    def test_issued_key_authenticates_after_restart_and_is_scoped_to_one_project(self):
        self.create()
        self.create("other")
        issued = self.issue()
        member, secret = issued["data"], issued["key"]
        self.stop_server()
        self.start_server()
        session = self.api("GET", "/api/session", key=secret)["data"]
        self.assertEqual(session["id"], member["keyId"])
        self.assertEqual(session["role"], "writer")
        self.assertEqual(session["projects"], ["film"])
        self.assertIn("script", session["sections"])
        listed = self.api("GET", "/api/projects", key=secret)["data"]
        self.assertEqual([p["slug"] for p in listed], ["film"])
        project = self.api("GET", "/api/projects/film", key=secret)["data"]
        self.assertFalse(project["capabilities"]["manageTeam"])
        self.api("PUT", "/api/projects/film/script", {"text": "Авторский текст Әлия"}, key=secret)
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"],
                         "Авторский текст Әлия")
        self.api("GET", "/api/projects/other", status=403, key=secret)
        self.api("GET", "/api/projects/not-created", status=403, key=secret)
        self.api("POST", "/api/projects", {"slug": "third", "title": "Нельзя"}, 403, secret)
        self.assertFalse((self.data / "third" / "project.json").exists())

    def test_rights_change_on_next_request_and_revocation_keeps_member_but_rejects_key(self):
        self.create()
        issued = self.issue()
        member, secret = issued["data"], issued["key"]
        path = f"/api/projects/film/members/{member['id']}"
        # Весь состав виден автору с разделами overview/script, без права team.
        roster = self.api("GET", "/api/projects/film/members", key=secret)["data"]
        self.assertIn(member["id"], [m["id"] for m in roster])
        self.api("GET", path, key=secret)
        self.api("POST", "/api/projects/film/members", {
            "name": "Запрещено", "email": "no@example.test", "role": "writer",
            "sections": ["overview", "script"]}, 403, secret)
        self.api("PATCH", path, {"role": "producer", "sections": ["overview", "team"]}, 403, secret)
        self.api("DELETE", path, status=403, key=secret)
        self.api("PUT", "/api/projects/film/script", {"text": "Можно"}, key=secret)
        changed = self.api("PATCH", path, {"sections": ["overview"]})
        self.assertNotIn("key", changed)
        self.api("GET", "/api/projects/film/script", status=403, key=secret)
        self.api("PUT", "/api/projects/film/script", {"text": "Нельзя"}, 403, secret)
        self.api("PATCH", path, {"role": "viewer", "sections": ["overview", "script"]})
        self.assertEqual(self.api("GET", "/api/session", key=secret)["data"]["role"], "viewer")
        self.api("GET", "/api/projects/film/script", key=secret)
        self.api("PUT", "/api/projects/film/script", {"text": "Наблюдатель не пишет"}, 403, secret)
        revoked = self.api("DELETE", path)["data"]
        self.assertEqual(revoked["id"], member["id"])
        self.assertEqual(revoked["accessStatus"], "revoked")
        self.assertTrue(revoked["revokedAt"])
        roster = self.api("GET", "/api/projects/film/members")["data"]
        self.assertEqual(next(m for m in roster if m["id"] == member["id"])["accessStatus"], "revoked")
        for endpoint in ("/api/session", "/api/projects", "/api/projects/film",
                         "/api/projects/film/script", "/api/projects/film/members"):
            with self.subTest(endpoint=endpoint):
                self.api("GET", endpoint, status=401, key=secret)
        # Изменение прав не восстанавливает отозванный секрет.
        result = self.api("PATCH", path, {"role": "writer", "sections": ["overview", "script"]}, 409)
        self.assertEqual(result["error"]["code"], "ACCESS_REVOKED")
        self.api("GET", "/api/session", status=401, key=secret)

    def test_all_manager_roles_can_issue_change_and_revoke_access_only_in_their_project(self):
        self.create()
        self.create("other")
        configured = json.loads(self.keys.read_text(encoding="utf-8"))
        configured["keys"].append({"id": "scoped-admin", "key": "temporary-scoped-admin",
                                   "role": "admin", "projects": ["film"], "sections": ["*"]})
        self.keys.write_text(json.dumps(configured), encoding="utf-8")
        for role in ("admin", "producer", "director"):
            with self.subTest(role=role):
                manager_secret = "temporary-scoped-admin" if role == "admin" else self.issue(
                    role, ["overview", "team", "script"], email=role + "@example.test")["key"]
                self.assertTrue(self.api("GET", "/api/projects/film", key=manager_secret)["data"]
                                ["capabilities"]["manageTeam"])
                created = self.issue(key=manager_secret, email=role + "-writer@example.test")
                path = f"/api/projects/film/members/{created['data']['id']}"
                self.api("PATCH", path, {"sections": ["overview"]}, key=manager_secret)
                self.api("DELETE", path, key=manager_secret)
                self.api("GET", "/api/session", status=401, key=created["key"])
                self.api("POST", "/api/projects/other/members", {
                    "name": "Чужой проект", "email": "other@example.test", "role": "writer",
                    "sections": ["overview", "script"]}, 403, manager_secret)
                self.api("GET", "/api/projects/other/members", status=403, key=manager_secret)

    def test_all_nonmanager_roles_can_view_team_but_cannot_mutate_it(self):
        self.create()
        for role in ("writer", "cinematographer", "artist", "editor", "viewer"):
            with self.subTest(role=role):
                issued = self.issue(role, ["overview", "team"], email=role + "@example.test")
                secret = issued["key"]
                path = f"/api/projects/film/members/{issued['data']['id']}"
                self.api("GET", "/api/projects/film/members", key=secret)
                self.api("GET", path, key=secret)
                self.assertFalse(self.api("GET", "/api/projects/film", key=secret)["data"]
                                 ["capabilities"]["manageTeam"])
                self.api("POST", "/api/projects/film/members", {
                    "name": "Нельзя", "email": "no@example.test", "role": "writer",
                    "sections": ["overview", "script"]}, 403, secret)
                self.api("PATCH", path, {"role": "producer"}, 403, secret)
                self.api("DELETE", path, status=403, key=secret)

    def test_cinema_sections_are_accepted_and_issued_roles_apply_them(self):
        self.create()
        sections = ["overview", "script", "breakdown", "heroes", "locations", "world",
                    "storyboard", "shots", "continuity", "sound", "edit", "plan", "journal"]
        producer = self.issue("producer", sections, email="producer@example.test")
        self.assertEqual(set(producer["data"]["sections"]), set(sections))
        session = self.api("GET", "/api/session", key=producer["key"])["data"]
        self.assertEqual(set(session["sections"]), set(sections))
        for role, allowed in (
                ("writer", ["overview", "script", "breakdown", "journal"]),
                ("cinematographer", ["overview", "storyboard", "shots", "journal"]),
                ("artist", ["overview", "heroes", "locations", "world", "journal"]),
                ("editor", ["overview", "edit", "sound", "journal"]),
                ("viewer", ["overview", "script", "breakdown", "heroes", "locations", "world",
                            "storyboard", "shots", "continuity", "sound", "edit", "journal"])):
            with self.subTest(role=role):
                issued = self.issue(role, allowed, email=role + "@example.test")
                self.assertEqual(issued["data"]["role"], role)
                self.assertEqual(set(issued["data"]["sections"]), set(allowed))
                self.assertEqual(set(self.api("GET", "/api/session", key=issued["key"])["data"]
                                     ["sections"]), set(allowed))

    def test_invalid_member_fields_never_issue_a_key_or_change_project(self):
        self.create()
        payload = {"name": "Автор", "email": "writer@example.test", "role": "writer",
                   "sections": ["overview", "script"]}
        before = (self.data / "film" / "project.json").read_bytes()
        keys_before = self.keys.read_bytes()
        invalid = ({"email": "no-address"}, {"email": "a@b.test\nBcc:other@b.test"},
                   {"name": " "}, {"role": "unknown"}, {"role": "admin"}, {"sections": []},
                   {"sections": ["overview", "overview"]}, {"sections": ["unknown-section"]},
                   {"sections": "script"}, {"key": "client-selected-secret"},
                   {"keyHash": "forged"}, {"accessStatus": "active"}, {"revokedAt": "forged"})
        for changes in invalid:
            with self.subTest(changes=changes):
                result = self.api("POST", "/api/projects/film/members", dict(payload, **changes), 422)
                self.assertNotIn("key", result)
                self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)
                self.assertEqual(self.keys.read_bytes(), keys_before)
        issued = self.issue()
        before = (self.data / "film" / "project.json").read_bytes()
        path = f"/api/projects/film/members/{issued['data']['id']}"
        for changes in ({"key": "replacement"}, {"keyHash": "forged"},
                        {"keyId": "admin"}, {"revokedAt": ""}, {"accessStatus": "active"}):
            with self.subTest(patch=changes):
                self.api("PATCH", path, changes, 422)
                self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)
        self.api("GET", "/api/session", key=issued["key"])

    def test_manager_cannot_grant_sections_beyond_own_access_via_issued_or_external_keys(self):
        self.create()
        manager = self.issue("producer", ["overview", "script", "team"], email="producer@example.test")
        artist = self.issue("artist", ["overview", "storyboard"], email="artist@example.test")
        before = (self.data / "film" / "project.json").read_bytes()
        for body in ({"name": "Художник", "email": "new@example.test", "role": "artist",
                      "sections": ["overview", "storyboard"]},
                     {"name": "Внешний художник", "keyId": "artist", "role": "artist",
                      "sections": ["overview", "storyboard"]}):
            with self.subTest(body=body):
                self.api("POST", "/api/projects/film/members", body, 403, manager["key"])
                self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)
        path = f"/api/projects/film/members/{artist['data']['id']}"
        self.api("PATCH", path, {"sections": ["overview", "storyboard"]}, 403, manager["key"])
        self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)
        self.api("PATCH", path, {"sections": ["overview"]}, key=manager["key"])
        self.assertEqual(self.api("GET", "/api/session", key=artist["key"])["data"]["sections"],
                         ["overview"])

    def test_failed_issue_or_revoke_keeps_previous_access_and_revision(self):
        self.create()
        before = (self.data / "film" / "project.json").read_bytes()
        with patch.object(app.os, "replace", side_effect=OSError("Отказ записи")):
            result = self.api("POST", "/api/projects/film/members", {
                "name": "Не сохранён", "email": "no@example.test", "role": "writer",
                "sections": ["overview", "script"]}, 500)
        self.assertEqual(result["error"]["code"], "STORAGE_WRITE_FAILED")
        self.assertNotIn("key", result)
        self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)
        issued = self.issue()
        before = (self.data / "film" / "project.json").read_bytes()
        path = f"/api/projects/film/members/{issued['data']['id']}"
        with patch.object(app.os, "replace", side_effect=OSError("Отказ отзыва")):
            self.api("DELETE", path, status=500)
        self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)
        self.api("GET", "/api/session", key=issued["key"])
        self.api("GET", "/api/projects/film/script", key=issued["key"])

    def test_issued_member_can_work_as_cell_assignee_and_revoked_member_cannot_be_assigned(self):
        self.create()
        self.api("POST", "/api/projects/film/scenes", {"id": "one", "title": "Сцена"}, 201)
        issued = self.issue()
        member, secret = issued["data"], issued["key"]
        cell = self.api("POST", "/api/projects/film/cells", {
            "object": {"type": "scene", "id": "one"}, "stage": "script",
            "assignee": {"keyId": member["keyId"]}, "version": "draft-1"}, 201)["data"]
        self.assertEqual(cell["assignee"], {"keyId": member["keyId"], "name": member["name"]})
        changed = self.api("PATCH", f"/api/projects/film/cells/{cell['id']}", {
            "status": "working", "comment": "Правлю сцену"}, key=secret)["data"]
        self.assertEqual(changed["status"], "working")
        self.assertEqual(self.api("GET", "/api/projects/film/map", key=secret)["data"]
                         ["myTasks"][0]["id"], cell["id"])
        self.api("DELETE", f"/api/projects/film/members/{member['id']}")
        before = (self.data / "film" / "project.json").read_bytes()
        self.api("PATCH", f"/api/projects/film/cells/{cell['id']}", {
            "assignee": {"keyId": member["keyId"]}}, 422)
        self.api("PATCH", f"/api/projects/film/cells/{cell['id']}", {
            "comment": "Отозванный исполнитель"}, 401, secret)
        self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)

    def test_issued_cinema_stage_scopes_enforce_writer_breakdown_and_editor_sound_read_only(self):
        self.create()
        self.api("POST", "/api/projects/film/scenes", {"id": "one", "title": "Сцена"}, 201)
        writer = self.issue("writer", ["overview", "script", "breakdown"], email="writer@example.test")
        editor = self.issue("editor", ["overview", "sound", "edit"], email="editor@example.test")
        artist = self.issue("artist", ["overview", "heroes"], email="artist@example.test")
        # У художника нет legacy storyboard: работа разрешается именно разделом heroes.
        heroes = self.api("POST", "/api/projects/film/cells", {
            "object": {"type": "scene", "id": "one"}, "stage": "heroes",
            "assignee": {"keyId": artist["data"]["keyId"]}}, 201)["data"]
        self.api("PATCH", f"/api/projects/film/cells/{heroes['id']}", {
            "status": "working"}, key=artist["key"])
        # Монтажёр назначается по edit без legacy post; правка комментария не запускает зависимости.
        edit = self.api("POST", "/api/projects/film/cells", {
            "object": {"type": "scene", "id": "one"}, "stage": "edit",
            "assignee": {"keyId": editor["data"]["keyId"]}}, 201)["data"]
        self.api("PATCH", f"/api/projects/film/cells/{edit['id']}", {
            "comment": "Готовлю монтаж"}, key=editor["key"])
        for stage, issued in (("breakdown", writer), ("sound", editor)):
            with self.subTest(stage=stage):
                before = (self.data / "film" / "project.json").read_bytes()
                self.api("POST", "/api/projects/film/cells", {
                    "object": {"type": "scene", "id": "one"}, "stage": stage,
                    "assignee": {"keyId": issued["data"]["keyId"]}}, 422)
                self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)
                cell = self.api("POST", "/api/projects/film/cells", {
                    "object": {"type": "scene", "id": "one"}, "stage": stage}, 201)["data"]
                self.api("GET", f"/api/projects/film/cells/{cell['id']}", key=issued["key"])
                before = (self.data / "film" / "project.json").read_bytes()
                self.api("PATCH", f"/api/projects/film/cells/{cell['id']}", {
                    "comment": "Нет права записи"}, 403, issued["key"])
                self.assertEqual((self.data / "film" / "project.json").read_bytes(), before)


class BreakdownApiTests(unittest.TestCase):
    """Контракт разбивки проверяется через HTTP Handler и настоящие файлы проекта."""

    setUp = ApiTests.setUp
    start_server = ApiTests.start_server
    stop_server = ApiTests.stop_server
    request = ApiTests.request
    read_response = staticmethod(ApiTests.read_response)
    api = ApiTests.api
    create = ApiTests.create
    member = ApiTests.member
    issue = TeamAccessTests.issue

    @staticmethod
    def parsed_breakdown():
        return parse_breakdown(
            "Title: Проверочная разбивка\n\n= Первый акт\n\n"
            "ИНТ. ЮРТА — ДЕНЬ\n\nӘЛИЯ (25) подходит к двери.\n\n"
            "ӘЛИЯ\nЯ вернулась.\n\nНАТ. АУЛ — НОЧЬ\n\n"
            "ЕР ТӨСТІК\nМен сені күтемін.\n\nӘЛИЯ\nИдём.\n")

    def project_bytes(self):
        return (self.data / "film" / "project.json").read_bytes()

    def import_breakdown(self, payload=None, key="temporary-admin", status=200, headers=None):
        return self.api("POST", "/api/projects/film/breakdown",
                        self.parsed_breakdown() if payload is None else payload,
                        status, key, headers)

    def test_direct_parser_output_imports_all_entities_fields_and_activity(self):
        self.create()
        document = self.parsed_breakdown()
        self.assertEqual([s["n"] for s in document["scenes"]], [1, 2])
        self.assertEqual([c["name"] for c in document["characters"]], ["ӘЛИЯ", "ЕР ТӨСТІК"])
        result = self.import_breakdown(document)["data"]
        defaults = {"role": "", "identity": "", "taboo": [], "height": "", "refs": [],
                    "status": "draft", "translations": {}}
        entity_ids = set()
        stored = json.loads(self.project_bytes())
        for collection in ("scenes", "characters", "locations"):
            with self.subTest(collection=collection):
                self.assertEqual(result["summary"][collection],
                                 {"created": 2, "updated": 0, "unchanged": 0})
                rows = self.api("GET", f"/api/projects/film/{collection}")["data"]
                self.assertEqual(len(rows), 2)
                self.assertEqual({r["id"] for r in result[collection]}, {r["id"] for r in rows})
                for source, row in zip(document[collection], rows):
                    self.assertRegex(row["id"], r"^[0-9A-HJKMNP-TV-Z]{26}$")
                    self.assertNotIn(row["id"], entity_ids)
                    entity_ids.add(row["id"])
                    self.assertEqual(row["studio_id"], stored["studio_id"])
                    self.assertTrue(row["createdAt"])
                    self.assertEqual(row["updatedAt"], row["createdAt"])
                    for field, value in source.items():
                        self.assertEqual(row["title" if field == "heading" else field], value)
                    if collection == "scenes":
                        self.assertEqual(row["text"], "")
                    else:
                        self.assertEqual({k: row[k] for k in defaults}, defaults)
        events = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        imported = [e for e in events if e["action"] == "breakdown.imported"]
        self.assertEqual(len(imported), 1)
        self.assertEqual(imported[0]["object"], {"type": "breakdown", "id": "film"})
        created = [e for e in events if e["action"] in
                   ("scene.created", "character.created", "location.created")]
        self.assertEqual({e["object"]["id"] for e in created}, entity_ids)
        self.assertEqual(len(created), 6)
        self.assertTrue(all(e["keyId"] == "admin" and e["contentHash"] for e in created))
        for event in events:
            self.assertRegex(event["id"], r"^[0-9A-HJKMNP-TV-Z]{26}$")
            self.assertEqual(event["studio_id"], stored["studio_id"])
        self.assertEqual([e["sequence"] for e in events], list(range(1, len(events) + 1)))
        self.assertEqual([e["previousHash"] for e in events[1:]], [e["hash"] for e in events[:-1]])
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"]["text"], "")

    def test_import_is_idempotent_by_normalized_name_and_preserves_passports_and_author_text(self):
        self.create()
        self.api("PUT", "/api/projects/film/script", {
            "text": "Авторский сценарий <Әлия> & Ер Төстік", "language": "kk",
            "translations": {"ru": "Авторский перевод"}})
        scene = self.api("POST", "/api/projects/film/scenes", {
            "id": "manual", "title": "  инт. юрта — день  ", "text": "Авторская сцена",
            "translations": {"kk": {"text": "Автор аудармасы"}}}, 201)["data"]
        passport = {"role": "Главная героиня", "identity": "Замок внешности Ә Ғ Қ Ң Ө Ұ Ү Һ І",
                    "taboo": ["Не менять внешность"], "height": "Выше партнёра",
                    "refs": [{"path": "assets/aliya.png", "role": "identity"}], "status": "locked",
                    "scenes": [1], "translations": {"kk": {"name": "Әлия", "identity": "Келбет"}}}
        character = self.api("POST", "/api/projects/film/characters",
                             dict(passport, name="  әлия  "), 201)["data"]
        location = self.api("POST", "/api/projects/film/locations",
                            dict(passport, name="ЮРТА", refs=[{"path": "assets/yurt.png",
                                                               "role": "environment"}]), 201)["data"]
        author_script = self.api("GET", "/api/projects/film/script")["data"]
        first = self.import_breakdown()["data"]
        self.assertEqual(first["scenes"][0]["id"], scene["id"])
        self.assertEqual(first["characters"][0]["id"], character["id"])
        self.assertEqual(first["locations"][0]["id"], location["id"])
        snapshots = {c: self.api("GET", f"/api/projects/film/{c}")["data"]
                     for c in ("scenes", "characters", "locations")}
        for collection, original in (("characters", character), ("locations", location)):
            current = next(r for r in snapshots[collection] if r["id"] == original["id"])
            for field in ("name", "role", "identity", "taboo", "height", "refs", "status", "translations"):
                self.assertEqual(current[field], original[field])
        manual = next(s for s in snapshots["scenes"] if s["id"] == "manual")
        self.assertEqual(manual["text"], scene["text"])
        self.assertEqual(manual["translations"], scene["translations"])
        self.assertEqual(snapshots["characters"][0]["scenes"], [1, 2])
        second_document = self.parsed_breakdown()
        second_document["characters"][0]["name"] = " ӘЛИЯ "
        second_document["characters"][1]["name"] = "  ер   төстік  "
        second_document["locations"][0]["name"] = " юрта "
        second_document["locations"][1]["name"] = " аул "
        before_events = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        second = self.import_breakdown(second_document)["data"]
        for collection in snapshots:
            self.assertEqual(second["summary"][collection],
                             {"created": 0, "updated": 0, "unchanged": 2})
            self.assertEqual(second[collection], first[collection])
            self.assertEqual(self.api("GET", f"/api/projects/film/{collection}")["data"], snapshots[collection])
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"], author_script)
        after_events = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        self.assertEqual(after_events[:-1], before_events)
        self.assertEqual(after_events[-1]["action"], "breakdown.imported")
        # Изменённые вычисленные сведения обновляются в тех же сущностях.
        second_document["characters"][0]["lines"] += 1
        second_document["locations"][0]["times"] = ["ДЕНЬ", "ВЕЧЕР"]
        changed = self.import_breakdown(second_document)["data"]
        self.assertEqual(changed["characters"][0]["id"], character["id"])
        self.assertEqual(changed["summary"]["characters"]["updated"], 1)
        self.assertEqual(changed["summary"]["locations"]["updated"], 1)
        self.assertEqual(self.api("GET", f"/api/projects/film/characters/{character['id']}")["data"]
                         ["identity"], passport["identity"])
        self.assertEqual(self.api("GET", "/api/projects/film/script")["data"], author_script)

    def test_unicode_name_normalization_reuses_passports_and_rejects_duplicate_names(self):
        self.create()
        document = self.parsed_breakdown()
        document["characters"][0]["name"] = "ЙОЛ"
        document["locations"][0]["name"] = "ЙЕЛ"
        first = self.import_breakdown(document)["data"]
        document["characters"][0]["name"] = " и\u0306ол "
        document["locations"][0]["name"] = " и\u0306ел "
        second = self.import_breakdown(document)["data"]
        self.assertEqual(first["characters"], second["characters"])
        self.assertEqual(first["locations"], second["locations"])
        before = self.project_bytes()
        for collection, name in (("characters", " и\u0306ол "), ("locations", " и\u0306ел ")):
            with self.subTest(collection=collection):
                result = self.api("POST", f"/api/projects/film/{collection}", {"name": name}, 409)
                self.assertEqual(result["error"]["code"], "ALREADY_EXISTS")
                self.assertEqual(self.project_bytes(), before)

    def test_scene_numbers_keep_repeated_headings_distinct_and_reimports_keep_manual_work(self):
        self.create()
        document = self.parsed_breakdown()
        document["scenes"][1]["heading"] = document["scenes"][0]["heading"]
        first = self.import_breakdown(document)["data"]
        self.assertNotEqual(first["scenes"][0]["id"], first["scenes"][1]["id"])
        for row in first["scenes"]:
            self.api("PATCH", f"/api/projects/film/scenes/{row['id']}",
                     {"text": "Работа автора сцены " + str(row["n"])})
        document["scenes"] = list(reversed(document["scenes"]))
        document["scenes"][0]["heading"] = "НАТ. АУЛ — РАССВЕТ"
        second = self.import_breakdown(document)["data"]
        self.assertEqual({r["n"]: r["id"] for r in first["scenes"]},
                         {r["n"]: r["id"] for r in second["scenes"]})
        scenes = self.api("GET", "/api/projects/film/scenes")["data"]
        self.assertEqual(len(scenes), 2)
        self.assertEqual({s["n"]: s["text"] for s in scenes},
                         {1: "Работа автора сцены 1", 2: "Работа автора сцены 2"})
        self.assertEqual(next(s for s in scenes if s["n"] == 2)["title"], "НАТ. АУЛ — РАССВЕТ")

    def test_changed_import_invalidates_only_affected_scene_and_shot_cells_and_keeps_media(self):
        self.create()
        imported = self.import_breakdown()["data"]
        cells, shots = {}, {}
        for row in imported["scenes"]:
            n, scene_id = row["n"], row["id"]
            shot = self.api("POST", "/api/projects/film/shots", {
                "id": "shot-" + str(n), "sceneId": scene_id, "title": "Кадр " + str(n),
                "imageUrl": "https://example.test/frame-" + str(n) + ".png",
                "videoUrl": "https://example.test/video-" + str(n) + ".mp4"}, 201)["data"]
            shots[n] = shot
            for kind, object_id, stage in (("scene", scene_id, "heroes"),
                                            ("shot", shot["id"], "storyboard")):
                cells[n, kind] = self.api("POST", "/api/projects/film/cells", {
                    "object": {"type": kind, "id": object_id}, "stage": stage,
                    "version": "v1", "status": "awaiting"}, 201)["data"]
        # Апрув также теряет актуальность; сама append-only история апрува сохраняется.
        scene_cell = cells[1, "scene"]
        self.api("POST", "/api/projects/film/approvals", {
            "object": scene_cell["object"], "stage": scene_cell["stage"],
            "version": "v1", "verdict": "approved"}, 201)
        before_cells = self.api("GET", "/api/projects/film/cells")["data"]
        approvals = self.api("GET", "/api/projects/film/approvals")["data"]
        self.import_breakdown()
        self.assertEqual(self.api("GET", "/api/projects/film/cells")["data"], before_cells)
        for n, shot in shots.items():
            self.assertEqual(self.api("GET", f"/api/projects/film/shots/{shot['id']}")["data"], shot)
        document = self.parsed_breakdown()
        document["scenes"][0]["act"] = "Изменённый акт"
        self.import_breakdown(document)
        expected_invalidated = {cells[1, kind]["id"] for kind in ("scene", "shot")}
        after_cells = self.api("GET", "/api/projects/film/cells")["data"]
        for current in after_cells:
            if current["id"] in expected_invalidated:
                self.assertEqual(current["status"], "done")
            else:
                self.assertEqual(current, next(c for c in before_cells if c["id"] == current["id"]))
        affected = self.api("GET", "/api/projects/film/shots/shot-1")["data"]
        self.assertTrue(affected["needsReview"])
        self.assertEqual({k: v for k, v in affected.items() if k != "needsReview"},
                         {k: v for k, v in shots[1].items() if k != "needsReview"})
        self.assertEqual(self.api("GET", "/api/projects/film/shots/shot-2")["data"], shots[2])
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], approvals)
        event = self.api("GET", "/api/projects/film/activity?limit=100")["data"][-1]
        self.assertEqual(event["action"], "breakdown.imported")
        self.assertEqual(set(event["invalidatedCellIds"]), expected_invalidated)
        self.stop_server()
        self.start_server()
        self.assertEqual(self.api("GET", "/api/projects/film/cells")["data"], after_cells)
        self.assertEqual(self.api("GET", "/api/projects/film/approvals")["data"], approvals)
        self.assertEqual(self.api("GET", "/api/projects/film/shots/shot-1")["data"], affected)

    def test_passport_crud_defaults_translations_pagination_conflicts_and_activity(self):
        self.create()
        for collection, kind in (("characters", "character"), ("locations", "location")):
            with self.subTest(collection=collection):
                base = f"/api/projects/film/{collection}"
                first = self.api("POST", base, {"name": "Әлия"}, 201)["data"]
                self.assertEqual({k: first[k] for k in
                                  ("role", "identity", "height", "status", "taboo", "refs", "scenes", "translations")},
                                 {"role": "", "identity": "", "height": "", "status": "draft",
                                  "taboo": [], "refs": [], "scenes": [], "translations": {}})
                second = self.api("POST", base, {"name": "Ер Төстік"}, 201)["data"]
                body = {"role": "Героиня", "identity": "Келбет Ә Ғ Қ Ң Ө Ұ Ү Һ І", "height": "Выше героя",
                        "taboo": ["Сохранить лицо"], "refs": [
                            {"path": "assets/aliya.png", "role": "identity"},
                            {"path": "https://example.test/costume.png", "role": "costume"},
                            {"path": "assets/yurt.png", "role": "environment"},
                            {"path": "assets/frame.png", "role": "composition"}],
                        "status": "locked", "scenes": [1, 2], "translations": {
                            "ru": {"name": "Алия", "role": "Главная", "taboo": ["Сохранить лицо"]},
                            "kk": {"name": "Әлия", "identity": "Келбет", "height": "Бойы"}}}
                updated = self.api("PATCH", base + "/" + first["id"], body)["data"]
                self.assertEqual({k: updated[k] for k in body}, body)
                self.assertEqual(updated["createdAt"], first["createdAt"])
                self.assertEqual(self.api("GET", base + "/" + first["id"])["data"], updated)
                listed = self.api("GET", base + "?offset=1&limit=1")
                self.assertEqual(listed["pagination"]["total"], 2)
                self.assertEqual(listed["data"], [second])
                before = self.project_bytes()
                self.api("PATCH", base + "/" + second["id"], {"name": " ӘЛИЯ "}, 409)
                self.assertEqual(self.project_bytes(), before)
                deleted = self.api("DELETE", base + "/" + first["id"])["data"]
                self.assertEqual(deleted["id"], first["id"])
                self.api("GET", base + "/" + first["id"], status=404)
                self.api("DELETE", base + "/missing", status=404)
                self.api("PUT", base + "/" + second["id"], {"name": "Другое"}, 405)
                events = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
                own = [e for e in events if e["object"] == {"type": kind, "id": first["id"]}]
                self.assertEqual([e["action"] for e in own],
                                 [kind + ".created", kind + ".updated", kind + ".deleted"])
                self.assertTrue(all(e["keyId"] == "admin" and e["contentHash"] for e in own))
        stored = {c: self.api("GET", f"/api/projects/film/{c}")["data"] for c in ("characters", "locations")}
        self.stop_server()
        self.start_server()
        self.assertEqual({c: self.api("GET", f"/api/projects/film/{c}")["data"] for c in stored}, stored)

    def test_import_and_passport_permissions_apply_role_membership_and_section_scopes(self):
        self.create()
        configured = json.loads(self.keys.read_text(encoding="utf-8"))
        configured["keys"].extend([
            {"id": "assistant", "key": "temporary-assistant", "role": "assistant_director",
             "projects": ["film"], "sections": ["overview", "breakdown"]},
            {"id": "outside", "key": "temporary-outside", "role": "producer",
             "projects": ["elsewhere"], "sections": ["*"]},
        ])
        self.keys.write_text(json.dumps(configured), encoding="utf-8")
        before = self.project_bytes()
        self.import_breakdown(key="temporary-assistant", status=403)
        self.import_breakdown(key="temporary-outside", status=403)
        self.assertEqual(self.project_bytes(), before)
        assistant = self.api("POST", "/api/projects/film/members", {
            "name": "Второй режиссёр", "role": "assistant_director", "keyId": "assistant",
            "sections": ["overview", "breakdown"]}, 201)["data"]
        self.import_breakdown(key="temporary-assistant")
        assistant_events = self.api("GET", "/api/projects/film/activity?limit=100")["data"]
        self.assertEqual(assistant_events[-1]["keyId"], "assistant")
        self.assertEqual(assistant_events[-1]["name"], assistant["name"])
        self.api("POST", "/api/projects/film/characters", {"name": "Нельзя"}, 403, "temporary-assistant")
        self.api("PATCH", f"/api/projects/film/members/{assistant['id']}", {"sections": ["overview"]})
        self.import_breakdown(key="temporary-assistant", status=403)
        writer = self.issue("writer", ["overview", "script", "breakdown"])["key"]
        artist = self.issue("artist", ["overview", "heroes", "locations"], email="artist@example.test")["key"]
        viewer = self.issue("viewer", ["overview", "breakdown", "heroes", "locations"],
                            email="viewer@example.test")["key"]
        for key in (writer, artist, viewer):
            with self.subTest(key_role=key[:10]):
                self.api("GET", "/api/projects/film/characters", key=key)
                self.api("GET", "/api/projects/film/locations", key=key)
                before = self.project_bytes()
                self.import_breakdown(key=key, status=403)
                self.assertEqual(self.project_bytes(), before)
        for key in (writer, viewer):
            for collection in ("characters", "locations"):
                with self.subTest(role_key=key[:10], collection=collection):
                    before = self.project_bytes()
                    self.api("POST", f"/api/projects/film/{collection}", {"name": "Нельзя"}, 403, key)
                    self.assertEqual(self.project_bytes(), before)
        for collection in ("characters", "locations"):
            passport = self.api("POST", f"/api/projects/film/{collection}",
                                {"name": "Художник заполняет"}, 201, artist)["data"]
            self.api("PATCH", f"/api/projects/film/{collection}/{passport['id']}",
                     {"identity": "Замок"}, key=artist)
            self.api("DELETE", f"/api/projects/film/{collection}/{passport['id']}", key=artist)
        for role in ("producer", "director"):
            issued = self.issue(role, ["overview", "breakdown"], email=role + "@example.test")
            self.import_breakdown(key=issued["key"])

    def test_passport_reads_require_overview_and_each_write_requires_its_own_section(self):
        self.create()
        overview = self.issue("viewer", ["overview"], email="overview@example.test")["key"]
        heroes = self.issue("artist", ["heroes"], email="heroes@example.test")["key"]
        locations = self.issue("artist", ["locations"], email="locations@example.test")["key"]
        for collection, own_key, other_key in (("characters", heroes, locations),
                                               ("locations", locations, heroes)):
            with self.subTest(collection=collection):
                base = "/api/projects/film/" + collection
                item = self.api("POST", base, {"name": "Паспорт"}, 201, own_key)["data"]
                path = base + "/" + item["id"]
                self.api("GET", base, key=overview)
                self.api("GET", path, key=overview)
                self.api("GET", base, status=403, key=own_key)
                self.api("GET", path, status=403, key=own_key)
                for key in (overview, other_key):
                    before = self.project_bytes()
                    self.api("POST", base, {"name": "Запрещено"}, 403, key)
                    self.api("PATCH", path, {"identity": "Запрещено"}, 403, key)
                    self.api("DELETE", path, status=403, key=key)
                    self.assertEqual(self.project_bytes(), before)
                self.api("PATCH", path, {"identity": "Свой раздел"}, key=own_key)
                self.api("DELETE", path, key=own_key)

    def test_invalid_breakdown_returns_422_without_any_persisted_changes(self):
        self.create()
        self.import_breakdown()
        before = self.project_bytes()
        valid = self.parsed_breakdown()
        invalid = []
        for field, value in (("scenes", {}), ("characters", None), ("locations", "list"),
                             ("title", "title"), ("pages_est", True),
                             ("caps_mentions", [{"word": "ВЕЩЬ", "scenes": [9]}]),
                             ("unexpected", True)):
            invalid.append(dict(valid, **{field: value}))
        missing = copy.deepcopy(valid)
        del missing["locations"]
        invalid.append(missing)
        invalid.append(dict(valid, scenes=valid["scenes"] + [valid["scenes"][0]]))
        for field, value in (("n", True), ("heading", " "), ("location", ""), ("act", []),
                             ("page_from", 0), ("page_to", 0), ("line_to", 1),
                             ("chars", ["ӘЛИЯ", " әлия "]), ("intros", [{"name": "ГЕРОЙ", "age": 200}]),
                             ("id", "forged")):
            document = copy.deepcopy(valid)
            document["scenes"][1][field] = value
            invalid.append(document)
        missing = copy.deepcopy(valid)
        del missing["scenes"][0]["page_to"]
        invalid.append(missing)
        for collection, fields_to_reject in (
                ("characters", (("name", " "), ("age", True), ("age", 151), ("lines", -1),
                                ("scenes", [1, 1]), ("scenes", [9]), ("first_scene", 9),
                                ("identity", "Импорт не принимает авторский паспорт"))),
                ("locations", (("parent", ""), ("types", ["ИНТ", "инт"]), ("times", [False]),
                               ("scenes", [9]), ("name", [])))):
            for field, value in fields_to_reject:
                document = copy.deepcopy(valid)
                document[collection][-1][field] = value
                invalid.append(document)
            duplicate = copy.deepcopy(valid)
            duplicate[collection].append(dict(duplicate[collection][0],
                                               name=" " + duplicate[collection][0]["name"].lower() + " "))
            invalid.append(duplicate)
        for index, document in enumerate(invalid):
            with self.subTest(case=index):
                result = self.import_breakdown(document, status=422)
                self.assertEqual(result["error"]["code"], "VALIDATION_ERROR")
                self.assertEqual(self.project_bytes(), before)
                self.assertEqual(list(self.data.rglob("*.tmp")), [])

    def test_invalid_passports_return_422_and_never_change_entities_revision_or_activity(self):
        self.create()
        invalid = ({"name": " "}, {"name": False}, {"role": []}, {"identity": "x" * 2001},
                   {"height": 170}, {"status": "approved"}, {"status": []}, {"taboo": "нет"},
                   {"taboo": [" "]}, {"taboo": ["x"] * 11}, {"scenes": [True]},
                   {"scenes": [1, 1]}, {"refs": [{"path": "../secret", "role": "identity"}]},
                   {"refs": [{"path": "javascript:alert(1)", "role": "identity"}]},
                   {"refs": [{"path": "file:///tmp/secret", "role": "identity"}]},
                   {"refs": [{"path": "/Users/local/ref.png", "role": "identity"}]},
                   {"refs": [{"path": "//example.test/image", "role": "identity"}]},
                   {"refs": [{"path": "assets\\image.png", "role": "identity"}]},
                   {"refs": [{"path": "assets/image.png", "role": "invalid"}]},
                   {"refs": [{"path": "assets/image.png"}]},
                   {"translations": {"en": {"name": "English"}}},
                   {"translations": {"kk": {"identity": []}}},
                   {"translations": {"ru": {"unknown": "value"}}},
                   {"id": "forged"}, {"studio_id": "forged"}, {"age": 25})
        for collection in ("characters", "locations"):
            base = "/api/projects/film/" + collection
            item = self.api("POST", base, {"name": "Существующий паспорт", "identity": "Не терять"}, 201)["data"]
            before = self.project_bytes()
            self.api("POST", base, {}, 422)
            for changes in invalid:
                with self.subTest(collection=collection, changes=changes):
                    for method, path, body in (("POST", base, dict({"name": "Новый"}, **changes)),
                                               ("PATCH", base + "/" + item["id"], changes)):
                        result = self.api(method, path, body, 422)
                        self.assertEqual(result["error"]["code"], "VALIDATION_ERROR")
                        self.assertEqual(self.project_bytes(), before)

    def test_stale_if_match_rejects_import_and_passport_changes_without_side_effects(self):
        self.create()
        _, _, _, headers = self.request("GET", "/api/projects/film", include_headers=True)
        stale = headers["ETag"]
        item = self.api("POST", "/api/projects/film/characters", {"name": "Әлия"}, 201,
                        headers={"If-Match": stale})["data"]
        before = self.project_bytes()
        operations = (("POST", "/api/projects/film/breakdown", self.parsed_breakdown()),
                      ("POST", "/api/projects/film/locations", {"name": "ЮРТА"}),
                      ("PATCH", f"/api/projects/film/characters/{item['id']}", {"identity": "Устарело"}),
                      ("DELETE", f"/api/projects/film/characters/{item['id']}", None))
        for method, path, payload in operations:
            with self.subTest(method=method, path=path):
                result = self.api(method, path, payload, 409, headers={"If-Match": stale})
                self.assertEqual(result["error"]["code"], "REVISION_CONFLICT")
                self.assertEqual(self.project_bytes(), before)
        _, _, _, headers = self.request("GET", "/api/projects/film/characters", include_headers=True)
        self.import_breakdown(headers={"If-Match": headers["ETag"]})
        before = self.project_bytes()
        self.import_breakdown(status=400, headers={"If-Match": "1"})
        self.assertEqual(self.project_bytes(), before)

    def test_failed_writes_leave_no_partial_import_passport_or_activity(self):
        self.create()
        item = self.api("POST", "/api/projects/film/characters",
                        {"name": "Әлия", "identity": "Сохранённый паспорт"}, 201)["data"]
        before = self.project_bytes()
        operations = (("POST", "/api/projects/film/breakdown", self.parsed_breakdown()),
                      ("POST", "/api/projects/film/locations", {"name": "ЮРТА"}),
                      ("PATCH", f"/api/projects/film/characters/{item['id']}", {"identity": "Не записалось"}),
                      ("DELETE", f"/api/projects/film/characters/{item['id']}", None))
        for boundary in ("fsync", "replace"):
            for method, path, payload in operations:
                with self.subTest(boundary=boundary, method=method, path=path):
                    with patch.object(app.os, boundary, side_effect=OSError("Отказ диска")):
                        result = self.api(method, path, payload, 500)
                    self.assertEqual(result["error"]["code"], "STORAGE_WRITE_FAILED")
                    self.assertEqual(self.project_bytes(), before)
                    self.assertEqual(list(self.data.rglob("*.tmp")), [])
        self.assertEqual(self.api("GET", "/api/projects/film/scenes")["data"], [])
        self.assertEqual(self.api("GET", "/api/projects/film/locations")["data"], [])
        self.import_breakdown()
        self.assertEqual(len(self.api("GET", "/api/projects/film/scenes")["data"]), 2)

    def test_legacy_projects_read_empty_collections_without_rewrite_and_import_migrates_them(self):
        self.create()
        path = self.data / "film" / "project.json"
        project = json.loads(path.read_text(encoding="utf-8"))
        for field in ("characters", "locations", "studio_id"):
            project.pop(field, None)
        # Старые записи журнала без studio_id и с прежним ID остаются достоверными.
        project["activity"][0].pop("studio_id", None)
        project["activity"][0]["id"] = "legacy-event-id"
        project["activity"][0]["hash"] = app.content_hash({
            k: v for k, v in project["activity"][0].items() if k != "hash"})
        legacy_event = copy.deepcopy(project["activity"][0])
        path.write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")
        before = self.project_bytes()
        for collection in ("characters", "locations"):
            self.assertEqual(self.api("GET", "/api/projects/film/" + collection)["data"], [])
        self.assertEqual(self.project_bytes(), before)
        self.assertEqual(self.api("GET", "/api/projects/film/activity")["data"], [legacy_event])
        self.import_breakdown()
        migrated = json.loads(self.project_bytes())
        self.assertTrue(migrated["studio_id"])
        for collection in ("scenes", "characters", "locations"):
            self.assertEqual(len(migrated[collection]), 2)
            self.assertTrue(all(row["studio_id"] == migrated["studio_id"] for row in migrated[collection]))
        self.assertEqual(migrated["activity"][0], legacy_event)
        self.assertEqual(migrated["activity"][1]["previousHash"], legacy_event["hash"])
        self.assertTrue(all(e["studio_id"] == migrated["studio_id"] for e in migrated["activity"][1:]))


class AtomicWriteTests(unittest.TestCase):
    def test_atomic_write_failure_cleans_same_directory_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.json"
            path.write_bytes(b'{"old":true}')
            observed = []

            def reject_replace(source, destination):
                source = Path(source)
                self.assertEqual(source.parent, path.parent)
                self.assertEqual(Path(destination), path)
                observed.append(json.loads(source.read_text(encoding="utf-8")))
                raise OSError("имитация отказа записи")

            with patch.object(app.os, "replace", side_effect=reject_replace):
                with self.assertRaises(app.ApiError) as caught:
                    app.atomic_write(path, {"new": "Новые данные"})
            self.assertEqual(caught.exception.status, 500)
            self.assertEqual(caught.exception.code, "STORAGE_WRITE_FAILED")
            self.assertEqual(observed, [{"new": "Новые данные"}])
            self.assertEqual(path.read_bytes(), b'{"old":true}')
            self.assertEqual([p.name for p in path.parent.iterdir()], ["project.json"])


if __name__ == "__main__":
    unittest.main()
