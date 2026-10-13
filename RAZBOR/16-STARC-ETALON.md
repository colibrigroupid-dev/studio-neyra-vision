# Story Architect (STARC): эталон сценарного редактора

Дата разбора: 2026-10-13. Программа: starc.app, исходники github.com/story-apps/starc (GPLv3), ветка HEAD на момент чтения.

## Как читать метки

- **[справка: имя]** — факт со страницы starc.app/help/<имя>/ (английская версия; русская /ru/ не сверялась).
- **[код: путь]** — факт из исходника. Путь от корня репозитория, например `src/core/management_layer/plugins/screenplay_text/text/handlers/dialog_handler.cpp`.
- **[вывод]** — мой вывод из кода или справки, не проверен запуском.
- **[не нашёл]** — в доступных файлах и справке не найдено; не домысливалось.

**Важная оговорка о точности.** Исходники читались через WebFetch, то есть значения пересказаны небольшой моделью, а не скопированы байт в байт. Таблицы отступов, enum-значения и переходы клавиш нужно сверить по локальному клону перед переносом. Логика и порядок действий — надёжнее, точные числа — менее.

---

## 1. Экран сценарного редактора

- **Раскладка.** Навигация всегда слева, рабочая область справа. [справка: navigation]
- **Левая панель.** Дерево проекта: документы, папки, сериал, вкладки проекта (общая информация, локации, персонажи, серии). Внутри документа — уровень «Сценарий», разворачивается стрелкой в список сцен. Сцены переставляются перетаскиванием, текст меняется синхронно. [справка: navigation]
- **Виды документа.** Переключатель в верхнем левом углу: стандартный текст, карточки, таймлайн, разбор сцен (script breakdown). Изменения синхронизированы между видами. [справка: navigation]
- **Верхняя панель.** Выбор типа текущего абзаца («Тип текста») и значок изоляции сцены. [справка: double-dialogue, scene-isolation]
- **Правая часть.** Панель правок и комментариев в режиме рецензирования. [справка: review-mode]
- **Счётчики.** Виджет сессионной статистики: `src/core/ui/session_statistics/counter_widget.cpp`. Состав счётчика на экране редактора [не нашёл].
- **Полоса прокрутки.** Модуль `src/corelib/ui/modules/text_scrollbar_manager/screenplay_text_scrollbar_manager.cpp`. Что он показывает (вероятно, метки сцен), [не проверено].
- **Панель быстрого форматирования.** Для сценария отдельный файл не найден [не нашёл]. Для stageplay есть `stageplay_text_edit_toolbar.cpp`; по аналогии, но не подтверждено.
- **Скрыто или опционально.** Изоляция сцены (включается значком), режим рецензирования, сессионная статистика.

Исходник редактора сценария: `src/core/management_layer/plugins/screenplay_text/text/screenplay_text_edit.cpp`. Структура сцен: `src/core/management_layer/plugins/screenplay_text_structure/` — прямого подтверждения пути нет [вывод по аналогии с stageplay].

---

## 2. Типы абзацев сценария

Перечень в программе — `enum class TextParagraphType` в `src/corelib/business_layer/templates/text_template.h`. Всего там около 40 значений, но для сценария используются 17 блоков шаблона (ниже). Остальные (комикс, роман, титры и т.д.) сценарием не используются. [код: text_template.h]

Русские названия взяты из задания. Сверку с файлами переводов (.ts) я не делала [не проверено]. Соответствие английских идентификаторов и русских названий — [вывод].

Горячие клавиши по умолчанию — из `src/corelib/data_layer/storage/settings_storage.cpp`. На Mac Ctrl означает Cmd. [справка: double-dialogue: «Ctrl (or Cmd)»]

