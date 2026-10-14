"""Контракт №69: чистые функции, пробный режим и подставной BytePlus API.

Все HTTP-вызовы заблокированы в setUp; ключи пользователя не читаются.
Запуск: cd server && python3 -B -m unittest blocks.video.test_video -v
"""

import io
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from blocks import video


PNG = ("data:image/png;base64,"
       "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
IMAGE = "https://example.invalid/hero.png"
VIDEO = "https://example.invalid/take.mp4"


class Response(io.BytesIO):
    def __init__(self, body, content_type="application/json"):
        super().__init__(body)
        self.headers = {"Content-Type": content_type} if content_type else {}


def response(data):
    return Response(json.dumps(data).encode("utf-8"))


class VideoTest(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"NEYRA_ASSISTANT_FAKE": "0", "ARK_API_KEY": ""})
        environment.start()
        self.addCleanup(environment.stop)
        network = patch("urllib.request.urlopen", side_effect=AssertionError("Сеть запрещена в тестах"))
        self.urlopen = network.start()
        self.addCleanup(network.stop)
        opener = patch("urllib.request.build_opener")
        opener.start().return_value.open = self.urlopen
        self.addCleanup(opener.stop)
        self.real_api_key = video.api_key
        key = patch.object(video, "api_key", return_value="test-key-not-real")
        self.key = key.start()
        self.addCleanup(key.stop)

    def reply(self, data):
        self.urlopen.side_effect = None
        self.urlopen.return_value = response(data)

    def assert_error(self, status, code, function, *args, **kwargs):
        with self.assertRaises(video.VideoError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.status, status)
        self.assertEqual(caught.exception.code, code)
        self.assertTrue(caught.exception.message)
        return caught.exception

    def test_error_has_http_contract(self):
        error = video.VideoError(502, "VIDEO_UPSTREAM", "Ошибка модели")
        self.assertEqual((error.status, error.code, error.message), (502, "VIDEO_UPSTREAM", "Ошибка модели"))
        self.assertEqual(str(error), "Ошибка модели")

    def test_prompt_explains_each_reference_before_action(self):
        text = video.prompt(
            {"action": "@Image1 входит в @Image2 и поднимает руку.", "size": "Общий план", "angle": "На уровне глаз", "movement": "dolly in"},
            {"title": "Встреча", "location": "Юрта", "time": "День", "ton": "Тревога", "vizual": "Мягкий свет"},
            [{"role": "character", "name": "Ер Төстік"}, {"role": "location", "name": "Юрта"}],
        )
        for number, name in ((1, "Ер Төстік"), (2, "Юрта")):
            self.assertRegex(text, rf"@Image{number}\s*—\s*это[^\n]*{name}")
            self.assertLess(text.index(f"@Image{number} — это"), text.index("входит"))
        for value in ("Общий план", "На уровне глаз", "dolly in", "День", "Тревога", "Мягкий свет", "16:9"):
            self.assertIn(value, text)
        self.assertIn("no music, only synchronized sound effects and dialogue", text)
        handles = set(re.findall(r"@Image\d+", text))
        self.assertEqual(handles, {"@Image1", "@Image2"})

    def test_prompt_accepts_ordered_role_descriptions(self):
        text = video.prompt({"action": "Герой поворачивается."}, {}, ["герой Ер Төстік", "локация Юрта", "первый кадр"])
        for number, description in enumerate(("герой Ер Төстік", "локация Юрта", "первый кадр"), 1):
            self.assertIn(f"@Image{number} — это {description}", text)

    def test_prompt_static_camera_is_text_for_i2v(self):
        for movement in ("static", "locked-off", "Статичный кадр", "Статика", "Қозғалыссыз", "static camera", "fixed camera", "stationary camera"):
            with self.subTest(movement=movement):
                text = video.prompt({"action": "Герой моргает.", "camera": {"size": "Крупный план", "angle": "eye level", "movement": movement}}, {}, [])
                self.assertIn("locked-off camera, do not change the camera position or the framing", text)
                self.assertIn("Крупный план", text)
                self.assertIn("eye level", text)

    def test_prompt_preserves_moving_camera_when_subject_or_focus_is_static(self):
        for movement in ("fixed focus, slow dolly forward", "static subject, tracking camera", "камера не статичная, медленная панорама"):
            with self.subTest(movement=movement):
                text = video.prompt({"action": "Герой идёт.", "movement": movement}, {}, [])
                self.assertIn(movement, text)
                self.assertNotIn("locked-off camera, do not change the camera position or the framing", text)

    def test_prompt_keeps_speech_language_and_sound_delimiters(self):
        text = video.prompt(
            {"action": "Герой шепчет.", "dialogueLanguage": "казахский"}, {}, [],
            dialogue="Мен дайынмын.", sfx="Ветер, тихий скрип дерева",
        )
        self.assertIn("казахский", text)
        self.assertRegex(text, r"\{[^}]*Мен дайынмын\.[^}]*\}")
        self.assertRegex(text, r"<[^>]*Ветер, тихий скрип дерева[^>]*>")
        self.assertIn("no music, only synchronized sound effects and dialogue", text)

    def test_prompt_accepts_explicit_dialogue_and_scene_language(self):
        text = video.prompt({"action": "Ответ героя."}, {}, [], dialogue={"text": "Я готов.", "language": "русский", "speaker": "Ер Төстік", "delivery": "шёпотом"})
        for value in ("Я готов.", "русский", "Ер Төстік", "шёпотом"):
            self.assertIn(value, text)
        self.assertRegex(text, r"\{[^}]*Я готов\.[^}]*\}")
        text = video.prompt({"description": "Ответ героя."}, {"language": "русский"}, [], dialogue="Я готов.")
        self.assertIn("русский", text)
        self.assertRegex(text, r"\{[^}]*Я готов\.[^}]*\}")

    def test_prompt_requires_action_language_and_defined_references(self):
        for shot in ({}, {"action": " "}):
            with self.subTest(shot=shot):
                self.assert_error(422, "VALIDATION", video.prompt, shot, {}, [])
        self.assert_error(422, "VALIDATION", video.prompt, {"action": "Говорит."}, {}, [], dialogue="Здравствуйте.")
        self.assert_error(422, "VALIDATION", video.prompt, {"action": "@Image7 входит."}, {}, ["герой"])

    def test_payload_defaults_and_ordered_image_roles(self):
        body = video.payload("Движение кадра", [IMAGE, PNG])
        self.assertEqual(body["model"], "dreamina-seedance-2-5-260628")
        self.assertEqual(body["duration"], 5)
        self.assertEqual(body["resolution"], "720p")
        self.assertEqual(body["ratio"], "16:9")
        self.assertIs(body["generate_audio"], True)
        self.assertIs(body["watermark"], False)
        self.assertNotIn("camera_fixed", body)
        self.assertEqual(body["content"], [
            {"type": "text", "text": "Движение кадра"},
            {"type": "image_url", "image_url": {"url": IMAGE}, "role": "reference_image"},
            {"type": "image_url", "image_url": {"url": PNG}, "role": "reference_image"},
        ])

    def test_first_frame_is_first_image_and_counts_toward_limit(self):
        body = video.payload("Текст", [IMAGE] * 5, first_frame=PNG)
        self.assertEqual(body["content"][1], {"type": "image_url", "image_url": {"url": PNG}, "role": "first_frame"})
        self.assertEqual(len(body["content"]), 7)
        self.assertTrue(all(part["role"] == "reference_image" for part in body["content"][2:]))
        self.assert_error(422, "VALIDATION", video.payload, "Текст", [IMAGE] * 6, first_frame=PNG)
        self.assert_error(422, "VALIDATION", video.payload, "Текст", [IMAGE] * 7)

    def test_payload_duration_boundaries_and_resolutions(self):
        for duration in (4, 15):
            for resolution in ("480p", "720p", "1080p"):
                with self.subTest(duration=duration, resolution=resolution):
                    body = video.payload("Текст", [], duration=duration, resolution=resolution)
                    self.assertEqual((body["duration"], body["resolution"]), (duration, resolution))
        for duration in (3, 16, True, 5.5, "5", None):
            with self.subTest(duration=duration):
                self.assert_error(422, "VALIDATION", video.payload, "Текст", [], duration=duration)
        for resolution in ("4K", "720P", "", None):
            with self.subTest(resolution=resolution):
                self.assert_error(422, "VALIDATION", video.payload, "Текст", [], resolution=resolution)

    def test_payload_rejects_empty_text_bad_urls_and_bad_base64(self):
        for text in ("", " ", None):
            with self.subTest(text=text):
                self.assert_error(422, "VALIDATION", video.payload, text, [])
        for url in ("http://example.invalid/x.png", "file:///tmp/x.png", "https:///x.png", "data:image/png;base64,%%%", "data:image/png;base64,", "data:image/jpeg;base64,aGVsbG8=", None):
            with self.subTest(url=url):
                self.assert_error(422, "VALIDATION", video.payload, "Текст", [url])
        self.assert_error(422, "VALIDATION", video.payload, "Текст", IMAGE)

    def test_api_key_environment_precedes_key_file(self):
        with patch.dict(os.environ, {"ARK_API_KEY": "  environment-key  "}), patch("pathlib.Path.read_text", side_effect=AssertionError("Файл не нужен")):
            self.assertEqual(self.real_api_key(), "environment-key")

    def test_api_key_file_and_missing_file(self):
        with tempfile.TemporaryDirectory() as directory, patch("pathlib.Path.home", return_value=Path(directory)):
            self.assertEqual(self.real_api_key(), "")
            key_file = Path(directory) / ".config" / "neyra-studio" / "ark-key"
            key_file.parent.mkdir(parents=True)
            key_file.write_text("  file-key\n", encoding="utf-8")
            self.assertEqual(self.real_api_key(), "file-key")
            with patch("pathlib.Path.read_text", side_effect=PermissionError("Недоступен")):
                self.assertEqual(self.real_api_key(), "")

    def test_fake_create_status_never_access_key_or_network(self):
        with patch.dict(os.environ, {"NEYRA_ASSISTANT_FAKE": "1"}):
            task_id = video.create(video.payload("Текст", []))
            self.assertRegex(task_id, r"^fake-[0-9a-f]+$")
            result = video.status(task_id)
        self.assertEqual(result["state"], "succeeded")
        self.assertIsNone(result["video_url"])
        self.assertIs(result["fake"], True)
        self.assertEqual(video.status(task_id)["state"], "succeeded")
        self.urlopen.assert_not_called()
        self.key.assert_not_called()

    def test_missing_key_does_not_open_network(self):
        self.key.return_value = ""
        self.assert_error(503, "VIDEO_KEY_MISSING", video.create, video.payload("Текст", []))
        self.assert_error(503, "VIDEO_KEY_MISSING", video.status, "task-123")
        self.urlopen.assert_not_called()

    def test_create_posts_exact_payload_with_bearer_and_timeout(self):
        body = video.payload("Текст", [IMAGE])
        self.reply({"id": "task-123"})
        self.assertEqual(video.create(body), "task-123")
        request = self.urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(json.loads(request.data), body)
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key-not-real")
        self.assertGreater(self.urlopen.call_args.kwargs["timeout"], 0)

    def test_status_maps_byteplus_states_and_preserves_details(self):
        for upstream, expected in (("queued", "queued"), ("running", "running"), ("succeeded", "succeeded"), ("failed", "failed"), ("cancelled", "cancelled"), ("expired", "failed")):
            with self.subTest(upstream=upstream):
                error = {"code": "ModelError", "message": "Не удалось создать кадр"} if expected == "failed" else None
                self.reply({"status": upstream, "content": {"video_url": VIDEO} if expected == "succeeded" else {}, "error": error, "usage": {"completion_tokens": 47}})
                result = video.status("task-123")
                self.assertEqual(result["state"], expected)
                self.assertEqual(result["video_url"], VIDEO if expected == "succeeded" else None)
                self.assertEqual(result["error"], error)
                self.assertEqual(result["usage"], {"completion_tokens": 47})
        request = self.urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/task-123")
        self.assertEqual(request.get_method(), "GET")
        self.assertGreater(self.urlopen.call_args.kwargs["timeout"], 0)

    def test_task_id_cannot_inject_path_query_or_fragment(self):
        for task_id in (None, "", " ", 123, "task/x", "task?x=1", "task#x", "task\nx", "x" * 201):
            with self.subTest(task_id=task_id):
                self.assert_error(422, "VALIDATION", video.status, task_id)
        self.urlopen.assert_not_called()

    def test_malformed_task_replies_are_upstream_errors(self):
        for reply in ({}, {"id": ""}, {"id": None}, [], {"id": "task/other"}):
            with self.subTest(create=reply):
                self.reply(reply)
                self.assert_error(502, "VIDEO_UPSTREAM", video.create, video.payload("Текст", []))
        for reply in ({}, {"status": "unknown"}, {"status": None}, [], {"status": "succeeded", "content": {}}):
            with self.subTest(status=reply):
                self.reply(reply)
                self.assert_error(502, "VIDEO_UPSTREAM", video.status, "task-123")
        for field in ("content", "usage", "error"):
            with self.subTest(malformed_field=field):
                self.reply({"status": "running", field: []})
                self.assert_error(502, "VIDEO_UPSTREAM", video.status, "task-123")

    def test_http_transport_and_json_failures_are_wrapped_without_retry(self):
        for operation, args in ((video.create, (video.payload("Текст", []),)), (video.status, ("task-123",))):
            for kind in ("http", "url", "timeout", "json"):
                with self.subTest(operation=operation.__name__, kind=kind):
                    self.urlopen.reset_mock()
                    if kind == "json":
                        self.urlopen.side_effect = None
                        self.urlopen.return_value = Response(b"not-json")
                    elif kind == "http":
                        self.urlopen.side_effect = urllib.error.HTTPError(VIDEO, 429, "Too Many Requests", {}, io.BytesIO(b'{"error":"quota"}'))
                    elif kind == "url":
                        self.urlopen.side_effect = urllib.error.URLError("Connection refused")
                    else:
                        self.urlopen.side_effect = TimeoutError("Timed out")
                    self.assert_error(502, "VIDEO_UPSTREAM", operation, *args)
                    self.assertEqual(self.urlopen.call_count, 1)

    def test_usd_uses_internal_per_second_cost(self):
        for resolution, expected in (("480p", 0.515), ("720p", 1.155), ("1080p", 2.845)):
            with self.subTest(resolution=resolution):
                self.assertAlmostEqual(video.usd(5, resolution), expected)
        self.assertEqual(video.usd(0, "720p"), 0)
        self.assertAlmostEqual(video.usd(1.5, "720p"), 0.3465)

    def test_usd_rejects_invalid_estimate_inputs(self):
        for seconds in (-1, True, "5", None, float("nan"), float("inf")):
            with self.subTest(seconds=seconds):
                self.assert_error(422, "VALIDATION", video.usd, seconds, "720p")
        self.assert_error(422, "VALIDATION", video.usd, 5, "4K")

    def test_download_writes_video_and_returns_path(self):
        self.urlopen.side_effect = None
        self.urlopen.return_value = Response(b"video-bytes", "video/mp4")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "take.mp4"
            self.assertEqual(video.download(VIDEO, path), path)
            self.assertEqual(path.read_bytes(), b"video-bytes")
        self.assertGreater(self.urlopen.call_args.kwargs["timeout"], 0)
        self.key.assert_not_called()

    def test_download_rejects_wrong_content_type_preserving_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "take.mp4"
            path.write_bytes(b"previous-take")
            for content_type in ("text/html", "application/json", ""):
                with self.subTest(content_type=content_type):
                    self.urlopen.side_effect = None
                    self.urlopen.return_value = Response(b"error-page", content_type)
                    self.assert_error(502, "VIDEO_UPSTREAM", video.download, VIDEO, path)
                    self.assertEqual(path.read_bytes(), b"previous-take")
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_download_midstream_failure_is_atomic(self):
        class BrokenResponse(Response):
            def read(self, size=-1):
                if self.tell():
                    raise OSError("Обрыв загрузки")
                return super().read(4)

        self.urlopen.side_effect = None
        self.urlopen.return_value = BrokenResponse(b"unfinished-take", "video/mp4")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "take.mp4"
            path.write_bytes(b"previous-take")
            self.assert_error(502, "VIDEO_UPSTREAM", video.download, VIDEO, path)
            self.assertEqual(path.read_bytes(), b"previous-take")
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_download_requires_https_and_wraps_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "take.mp4"
            for url in ("http://example.invalid/x.mp4", "file:///tmp/x.mp4", "https:///x.mp4", PNG):
                with self.subTest(url=url):
                    self.assert_error(422, "VALIDATION", video.download, url, path)
            self.urlopen.assert_not_called()
            self.urlopen.side_effect = TimeoutError("Timed out")
            self.assert_error(502, "VIDEO_UPSTREAM", video.download, VIDEO, path)
            self.assertFalse(path.exists())

    def test_download_redirects_require_https_at_every_hop(self):
        handler = video._HTTPSRedirectHandler()
        request = urllib.request.Request(VIDEO)
        for url in ("http://example.invalid/x.mp4", "file:///tmp/x.mp4"):
            with self.subTest(url=url):
                self.assert_error(502, "VIDEO_UPSTREAM", handler.redirect_request, request, None, 302, "Found", {}, url)
        redirected = handler.redirect_request(request, None, 302, "Found", {}, "https://example.invalid/x.mp4")
        self.assertEqual(redirected.full_url, "https://example.invalid/x.mp4")
        self.urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
