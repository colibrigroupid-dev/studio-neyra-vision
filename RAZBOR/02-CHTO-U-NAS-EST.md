# Что у нас уже есть по платформе Neyra (инвентаризация 13.10.2026)

Сведено из папок `neyra-3d/`, `neyra-kazakhstan/`, `KINO-STANCIYA/`, `neyra-vision/`, памяти и живого MCP-моста. Это фундамент, на котором строим studio.neyra.vision и инструмент для команды.

## 1. Доступ к самой платформе Neyra

| Что | Где | Состояние |
|---|---|---|
| Аккаунт Neyra Studio (studio.neyra.ai) | Google-аккаунт Александра, neyravision@gmail.com | ≈37,5 тыс. кредитов (21.09); tier free |
| **MCP-мост** `neyra` в Claude Code | токен `nbk_…` в `~/.claude.json`, scope read_write | ✅ подключён, сервер `neyra-studio 2.1.0`; в этой сессии видно **46 инструментов** |
| Проекты в аккаунте (list_projects 13.10) | 8: «ЖОЛАМА МАҒАН — AI-превиз» (0 сцен, 07.10), The One Who Lied (109/140 сцен, WBD proof-of-concept), «МАТКА — атака v2» (10), «МАТКА — сцена пчёл» (36 и 0), BÖRI 1-minute (1), «Смотри, у меня есть идея» (20), BRO (120) | живые |
| Лицензия на платформу для Казахстана | `neyra-kazakhstan/dogovor/LICENZIYA-NEYRA-TAURUS-DIGITAL-RU/EN.md` — исключительная лицензия Neyra Labs → Digital Taurus Asia (кино/сериалы/реклама в РК); подписывает Роман | черновик, к подаче в Astana Hub (08.10) |

### MCP-инструменты, которые видны сейчас (46)
Чтение: `get_platform_guide`, `list_projects`, `get_project`, `get_scenes` (до 50 сцен разом), `get_scene`, `get_scene_production`, `get_dataroom` (overview/research/analysis/doctor/audience/operator/teaser/findings), `list_cast`, `get_character`, `list_world`, `get_coverage_map`, `get_golden_prompt`, `list_renders`, `get_render`, `list_scene_boards`, `get_scene_board`, `list_scene_history`, `get_revision`, `get_audit_log`, `get_credit_balance`, `get_project_settings`, `list_agents`.
Запись: `create_project` (500 cr), `create_scene`, `update_scenes`, `update_scene_details`, `update_scene_prompt`, `set_scene_dialogue`, `set_scene_shotlist`, `update_character`, `upsert_world_entity`, `update_dataroom_overview`, `update_project_settings`, `update_board_cell`, `restore_revision`, `import_screenplay`.
Агенты и контроль: `ask_agent`, `submit_agent_report`, `lint_prompt`, `improve_prompt`, `analyze_scene`, `classify_shot_tiers`.
Платное: `regenerate_image` (15 cr; в сентябре отдавал 402), `generate_voiceover` (12), `generate_sfx`.
Не через MCP: Script Doctor, Deep Analysis, Audience Pulse, Epic Shots, Animatic (запускаются в Data Room, MCP читает результат); оплата, публикация, удаление.

### Модель данных Neyra (снята живьём 13.10 с The One Who Lied)
- **Проект**: title, type (film/documentary/short_film/drama), style (naturalism…), aspect, duration, scene_count; настройки: image model (auto/flux/nano_banana_*/gpt_image_*/seedream/wan/qwen…), 1K/2K/4K, 16:9/9:16/1:1/4:5/21:9, 16 стилевых пресетов, video model.
- **Data Room → overview**: logline, tagline, synopsis (по актам), overall_score, oscar_verdict, acts {title, summary, scene_numbers}, film_vector {north_star, target_arc (icarus…), emotional_temperature, intensity_curve, tonal_anchors}, genre, tone, theme.
- **Сцена** (`get_scene_production`): order, title, slugline, INT/EXT, time_of_day, screenplay (текст сцены), dialogue[], **shotlist[]** (shot_type establishing/insert/medium/close_up…, duration_seconds, number, label, intent, prompt, image_url, status), sound_design {music_prompt, key_sounds[], ambience, music_mood, mix_note}, scene_brain {score, strengths, improvements, verdict}, shot_intent, emotional_objective, render_mode, shot_tier (establishing/hero/medium/close…), emotion_charge, cast_ids[], location_id, world_entity_refs[], duration_seconds, notes (BRIDGE → next).
- **Каст** (`list_cast`): id, name, role, description, **appearance_prompt** (замок внешности, вставляется дословно в каждый рендер), portrait_url, voice, psychology. Пример — ЖУЛДЫЗ и КАТИРА из «Матки».
- **Мир** (`list_world`): kind (location/prop/vehicle/creature/wardrobe/atmosphere), name, descriptor, appearance_prompt, lighting_design, indoor_outdoor, reference_url.
- **Золотой промпт**: subject + hero identity (verbatim locked appearance) → action/emotion → location/time → lens/Camera DNA → light/grade → mood/texture; 90–340 слов; негатив отдельно; объекты 3D-доски как `<object N>`.
- **Команда агентов** (`list_agents`): 29 ролей с миссией, навыками, **gates** (проверки перед передачей) и **handoffs** (кому передаёт): Showrunner, Story Architect, Film Director, Screenwriter, Script Doctor, Script Breakdown, Cinematographer, Character Psychologist, Image Prompt Master, Video Prompt Engineer, Critic · Quality Gate, Continuity Supervisor, Animatic Director, Audio Designer, Location Manager, Editor, Producer, CTO, Creative Director, Ads Director, Photographer, Colorist, VFX Artist, Art Director, Animator, Wardrobe Designer, Drama Showrunner, Game Designer, Level Artist, Gameplay Choreographer. Плюс 50 опубликованных шаблонов агентов в аккаунте.

