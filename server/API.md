# Сервер хранения Neyra Vision · задача №15

`server/app.py` использует только стандартную библиотеку Python 3.9+. Он раздаёт
публичные страницы репозитория и хранит проекты через JSON API. Подключение
`studio/` и `scenariy/` к этому API — отдельная задача: их нынешнее поведение эта
реализация не меняет. Сервер не выполняет генерации и не проксирует
`/api/neyra` из существующего `scenariy/server.py`.

## Запуск и проверка

Из корня репозитория:

```sh
python3 server/app.py
python3 -m unittest discover -s server -p 'test_api.py' -v
```

Обычный запуск тестов открывает настоящий локальный TCP-сервер на свободном
порту. В песочнице Codex открытие TCP-порта запрещено; для неё есть режим:

```sh
NEYRA_TEST_TRANSPORT=inprocess python3 -m unittest discover -s server -p 'test_api.py' -v
```

Он передаёт HTTP-байты тому же обработчику внутри процесса. Это проверяет
маршруты, права и запись данных, но не доказывает, что сетевой порт можно открыть
в конкретном окружении. Сам сервер запускайте вне такой песочницы.

Адрес по умолчанию — `http://127.0.0.1:8770`. Параметры запуска:

```sh
python3 server/app.py --host 127.0.0.1 --port 8770 \
  --data-dir server/data \
  --keys-file ~/.config/neyra-studio/keys.json
```

Перед запуском оператор создаёт конфигурацию вне репозитория на основе
`server/keys.example.json`. Все поля `key` в примере намеренно пусты: сервер
отклоняет такой файл при запуске. Заполните их отдельными случайными секретами,
удалите ненужные записи и ограничьте `projects` и `sections`. Сам файл с
секретами и его копии в репозиторий не помещают.

```sh
mkdir -p ~/.config/neyra-studio
cp server/keys.example.json ~/.config/neyra-studio/keys.json
chmod 600 ~/.config/neyra-studio/keys.json
# Заполните key в этом внешнем файле перед запуском.
```

При указании собственного `--data-dir` не помещайте его в публичные папки
сайта. Данные по умолчанию лежат в `server/data/<slug>/project.json` и исключены
из git. На GitHub Pages этот Python-сервер не исполняется.

## Ключи, роли и разделы

Каждый запрос к `/api/` требует заголовок `X-Key`. Конфигурация ключей имеет
форму:

```json
{
  "keys": [
    {
      "id": "writer-local",
      "key": "",
      "role": "writer",
      "projects": ["demo"],
      "sections": ["overview", "script"]
    }
  ]
}
```

Это структура, а не рабочая конфигурация: `key` должен быть непустым секретом
из 1–512 печатных ASCII-символов без пробелов. ID и секреты уникальны.
`id` — открытый идентификатор ключа для ссылки из участника; секрет `key` API
не выдаёт. `projects` задаёт допустимые slug либо `["*"]` для всех проектов.
`sections: ["*"]` означает все разделы в пределах прав данной роли, а не
расширение её прав; в примере разделы перечислены явно.
Оператор создаёт новые ключи во внешнем файле; API участников принимает только
`keyId`, а поле `key` отклоняет.

Конфигурация строго проверяется при запуске и заново читается при каждом
API-запросе. Удаление ключа из неё отзывает доступ без перезапуска. Если файл
стал недоступен или невалиден, API возвращает 503 и не продолжает работу с
устаревшими правами. Значения ключей не попадают в журнал HTTP-запросов.

| Роль | Допустимые разделы | Запись |
|---|---|---|
| `admin` | `overview`, `script`, `storyboard`, `shots`, `animatic`, `team`, `post` | Да |
| `director` | Те же | Да |
| `producer` | Те же | Да |
| `writer` | `overview`, `script` | Да |
| `artist` | `overview`, `storyboard`, `shots` | Да |
| `editor` | `overview`, `animatic`, `post` | Да |
| `viewer` | Все, кроме `team` | Нет |

