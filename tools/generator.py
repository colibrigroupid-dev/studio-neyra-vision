#!/usr/bin/env python3
"""Интерфейс «Генератор» (№42): одно задание → файл + происхождение (provenance) + стоимость.

Любой движок (карандаш Z-Image на GPU, Nano Banana, Seedance, голос, Neyra MCP, LoRA) подключается адаптером,
который реализует Generator.run(job) и обязан вернуть Result с файлом и происхождением. Происхождение пишется
соседним файлом <имя>.json рядом с результатом и в журнал проекта — это основа дата-рума (RAZBOR/06 §6).

Сухой прогон (dry_run=True) ничего не генерирует и не платит: пишет задание и промпт в сайдкар — так
готовится «до кнопки» всё, что потом запускается одним решением «да».

    python3 tools/generator.py selftest
"""
from __future__ import annotations
import dataclasses, datetime, hashlib, json, os, pathlib, sys, uuid, urllib.request, urllib.parse

@dataclasses.dataclass
class Job:
    kind: str                     # karandash | image | video | voice | sfx | lora
    project: str                  # slug проекта
    target: str                   # например "shot:12.3" или "hero:erke" или "location:aul"
    prompt: str
    negative: str = ""
    params: dict = dataclasses.field(default_factory=dict)   # размер, seed, шаги, модель…
    refs: list = dataclasses.field(default_factory=list)     # пути к референсам с ролями: {"path":..., "role":"identity|staging|style"}
    requested_by: str = ""        # имя/ключ участника
    budget_limit: float = 0.0     # $ — выше не запускать
    out_dir: str = ""             # куда класть результат
    dry_run: bool = False
    id: str = dataclasses.field(default_factory=lambda: uuid.uuid4().hex[:12])

@dataclasses.dataclass
class Result:
    ok: bool
    file: str = ""                # путь к результату
    provenance: dict = dataclasses.field(default_factory=dict)
    cost_usd: float = 0.0
    error: str = ""

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

def write_provenance(result_path: pathlib.Path, job: Job, engine: dict, cost_usd: float, extra: dict | None = None) -> pathlib.Path:
    """Сайдкар <файл>.json: кто, когда, чем, промпт, параметры, цена, хэш. Один формат для всех движков."""
    prov = {
        "schema": "neyra-vision/provenance/1",
        "job_id": job.id, "kind": job.kind, "project": job.project, "target": job.target,
        "requested_by": job.requested_by, "created_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "engine": engine,                       # {"name": "...", "model": "...", "version": "...", "license": "...", "public_name": "технология NEYRA"}
        "prompt": job.prompt, "negative": job.negative, "params": job.params,
        "refs": [{"path": str(r.get("path", "")), "role": r.get("role", ""), "sha256": (sha256(r["path"]) if r.get("path") and os.path.exists(r["path"]) else "")} for r in job.refs],
        "cost_usd": round(cost_usd, 4), "dry_run": job.dry_run,
        "file": result_path.name if result_path else "", "sha256": (sha256(result_path) if result_path and result_path.exists() else ""),
        "approval": {"status": "draft", "by": "", "at": "", "comment": ""},   # заполняет апрув (карта производства)
    }
    if extra: prov.update(extra)
    side = (result_path.with_suffix(result_path.suffix + ".json") if result_path and result_path.suffix else (pathlib.Path(job.out_dir) / f"{job.id}.json"))
    side.parent.mkdir(parents=True, exist_ok=True)
    side.write_text(json.dumps(prov, ensure_ascii=False, indent=1), encoding="utf-8")
    return side

