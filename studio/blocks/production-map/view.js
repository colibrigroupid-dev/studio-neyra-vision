// №32: presentation only; the server remains the authority for every mutation.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const text = (locale, ru, kk) => locale === 'kk' ? kk : ru;
const local = (value, locale) => typeof value === 'object' && value !== null ? value[locale] || value.ru || value.kk || '' : value || '';
const stages = [
  ['script', 'Сценарий', 'Сценарий', 'development'], ['breakdown', 'Разбивка', 'Сценарийді талдау', 'development'],
  ['heroes', 'Герои', 'Кейіпкерлер', 'art'], ['locations', 'Локации', 'Локациялар', 'art'],
  ['storyboard', 'Раскадровка', 'Кадрлық жоспар', 'camera'], ['shots', 'Кадры', 'Кадрлар', 'camera'],
  ['video', 'Видео', 'Бейне', 'camera'], ['sound', 'Звук', 'Дыбыс', 'post'], ['edit', 'Монтаж', 'Монтаж', 'post']
];
const legacySections = { script: 'script', breakdown: 'script', heroes: 'storyboard', locations: 'storyboard', storyboard: 'storyboard', shots: 'shots', video: 'animatic', sound: 'post', edit: 'post' };
const roleSections = {
  writer: ['overview', 'script', 'breakdown', 'journal', 'team'],
  assistant_director: ['overview', 'script', 'breakdown', 'journal', 'team'],
  cinematographer: ['overview', 'storyboard', 'shots', 'continuity', 'journal', 'team'],
  artist: ['overview', 'heroes', 'locations', 'world', 'storyboard', 'shots', 'continuity', 'journal', 'team'],
  editor: ['overview', 'edit', 'sound', 'animatic', 'post', 'journal', 'team']
};
const approvers = { script: ['producer', 'writer'], breakdown: ['assistant_director'], heroes: ['director'], locations: ['director'], storyboard: ['director', 'cinematographer'], shots: ['director'], video: ['director'], sound: ['director'], edit: ['producer', 'director'] };
const roleNames = {
  admin: ['Администратор', 'Әкімші'], producer: ['Продюсер', 'Продюсер'], director: ['Режиссёр', 'Режиссер'],
  writer: ['Сценарист', 'Сценарист'], assistant_director: ['Второй режиссёр', 'Екінші режиссер'],
  cinematographer: ['Оператор', 'Оператор'], artist: ['Художник', 'Суретші'], editor: ['Монтажёр', 'Монтажшы'], viewer: ['Наблюдатель', 'Бақылаушы']
};
const statusNames = { empty: ['Не начато', 'Басталмады'], working: ['В работе', 'Орындалуда'], done: ['Готово', 'Дайын'], awaiting: ['Ждёт утверждения', 'Бекітуді күтуде'], approved: ['Принято', 'Қабылданды'], returned: ['Вернули', 'Қайтарылды'] };
const symbols = { empty: '○', working: '●', done: '✓', awaiting: '◆', approved: '◆', returned: '↺' };
const statusOf = cell => Object.hasOwn(statusNames, cell?.status) ? cell.status : 'empty';
const statusTitle = (value, locale) => text(locale, ...statusNames[value]);
const roleTitle = (value, locale) => roleNames[value] ? text(locale, ...roleNames[value]) : text(locale, 'Роль не указана', 'Рөл көрсетілмеген');
const sameObject = (a, b) => a?.type === b?.type && a?.id === b?.id;
const filmObject = object => ['scene', 'teaser'].includes(object?.type);

export function mapStages(locale = 'ru') {
  return stages.map(([id, ru, kk, department]) => ({ id, title: text(locale, ru, kk), department }));
}