Доступ к существующему проекту — пересечение роли, `projects` и `sections`
из конфигурации с членством и разделами участника этого проекта. Одного
валидного ключа недостаточно для доступа к чужому проекту. `admin` может
работать без членства, но остаётся ограничен своей конфигурацией. Создавать
проекты могут `admin`, `director` и `producer`; создатель автоматически
становится участником. Управлять участниками могут эти роли с разделом `team`.
Имя автоматически созданного участника — «Создатель проекта»; реальное имя
можно вписать PATCH-запросом участника.
При создании или изменении участника роль должна совпасть с ролью `keyId` в
конфигурации; разделы не могут превышать права роли и этого ключа.

Раздел `overview` открывает метаданные проекта, `script` — черновик, версии и
сцены, `shots` — кадры, `team` — участников. Получение проекта возвращает только
метаданные: оно не раскрывает сценарий, кадры или команду обходом их прав.
Изменять метаданные могут только `admin`, `director`, `producer`. Роль `artist`
получает кадры с `sceneId`, но список сцен и их текст через этот контракт не
читает. Выбор сцен в клиенте потребует отдельного решения о доступе к их
идентификаторам и названиям.

Для примеров ниже введите ключ нужной роли и сохраните его в локальной
переменной оболочки:

```sh
read -r -s NEYRA_KEY
```

## Общие правила запросов и ответов

Базовый путь — `/api/projects`. Тело POST, PUT и PATCH — JSON-объект с
`Content-Type: application/json` и одним корректным `Content-Length`; chunked
`Transfer-Encoding` не поддерживается. Максимальный размер тела — 2 МиБ.
Неизвестные поля и неверные типы отклоняются. Повторяющиеся поля JSON, `NaN` и
`Infinity` не допускаются. Даты выдаются в UTC; идентификаторы и даты создаёт
сервер. Slug — 1–64 строчных латинских букв, цифр и дефисов, начинается и
заканчивается буквой или цифрой. ID — 1–80 латинских букв любого регистра,
цифр, дефисов и подчёркиваний, начинается буквой или цифрой. `/`, `..` и обход
путей недопустимы.

Успешный ответ:

```json
{"data":{"slug":"demo","title":"Рабочий проект"}}
```

Ответ списка:

```json
{"data":[],"pagination":{"offset":0,"limit":50,"total":0}}
```

Все списки поддерживают `?offset=0&limit=50`: `offset` — целое от нуля, `limit`
— целое от 1 до 200 (по умолчанию 50). `total` — число доступных элементов до
ограничения страницы. Список проектов содержит только проекты, доступные ключу
по разделу `overview`.

Успешные ответы конкретного проекта содержат `ETag: "<revision>"`. Любая его мутация
может принять `If-Match: "<revision>"`: устаревшая ревизия даёт
`409 REVISION_CONFLICT`, данные не меняются. Без `If-Match` запрос применяется
к последнему состоянию. POST создаёт новые записи; автоматический повтор такого
запроса может создать ещё одну версию или сущность. Ключей идемпотентности нет.

Пользовательские строки хранятся и после JSON-декодирования возвращаются
дословно. В HTTP JSON символы `<`, `>` и `&` экранируются как `\u003c`, `\u003e`,
`\u0026`; ответы имеют JSON MIME-тип. Клиент выводит строки через `textContent`
или экранирование текста, без подстановки в `innerHTML`. Это сохраняет Fountain
и исходный текст, включая русский и казахский.

Общие статусы кадров и сценария: `draft`, `working`, `review`, `approved`.
Поле `language` принимает `ru` или `kk`; смена этого поля не переводит текст.
При PUT без `status` черновик получает `draft`; без `language` сохраняет свой
нынешний язык. Язык в метаданных проекта и язык черновика после создания
изменяются независимо.

## Проекты

| Метод и путь | Назначение | Тело | Успех |
|---|---|---|---|
| `POST /api/projects` | Создать | `slug`, `title`; необязательно `synopsis`, `language` | 201 |
| `GET /api/projects` | Список доступных проектов | — | 200 |
| `GET /api/projects/<slug>` | Метаданные проекта | — | 200 |
| `PATCH /api/projects/<slug>` | Обновить метаданные | Любые из `title`, `synopsis`, `language` | 200 |

Метаданные: `slug`, `title`, `synopsis`, `language`, `createdAt`, `updatedAt`,
`revision`. `title` — непустая строка до 240 символов, `synopsis` — строка до
8000 символов; язык по умолчанию `ru`. Slug после создания не меняется.