| # | Название (задание) | Идентификатор | Клавиша | Вид в US Letter (Courier Prime 12) | Вид в RU A4 (Courier New 12) |
|---|---|---|---|---|---|
| 1 | Неформатируемый текст | UnformattedText | Ctrl+0 | без отступов, без CAPS | то же |
| 2 | Заголовок сцены | SceneHeading | Ctrl+1 | CAPS, **жирный**, 2 строки до | CAPS, не жирный, 1 строка до |
| 3 | Заголовок бита | BeatHeading | Ctrl+Shift+1 | без отступов, 1 строка до | то же |
| 4 | Персонажи сцены | SceneCharacters | Ctrl+2 | CAPS, без отступов | CAPS, без отступов |
| 5 | Описание действия | Action | Ctrl+3 | без отступов, 1 строка до | то же |
| 6 | Персонаж | Character | Ctrl+4 | CAPS, отступ слева 50.8 мм, 1 строка до | CAPS, отступ слева 67.5 мм, 1 строка до |
| 7 | Ремарка | Parenthetical | Ctrl+5 | слева 38.1 мм, справа 38.1 мм | слева 55 мм, справа 45 мм |
| 8 | Реплика | Dialogue | Ctrl+6 | слева 25.4 мм, справа 38.1 мм | слева 37.5 мм, справа 37.5 мм |
| 9 | Текст песни | Lyrics | Ctrl+7 | слева 25.4 мм, справа 38.1 мм, курсив | слева 37.5 мм, курсив |
| 10 | Переход | Transition | Ctrl+9 | CAPS, по правому краю, 1 строка до | CAPS, по правому краю, 1 строка до |
| 11 | Кадр | Shot | Ctrl+8 | CAPS, 1 строка до | CAPS, 1 строка до |
| 12 | Заметка | InlineNote | Ctrl+Shift+0 | слева 63.5 мм, курсив, 1 строка до | слева 67.5 мм, 1 строка до |
| 13 | Заголовок секвенции (папки) | SequenceHeading | Ctrl+Space | CAPS, 2 строки до | CAPS, 1 строка до |
| 14 | Конец секвенции | SequenceFooter | [не нашёл] | CAPS, 1 строка до | CAPS, 1 строка до |
| 15 | Заголовок акта | ActHeading | Ctrl+Shift+Space | CAPS, по центру, подчёркнут, 2 строки до, с новой страницы | CAPS, по центру, подчёркнут, 1 строка до |
| 16 | Конец акта | ActFooter | [не нашёл] | CAPS, по центру, подчёркнут, 1 строка до | то же |
| 17 | Разделитель страниц | PageSplitter | — | выключен (`active="false"`) | выключен |

Источники: [код: src/corelib/templates/screenplay/us] (US Letter), [код: src/corelib/templates/screenplay/ru] (RU A4), [код: src/corelib/business_layer/templates/screenplay_template.cpp] (названия шаблонов). Отступы — в мм, порядок полей «слева, сверху, справа, снизу» — [вывод] для US (сходится с шаблоном Final Draft), для RU не подтверждено.

**Замечания.**
- Заголовок сцены и персонаж: CAPS задаётся шаблоном, пользователь вводит строчными. [код: шаблоны]
- Отступ «только для половины страницы» (`margins_on_half_page`) задан отдельно: для Character в US 25.4 мм, в RU 33 мм. Используется для двойной реплики. [код: шаблоны]
- Шаблон «Final Draft» по имени в коде [не нашёл]. Ближайший аналог — `us` («US template (page: Letter; font: Courier Prime)»). [код: screenplay_template.cpp]

---

## 3. Таблица переходов клавиш

### 3.1. Механика

В редакторе два режима смены типа [код: src/core/management_layer/content/... через `ShortcutsHelper`, ключи настроек]:

- **jumping** («переход к следующему»): Enter или Tab в конце текста создаёт новый абзац с новым типом.
- **changing** («смена типа»): Enter или Tab в **пустом** абзаце меняет тип текущего абзаца, новый не создаётся.

Ключи настроек: `<модуль>/styles-jumping/from-<тип>-by-tab|enter` и `<модуль>/styles-changing/from-<тип>-by-tab|enter`. [код: src/corelib/utils/helpers/shortcuts_helper.cpp]

### 3.2. Значения по умолчанию — переходы

Источник: [код: src/corelib/data_layer/storage/settings_storage.cpp]. Колонки: «jump Tab» — переход по Tab в конце текста; «jump Enter» — то же по Enter; «change Tab» / «change Enter» — смена типа в пустом абзаце.