export function cellPermissions(cell, p) {
  const denied = { manage: false, work: false, approve: false };
  const principal = p?._principal;
  if (!principal?.id || !Object.hasOwn(legacySections, cell?.stage)) return denied;
  const member = (p.members || []).find(item => item.keyId === principal.id);
  if (principal.role !== 'admin' && (!member || member.role !== principal.role || member.revokedAt || ['revoked', 'unavailable'].includes(member.accessStatus))) return denied;
  if (!(principal.projects || []).some(slug => slug === '*' || slug === p.slug)) return denied;
  const section = member?.keySource === 'issued' ? (cell.stage === 'video' ? 'animatic' : cell.stage) : legacySections[cell.stage];
  const allowed = name => (principal.sections || []).includes(name) && (principal.role === 'admin' || (member.sections || []).includes(name));
  if (!allowed('overview') || !allowed(section) || principal.role === 'viewer') return denied;
  if (!['admin', 'producer', 'director'].includes(principal.role) && !(roleSections[principal.role] || []).includes(section)) return denied;
  if ((principal.role === 'writer' && section === 'breakdown') || (principal.role === 'editor' && section === 'sound')) return denied;
  return {
    manage: ['admin', 'producer', 'director'].includes(principal.role),
    work: cell?.assignee?.keyId === principal.id,
    approve: [cell?.approverRole, 'admin', 'producer'].includes(principal.role)
  };
}

function objectTitle(object, p, locale) {
  const labels = { scene: ['Сцена', 'Көрініс'], teaser: ['Тизер', 'Тизер'], shot: ['Кадр', 'Кадр'] };
  const record = (object?.type === 'scene' ? p?.scenes : object?.type === 'shot' ? p?.shots : [])?.find(item => item.id === object.id);
  const title = local(record?.title, locale);
  const label = labels[object?.type] ? text(locale, ...labels[object.type]) : '';
  return [label, title || (label ? object?.id : '')].filter(Boolean).join(' ');
}

function cellAttributes(object, stage) {
  return `data-map-object-type='${escape(object.type)}' data-map-object-id='${escape(object.id)}' data-map-stage='${escape(stage)}'`;
}

function cellStatus(cell, locale) {
  const value = statusOf(cell);
  return `<span class='map-status map-status-${value}'><span class='map-symbol' aria-hidden='true'>${symbols[value]}</span><span>${escape(statusTitle(value, locale))}</span></span>`;
}

function personalList(title, cells, p, locale, empty) {
  const items = (cells || []).filter(cell => filmObject(cell.object));
  return `<section class='panel map-personal'><h2>${escape(title)} <span class='map-count'>${items.length}</span></h2>${items.length ? `<ul>${items.map(cell => `<li><button class='map-task' ${cellAttributes(cell.object, cell.stage)}><span>${escape(objectTitle(cell.object, p, locale))} · ${escape(mapStages(locale).find(item => item.id === cell.stage)?.title || '')}</span>${cellStatus(cell, locale)}${cell.comment && cell.status === 'returned' ? `<span class='map-return-note'>${escape(cell.comment)}</span>` : ''}${cell.dueAt ? `<span class='map-task-date'>${escape(text(locale, 'Срок', 'Мерзім'))}: ${escape(cell.dueAt)}</span>` : ''}</button></li>`).join('')}</ul>` : `<p>${escape(empty)}</p>`}</section>`;
}

function gridRows(data) {
  if (Array.isArray(data?.grid)) return data.grid.filter(row => filmObject(row.object));
  return (data?.objects || []).filter(filmObject).map(object => ({ object, stages: Object.fromEntries(stages.map(([stage]) => [stage, (data.cells || []).find(cell => sameObject(cell.object, object) && cell.stage === stage) || null])) }));
}

