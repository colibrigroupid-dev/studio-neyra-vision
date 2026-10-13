const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;').replaceAll('"', '&quot;');
const text = (locale, ru, kk) => locale === 'kk' ? kk : ru;
const list = value => Array.isArray(value) ? value : [];
const sectionNames = { breakdown: ['Разбивка', 'Сценарийді талдау'], heroes: ['Герои', 'Кейіпкерлер'], locations: ['Локации', 'Локациялар'] };
const sectionCollection = { breakdown: 'scenes', heroes: 'characters', locations: 'locations' };
const named = (names, locale) => names[locale === 'kk' ? 1 : 0];

function passportValue(record, key, locale) {
  const translation = record.translations?.[locale];
  return translation && Object.hasOwn(translation, key) ? translation[key] : record[key];
}
function deniedCollection(snapshot, section, collection) {
  const denied = snapshot?.denied;
  return Array.isArray(denied) ? denied.includes(collection) || denied.includes(section) : Boolean(denied?.[collection] || denied?.[section]);
}
function actionButton(action, label, disabled = false, primary = false) {
  return `<button type='button' class='btn${primary ? ' primary' : ''}' data-action='${action}'${disabled ? ' disabled' : ''}>${label}</button>`;
}
function modeControl(locale, mode) {
  return `<label class='cinema-mode-control' for='cinema-mode'>${text(locale, 'Бумага', 'Қағаз')}<select id='cinema-mode' data-cinema-mode><option value='graphite'${mode !== 'light' ? ' selected' : ''}>${text(locale, 'Графит', 'Графит')}</option><option value='light'${mode === 'light' ? ' selected' : ''}>${text(locale, 'Светлая', 'Ашық')}</option></select></label>`;
}
function pages(scene) {
  if (scene.page_from == null && scene.page_to == null) return '';
  if (scene.page_from == null) return String(scene.page_to);
  if (scene.page_to == null || scene.page_to === scene.page_from) return String(scene.page_from);
  return `${scene.page_from}–${scene.page_to}`;
}
function sceneTable(scenes, locale) {
  const columns = ['№', text(locale, 'ИНТ/НАТ', 'ИНТ/НАТ'), text(locale, 'Локация', 'Локация'), text(locale, 'Время', 'Уақыт'), text(locale, 'Страницы', 'Беттер'), text(locale, 'Кто в сцене', 'Көріністегі кейіпкерлер')];
  // The number is taken from the import; an array index is not a scene number.
  const sorted = [...scenes].sort((a, b) => (Number(a.n) || Infinity) - (Number(b.n) || Infinity));
  return `<p id='breakdown-scroll-hint' class='cinema-scroll-hint'>${text(locale, 'Таблицу можно листать в сторону.', 'Тар экранда кестені көлденең айналдыруға болады.')}</p><div class='breakdown-scroll' role='region' tabindex='0' aria-label='${text(locale, 'Таблица сцен', 'Көріністер кестесі')}' aria-describedby='breakdown-scroll-hint'><table class='breakdown-table'><caption>${text(locale, 'Разбивка по сценам', 'Көріністер бойынша талдау')}</caption><thead><tr>${columns.map(label => `<th scope='col'>${label}</th>`).join('')}</tr></thead><tbody>${sorted.map(scene => `<tr data-scene-id='${escape(scene.id)}'><th scope='row'>${escape(scene.n ?? '—')}</th><td>${escape(scene.type || '—')}</td><td>${escape(scene.location || '—')}</td><td>${escape(scene.time || '—')}</td><td>${escape(pages(scene))}</td><td>${list(scene.chars).length ? list(scene.chars).map(escape).join(', ') : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}
let fieldLocale = 'ru';
function passportField(label, value, className = '') {
  return `<div${className ? ` class='${className}'` : ''}><dt>${label}</dt><dd class='${value ? '' : 'passport-empty'}'>${value ? escape(value) : text(fieldLocale, 'пока пусто', 'толтырылмаған')}</dd></div>`;
}
function passportCard(record, collection, locale, canEdit) {
  const value = key => passportValue(record, key, locale);
  const taboo = list(value('taboo'));
  const status = record.status === 'locked' ? 'locked' : 'draft';
  const statusLabel = status === 'locked' ? text(locale, 'Замок утверждён', 'Бекітілген') : text(locale, 'Черновик', 'Нобай');
  return `<article class='passport-card' data-passport-id='${escape(record.id)}' data-passport-collection='${collection}'><div class='passport-card-heading'><h2>${escape(value('name') || '—')}</h2><span class='passport-status' data-status='${status}'>${statusLabel} · ${status}</span></div><dl class='passport-fields'>${passportField(text(locale, 'Роль', 'Рөлі'), value('role'))}${passportField(text(locale, 'Замок внешности', 'Тұрақты сыртқы келбет'), value('identity'), 'passport-identity')}<div class='passport-taboo'><dt>${text(locale, 'Табу-детали', 'Тыйым салынған бөлшектер')}</dt><dd>${taboo.length ? `<ul>${taboo.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : `<span class='passport-empty'>${text(locale, 'пока пусто', 'толтырылмаған')}</span>`}</dd></div>${passportField(text(locale, 'Рост', 'Бойы'), value('height'))}${passportField(text(locale, 'В каких сценах', 'Қай көріністерде'), list(record.scenes).join(', '), 'passport-scenes')}</dl>${collection === 'characters' ? `<a class='btn' href='#/studio/heroes/${escape(encodeURIComponent(record.id))}'>${text(locale, 'Открыть', 'Ашу')}</a>` : ''}${canEdit ? `<button type='button' class='btn' data-action='edit-passport' data-passport-id='${escape(record.id)}' data-passport-collection='${collection}'>${text(locale, 'Изменить паспорт', 'Паспортты өзгерту')}</button>` : ''}</article>`;
}

export function renderBreakdownSection({ section = 'breakdown', snapshot, locale = 'ru', mode = 'graphite', loading = false, error = '', connected = false, canImport = false, canEdit = false } = {}) {
  fieldLocale = locale;
  const currentSection = Object.hasOwn(sectionNames, section) ? section : 'breakdown';
  const collection = sectionCollection[currentSection];
  const denied = deniedCollection(snapshot, currentSection, collection);
  const records = connected && !denied ? list(snapshot?.[collection]) : [];
  const importingAllowed = connected && canImport;
  const importButton = actionButton('razbor', text(locale, 'Разобрать сценарий помощником', 'Көмекшімен талдау'), loading, true) + actionButton('import-breakdown', text(locale, 'Загрузить разбивку файлом', 'Файлмен талдауды жүктеу'), loading);
  const description = currentSection === 'breakdown'
    ? text(locale, 'Сцены, места, время и состав для подготовки фильма.', 'Фильмді дайындауға арналған көріністер, орындар, уақыт және кейіпкерлер.')
    : text(locale, 'Паспорта и согласованные детали для следующих этапов фильма.', 'Фильмнің келесі кезеңдеріне арналған паспорттар мен келісілген бөлшектер.');
  let content = '';
  if (!connected) content = `<div class='cinema-state' role='status'><p>${text(locale, 'Подключитесь к серверу проекта и введите ключ участника.', 'Жоба серверіне қосылып, қатысушы кілтін енгізіңіз.')}</p><p>${text(locale, 'Нажмите «Разобрать сценарий помощником» — сцены, герои и локации появятся сами. Или опишите героев словами внизу: «создай героя: мальчик 10 лет, войлочная шапка».', 'Көмекшімен талдауды іске қосыңыз — көріністер, кейіпкерлер мен локациялар өздері пайда болады.')}</p>${actionButton('server', text(locale, 'Введите ключ участника', 'Қатысушы кілтін енгізіңіз'))}</div>`;
  else if (denied) content = `<div class='cinema-state' role='status'><p>${text(locale, 'Сюда вам пока нельзя. Спросите у продюсера про права.', 'Бұл бөлім сіздің кілтіңізге қолжетімді емес. Жоба жетекшісіне хабарласыңыз.')}</p></div>`;
  else if (loading && !snapshot) content = `<div class='cinema-state' role='status'><p>${text(locale, 'Открываем проект…', 'Жоба деректері жүктелуде…')}</p></div>`;
  else if (records.length) content = currentSection === 'breakdown' ? sceneTable(records, locale) : `<div class='passport-list'>${records.map(record => passportCard(record, collection, locale, canEdit)).join('')}</div>`;
  else if (!error && !loading) content = `<div class='cinema-state' role='status'><p>${text(locale, 'Нажмите «Разобрать сценарий помощником» — сцены, герои и локации появятся сами. Или опишите героев словами внизу: «создай героя: мальчик 10 лет, войлочная шапка».', 'Көмекшімен талдауды іске қосыңыз — көріністер, кейіпкерлер мен локациялар өздері пайда болады.')}</p><p>${text(locale, 'Выберите файл разбивки сценария.', 'Сценарийіңіздің razbivka.json файлын жүктеңіз.')}</p>${importingAllowed ? importButton : `<p>${text(locale, 'Разобрать сценарий может тот, у кого есть право на разбивку.', 'Импорт талдауды өзгерту құқығы бар қатысушыға қолжетімді.')}</p>`}</div>`;
  return `<section class='cinema-section' data-cinema-section='${currentSection}' data-cinema-mode='${mode === 'light' ? 'light' : 'graphite'}' aria-busy='${loading ? 'true' : 'false'}'><div class='page-heading'><div><h1>${named(sectionNames[currentSection], locale)}</h1><p>${description}</p></div><div class='cinema-actions'>${connected ? actionButton('refresh-breakdown', text(locale, 'Обновить', 'Жаңарту'), loading) : ''}${importingAllowed && (records.length || denied || error) ? importButton : ''}</div></div><div class='cinema-toolbar'>${modeControl(locale, mode)}${connected && !denied && currentSection !== 'breakdown' ? `<p class='cinema-access-note'>${canEdit ? text(locale, 'Паспорта можно править.', 'Паспорттарды өзгертуге болады.') : text(locale, 'Вам открыт просмотр.', 'Сіздің рөліңіз үшін — тек қарау.')}</p>` : ''}</div>${error ? `<div class='cinema-state cinema-error' role='alert'><p>${escape(error)}</p></div>` : ''}${loading && snapshot ? `<p class='cinema-loading' role='status'>${text(locale, 'Обновляем данные…', 'Деректер жаңартылуда…')}</p>` : ''}${content}</section>`;
}

export function renderPassportEditor({ record = {}, collection = 'characters', locale = 'ru' } = {}) {
  const field = (key, label, maxlength, required = false) => `<div><label for='passport-${key}'>${label}</label><input id='passport-${key}' name='${key}' value='${escape(record[key])}' maxlength='${maxlength}'${required ? ' required' : ''}></div>`;
  const translatedFields = Object.values(record.translations || {}).some(translation => translation && Object.keys(translation).length);
  return `<form id='passport-form' data-passport-id='${escape(record.id)}' data-passport-collection='${collection === 'locations' ? 'locations' : 'characters'}'>${translatedFields ? `<p class='passport-language-note'>${text(locale, 'Вы правите основной паспорт; перевод хранится отдельно.', 'Негізгі паспортты өзгертесіз. Карточкада аударма көрсетілуі мүмкін; аудармалар бөлек сақталады.')}</p>` : ''}${field('name', text(locale, 'Имя / название', 'Аты / атауы'), 240, true)}${field('role', text(locale, 'Роль', 'Рөлі'), 240)}<div><label for='passport-aliases'>${text(locale, 'Как ещё зовут в сценарии — через запятую', 'Сценарийде тағы қалай аталады — үтір арқылы')}</label><input id='passport-aliases' name='aliases' value='${escape(list(record.aliases).join(', '))}' maxlength='2500'></div><label for='passport-identity'>${text(locale, 'Замок внешности', 'Тұрақты сыртқы келбет')}</label><textarea id='passport-identity' name='identity' rows='4' maxlength='2000'>${escape(record.identity)}</textarea><label for='passport-taboo'>${text(locale, 'Табу-детали — по одной на строку', 'Тыйым салынған бөлшектер — әр жолға біреу')}</label><textarea id='passport-taboo' name='taboo' rows='4' maxlength='5010' aria-describedby='passport-taboo-note'>${escape(list(record.taboo).join('\n'))}</textarea><p id='passport-taboo-note'>${text(locale, 'До 10 деталей, каждая до 500 символов.', '10 бөлшекке дейін, әрқайсысы 500 таңбаға дейін.')}</p><div class='form-row'>${field('height', text(locale, 'Рост', 'Бойы'), 240)}<div><label for='passport-status'>${text(locale, 'Статус', 'Мәртебе')}</label><select id='passport-status' name='status'><option value='draft'${record.status !== 'locked' ? ' selected' : ''}>${text(locale, 'Черновик', 'Нобай')} · draft</option><option value='locked'${record.status === 'locked' ? ' selected' : ''}>${text(locale, 'Замок утверждён', 'Бекітілген')} · locked</option></select></div></div><label for='passport-scenes'>${text(locale, 'В каких сценах', 'Қай көріністерде')}</label><input id='passport-scenes' name='scenes' value='${escape(list(record.scenes).join(', '))}' aria-describedby='passport-scenes-note'><p id='passport-scenes-note'>${text(locale, 'Номера сцен через запятую.', 'Көрініс нөмірлерін үтірмен бөліңіз.')}</p><p class='form-error' data-passport-error role='alert' hidden></p><div class='dialog-actions'><button type='button' class='btn' data-close>${text(locale, 'Отмена', 'Бас тарту')}</button><button type='submit' class='btn primary'>${text(locale, 'Сохранить паспорт', 'Паспортты сақтау')}</button></div></form>`;
}
