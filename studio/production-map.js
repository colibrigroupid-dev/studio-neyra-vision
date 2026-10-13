const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;').replaceAll('"', '&quot;');
const text = (locale, ru, kk) => locale === 'kk' ? kk : ru;
const translated = (value, locale) => typeof value === 'string' ? value : value?.[locale] || value?.ru || value?.kk || '';
const list = value => Array.isArray(value) ? value : [];
const objectKey = object => `${object?.type || ''}:${object?.id || ''}`;
const stageNames = {
  script: ['Сценарий', 'Сценарий'], breakdown: ['Разбивка', 'Сценарийді талдау'],
  heroes: ['Герои', 'Кейіпкерлер'], locations: ['Локации', 'Локациялар'],
  storyboard: ['Раскадровка', 'Кадрлық жоспар'], shots: ['Кадры', 'Кадрлар'],
  video: ['Видео', 'Видео'], sound: ['Звук', 'Дыбыс'], edit: ['Монтаж', 'Монтаж']
};
const statusNames = {
  empty: ['Не начато', 'Басталмаған'], working: ['В работе', 'Орындалуда'],
  done: ['Готово', 'Дайын'], awaiting: ['Ждёт решения', 'Шешім күтуде'],
  approved: ['Принято', 'Қабылданды'], returned: ['Возвращено', 'Қайтарылды']
};
const statusMarks = { empty: '○', working: '●', done: '✓', awaiting: '◇', approved: '◆', returned: '↩' };
const roleNames = {
  producer: ['Продюсер', 'Продюсер'], director: ['Режиссёр', 'Режиссер'],
  writer: ['Сценарист', 'Сценарист'], assistant_director: ['Второй режиссёр', 'Екінші режиссер'],
  cinematographer: ['Оператор', 'Оператор'], artist: ['Художник', 'Суретші'],
  editor: ['Монтажёр', 'Монтажшы'], viewer: ['Наблюдатель', 'Бақылаушы'], admin: ['Администратор', 'Әкімші']
};
const named = (dictionary, key, locale) => dictionary[key]?.[locale === 'kk' ? 1 : 0] || key || '—';
export const productionStageName = (stage, locale = 'ru') => named(stageNames, stage, locale);
const objectTypeName = (type, locale) => named({
  scene: ['Сцена', 'Көрініс'], shot: ['Кадр', 'Кадр'], teaser: ['Тизер', 'Тизер'],
  episode: ['Серия', 'Серия'], project: ['Проект', 'Жоба'], member: ['Участник', 'Қатысушы'],
  version: ['Версия', 'Нұсқа'], script: ['Сценарий', 'Сценарий'], post: ['Постпродакшен', 'Постпродакшн'],
  character: ['Герой', 'Кейіпкер'], location: ['Локация', 'Локация'], breakdown: ['Разбивка', 'Талдау'], assistant: ['Помощник', 'Көмекші']
}, type, locale);
function objectRecord(object, project) {
  const collection = object?.type === 'scene' ? project?.scenes : object?.type === 'shot' ? project?.shots : object?.type === 'character' ? project?.characters : object?.type === 'location' ? project?.locations : [];
  return list(collection).find(item => item.id === object?.id);
}
export function productionObjectLabel(object, project, locale = 'ru') {
  const record = objectRecord(object, project);
  const title = translated(record?.title, locale) || (typeof record?.name === 'string' ? record.name : '');
  // технический ULID не показываем: человеку нужны тип и имя
  const isUlid = /^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(object?.id || ''));
  return `${objectTypeName(object?.type, locale)}${title ? ` · ${title}` : (object?.id && !isUlid ? ` · ${object.id}` : '')}`;
}
function dateLabel(value, locale, dateOnly = false) {
  if (!value) return '—';
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const date = new Date(isDate ? `${value}T00:00:00` : value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
  if (!dateOnly && !isDate) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', options);
}
function authorName(item, project, locale) {
  return item.name || list(project?.members).find(member => member.keyId === item.keyId)?.name || item.keyId || text(locale, 'Автор не указан', 'Автор көрсетілмеген');
}
function newestFirst(items) {
  return list(items).map((item, index) => ({ item, index })).sort((a, b) => {
    // Activity sequence records append order even if the server clock changes.
    if (Number.isSafeInteger(a.item.sequence) && Number.isSafeInteger(b.item.sequence) && a.item.sequence !== b.item.sequence) return b.item.sequence - a.item.sequence;
    const delta = Date.parse(b.item.createdAt) - Date.parse(a.item.createdAt);
    return (Number.isFinite(delta) && delta) || (Number(b.item.sequence) - Number(a.item.sequence)) || b.index - a.index;
  }).map(({ item }) => item);
}
const ids = items => new Set(list(items).map(item => typeof item === 'string' ? item : item?.id).filter(Boolean));
function cellStatus(cell, locale) {
  const status = Object.hasOwn(statusNames, cell?.status) ? cell.status : 'empty';
  return `<span class='map-status map-status-${status}' data-status='${status}'><span aria-hidden='true'>${statusMarks[status]}</span>${escape(named(statusNames, status, locale))}</span>`;
}
function renderGrid(map, project, locale, filter) {
  const stages = list(map.stages);
  const selected = filter === 'mine' ? ids(map.myTasks) : filter === 'awaiting' ? ids(map.awaitingMe) : null;
  const grid = new Map(list(map.grid).map(row => [objectKey(row.object), row]));
  const rows = list(map.objects).map(object => grid.get(objectKey(object)) || { object, stages: {} })
    .filter(row => !selected || stages.some(stage => selected.has(row.stages?.[stage]?.id)));
  if (!rows.length || !stages.length) return `<div class='map-state' role='status'><p>${filter === 'mine' ? text(locale, 'У вас пока нет назначенных задач.', 'Сізге әзірге тапсырма тағайындалмаған.') : filter === 'awaiting' ? text(locale, 'Сейчас ничто не ждёт вашего решения.', 'Қазір сіздің шешіміңізді күтетін тапсырма жоқ.') : text(locale, 'Карта заполнится, когда появятся сцены.', 'Жобада картаға арналған нысандар әзірге жоқ.')}</p></div>`;
  return `<p class='map-scroll-hint'>${text(locale, 'Таблицу можно листать вправо.', 'Барлық кезеңді көру үшін кестені оңға жылжытыңыз.')}</p>
    <div class='production-map-scroll' role='region' tabindex='0' aria-label='${text(locale, 'Карта производства', 'Өндіріс картасы: нысандар мен кезеңдер')}'>
      <table class='production-map-table'><caption>${text(locale, 'Сцены и этапы', 'Жоба нысандары × өндіріс кезеңдері')}</caption>
      <thead><tr><th scope='col'>${text(locale, 'Объект', 'Нысан')}</th>${stages.map(stage => `<th scope='col'>${escape(productionStageName(stage, locale))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row => {
        const title = translated(objectRecord(row.object, project)?.title, locale);
        return `<tr><th scope='row'><div class='map-object-name'>${escape(title || objectTypeName(row.object?.type, locale))}</div><span class='map-object-id'>${escape(row.object?.id || '—')}</span></th>${stages.map(stage => {
          const cell = row.stages?.[stage];
          if (selected && !selected.has(cell?.id)) return `<td><span class='map-unselected' aria-label='${text(locale, 'Не входит в выбранный список', 'Таңдалған тізімге кірмейді')}'>—</span></td>`;
          if (!cell?.id) return `<td><span class='map-empty'>${cellStatus(null, locale)}</span></td>`;
          const label = `${productionObjectLabel(row.object, project, locale)} · ${productionStageName(stage, locale)} · ${named(statusNames, cell.status, locale)}`;
          return `<td><button type='button' class='map-cell' data-map-cell='${escape(cell.id)}' aria-label='${escape(label)}'>${cellStatus(cell, locale)}<span class='map-cell-assignee'>${escape(cell.assignee?.name || text(locale, 'Не назначен', 'Тағайындалмаған'))}</span></button></td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table>
    </div>`;
}
function actionLabel(action, locale) {
  const approvals = { 'approval.approved': ['Принял результат', 'Нәтижені қабылдады'], 'approval.returned': ['Вернул на доработку', 'Түзетуге қайтарды'], 'version.restored': ['Восстановил версию', 'Нұсқаны қалпына келтірді'] };
  if (approvals[action]) return named(approvals, action, locale);
  const [type, verb] = String(action || '').split('.');
  const verbs = { created: ['Создал', 'Жасады'], updated: ['Обновил', 'Жаңартты'], deleted: ['Удалил', 'Жойды'] };
  const target = type === 'cell' ? text(locale, 'задачу', 'тапсырманы') : objectTypeName(type, locale).toLocaleLowerCase();
  return verbs[verb] ? `${named(verbs, verb, locale)} ${target}` : action || text(locale, 'Операция', 'Операция');
}
function versionLabel(item, locale) {
  return [item.version ? `${text(locale, 'Версия', 'Нұсқа')}: ${item.version}` : '', item.variant ? `${text(locale, 'Вариант', 'Нұсқаның түрі')}: ${item.variant}` : ''].filter(Boolean).join(' · ');
}
function renderActivity(activity, project, locale) {
  return `<aside class='map-activity' aria-labelledby='map-activity-title'><h2 id='map-activity-title'>${text(locale, 'Что происходило', 'Операциялар таспасы')}</h2>${list(activity).length ? `<ol>${newestFirst(activity).map(item => `<li><div class='map-activity-byline'><strong>${escape(authorName(item, project, locale))}</strong><time datetime='${escape(item.createdAt || '')}'>${escape(dateLabel(item.createdAt, locale))}</time></div><p>${escape(actionLabel(item.action, locale))}</p><p class='map-activity-target'>${escape(productionObjectLabel(item.object, project, locale))}${item.stage ? ` · ${escape(productionStageName(item.stage, locale))}` : ''}</p>${versionLabel(item, locale) ? `<p class='map-activity-version'>${escape(versionLabel(item, locale))}</p>` : ''}</li>`).join('')}</ol>` : `<p>${text(locale, 'Пока тихо: операций не было.', 'Операциялар әзірге жоқ.')}</p>`}</aside>`;
}
export function renderProductionMap({ map, project, locale = 'ru', filter = 'all', activity = [], approvals = [], loading = false, error = '', mode = 'graphite' } = {}) {
  const currentFilter = ['all', 'mine', 'awaiting'].includes(filter) ? filter : 'all';
  const currentMode = mode === 'light' ? 'light' : 'graphite';
  const filters = [['all', text(locale, 'Вся карта', 'Бүкіл карта')], ['mine', `${text(locale, 'Мои задачи', 'Менің тапсырмаларым')} · ${ids(map?.myTasks).size}`], ['awaiting', `${text(locale, 'Ждёт меня', 'Мені күтуде')} · ${ids(map?.awaitingMe).size}`]];
  let state = '';
  if (error) state = `<div class='map-state map-error' role='alert'><p>${text(locale, 'Карта не загрузилась. Попробуйте обновить.', 'Картаны жүктеу мүмкін болмады.')}</p><p>${escape(error)}</p></div>`;
  else if (loading) state = `<div class='map-state' role='status'><p>${text(locale, 'Открываем карту…', 'Өндіріс картасы жүктелуде…')}</p></div>`;
  else if (!map) state = `<div class='map-state' role='status'><p>${text(locale, 'Подключите сервер проекта, чтобы открыть карту производства.', 'Өндіріс картасын ашу үшін жоба серверіне қосылыңыз.')}</p><button type='button' class='btn' data-action='server'>${text(locale, 'Подключить сервер', 'Серверге қосылу')}</button></div>`;
  return `<section class='production-map' data-map-mode='${currentMode}' aria-busy='${Boolean(loading)}'>
    <div class='page-heading'><div><h1>${text(locale, 'Карта производства', 'Өндіріс картасы')}</h1><p>${text(locale, 'Кто за что отвечает и на каком этапе каждая сцена.', 'Нысандар мен кезеңдер, команданың міндеттері мен шешімдері.')}</p></div><button type='button' class='btn' data-action='refresh-map' ${loading || !map && !error ? 'disabled' : ''}>${text(locale, 'Обновить', 'Жаңарту')}</button></div>
    <div class='map-toolbar'><div class='map-filters' role='group' aria-label='${text(locale, 'Задачи на карте', 'Картадағы тапсырмалар')}'>${filters.map(([value, label]) => `<button type='button' class='btn ${currentFilter === value ? 'active' : ''}' data-map-filter='${value}' aria-pressed='${currentFilter === value}' ${!map ? 'disabled' : ''}>${escape(label)}</button>`).join('')}</div><label class='map-mode-control' for='production-map-mode'>${text(locale, 'Режим', 'Режим')}<select id='production-map-mode' data-map-mode><option value='graphite' ${currentMode === 'graphite' ? 'selected' : ''}>${text(locale, 'Графитовый', 'Графит')}</option><option value='light' ${currentMode === 'light' ? 'selected' : ''}>${text(locale, 'Бумажный', 'Қағаз')}</option></select></label></div>
    ${state}${!state ? `<div class='map-layout'><div class='map-grid-panel'>${renderGrid(map, project, locale, currentFilter)}</div>${renderActivity(activity, project, locale)}</div>` : ''}
  </section>`;
}
function field(label, value) { return `<div><dt>${escape(label)}</dt><dd>${escape(value || '—')}</dd></div>`; }
export function renderProductionCell({ cell, map, project, locale = 'ru', approvals = [], canApprove = false } = {}) {
  if (!cell) return `<div class='map-state' role='status'><p>${text(locale, 'Эту задачу уже изменили. Обновите карту.', 'Ұяшық енді қолжетімді емес. Картаны жаңартыңыз.')}</p></div>`;
  const history = newestFirst(list(approvals).filter(approval => approval.cellId === cell.id));
  const actionable = canApprove && cell.status === 'awaiting' && Boolean(String(cell.version || '').trim() || String(cell.variant || '').trim());
  return `<div class='map-cell-detail'>${cellStatus(cell, locale)}<p class='map-cell-object'>${escape(productionObjectLabel(cell.object, project, locale))} · ${escape(productionStageName(cell.stage, locale))}</p>
    <dl class='map-cell-fields'>${field(text(locale, 'Исполнитель', 'Орындаушы'), cell.assignee?.name || text(locale, 'Не назначен', 'Тағайындалмаған'))}${field(text(locale, 'Принимает', 'Қабылдайтын рөл'), named(roleNames, cell.approverRole, locale))}${field(text(locale, 'Срок', 'Мерзім'), cell.dueAt ? dateLabel(cell.dueAt, locale) : text(locale, 'Не указан', 'Көрсетілмеген'))}${field(text(locale, 'Версия', 'Нұсқа'), cell.version)}${field(text(locale, 'Вариант', 'Нұсқаның түрі'), cell.variant)}</dl>
    <h3>${text(locale, 'Комментарий к задаче', 'Тапсырмаға пікір')}</h3><p class='map-comment'>${escape(cell.comment || text(locale, 'Без комментария.', 'Пікір жоқ.'))}</p>
    ${actionable ? `<form id='map-approval-form' data-cell-id='${escape(cell.id)}'><label for='map-approval-comment'>${text(locale, 'Комментарий к решению', 'Шешімге пікір')}</label><textarea id='map-approval-comment' name='comment' rows='3' maxlength='8000' aria-describedby='map-approval-note'></textarea><p id='map-approval-note'>${text(locale, 'Для возврата напишите причину.', 'Қайтару үшін себебін жазыңыз.')}</p><div class='dialog-actions'><button type='submit' class='btn primary' name='verdict' value='approved'>${text(locale, 'Принять', 'Қабылдау')}</button><button type='submit' class='btn' name='verdict' value='returned'>${text(locale, 'Вернуть', 'Қайтару')}</button></div></form>` : cell.status === 'awaiting' ? `<p class='map-access-note'>${text(locale, 'Вам открыт просмотр этой задачи.', 'Сіздің рөліңізге бұл тапсырманы қарау қолжетімді.')}</p>` : ''}
    <p class='form-error' data-map-error role='alert' hidden></p><section class='map-approval-history'><h3>${text(locale, 'История решений', 'Шешімдер тарихы')}</h3>${history.length ? `<ol>${history.map(approval => `<li>${cellStatus({ status: approval.verdict }, locale)}<div class='map-approval-byline'><strong>${escape(authorName(approval, project, locale))}</strong><time datetime='${escape(approval.createdAt || '')}'>${escape(dateLabel(approval.createdAt, locale))}</time></div><p>${escape(versionLabel(approval, locale) || '—')}</p>${approval.comment ? `<p class='map-comment'>${escape(approval.comment)}</p>` : ''}</li>`).join('')}</ol>` : `<p>${text(locale, 'Решений пока нет.', 'Шешімдер әзірге жоқ.')}</p>`}</section>
    <button type='button' class='btn map-reopen' data-reopen-map-cell='${escape(cell.id)}'>${text(locale, 'Обновить карточку', 'Карточканы жаңарту')}</button>
  </div>`;
}