| Из (тип) | jump Tab | jump Enter | change Tab | change Enter |
|---|---|---|---|---|
| UnformattedText | UnformattedText | UnformattedText | UnformattedText | UnformattedText |
| SceneHeading | SceneCharacters | Action | Action | SceneHeading |
| SceneCharacters | Action | Action | Action | Action |
| BeatHeading | Action | Action | Action | Action |
| Action | Character | Action | Character | SceneHeading |
| Character | Parenthetical | Dialogue | Action | Action |
| Parenthetical | Dialogue | Dialogue | Dialogue | Parenthetical |
| Dialogue | Parenthetical | Action | Parenthetical | Action |
| Lyrics | Parenthetical | Action | Parenthetical | Action |
| Transition | SceneHeading | SceneHeading | Action | Transition |
| Shot | Action | Action | Action | Shot |
| InlineNote | Action | Action | InlineNote | InlineNote |
| SequenceHeading | SceneHeading | SceneHeading | SceneHeading | ActHeading |
| ActHeading | SequenceHeading | SceneHeading | SequenceHeading | ActHeading |

Для SequenceFooter и ActFooter значений в этом наборе [не нашёл].

### 3.3. Поведение по коду (обработчики)

Обработчики: `src/core/management_layer/plugins/screenplay_text/text/handlers/*.cpp`. Диспетчер: `key_press_handler_facade.cpp`, соответствие «тип → обработчик» подтверждено.

Для каждого типа: Enter/Tab в конце непустого абзаца, Enter/Tab в пустом, и особые случаи. Если в колонке стоит «по умолч.», значение взято из таблицы 3.2 (код вызывает jump/change-функции, а не конкретный тип).

| Тип | Enter, конец текста | Enter, пустой | Tab, конец текста | Tab, пустой | Особое |
|---|---|---|---|---|---|
| **Заголовок сцены** | jump Enter → Action | change Enter → SceneHeading | в поле «место»: вставляет « - ». В остальных полях: jump Tab → SceneCharacters | change Tab → Action | Enter в начале непустого абзаца вставляет новый заголовок **перед** текущим. Enter при открытом автодополнении принимает вариант. |
| **Персонажи сцены** | по умолч.: Action | по умолч.: Action | по умолч.: Action | по умолч.: Action | обработчик `scene_characters_handler.cpp` не читан [не проверено] |
| **Описание действия** | jump Enter → Action | change Enter → SceneHeading | jump Tab → Character | change Tab → Character | Enter, если весь текст до курсора — известное имя персонажа: блок становится Character, следом создаётся Dialogue. Tab в начале непустого абзаца → Character. Ввод «.» после INT/EXT → SceneHeading. Ввод «:» после перехода → Transition. |
| **Персонаж** | jump Enter → Dialogue | change Enter → Action | jump Tab → Parenthetical | change Tab → Action | Enter в начале непустого абзаца — новый Character выше. Enter в середине текста → Dialogue. Enter в поле «Имя» при открытом автодополнении → Dialogue. Расширение (V.O. и т.п.) — ввод «)» закрывает скобку, новый абзац не создаётся. |
| **Ремарка** | jump Enter → Dialogue | change Enter → Parenthetical | jump Tab → Dialogue | change Tab → Dialogue | Ввод «(» удаляется: скобки задаёт стиль (prefix/postfix). Ввод «)» в конце непустого абзаца → Dialogue. Enter в начале — ничего. |
| **Реплика** | jump Enter → Action | change Enter → Action | jump Tab → Parenthetical | change Tab → Parenthetical | Enter в середине реплики: назад находится блок Character, создаётся новый Character с тем же именем, затем Dialogue (продолжение реплики). Tab в середине: создаются две реплики, курсор переходит на предыдущую и она становится Parenthetical. |
| **Текст песни** | по умолч.: Action | по умолч.: Action | по умолч.: Parenthetical | по умолч.: Parenthetical | обработчик `lyrics_handler.cpp` не читан [не проверено] |
| **Переход** | jump Enter → SceneHeading | change Enter → Transition | jump Tab → SceneHeading | change Tab → Action | Enter в начале непустого — новый Transition выше. Enter в середине → SceneHeading. Автодополнение: Enter принимает и переходит на следующий абзац; Tab только принимает и остаётся в абзаце. |
| **Кадр** | jump Enter → Action | change Enter → Shot | jump Tab → Action | change Tab → Action | Enter в середине → Action. Автодополнение нет (`shot_handler.cpp` только проверяет открытость списка). |
| **Заметка** | по умолч.: Action | по умолч.: InlineNote | по умолч.: Action | по умолч.: InlineNote | `inline_note_handler.cpp` не читан [не проверено] |
| **Заголовок секвенции** | по умолч.: SceneHeading | по умолч.: ActHeading | по умолч.: SceneHeading | по умолч.: SceneHeading | `sequence_heading_handler.cpp` не читан [не проверено] |
| **Заголовок акта** | по умолч.: SceneHeading | по умолч.: ActHeading | по умолч.: SequenceHeading | по умолч.: SequenceHeading | `act_heading_handler.cpp` не читан [не проверено] |
| **Неформатируемый текст** | по умолч.: остаётся | по умолч.: остаётся | по умолч.: остаётся | по умолч.: остаётся | `unformatted_text_handler.cpp` не читан [не проверено] |
| **Разделитель страниц** | — | — | Стрелка вниз в конце → Action | — | `splitter_handler.h` |