```sh
curl -i -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"slug":"demo","title":"Рабочий проект","language":"ru"}' \
  http://127.0.0.1:8770/api/projects
curl -H "X-Key: $NEYRA_KEY" 'http://127.0.0.1:8770/api/projects?offset=0&limit=20'
curl -i -H "X-Key: $NEYRA_KEY" http://127.0.0.1:8770/api/projects/demo
curl -X PATCH -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"synopsis":"Замысел проекта"}' \
  http://127.0.0.1:8770/api/projects/demo
```

## Черновик и версии сценария

| Метод и путь | Назначение | Тело | Успех |
|---|---|---|---|
| `GET /api/projects/<slug>/script` | Текущий черновик | — | 200 |
| `PUT /api/projects/<slug>/script` | Заменить текст черновика | `text`; необязательно `language`, `status` | 200 |
| `POST /api/projects/<slug>/versions` | Зафиксировать черновик и сцены | Необязательно `label` | 201 |
| `GET /api/projects/<slug>/versions` | Список версий | — | 200 |
| `GET /api/projects/<slug>/versions/<id>` | Получить версию | — | 200 |
| `POST /api/projects/<slug>/versions/<id>/restore` | Восстановить версию, сохранить текущий черновик | `{}` | 201 |

`text` — строка Fountain или обычного текста до 1 000 000 символов. Пустой текст
допустим. Черновик
имеет `text`, `language`, `status`, `updatedAt`; новая версия фиксирует объект
`script` с этими полями и массив
`scenes`. Поля версии: `id` (UUID без дефисов), `number` (последовательный номер),
`kind` (`saved`, `backup`, `restored`), `label`, `script`,
`scenes`, `createdAt`, `createdBy`; у восстановленной версии есть
`sourceVersionId`. `label` — строка до 240 символов. Список версий выдаёт только
метаданные, без `script` и `scenes`; полные снимки возвращаются при создании
версии и запросе конкретного ID.

При восстановлении одна атомарная запись сохраняет текущий черновик со сценами
в версии `backup`, создаёт версию `restored` из выбранной и заменяет черновик
со сценами. Восстановленный черновик получает статус `draft` и актуальный
`updatedAt`, даже если у исходной версии был другой статус. Старые версии
остаются. Ответ:

```json
{
  "data": {
    "script": {"text":"...","language":"ru","status":"draft"},
    "backupVersionId":"идентификатор резервной версии",
    "restoredVersionId":"идентификатор восстановленной версии"
  }
}
```

Изменение текста черновика помечает кадры `needsReview: true`. Восстановление также
оставляет все материалы кадров и помечает их для проверки. Если сцена кадра
отсутствует в восстановленной версии, кадр не удаляется: клиент должен показать
необходимость пересвязать его с актуальной сценой. Сохранение обычной версии
не меняет черновик.

```sh
curl -X PUT -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"text":"ИНТ. КОМНАТА — ДЕНЬ\n\nСцена начинается.","status":"draft"}' \
  http://127.0.0.1:8770/api/projects/demo/script
curl -H "X-Key: $NEYRA_KEY" http://127.0.0.1:8770/api/projects/demo/script
curl -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"label":"Перед правкой"}' \
  http://127.0.0.1:8770/api/projects/demo/versions
curl -H "X-Key: $NEYRA_KEY" http://127.0.0.1:8770/api/projects/demo/versions
# Подставьте id из ответа списка или создания версии.
NEYRA_VERSION_ID='id-из-ответа'
curl -H "X-Key: $NEYRA_KEY" \
  "http://127.0.0.1:8770/api/projects/demo/versions/$NEYRA_VERSION_ID"
curl -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' --data '{}' \
  "http://127.0.0.1:8770/api/projects/demo/versions/$NEYRA_VERSION_ID/restore"
```

## Сцены

| Метод и путь | Назначение | Тело | Успех |
|---|---|---|---|
| `GET /api/projects/<slug>/scenes` | Список | — | 200 |
| `POST /api/projects/<slug>/scenes` | Создать | `title`; необязательно `id`, `text` | 201 |
| `GET /api/projects/<slug>/scenes/<id>` | Получить | — | 200 |
| `PATCH /api/projects/<slug>/scenes/<id>` | Изменить | Любые из `title`, `text` | 200 |
| `DELETE /api/projects/<slug>/scenes/<id>` | Удалить | — | 200 |

