"""Проверки JSON API на HTTP-сервере и временных файлах.

Запуск из корня репозитория: python3 -m unittest server.test_api -v
Явный режим без сетевого bind: NEYRA_TEST_TRANSPORT=inprocess python3 -m unittest server.test_api -v
Он передаёт HTTP-байты настоящему Handler и разбирает его HTTP-ответы,
но не проверяет TCP-транспорт. По умолчанию всегда используется TCP,
автоматической подмены транспорта и пропуска сетевых ошибок нет.
Ключи ниже — вымышленные значения из изолированной временной папки.
"""

import concurrent.futures
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
        self.api("GET", "/api/projects/film/members", status=403, key="temporary-viewer")
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