## 2. Наши конспекты и журналы (папка `neyra-3d/`, ~190 КБ текста)

| Файл | Что внутри | Зачем нам |
|---|---|---|
| `KONSPEKT-ACADEMY.md` + `academy/ACADEMY-FULL.md` (200 КБ, 13 глав) | три фазы /create → /editor → /studio; PreProductionDoc (12 столпов, Netflix Score, Save the Cat); звезда = канон; Brand Guidelines; Style refs; локации 8–20 слов; герой = портрет + appearance prompt + face refs; карточка сцены; Shot/Shotlist; герои /characters; пост; цены голоса; **MCP-мост и протокол Neuro Final Draft** | учебник по тому, как Neyra думает — основа для нашего регламента |
| `KONSPEKT-EDITOR.md` | 16 панелей редактора, три слоя данных (проект/сцена/шот), Project Brain, Shot Studio, что работает без LLM | карта «что где» |
| `ROMA-VIDEO-KONSPEKT.md` | порядок Ромы: концепт → лайк → SuperShot → breakdown ≥90% → зелёный gate → Render Lane; у каждого члена команды свой агент; «фильм за 1 час командой» | наш производственный регламент повторяет его |
| `material-ot-razrabotchikov/` — пакет Codex 20.09.2026: `NEYRA_3D_AGENT_KIT/` (README_FIRST, AGENT_CONTEXT 367 строк, OPERATING_PLAYBOOK, REPOSITORY_MAP `path::symbol`, BOOTSTRAP, coverage-matrix, INVESTIGATION_SUMMARY, навык `agent-skill/neyra-3d-operator` с 7 референсами, `evidence/` 34 скриншота) + PDF `NEYRA-Characters-Guide-EN-RU` (8,5 МБ) и `NEYRA-Play-Guide-EN-RU` (20 МБ) | только 3D-стенд `/3d`, `/3d/:sceneId`, `/3d/flow`; базовый коммит `b2e1bf7d…`; редактора, /create, агентов, Data Room и MCP в ките нет | формула SOURCE → SET → SHOOT → REHEARSE → RECORD TAKE → DELIVER; пять слоёв состояния — основа «работы над кадром» |
| `KONSPEKT-3D-STEND.md`, `KONSPEKT-AGENT-KIT-20-09.md`, навык `~/.claude/skills/neyra-3d-operator` | 3D-стенд: Set → Shoot → Deliver, 999 рецептов камеры, 38 движений, доска 8×8, пять слоёв сохранения, движки C-Dance 2.5/Wan 3.0 и цены | слой «работа над каждым кадром» |
| `KONSPEKT-CHARACTERS-GUIDE-20-09.md`, `KONSPEKT-PLAY-GUIDE-21-09.md` | герой ≈1050 cr, Neyra ID, Seedance Trusted Avatar, 4 проверки готовности; Play: первый ролик с героем ≈220 cr, Autopilot QA выключать | IP-аватары, цены клиентских шагов |
| `OTCHYOT-NEYRA-3D-10-09.md`, `ZHURNAL-TESTOV.md`, `BAGI-DLYA-ROMY.md`, `rekomendacii/` (NR-001…NR-008, сводные отчёты Роману 12.09 и 19.09) | что работает, что падает (showrunner 403 «admin-only during Lost Beta», 402 от провайдеров, UI затирает правки через MCP, MCP-сцены не видны в редакторе) | знаем стены — проектируем свой слой так, чтобы не зависеть от них |
| `scena-primer/`, `test-ip-avatar-bori-21-09/` | живые прогоны: парковка (3D-блокинг против референса), герой Бөрі с нуля | доказательства и примеры для сайта |

## 3. Что уже сделано «своими руками» (наш слой)