### 3.4. Shift+Tab, Backspace, Delete

- **Shift+Tab.** В прочитанных обработчиках обработки не найдено [не нашёл]. Поведение по умолчанию (стандартный редактор) не проверено.
- **Backspace в начале абзаца.** В `standard_key_handler.cpp` смена типа не происходит. Если предыдущий абзац невидим (режим изоляции), курсор переходит к ближайшему видимому. Фактическое слияние или удаление делает `BusinessLayer::TextCursor::removeCharacters` — файл не читан [не нашёл]. Тип результирующего абзаца в прочитанном коде не определяется.
- **Delete в конце абзаца.** Симметрично Backspace, та же функция [вывод].
- **Ctrl+D.** Справка: «Split Paragraph», Ctrl+D; слияние — контекстное меню «Merge Paragraph». [справка: double-dialogue] В коде горячей клавиши Ctrl+D для сценария не найдено [не нашёл].
- **Вверх/вниз, PageUp/PageDown.** PageUp/PageDown = 20 шагов вверх/вниз. [код: standard_key_handler.cpp]

### 3.5. Горячие клавиши смены типа (по умолчанию)

[код: src/corelib/data_layer/storage/settings_storage.cpp; применяются в `src/core/management_layer/plugins/screenplay_text/text/screenplay_text_edit_shortcuts_manager.cpp`]

| Клавиша | Тип |
|---|---|
| Ctrl+0 | Неформатируемый текст |
| Ctrl+1 | Заголовок сцены |
| Ctrl+Shift+1 | Заголовок бита |
| Ctrl+2 | Персонажи сцены |
| Ctrl+3 | Описание действия |
| Ctrl+4 | Персонаж |
| Ctrl+5 | Ремарка |
| Ctrl+6 | Реплика |
| Ctrl+7 | Текст песни |
| Ctrl+8 | Кадр |
| Ctrl+9 | Переход |
| Ctrl+Shift+0 | Заметка |
| Ctrl+Space | Заголовок секвенции |
| Ctrl+Shift+Space | Заголовок акта |

---

## 4. Автодополнение

Движок: `src/corelib/ui/widgets/text_edit/completer/completer.cpp`, `completer_text_edit.cpp`. Источники: `src/corelib/business_layer/model/screenplay/screenplay_dictionaries_model.cpp`.

### 4.1. Заголовок сцены

- **Префикс (INT./EXT.).** Список: `INT.`, `EXT.`, `INT./EXT.`, `EXT./INT.`. Совпадение по началу строки. [код: scene_heading_handler.cpp, dictionaries]
- **Место (локация).** Без текста — весь список локаций документа. С текстом — локации, содержащие введённое; сначала совпадения по началу, остальные по алфавиту. [код: scene_heading_handler.cpp]
- **Время суток.** Список по умолчанию: `DAY`, `NIGHT`, `MORNING`, `AFTERNOON`, `EVENING`, `LATER`, `MOMENTS LATER`, `CONTINUOUS`, `THE NEXT DAY`. Если введённый текст совпадает с началом сохранённой локации — показывается список локаций, иначе список времени. [код: screenplay_dictionaries_model.cpp, scene_heading_handler.cpp]
- **Разделители.** Tab в конце поля «место»: при ` -` вставляет пробел, при пробеле — `- `, иначе ` - `. [код: scene_heading_handler.cpp]
- **Формат.** `[МЕСТО]. [ЛОКАЦИЯ] - [ВРЕМЯ]`. [код: screenplay_text_block_parser.h]
- **Принятие.** Enter или Tab. Enter в поле времени сохраняет параметры сцены и создаёт абзац Action. [код: scene_heading_handler.cpp]