function renderGrid(rows, visible, p, locale) {
  if (!rows.length) return `<div class='empty map-empty'><h2>${escape(text(locale, 'Пока нет сцен в карте', 'Картада әлі көріністер жоқ'))}</h2><p>${escape(text(locale, 'Добавьте сцены в сценарий. Тизер появится, когда для него будет создана задача.', 'Сценарийге көріністер қосыңыз. Тизер оған тапсырма жасалғанда пайда болады.'))}</p></div>`;
  if (!visible.length) return `<p class='map-notice'>${escape(text(locale, 'Для выбранного отдела нет этого этапа. Измените фильтр.', 'Таңдалған бөлімде бұл кезең жоқ. Сүзгіні өзгертіңіз.'))}</p>`;
  return `<div class='map-grid-scroll' tabindex='0' role='region' aria-label='${escape(text(locale, 'Карта: прокрутите вправо, чтобы увидеть этапы', 'Карта: кезеңдерді көру үшін оңға жылжытыңыз'))}'><table class='map-grid'><caption class='map-sr-only'>${escape(text(locale, 'Сцены и тизеры по этапам производства', 'Өндіріс кезеңдері бойынша көріністер мен тизерлер'))}</caption><thead><tr><th scope='col'>${escape(text(locale, 'Объект', 'Нысан'))}</th>${visible.map(item => `<th scope='col'>${escape(item.title)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th scope='row'>${escape(objectTitle(row.object, p, locale))}</th>${visible.map(item => {
    const cell = row.stages?.[item.id];
    const value = statusOf(cell);
    const owner = value === 'working' ? cell?.assignee?.name : '';
    return `<td><button class='map-cell map-cell-${value}' ${cellAttributes(row.object, item.id)} aria-label='${escape(`${objectTitle(row.object, p, locale)} · ${item.title} · ${statusTitle(value, locale)}${owner ? ` · ${owner}` : ''}`)}'>${cellStatus(cell, locale)}${owner ? `<span class='map-cell-owner'>${escape(owner)}</span>` : ''}</button></td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function actionTitle(event, locale) {
  const names = {
    'approval.approved': ['принял результат', 'нәтижені қабылдады'], 'approval.returned': ['вернул результат', 'нәтижені қайтарды'],
    'cell.created': ['создал задачу', 'тапсырма жасады'], 'cell.updated': ['обновил задачу', 'тапсырманы жаңартты'],
    'project.created': ['создал проект', 'жоба жасады'], 'project.updated': ['обновил проект', 'жобаны жаңартты'],
    'script.updated': ['сохранил сценарий', 'сценарийді сақтады'],
    'scene.created': ['добавил сцену', 'көрініс қосты'], 'scene.updated': ['обновил сцену', 'көріністі жаңартты'], 'scene.deleted': ['удалил сцену', 'көріністі жойды'],
    'shot.created': ['добавил кадр', 'кадр қосты'], 'shot.updated': ['обновил кадр', 'кадрды жаңартты'], 'shot.deleted': ['удалил кадр', 'кадрды жойды'],
    'member.created': ['добавил участника', 'қатысушы қосты'], 'member.updated': ['изменил права участника', 'қатысушының құқықтарын өзгертті'], 'member.deleted': ['отозвал доступ участника', 'қатысушының қолжетімділігін жойды'],
    'version.created': ['сохранил версию', 'нұсқаны сақтады'], 'version.restored': ['восстановил версию', 'нұсқаны қалпына келтірді'],
    'post.updated': ['обновил план постпродакшена', 'постпродакшн жоспарын жаңартты']
  };
  return text(locale, ...(names[event.action] || ['обновил проект', 'жобаны жаңартты']));
}

function eventTime(value, locale) {
  const date = new Date(value);
  return value && !Number.isNaN(date.valueOf()) ? date.toLocaleString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}

function activityFeed(events, p, locale) {
  const stageItems = mapStages(locale);
  return `<aside class='panel map-activity'><h2>${escape(text(locale, 'Лента действий', 'Әрекеттер тізбегі'))}</h2>${events?.length ? `<ol>${[...events].reverse().map(event => {
    const target = objectTitle(event.object, p, locale);
    const stage = stageItems.find(item => item.id === event.stage)?.title;
    const version = [event.version, event.variant].filter(Boolean).join(' · ');
    return `<li><p><strong>${escape(event.name || text(locale, 'Участник', 'Қатысушы'))}</strong> ${escape(actionTitle(event, locale))}${target ? ` · ${escape(target)}` : ''}${stage ? ` · ${escape(stage)}` : ''}</p>${version ? `<p class='map-event-result'>${escape(version)}</p>` : ''}${event.status && Object.hasOwn(statusNames, event.status) ? cellStatus(event, locale) : ''}<time datetime='${escape(event.createdAt)}'>${escape(eventTime(event.createdAt, locale))}</time></li>`;
  }).join('')}</ol>` : `<p>${escape(text(locale, 'Здесь появятся действия команды.', 'Мұнда команданың әрекеттері көрсетіледі.'))}</p>`}</aside>`;
}

export function renderMapPage({ p, data, locale = 'ru', stage = 'all', department = 'all', loading = false, error = '' }) {
  const title = text(locale, 'Карта производства', 'Өндіріс картасы');
  const heading = `<div class='page-heading'><div><h1>${escape(title)}</h1><p>${escape(text(locale, 'Каждая сцена проходит свой путь. Видно, кто делает и кто принимает.', 'Әр көріністің өз жолы бар. Кім орындайтыны және кім қабылдайтыны көрінеді.'))}</p></div>${p?._server ? `<button class='btn' data-action='map-refresh' ${loading ? 'disabled' : ''}>${escape(text(locale, 'Обновить', 'Жаңарту'))}</button>` : ''}</div>`;
  if (!p?._server) return `<section class='map-space'>${heading}<div class='empty map-empty'><h2>${escape(text(locale, 'Карта работает с сервером проекта', 'Карта жоба серверімен жұмыс істейді'))}</h2><p>${escape(text(locale, 'Подключите сервер и свой ключ роли: здесь появятся общая карта, ваши задачи и решения команды.', 'Серверді және рөл кілтіңізді қосыңыз: мұнда ортақ карта, тапсырмаларыңыз және команданың шешімдері пайда болады.'))}</p><button class='btn primary' data-action='server'>${escape(text(locale, 'Подключить сервер', 'Серверді қосу'))}</button></div></section>`;
  const problem = error ? `<p class='map-error' role='alert'>${escape(error)}</p>` : '';
  if (!data) return `<section class='map-space'>${heading}${problem}<p class='map-notice' role='status'>${escape(loading ? text(locale, 'Загружаем карту проекта…', 'Жоба картасы жүктелуде…') : text(locale, 'Карта пока недоступна. Обновите её после подключения к серверу.', 'Карта әзірге қолжетімсіз. Серверге қосылғаннан кейін жаңартыңыз.'))}</p></section>`;
  const allStages = mapStages(locale);
  const departments = [['development', 'Сценарный отдел', 'Сценарий бөлімі'], ['art', 'Художественный отдел', 'Көркемдік бөлім'], ['camera', 'Режиссёр и оператор', 'Режиссер және оператор'], ['post', 'Постпродакшен', 'Постпродакшн']];
  const visible = allStages.filter(item => (stage === 'all' || item.id === stage) && (department === 'all' || item.department === department));
  return `<section class='map-space' aria-busy='${loading}'>${heading}${problem}<div class='map-personal-lists'>${personalList(text(locale, 'Мои задачи', 'Менің тапсырмаларым'), data.myTasks, p, locale, text(locale, 'На этом уровне нет назначенных вам задач.', 'Бұл деңгейде сізге тағайындалған тапсырмалар жоқ.'))}${personalList(text(locale, 'Ждёт меня', 'Мені күтуде'), data.awaitingMe, p, locale, text(locale, 'На этом уровне нет результатов, ждущих вашего решения.', 'Бұл деңгейде шешіміңізді күтетін нәтижелер жоқ.'))}</div><div class='map-filters'><div><label for='map-stage-filter'>${escape(text(locale, 'Этап', 'Кезең'))}</label><select id='map-stage-filter'><option value='all' ${stage === 'all' ? 'selected' : ''}>${escape(text(locale, 'Все этапы', 'Барлық кезеңдер'))}</option>${allStages.map(item => `<option value='${item.id}' ${stage === item.id ? 'selected' : ''}>${escape(item.title)}</option>`).join('')}</select></div><div><label for='map-department-filter'>${escape(text(locale, 'Отдел', 'Бөлім'))}</label><select id='map-department-filter'><option value='all' ${department === 'all' ? 'selected' : ''}>${escape(text(locale, 'Все отделы', 'Барлық бөлімдер'))}</option>${departments.map(([id, ru, kk]) => `<option value='${id}' ${department === id ? 'selected' : ''}>${escape(text(locale, ru, kk))}</option>`).join('')}</select></div></div><ul class='map-legend' aria-label='${escape(text(locale, 'Статусы', 'Мәртебелер'))}'>${Object.keys(statusNames).map(value => `<li>${cellStatus({ status: value }, locale)}</li>`).join('')}</ul><div class='map-layout'><div class='map-main'>${renderGrid(gridRows(data), visible, p, locale)}</div>${activityFeed(data.activity, p, locale)}</div></section>`;
}

function assignmentOptions(p, cell, locale) {
  const selected = cell?.assignee?.keyId || '';
  const members = (p.members || []).filter(member => {
    if (!member.keyId || member.revokedAt || ['revoked', 'unavailable'].includes(member.accessStatus)) return false;
    const candidate = { ...p, _principal: { id: member.keyId, role: member.role, projects: [p.slug], sections: member.sections } };
    return cellPermissions({ ...cell, assignee: { keyId: member.keyId } }, candidate).work;
  });
  const selectedMember = members.some(member => member.keyId === selected);
  return `<option value='' ${!selected ? 'selected' : ''}>${escape(!selected && cell?.assignee?.name ? cell.assignee.name : text(locale, 'Не назначен', 'Тағайындалмады'))}</option>${selected && !selectedMember ? `<option value='${escape(selected)}' selected disabled>${escape(cell.assignee.name || text(locale, 'Исполнитель недоступен', 'Орындаушы қолжетімсіз'))}</option>` : ''}${members.map(member => `<option value='${escape(member.keyId)}' ${member.keyId === selected ? 'selected' : ''}>${escape(member.name)} · ${escape(roleTitle(member.role, locale))}</option>`).join('')}`;
}

function approvalHistory(items, object, stage, p, locale) {
  const history = (items || []).filter(item => sameObject(item.object, object) && item.stage === stage);
  return `<section class='map-approval-history'><h3>${escape(text(locale, 'История решений', 'Шешімдер тарихы'))}</h3>${history.length ? `<ol>${[...history].reverse().map(item => {
    const author = (p.members || []).find(member => member.keyId === item.keyId)?.name || text(locale, 'Участник', 'Қатысушы');
    const result = [item.version, item.variant].filter(Boolean).join(' · ');
    const verdict = item.verdict === 'approved' ? 'approved' : 'returned';
    return `<li>${cellStatus({ status: verdict }, locale)}<p><strong>${escape(author)}</strong>${result ? ` · ${escape(result)}` : ''}</p>${item.comment ? `<p>${escape(item.comment)}</p>` : ''}<time datetime='${escape(item.createdAt)}'>${escape(eventTime(item.createdAt, locale))}</time></li>`;
  }).join('')}</ol>` : `<p>${escape(text(locale, 'Решений по этому этапу ещё нет.', 'Бұл кезең бойынша әлі шешімдер жоқ.'))}</p>`}</section>`;
}

export function renderCellCard({ p, data, object, stage, locale = 'ru', error = '' }) {
  const saved = (data?.cells || []).find(cell => sameObject(cell.object, object) && cell.stage === stage)
    || data?.grid?.find(row => sameObject(row.object, object))?.stages?.[stage];
  const cell = saved || { object, stage, status: 'empty', assignee: { keyId: null, name: '' }, approverRole: approvers[stage]?.[0], dueAt: null, comment: '', version: null, variant: null };
  const rights = cellPermissions(cell, p);
  const writable = rights.manage || rights.work;
  const value = statusOf(cell);
  const verdict = rights.approve && value === 'awaiting' && (cell.version || cell.variant);
  const locked = writable ? '' : 'readonly';
  const administrative = rights.manage ? '' : 'disabled';
  const options = ['empty', 'working', 'done', 'awaiting'];
  return `<div class='map-card'>${error ? `<p class='map-error' role='alert'>${escape(error)}</p>` : ''}<p class='map-card-context'>${escape(objectTitle(object, p, locale))} · ${escape(mapStages(locale).find(item => item.id === stage)?.title || '')}</p>${cellStatus(cell, locale)}${!saved ? `<p class='map-notice'>${escape(rights.manage ? text(locale, 'Задача ещё не создана. Назначьте исполнителя и сохраните карточку.', 'Тапсырма әлі жасалмады. Орындаушыны тағайындап, карточканы сақтаңыз.') : text(locale, 'Задача ещё не создана. Её может назначить руководитель проекта.', 'Тапсырма әлі жасалмады. Оны жоба жетекшісі тағайындай алады.'))}</p>` : !writable ? `<p class='map-notice'>${escape(text(locale, 'Поля задачи доступны для чтения. Решение принимает утверждающий с доступом к этапу.', 'Тапсырма өрістерін оқуға болады. Шешімді кезеңге қолжетімді бекітуші қабылдайды.'))}</p>` : ''}<form id='map-cell-form' ${cellAttributes(object, stage)}><div class='form-row'><div><label for='map-cell-assignee'>${escape(text(locale, 'Исполнитель', 'Орындаушы'))}</label><select id='map-cell-assignee' name='assignee' ${administrative}>${assignmentOptions(p, cell, locale)}</select></div><div><label for='map-cell-approver'>${escape(text(locale, 'Утверждающий', 'Бекітуші'))}</label><select id='map-cell-approver' name='approverRole' ${administrative}>${(approvers[stage] || []).map(role => `<option value='${role}' ${cell.approverRole === role ? 'selected' : ''}>${escape(roleTitle(role, locale))}</option>`).join('')}</select></div></div><div class='form-row'><div><label for='map-cell-status'>${escape(text(locale, 'Статус', 'Мәртебе'))}</label><select id='map-cell-status' name='status' ${writable ? '' : 'disabled'}>${!options.includes(value) ? `<option value='${value}' selected disabled>${escape(statusTitle(value, locale))}</option>` : ''}${options.map(status => `<option value='${status}' ${value === status ? 'selected' : ''}>${escape(statusTitle(status, locale))}</option>`).join('')}</select></div><div><label for='map-cell-due'>${escape(text(locale, 'Срок', 'Мерзім'))}</label><input id='map-cell-due' name='dueAt' type='text' maxlength='80' value='${escape(cell.dueAt)}' ${rights.manage ? '' : 'readonly'} aria-describedby='map-due-hint'><p id='map-due-hint' class='map-field-hint'>${escape(text(locale, 'Дата ГГГГ-ММ-ДД или дата и время ISO с часовым поясом.', 'ЖЖЖЖ-АА-КК күні немесе уақыт белдеуі бар ISO күні мен уақыты.'))}</p></div></div><div class='form-row'><div><label for='map-cell-version'>${escape(text(locale, 'Версия результата', 'Нәтиже нұсқасы'))}</label><input id='map-cell-version' name='version' maxlength='240' value='${escape(cell.version)}' ${locked}></div><div><label for='map-cell-variant'>${escape(text(locale, 'Вариант результата', 'Нәтиже варианты'))}</label><input id='map-cell-variant' name='variant' maxlength='240' value='${escape(cell.variant)}' ${locked}></div></div><label for='map-cell-comment'>${escape(text(locale, 'Комментарий', 'Пікір'))}</label><textarea id='map-cell-comment' name='comment' rows='3' maxlength='8000' ${locked}>${escape(cell.comment)}</textarea>${writable ? `<p class='map-notice'>${escape(text(locale, 'Для утверждения укажите версию или вариант результата. Непринятые предыдущие этапы сервер объяснит при сохранении.', 'Бекіту үшін нәтиже нұсқасын немесе вариантын көрсетіңіз. Сақтау кезінде сервер қабылданбаған алдыңғы кезеңдерді түсіндіреді.'))}</p><div class='dialog-actions map-cell-actions'><button class='btn' type='submit' name='intent' value='save'>${escape(text(locale, 'Сохранить', 'Сақтау'))}</button>${rights.work ? `<button class='btn' type='submit' name='intent' value='done'>${escape(text(locale, 'Готово', 'Дайын'))}</button><button class='btn primary' type='submit' name='intent' value='awaiting'>${escape(text(locale, 'На утверждение', 'Бекітуге жіберу'))}</button>` : ''}</div>` : ''}${verdict ? `<section class='map-verdict'><h3>${escape(text(locale, 'Ваше решение', 'Сіздің шешіміңіз'))}</h3><p>${escape(text(locale, 'Решение относится к показанной версии и варианту.', 'Шешім көрсетілген нұсқа мен вариантқа қатысты.'))}</p><button class='btn primary' type='button' data-map-verdict='approved'>${escape(text(locale, 'Принять', 'Қабылдау'))}</button><label for='map-return-comment'>${escape(text(locale, 'Замечание одной строкой', 'Бір жолдық ескерту'))}</label><input id='map-return-comment' name='returnComment' type='text' maxlength='8000'><button class='btn map-return-button' type='button' data-map-verdict='returned'>${escape(text(locale, 'Вернуть с замечанием', 'Ескертумен қайтару'))}</button></section>` : ''}</form>${approvalHistory(data?.approvals, object, stage, p, locale)}</div>`;
}