`title` — непустая строка до 240 символов, `text` — строка до 1 000 000 символов
(по умолчанию пустая). Изменение
сцены помечает связанные кадры `needsReview: true`. Удаление сцены с кадрами
возвращает `409 SCENE_IN_USE`: сначала удалите либо пересвяжите кадры.
Сцены сохраняются явно; PUT сценария не разбивает текст на сцены автоматически.

```sh
curl -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"id":"scene-1","title":"Комната","text":"Начало сцены"}' \
  http://127.0.0.1:8770/api/projects/demo/scenes
curl -H "X-Key: $NEYRA_KEY" http://127.0.0.1:8770/api/projects/demo/scenes
curl -H "X-Key: $NEYRA_KEY" http://127.0.0.1:8770/api/projects/demo/scenes/scene-1
curl -X PATCH -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"text":"Обновлённая сцена"}' \
  http://127.0.0.1:8770/api/projects/demo/scenes/scene-1
curl -X DELETE -H "X-Key: $NEYRA_KEY" \
  http://127.0.0.1:8770/api/projects/demo/scenes/scene-1
```

Если далее создаёте кадры этой сцены, выполните пример DELETE после работы с
ними или создайте сцену снова.

## Кадры

| Метод и путь | Назначение | Тело | Успех |
|---|---|---|---|
| `GET /api/projects/<slug>/shots` | Список | — | 200 |
| `POST /api/projects/<slug>/shots` | Создать | `sceneId`, `title`; необязательные поля ниже | 201 |
| `GET /api/projects/<slug>/shots/<id>` | Получить | — | 200 |
| `PATCH /api/projects/<slug>/shots/<id>` | Изменить | Любые изменяемые поля ниже | 200 |
| `DELETE /api/projects/<slug>/shots/<id>` | Удалить | — | 200 |

`sceneId` должен ссылаться на существующую сцену, иначе ответ 404. `title` —
непустая строка до 240 символов.
Допустимы строки `description`, `prompt`, `owner`, `lens`, `movement`,
до 8000 символов; `imageUrl`, `videoUrl` — до 2048 символов. `duration` —
конечное число секунд больше 0 и не больше 3600 (по умолчанию 5); `status` —
`draft`, `working`, `review`, `approved` (по умолчанию `draft`).
При создании можно передать безопасный `id`; при PATCH он неизменяем.
`aspectRatio` сервер устанавливает в `16:9`, `needsReview` управляется сервером.
PATCH со статусом `approved` снимает `needsReview`. Поля `imageUrl` и `videoUrl`
содержат пустую строку, HTTP/HTTPS-ссылку или относительный путь; другие схемы и
ссылки вида `//host/path` отклоняются. Загрузки файлов и получения содержимого
по ссылке этим API нет.

```sh
curl -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"id":"shot-1","sceneId":"scene-1","title":"Общий план","description":"Комната","status":"draft","duration":4}' \
  http://127.0.0.1:8770/api/projects/demo/shots
curl -H "X-Key: $NEYRA_KEY" http://127.0.0.1:8770/api/projects/demo/shots
curl -H "X-Key: $NEYRA_KEY" http://127.0.0.1:8770/api/projects/demo/shots/shot-1
curl -X PATCH -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"status":"review"}' \
  http://127.0.0.1:8770/api/projects/demo/shots/shot-1
curl -X DELETE -H "X-Key: $NEYRA_KEY" \
  http://127.0.0.1:8770/api/projects/demo/shots/shot-1
```

## Участники

| Метод и путь | Назначение | Тело | Успех |
|---|---|---|---|
| `GET /api/projects/<slug>/members` | Список | — | 200 |
| `POST /api/projects/<slug>/members` | Добавить | `name`, `role`, `sections`, `keyId` | 201 |
| `GET /api/projects/<slug>/members/<id>` | Получить | — | 200 |
| `PATCH /api/projects/<slug>/members/<id>` | Изменить | Любые из `name`, `role`, `sections`, `keyId` | 200 |
| `DELETE /api/projects/<slug>/members/<id>` | Удалить доступ | — | 200 |