### 4.2. Имя персонажа

Порядок источников [код: character_handler.cpp]:
1. Персонажи из предыдущих абзацев текущей сцены (до ближайшего заголовка сцены), второе уникальное имя ставится первым.
2. Блок «Персонажи сцены» (SceneCharacters).
3. Все персонажи проекта (`editor()->characters()`).

Фильтр — по введённой части имени. Расширения (после имени): `V.O.`, `O.S.`, `O.C.`, `SUBTITLE`, `CONT'D`. [код: screenplay_dictionaries_model.cpp] Формат: `[ИМЯ ПЕРСОНАЖА] ([СОСТОЯНИЕ])`. [код: screenplay_text_block_parser.h]

Принятие — Enter или Tab. Новое имя сохраняется в проект (`createCharacter`), новое расширение — в словарь. [код: character_handler.cpp]

### 4.3. Переход

Список по умолчанию: `CUT TO:`, `FADE IN:`, `FADE OUT`, `FADE TO:`, `DISSOLVE TO:`, `BACK TO:`, `MATCH CUT TO:`, `JUMP CUT TO:`, `FADE TO BLACK`. [код: screenplay_dictionaries_model.cpp] Все строки проходят через `tr()`, то есть переводятся по языку интерфейса. Введённые пользователем значения приводятся к верхнему регистру (`TextHelper::smartToUpper`).

Принятие: Enter — принять и перейти на следующий абзац; Tab — только принять. [код: transition_handler.cpp]

### 4.4. Что без автодополнения

Ремарка, кадр — автодополнения нет [код: parenthetical_handler.cpp, shot_handler.cpp].

---

## 5. Шаблоны оформления

### 5.1. Встроенные шаблоны

Папка `src/corelib/templates/screenplay/`: `ar`, `he`, `ru`, `tamil`, `telugu`, `us`, `world_cn`, `world_cp`. [код] Справка говорит «as many as 8» и называет International A4, American Letter, Russian, Arabic, Hebrew, Tamil, Telugu. [справка: document-templates] Соответствие:

| Файл | Страница | Шрифт | Название в коде / справке |
|---|---|---|---|
| `us` | Letter | Courier Prime 12 | «US template» / «American template» |
| `ru` | A4 | Courier New 12 | «Russian template» / «Russian template» |
| `world_cp` | A4 | Courier Prime 12 | [вывод] «International A4» |
| `world_cn` | — | — | [не нашёл] в справке; по имени — китайский шаблон [вывод] |
| `ar`, `he`, `tamil`, `telugu` | — | — | по справке, параметры не снимались |

### 5.2. Параметры страницы

- **Размер.** US — Letter. RU, World — A4.
- **Поля (мм).** US: 38.1 / 25.4 / 25.4 / 25.4 (порядок — [вывод] «слева, сверху, справа, снизу»). RU: 37.5 / 25 / 25 / 12.5. World_cp: 38 / 24 / 17 / 24.
- **Межстрочный.** Одинарный (`line_spacing_value="0"`) во всех трёх.
- **Номера страниц.** Сверху справа; первая страница без номера (US и RU).
- **Колонки.** Параметр есть (`Division of the page into columns`) [справка: custom-templates]. Значения в шаблонах [не нашёл].

### 5.3. Настройка своего шаблона

[справка: custom-templates]
- Меню (три полоски слева вверху) → «Application Settings» → «Components».
- У шаблона — три точки → «Create new template based on current».
- Настраиваемо: название, формат страницы, поля, положение номеров, колонки; титульная страница (порядок строк); шрифт, размер, «lettering» (капс — не определено в справке), межстрочный, отступы для заголовков, персонажа, ремарок, переходов.
- Сохранённый шаблон применяется ко всем сценариям. Для одного проекта — в настройках сценария (шестерёнка) включить «Override common settings for this screenplay».
- Место хранения шаблонов в файлах [не нашёл] в справке. Сам код: `src/corelib/business_layer/templates/screenplay_template.cpp`, `templates_facade.cpp`.