class Generator:
    """Базовый класс адаптера. Наследник задаёт ENGINE и реализует _run."""
    ENGINE = {"name": "abstract", "model": "", "version": "", "license": "", "public_name": "технология NEYRA"}
    PRICE_USD = 0.0   # оценка за одно задание; адаптер может считать точнее

    def estimate(self, job: Job) -> float:
        return self.PRICE_USD

    def run(self, job: Job) -> Result:
        est = self.estimate(job)
        if job.budget_limit and est > job.budget_limit and not job.dry_run:
            return Result(ok=False, error=f"оценка {est:.2f} $ выше лимита {job.budget_limit:.2f} $ — нужно «да»")
        out = pathlib.Path(job.out_dir or ".")
        out.mkdir(parents=True, exist_ok=True)
        if job.dry_run:
            side = write_provenance(out / f"{job.id}.dry", job, self.ENGINE, 0.0, {"note": "сухой прогон: промпт и параметры готовы, генерация не запускалась"})
            return Result(ok=True, file=str(side), provenance=json.loads(side.read_text()), cost_usd=0.0)
        try:
            path, cost, extra = self._run(job, out)
        except Exception as e:  # ошибка — честно, без «успеха»
            return Result(ok=False, error=f"{type(e).__name__}: {e}")
        side = write_provenance(path, job, self.ENGINE, cost, extra)
        return Result(ok=True, file=str(path), provenance=json.loads(side.read_text()), cost_usd=cost)

    def _run(self, job: Job, out: pathlib.Path):
        raise NotImplementedError

