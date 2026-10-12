# Мост с Neyra по MCP (№07): что переносим, в какую сторону, без платных вызовов

Состояние 13.10.2026 04:10: в аккаунте Neyra 8 проектов (BRO 120 сцен, «The One Who Lied» 109, МАТКА ×3, БӨРІ, «Смотри, у меня есть идея», «ЖОЛАМА МАҒАН — AI-превиз»); «Ер Төстік» там нет. Импорт архивной основы А в Neyra не делаем — Лена пишет основу Б; мост включаем на её драфте.

## Что умеет мост (инструменты MCP, бесплатные — данные, не рендер)
| Наше | Neyra | Направление | Чем |
|---|---|---|---|
| сценарий (драфт Fountain) | сцены проекта | папка → Neyra | `import_screenplay` (создаёт сцены со слаглайнами и текстом) |
| разбивка `/scenes` на нашем сервере | `get_scenes` (слаглайн, screenplay, dialogue, shot list) | Neyra → сервер | `tools/neyra-most.py pull-scenes` (через чат: MCP → JSON → `POST /breakdown`) |
| паспорта героев (`/characters`, канон) | каст (`list_cast`, `get_character`, `update_character`) | в обе стороны, канон главнее | identity/таbу → описание персонажа в Neyra; портрет ⭐ из Neyra → `refs` |
| паспорта локаций (`/locations`) | мир (`list_world`, `upsert_world_entity` location/prop/wardrobe) | в обе стороны | мастер-пластина ⭐ → `refs` |
| шот-лист раскадровки (`raskadrovka.json`) | `set_scene_shotlist` | папка → Neyra | после «да» на кадры |
| реестр кадров / происхождение | `list_renders`, `get_render`, `get_audit_log` | Neyra → реестр | сайдкары происхождения с `engine: neyra` |
| дата-рум проекта (экспорт ZIP) | `get_dataroom`, `update_dataroom_overview` | обзор → Neyra | паспорт проекта из `export-project.py` |

Платное в Neyra (кредиты): `regenerate_image`, `generate_voiceover`, `generate_sfx`, рендеры — только после «да» и только через адаптер генератора с лимитом (`generator.py`, адаптер `NeyraMCP` — пока не написан: MCP доступен из чата Claude, не из скрипта; значит адаптер = чат-процедура с теми же сайдкарами).

## Как запускается (когда появится драфт Б)
1. В чате: «залей сценарий в Neyra» → `create_project` (title «Ер Төстік», type film) → `import_screenplay` (Fountain → сцены) → `get_scenes` → JSON в `02-scenariy/neyra-scenes.json`.
2. `tools/sync-project.py razbivka` остаётся источником разбивки для нашего сервера (наш парсер — наши номера сцен); Neyra-сцены сверяются по слаглайнам, расхождения — в журнал.
3. Каст/мир: паспорта с замками → `update_character`/`upsert_world_entity` (описание = identity + табу, без возраста числом); обратно — только ⭐-портреты как `refs`.
4. Всё, что пришло из Neyra, получает сайдкар происхождения `engine: {name: neyra, public_name: технология NEYRA}`.

## На доску
- №07 (Claude): чат-процедура выше + `tools/neyra-most.py` для шагов 2–4 по JSON из чата; запуск — на драфте Б Лены. Проверка: сцены Neyra = сцены сервера по слаглайнам.