### 5.4. Пагинация и таймер «1 стр ≈ 1 мин»

- **Справка:** для American template с Letter «1 page approximately corresponds to 1 minute of screen time». [справка: document-templates]
- **Код, режим Page** [код: src/corelib/business_layer/chronometry/chronometer.cpp]: длительность блока = (высота текста / высота страницы) × секунд на страницу × 1.01. Высота текста учитывает строки, отступы блока, `linesBefore` и `linesAfter`, межстрочный (×1.5 и ×2.0 для полуторного и двойного, одинарный без множителя). Секунды на страницу — из опций, дефолт [не нашёл].
- **Счёт в восьмых страницы:** `PageEightCalculator` — высота текста / (высота страницы / 8) × 1.01. [код]
- **Другие режимы таймера:** по знакам (`CharactersChronometer`) и «Sophocles» (сцена, действие, реплика, песня — по своим секундам, тоже не читано по дефолтам). [код]

---

## 6. Проект и эпизоды

- **Сериал.** Каждая серия — отдельный документ типа «Сценарий» в одном проекте. Добавление: «+ Add Document» в нижней части левой панели, выбрать «Screenplay», назвать серию. [справка: create-a-series-project]
- **Сезоны.** Добавляется папка (тоже через «+ Add Document», но выбрать папку). Серии группируются: первая серия → Shift-клик на последней → перетащить в папку. [справка: create-a-series-project]
- **Другие документы.** В том же проекте можно добавить комикс, театр, аудиопостановку, роман. [справка: create-a-series-project]
- **Модули документа.** Сценарий, комикс, аудиопостановка, театр, роман. У каждого модуля есть части: титульный лист, синопсис, обработка (treatment), текст. [справка: start-writing]
- **Титульный лист.** Плагин `src/core/management_layer/plugins/title_page/`. По шаблону `ru`: поля название, автор, источник, год — по центру; контакты — справа. [код: templates/screenplay/ru, title_page/]
- **Логлайн.** Отдельного поля в справке и в найденных файлах [не нашёл].
- **Синопсис и обработка.** Есть как части документа (см. выше). Детали по ним не изучались.
- **Бит-план (beat sheet).** Биты создаются во вкладке «Treatment», Enter — следующий бит. У бита: альтернативное название, цвет, теги, сюжетный день. Видимость бита переключается в «Screenplay». [справка: beat-sheet]

---

## 7. Импорт и экспорт

### 7.1. Импорт [справка: screenplay-importing]

- **Форматы приложений:** KIT Scenarist, Final Draft, Celtx, Trelby.
- **Текстовые:** .txt, .odt, .docx, .fountain.
- **FDX и PDF как импорт в справке не названы.** Final Draft упомянут, FDX отдельно — нет [вывод].
- **Что сохраняется.** Справка утверждает «all the data ... successfully transferred» без уточнений по формату. Потери по формату — [не нашёл].
- **Выборочная загрузка** при импорте в существующий проект: можно выбрать части [справка].
- **Trelby.** Импорт сохранённого в формате Trelby проекта [справка: trelby]; при первом запуске можно выбрать «Adapt the interface and workflow». Что сохраняется — [не нашёл].
- **KIT Scenarist.** Импорт незавершённого скрипта, «all the data will be carefully transferred», процесс около 3 минут [справка: kitscenarist]. Перечня сохраняемых элементов [не нашёл].

Код: `src/corelib/business_layer/import/` (есть `text/simple_text_docx_importer.cpp`). Полный список импортёров не снимался.

### 7.2. Экспорт [справка: screenplay-exporting]

- **Форматы:** DOCX, PDF, FDX, Fountain.
- **Настройки:** выбрать части проекта; включить или исключить пометки рецензирования; подсветка персонажей и реплик; выборочные сцены по номерам.
- **PDF:** фиксированная версия, есть водяной знак [справка].
- **Титульная страница, номера сцен, ревизии — в каждом формате [не нашёл].**