# ---------- адаптеры ----------
class KarandashComfy(Generator):
    """Карандашная раскадровка: Z-Image Turbo + LoRA «Storyboard Sketch» через ComfyUI API (сервер с GPU).
    URL ComfyUI — в params['comfy_url'] или NV_COMFY_URL. Пока сервера нет — только dry_run."""
    ENGINE = {"name": "comfyui", "model": "Z-Image Turbo + LoRA storyboard-sketch", "version": "", "license": "Apache-2.0", "public_name": "технология NEYRA"}
    PRICE_USD = 0.0  # своя/арендованная видеокарта: цена = аренда/час, пишется в params['gpu_usd_per_hour']
    TRIGGER = "5t0ry style digital sketch, pencil on paper"

    def estimate(self, job):
        return float(job.params.get("gpu_usd_per_hour", 0.5)) * float(job.params.get("seconds", 3)) / 3600

    GRAPH = pathlib.Path(__file__).parent / "comfy" / "z-image-karandash.json"

    def graph(self, job, seed):
        """Граф из tools/comfy/z-image-karandash.json с подставленными значениями; числа — числами."""
        g = json.loads(self.GRAPH.read_text(encoding="utf-8")); g.pop("_comment", None)
        subst = {"{PROMPT}": job.prompt, "{NEGATIVE}": job.negative, "{LORA}": job.params.get("lora_file", "storyboard-sketch-z-image.safetensors"), "{JOB}": job.id}
        nums = {"{SEED}": int(seed), "{WIDTH}": int(job.params.get("width", 1024)), "{HEIGHT}": int(job.params.get("height", 576)), "{STEPS}": int(job.params.get("steps", 8))}
        for node in g.values():
            for k, v in node["inputs"].items():
                if isinstance(v, str):
                    if v in nums: node["inputs"][k] = nums[v]
                    else:
                        for a, b in subst.items(): v = v.replace(a, b)
                        node["inputs"][k] = v
        return g

    def _run(self, job, out):
        url = (job.params.get("comfy_url") or os.environ.get("NV_COMFY_URL") or "").rstrip("/")
        if not url: raise RuntimeError("нет ComfyUI: задайте NV_COMFY_URL (сервер с GPU, №25) — пока только dry_run")
        if "{ACTION_EN}" in job.prompt: raise RuntimeError("в промпте остался {ACTION_EN} — заполните deystvie_en в карточке кадра")
        import time, random
        variants = int(job.params.get("variants", 1)); files = []; t0 = time.time()
        for i in range(variants):
            seed = int(job.params.get("seed", 0)) + i if job.params.get("seed") else random.randrange(1, 2**31)
            body = json.dumps({"prompt": self.graph(job, seed), "client_id": f"neyra-{job.id}"}).encode()
            req = urllib.request.Request(url + "/prompt", data=body, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r: pid = json.loads(r.read())["prompt_id"]
            for _ in range(600):  # до 10 минут на вариант
                time.sleep(1)
                with urllib.request.urlopen(f"{url}/history/{pid}", timeout=30) as r: h = json.loads(r.read())
                if pid in h:
                    outs = [im for o in h[pid].get("outputs", {}).values() for im in o.get("images", [])]
                    if not outs: raise RuntimeError("ComfyUI вернул историю без картинок: " + json.dumps(h[pid].get("status", {}))[:200])
                    im = outs[0]; q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                    path = out / f"{job.id}-v{i+1}.png"
                    urllib.request.urlretrieve(f"{url}/view?{q}", path); files.append((path, seed)); break
            else:
                raise RuntimeError(f"ComfyUI: вариант {i+1} не готов за 10 минут")
        secs = time.time() - t0
        cost = float(job.params.get("gpu_usd_per_hour", 0.5)) * secs / 3600
        for p2, sd in files[1:]:  # сайдкар каждому варианту; первый вернётся из run()
            write_provenance(p2, job, self.ENGINE, cost / len(files), {"seed": sd, "variant_of": job.id, "gpu_seconds": round(secs, 1)})
        return files[0][0], cost, {"seed": files[0][1], "variants": [str(p2) for p2, _ in files], "gpu_seconds": round(secs, 1)}

class NanoBanana(Generator):
    """Чистовые кадры и портреты: Nano Banana 2 через ~/Documents/CODE/nano-banana/nb.py (ключ ~/.config/nano-banana/key)."""
    ENGINE = {"name": "google", "model": "gemini-3.1-flash-image (Nano Banana 2)", "version": "", "license": "условия Google Gemini API", "public_name": "технология NEYRA"}
    PRICE_USD = 0.04
    def _run(self, job, out):
        raise RuntimeError("запуск через nb.py подключается после пополнения кредитов (№47); до этого — dry_run")

class Seedance(Generator):
    ENGINE = {"name": "byteplus", "model": "Seedance 2.5", "version": "dreamina-seedance-2-5-260628", "license": "условия BytePlus ModelArk", "public_name": "технология NEYRA"}
    PRICE_USD = 0.70   # ≈ 5 с 1080p; точнее считает адаптер по длительности/разрешению
    def _run(self, job, out):
        raise RuntimeError("видео — только после принятых кадров и отдельного «да» (правило)")

class HiggsfieldCLI(Generator):
    """Второе окно к тем же моделям через командную строку Higgsfield (аккаунт Александра, план max, кредиты).
    Модели: image → nano_banana_flash (Nano Banana 2; 2K 16:9 = 2 кредита), video → seedance_2_5 (5 с 720p = 35 кредитов) —
    оценки `higgsfield generate cost` от 13.10.2026. Курс кредита в $ — params['usd_per_credit'] или NV_USD_PER_CREDIT
    (по тарифу плана; не задан = 0 и предупреждение). Запуск: `higgsfield generate create <model> --prompt … --image-references …
    --wait --json`; результат скачивается в out_dir. Без «да» Александра — только dry_run (правило платных генераций)."""
    ENGINE = {"name": "higgsfield-cli", "model": "", "version": "cli 1.1.26", "license": "условия Higgsfield", "public_name": "технология NEYRA"}
    MODELS = {"image": ("nano_banana_flash", 2), "video": ("seedance_2_5", 35)}
    CLI = "/opt/homebrew/bin/higgsfield"

    def estimate_credits(self, job):
        model, cr = self.MODELS[job.kind]
        if job.kind == "video": cr = cr * max(1, int(job.params.get("duration", 5))) / 5
        return cr

    def estimate(self, job):
        rate = float(job.params.get("usd_per_credit") or os.environ.get("NV_USD_PER_CREDIT") or 0)
        return self.estimate_credits(job) * rate

    def _run(self, job, out):
        import subprocess, shutil
        if not os.path.exists(self.CLI): raise RuntimeError("нет higgsfield CLI (brew install) или не выполнен `higgsfield auth login`")
        if job.params.get("needs") == "deystvie_en" and "{ACTION_EN}" in job.prompt: raise RuntimeError("в промпте остался {ACTION_EN} — заполните deystvie_en в карточке кадра")
        model, _ = self.MODELS[job.kind]
        cmd = [self.CLI, "generate", "create", model, "--prompt", job.prompt, "--json", "--wait", "--wait-timeout", "20m"]
        if job.kind == "image":
            cmd += ["--resolution", job.params.get("resolution", "2k"), "--aspect-ratio", job.params.get("aspect_ratio", "16:9")]
        else:
            cmd += ["--duration", str(job.params.get("duration", 5)), "--resolution", job.params.get("resolution", "720p"), "--aspect-ratio", job.params.get("aspect_ratio", "16:9")]
            if job.refs: cmd += ["--mode", "omni_reference"]
        for r in job.refs:
            if r.get("path") and os.path.exists(r["path"]): cmd += ["--image-references", r["path"]]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=1500)
        if res.returncode != 0: raise RuntimeError(f"higgsfield: {res.stderr.strip()[:300] or res.stdout.strip()[:300]}")
        data = json.loads(res.stdout)
        urls = [u for u in (data.get("result_urls") or data.get("urls") or [data.get("url")]) if u]
        if not urls:  # структура ответа уточняется первым боевым запуском
            raise RuntimeError("higgsfield: в ответе нет ссылки на результат — сохранён сырой JSON: " + json.dumps(data)[:200])
        ext = ".mp4" if job.kind == "video" else ".png"
        path = out / f"{job.id}{ext}"
        urllib.request.urlretrieve(urls[0], path)
        extra = {"higgsfield_job": data.get("id") or data.get("job_id"), "credits": self.estimate_credits(job), "raw": data}
        self.ENGINE = {**self.ENGINE, "model": model}
        return path, self.estimate(job), extra