`name` — непустая строка до 240 символов, `sections` — непустой список явных
разделов без повторов (`*` здесь не принимается), `keyId` — ID из внешней
конфигурации. Секретов в ответах участников нет. Неизвестный `keyId`, другая
роль или раздел за пределами прав ключа дают `422 VALIDATION_ERROR`. Удаление
участника прекращает его доступ по членству; само значение ключа во внешнем
файле не удаляется. Повторная привязка того же `keyId` в одном проекте даёт 409.
DELETE сцены, кадра или участника возвращает `data: {"id":"...","deleted":true}`.

```sh
# Используйте ключ admin/director/producer; writer-local настройте вне репозитория.
curl -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"name":"Сценарист","role":"writer","sections":["overview","script"],"keyId":"writer-local"}' \
  http://127.0.0.1:8770/api/projects/demo/members
curl -H "X-Key: $NEYRA_KEY" http://127.0.0.1:8770/api/projects/demo/members
NEYRA_MEMBER_ID='id-из-ответа'
curl -H "X-Key: $NEYRA_KEY" \
  "http://127.0.0.1:8770/api/projects/demo/members/$NEYRA_MEMBER_ID"
curl -X PATCH -H "X-Key: $NEYRA_KEY" -H 'Content-Type: application/json' \
  --data '{"sections":["script"]}' \
  "http://127.0.0.1:8770/api/projects/demo/members/$NEYRA_MEMBER_ID"
curl -X DELETE -H "X-Key: $NEYRA_KEY" \
  "http://127.0.0.1:8770/api/projects/demo/members/$NEYRA_MEMBER_ID"
```

## Ошибки и гарантии хранения

Ошибки возвращаются JSON-объектом с HTTP-кодом ошибки:

```json
{"error":{"code":"FORBIDDEN","message":"Недостаточно прав"}}
```

| HTTP | `error.code` | Смысл |
|---|---|---|
| 400 | `INVALID_JSON`, `BAD_REQUEST` | Некорректный JSON или форма запроса |
| 401 | `UNAUTHORIZED` | Нет ключа или ключ неверен |
| 403 | `FORBIDDEN` | Нет права на проект, раздел или запись |
| 404 | `NOT_FOUND` | Нет маршрута, проекта или сущности |
| 405 | `METHOD_NOT_ALLOWED` | Метод не поддерживается маршрутом |
| 409 | `ALREADY_EXISTS` | Такой slug или ID уже существует |
| 409 | `REVISION_CONFLICT` | `If-Match` не совпадает с ревизией |
| 409 | `SCENE_IN_USE` | Сцену используют кадры |
| 413 | `PAYLOAD_TOO_LARGE` | Тело больше 2 МиБ |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Тело передано не как JSON |
| 422 | `VALIDATION_ERROR` | Некорректные поля, ссылки, роль или разделы |
| 500 | `STORAGE_READ_FAILED` | Не удалось прочитать состояние проекта |
| 500 | `STORAGE_WRITE_FAILED` | Не удалось записать состояние проекта |
| 500 | `IO_ERROR` | Ошибка ввода-вывода, в том числе при обработке HTTP |
| 500 | `INTERNAL_ERROR` | Внутренняя ошибка без выдачи деталей или трассировки |
| 503 | `KEYS_UNAVAILABLE` | Конфигурация ключей стала недоступной или неверной |

Каждый проект записывается одним JSON-файлом: временный файл в той же папке,
`fsync`, затем атомарная замена (`os.replace`). Внутрипроцессная блокировка
сериализует операции параллельных HTTP-потоков, включая проверку ревизии и
восстановление. При ошибке до замены старый файл остаётся целым и запрос
возвращает ошибку, а не 200. Фиксация резервной и восстановленной версий вместе
с черновиком не разбивается на отдельные записи.

Данные сохраняются после перезапуска. Поддерживается один процесс сервера на
один каталог данных; межпроцессной блокировки и совместного редактирования в
реальном времени нет.

Статика доступна без `X-Key` только из разрешённых публичных путей и типов
файлов: публичные корневые файлы, `assets/`, `studio/`, `scenariy/`, `p/`.
Разрешённые типы — HTML, CSS, JS/MJS, изображения, шрифты, видео и аудио;
разрешён и корневой `version.txt`. `server/`, скрытые файлы, `.git`, JSON,
исходники Python, Markdown и внешние
символьные ссылки не раздаются; списка содержимого папок нет. Конфигурация
ключей, данные и внутренние документы не выдаются HTTP-сервером.