Код: `src/corelib/business_layer/export/screenplay/screenplay_exporter.cpp`, диалог `src/core/ui/export/screenplay_export_dialog.cpp`.

---

## 8. Статистика текста

[справка: text-statistics] Формулы подсчёта страниц, слов и знаков в справке не даны. По коду страницы — через восьмые (см. 5.4). Слова и знаки в коде не читались [не нашёл].

Группы:

- **Сводка (стрелка рядом с «Statistics»):**
  - Хронометраж проекта.
  - Страницы, слова, знаки.
  - Соотношение описаний, реплик и прочего.
  - Сцены: сколько действия днём, ночью и т.д.
  - Локации: интерьер и экстерьер.
  - Персонажи: сколько с более чем 10 репликами, сколько с меньшим числом.
- **Отчёты (клик по названию):**
  - **Сцены.** Персонажи в каждой сцене и её длительность. Синий кружок отмечает первое появление персонажа.
  - **Локации.** Какие сцены используют каждую локацию и сколько времени.
  - **Состав (cast).** Сколько реплик у каждого персонажа и в каких сценах.
  - **Реплики.** Все реплики персонажа, включая ремарки. Фильтр по персонажу.
  - **Гендер и тест Бекдель.** Нужен пол персонажа в профиле. Индикатор: есть ли разговор двух именованных женщин не о мужчинах. Критерий оценки в справке не раскрыт.
  - **Структура.** График соотношения сцен, действия и реплик с числом персонажей.
  - **Активность персонажей.** Кто появляется в каких моментах сцены.
- **Сессия:** слова, написанные сегодня; самые продуктивные дни.

Код отчётов: `src/corelib/business_layer/reports/screenplay/` (cast, dialogues, gender, location, scene, summary) и `plots/screenplay/` (characters activity, structure analysis).

---

## 9. Чек-лист для «один к одному» (только редактор сценария)

Без карточек, карт, ИИ. Приоритеты: **P0** — без этого это не Story Architect; **P1** — важно, можно вторым заходом; **P2** — потом.

1. **P0. Набор из 17 типов** (таблица раздела 2). Для минимума: заголовок сцены, действие, персонаж, ремарка, реплика, переход, кадр, текст песни, неформатируемый текст, персонажи сцены.
2. **P0. Таблица jump/change по умолчанию** (3.2). Хранить как данные (настройки), не зашивать в код. Это позволит править переходы.
3. **P0. Enter и Tab по типам** (3.3): в конце текста — jump, в пустом абзаце — change. Включая разрыв реплики по Enter (дублирует имя персонажа) и Tab в реплике.
4. **P0. Заголовок сцены:** Tab в поле места вставляет « - »; Enter в начале вставляет новый заголовок выше.
5. **P0. Горячие клавиши смены типа** Ctrl+0..9, Ctrl+Shift+1, Ctrl+Shift+0, Ctrl+Space, Ctrl+Shift+Space (3.5). На Mac — Cmd.
6. **P0. Backspace и Delete на границе абзацев.** В коде не найдено правило смены типа при слиянии [не нашёл]. Решить самостоятельно и зафиксировать в спецификации.
7. **P0. Shift+Tab.** В коде не найдено [не нашёл]. Решить самостоятельно.
8. **P0. Автодополнение заголовка сцены:** префиксы INT./EXT./INT./EXT./EXT./INT., локации документа (сначала совпадения по началу, затем вхождение), список времени суток (9 значений по умолчанию).
9. **P0. Автодополнение персонажа:** порядок источников (предыдущие персонажи сцены, блок «Персонажи сцены», все персонажи проекта), фильтр по префиксу, расширения V.O./O.S./O.C./SUBTITLE/CONT'D.
10. **P0. Автодополнение перехода:** список по умолчанию, Enter принимает и переходит, Tab только принимает.
11. **P0. Автопереход по знакам:** «.» после INT/EXT → заголовок сцены; «:» после перехода → переход; имя известного персонажа + Enter → персонаж + реплика.
12. **P0. Ремарка без ручных скобок:** стиль задаёт обёртку, ввод «(» и «)» обрабатывается. Enter и Tab по таблице.
13. **P0. Шаблон US Letter** (Courier Prime 12, одинарный межстрочный, поля и отступы из раздела 2 и 5.2). Сверить единицы мм.
14. **P0. Шаблон RU A4** (Courier New 12, поля 37.5/25/25/12.5, отступы по таблице). Сверить единицы мм.
15. **P0. Пагинация и хронометраж:** высота блока с учётом строк и межстрочного, +1% запас, 1 страница ≈ 1 минута. Секунды на страницу — настраиваемые, по умолчанию 60.
16. **P0. Номера страниц** сверху справа, первая страница без номера.
17. **P1. Навигатор сцен слева** с перетаскиванием сцен (текст переставляется синхронно). Видов документа в объёме P1 не нужно: стандартный текст достаточно.
18. **P1. Изоляция сцены** (значок в верхней панели; видна только сцена с курсором; отдельный режим не требует других элементов).
19. **P1. Двойная реплика:** Ctrl+D — разделить абзац, контекстное меню «Merge Paragraph» — объединить.
20. **P1. Импорт и экспорт:** DOCX и Fountain, FDX и PDF; импорт Final Draft (FDX) — критично для рынка.
21. **P1. Титульная страница:** название, автор, источник, год (по центру), контакты справа.
22. **P1. Бит-план или структура** (если нужна в редакторе): биты как абзацы с цветом и видимостью. Отложить, если не нужно.
23. **P2. Статистика:** страницы, слова, персонажи, сцены. Отчёты по гендеру и Бекделю — отдельный модуль, в минимум не входит.
24. **P2. Пользовательские шаблоны** (клонирование и правка) и хранение шаблонов в файлах.
25. **P2. Рецензирование** (пометки, цвета, ответы) и экспорт пометок.