- **Киностанция** `~/Documents/CODE/KINO-STANCIYA/` (раздаётся с neyra.vision/kino/, zip 53 МБ): CLAUDE.md-роль (сценарный редактор + операционный менеджер), навыки `scenarist` (главный), `kino`, `nano-banana`, `seedance`, `seedance-api`, `higgsfield`, `montazh`, `zvuk`; учебник 01–04; шаблоны документов; библиотека сценариев; скелет проекта `PROEKTY/_primer-proekta/` (PROEKT.md, ZHURNAL.md, 01-zamysel … 06-zvuk, materialy). Правила: слои по очереди, драфты не перезаписываются, имена латиницей, журнал в конце сессии. Это **слой 1 «сценарий»** платформы — уже существует и опробован на «Ер Төстік» (проект продюсера), встреча команды 12.10.
- **Страницы проектов по коду** на colibristudio.ai и neyra.vision (ОРДА, Бөрі, Матка, Тоқылдақ, BABY SHARP, Айдахар, Нектариум, Ер Төстік, Жолама маған, Талант, Давид, Еңлік-Кебек, Веки): замок по коду (общий TAURUSDGTL + свои), разделы: кадры, сценарий, команда, смета по PRO-коду, план. Шаблон кредитов (студия → Neyra Vision → режиссёр → AI-превиз). Это прообраз **«страницы проекта как лендинга, где работает команда по ключу и по разделам»**.
- **Генерация кадров и видео снаружи Neyra**: мастер-промпт Nano Banana 2 + Seedance 2.5 (`master-prompt-generacia-izobrazheniy-video.md`), Higgsfield-коннектор, welluma-art CLI на Seedance 2.5, CapCut Design Studio, чек-листы (детали перед генерацией, референсы сначала показать, видео только после «да» на картинки, география кадра — одна пластина локации).
- **Команда и бренд**: neyra.vision/team/ (Digital Taurus Asia ⊃ Taurus Asia Production + Neyra Vision), правила: публично «Neyra Vision» и «технология NEYRA», Neyra Labs не показывать, Анна и Анара первыми, 16:9 всегда, без названий моделей.
- **Сайт neyra.vision**: статика на GitHub Pages (репо colibrigroupid-dev/neyra-vision, DNS Рег.ру, CNAME), шрифты Oswald + Cormorant Garamond + IBM Plex Sans/Mono, тёмная кино-тема, видео-петля логотипа в hero. Контакты, которые уже используются публично: alex@neyra.ai, t.me/mis_ter_bro, t.me/kinosreda_kz.
- **Бизнес-контур в Казахстане** (`neyra-kazakhstan/`): профиль Neyra для анкет (12 модулей продукта, 28 агентов, Cannes AI Film Awards 2025), продукты и тарифы Neyra (токены 1 ¢, Solo $49 / Team $249 / Studio $2 490, 3D Free/Standard/Pro, лицензии L1–L4), налоги КЗ vs Сингапур, заявка в Astana Hub (подана с Ольгой 08.10), бизнес-план Digital Taurus Asia, лицензионный договор RU/EN. Заявленная доработка под Казахстан: **казахский и русский интерфейс и промпты, казахстанский конвейер (раскадровка → 3D-мизансцена → генерация → мастер), каталог локаций и типажей РК** — ровно то, что строим.

## 4. Чего нет — и что надо построить

1. **Страницы studio.neyra.vision** (витрина платформы на RU/KZ) — нет. Прототип в этой папке (`index.html`).
2. **Страница проекта для команды** как единый формат: разделы по этапам, статусы, ключи по ролям, журнал. Сейчас каждая страница проекта собирается вручную и по-своему. Нужен один шаблон + сборщик из папки проекта Киностанции.
3. **Карточка кадра** (работа над каждым кадром отдельно): номер сцены.кадр, крупность, движение, объектив, длительность, промпт, варианты картинок, выбранный (звезда), статус красный/зелёный, замечания, кто утвердил. В Neyra это есть внутри редактора; у нас — только таблицы и листы кадров в папках.
4. **Связка папка ↔ Neyra**: импорт сценария (`import_screenplay`), выгрузка каста/мира/шотлиста (`list_cast`, `list_world`, `get_scenes`) в страницу проекта; обратная запись промптов (`update_scene_prompt`) — с учётом правила «UI затирает правку через MCP» (править там, где жмёшь запуск).
5. **Казахский язык**: ни одна наша страница ещё не двуязычна RU/KZ (есть RU/EN). Нужны проверенные шрифты с казахскими буквами (Onest, Golos Text, Geologica, Noto, Cormorant Garamond, PT Serif, Commissioner, Mulish) и носитель для вычитки.
6. **Цены и сроки для Казахстана** — не определены; у Neyra: Pilot $300 / Short $1 000 / Feature $10 000 / Epic $30 000, продакшн от $50 000. Решение Александра.