ADAPTERS = {"karandash": KarandashComfy, "image": NanoBanana, "video": Seedance, "image-hf": HiggsfieldCLI, "video-hf": HiggsfieldCLI}

def selftest():
    import tempfile
    d = tempfile.mkdtemp()
    job = Job(kind="karandash", project="test", target="shot:1.1", prompt="5t0ry style digital sketch, wide shot, a rider leaves the aul at dawn", out_dir=d, dry_run=True, requested_by="selftest")
    r = KarandashComfy().run(job)
    assert r.ok and r.provenance["schema"] == "neyra-vision/provenance/1" and r.provenance["dry_run"] is True, r
    r2 = KarandashComfy().run(dataclasses.replace(job, dry_run=False))
    assert not r2.ok and "ComfyUI" in r2.error, r2
    g = KarandashComfy().graph(dataclasses.replace(job, params={"width": 1024, "height": 576, "steps": 8}), 42)
    assert g["9"]["inputs"]["seed"] == 42 and g["8"]["inputs"]["width"] == 1024 and "rider" in g["6"]["inputs"]["text"] and g["11"]["inputs"]["filename_prefix"].endswith(job.id), g["9"]
    r3 = Seedance().run(Job(kind="video", project="test", target="shot:1.1", prompt="x", out_dir=d, budget_limit=0.1))
    assert not r3.ok and "лимита" in r3.error, r3
    hf = HiggsfieldCLI()
    jv = Job(kind="video", project="test", target="shot:1.1", prompt="x", params={"duration": 10, "usd_per_credit": 0.1}, out_dir=d)
    assert hf.estimate_credits(jv) == 70 and abs(hf.estimate(jv) - 7.0) < 1e-9, hf.estimate_credits(jv)
    r4 = hf.run(dataclasses.replace(jv, dry_run=True)); assert r4.ok and r4.provenance["dry_run"], r4
    print("selftest ok:", r.file)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "selftest": selftest()
    else: print(__doc__)