---

## 10. Не нашёл / не читал

- Shift+Tab — обработчика в прочитанных файлах нет.
- Фактическое слияние абзацев при Backspace и Delete (`TextCursor::removeCharacters`) — файл не читан.
- Обработчики `scene_characters`, `lyrics`, `inline_note`, `unformatted_text`, `sequence_heading`, `sequence_footer`, `act_heading`, `act_footer`, `beat_heading` — не читались. Для них даны только значения по умолчанию.
- Номера сцен (нумерация) — отдельно не искалось, в справке не описаны.
- Русские названия типов — из задания, по файлам переводов не сверено.
- Шаблон «Final Draft» в коде — не найден.
- Логлайн — не найден.
- Секунды на страницу по умолчанию — не найдены.
- Формулы подсчёта страниц, слов и знаков — не найдены.
- Что именно сохраняется при импорте и экспорте в каждом формате — не найдено.
- Русские версии справки (/ru/) — не сверялись.
- Точные переходы клавиш и числа снимались через WebFetch (пересказ модели). Перед переносом — проверить по клону (`git clone https://github.com/story-apps/starc`) и сверить значения в `settings_storage.cpp`, `text_template.h`, `screenplay_template.cpp`, шаблонах `src/corelib/templates/screenplay/*`.

## 11. Ключевые файлы

- Типы и enum: `src/corelib/business_layer/templates/text_template.h`
- Шаблоны сценария: `src/corelib/business_layer/templates/screenplay_template.cpp`, `src/corelib/templates/screenplay/{us,ru,world_cp,...}`
- Обработчики клавиш: `src/core/management_layer/plugins/screenplay_text/text/handlers/*.cpp`
- Диспетчер: `.../handlers/key_press_handler_facade.cpp`
- Горячие клавиши: `.../screenplay_text_edit_shortcuts_manager.cpp`, `src/corelib/utils/helpers/shortcuts_helper.cpp`
- Дефолты настроек (хоткеи, переходы): `src/corelib/data_layer/storage/settings_storage.cpp`
- Словари автодополнения: `src/corelib/business_layer/model/screenplay/screenplay_dictionaries_model.cpp`
- Таймер и страницы: `src/corelib/business_layer/chronometry/chronometer.cpp`
- Отчёты и графики: `src/corelib/business_layer/reports/screenplay/`, `src/corelib/business_layer/plots/screenplay/`
- Импорт и экспорт: `src/corelib/business_layer/import/`, `src/corelib/business_layer/export/screenplay/screenplay_exporter.cpp`
- Титульная страница: `src/core/management_layer/plugins/title_page/`
