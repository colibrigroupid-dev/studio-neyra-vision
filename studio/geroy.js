const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;').replaceAll('"', '&quot;');
const list = value => Array.isArray(value) ? value : [];

// References have a purpose, but no angle. Keep them separate from the five
// portrait slots rather than presenting an arbitrary reference as an approved view.
function portraitSource(path) {
  if (typeof path !== 'string' || !path.trim() || /[\u0000-\u001f\u007f\\]/.test(path)
      || path.startsWith('//') || path.split(/[/?#]/).includes('..')) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^https?:\/\//i.test(path)) return '';
  return path;
}

export function renderGeroyWorkshop({ record = null, locale = 'ru', t = (ru, kk) => locale === 'kk' ? kk : ru,
  connected = false, loading = false, error = '', canEdit = false, mode = 'graphite', cena = 12 } = {}) {
  const value = key => record?.translations?.[locale] && Object.hasOwn(record.translations[locale], key)
    ? record.translations[locale][key] : record?.[key];
  const name = value('name') || t('Герой', 'Кейіпкер');
  const locked = ['locked', 'approved'].includes(record?.status);
  const field = (label, content) => `<div><dt>${label}</dt><dd${content ? '' : " class='geroy-empty'"}>${content ? escape(content) : t('пока пусто', 'әзірге бос')}</dd></div>`;
  const edit = () => canEdit && record && !loading && !error ? `<button type='button' class='btn' data-action='edit-passport' data-passport-collection='characters' data-passport-id='${escape(record.id)}'>${t('Уточнить паспорт', 'Паспортты нақтылау')}</button>` : '';
  let content;
  if (!connected) content = `<div class='geroy-state' role='status'><p>${t('Откройте проект команды, чтобы заполнить паспорт.', 'Паспортты толтыру үшін команда жобасын ашыңыз.')}</p><button type='button' class='btn' data-action='server'>${t('Ввести ключ', 'Кілтті енгізу')}</button></div>`;
  else if (error) content = `<div class='geroy-state' role='alert'><p>${escape(error)}</p></div>`;
  else if (loading && !record) content = `<div class='geroy-state' role='status'><p>${t('Открываем паспорт…', 'Паспортты ашып жатырмыз…')}</p></div>`;
  else if (!record) content = `<div class='geroy-state' role='status'><p>${t('Паспорт пока пустой. Заполните его по сценарию.', 'Паспорт әзірге бос. Оны сценарий бойынша толтырыңыз.')}</p></div>`;
  else {
    const empty = !value('role') && !value('identity') && !value('height') && !list(value('taboo')).length;
    const taboo = list(value('taboo'));
    const angles = [['anfas', t('Анфас', 'Алдынан')], ['tri-chetverti', t('Три четверти', 'Үш ширек')], ['profil-levyy', t('Левый профиль', 'Сол жақ қырынан')], ['profil-pravyy', t('Правый профиль', 'Оң жақ қырынан')], ['rost', t('В полный рост', 'Толық бойымен')]];
    const obrazy = list(record.obrazy).filter(o => o && o.url);
    const portrait = ([key, label]) => {
      const mine = obrazy.filter(o => o.rakurs === key);
      const main = mine.find(o => o.status === 'approved') || mine[mine.length - 1];
      const frame = main ? `<img src='${escape(main.url)}' alt='${escape(label)}' width='1600' height='900' loading='lazy'>${main.status === 'approved' ? `<span class='geroy-approved'>${t('утверждён', 'бекітілді')}</span>` : ''}` : `<span class='geroy-ratio'>16:9</span><span class='geroy-portrait-empty'>${t('Ждём портрет', 'Портретті күтеміз')}</span>`;
      const draw = canEdit && !locked ? `<button type='button' class='btn small' data-action='narisovat' data-rakurs='${key}'>${mine.length ? t('Ещё вариант', 'Тағы нұсқа') : t('Нарисовать', 'Салу')} · ${cena}</button>` : '';
      const variants = mine.length > 1 || (mine.length === 1 && canEdit && !locked) ? `<div class='geroy-variants'>${mine.map(o => `<div class='geroy-variant ${o.status === 'approved' ? 'approved' : ''}'><img src='${escape(o.url)}' alt='' width='320' height='180' loading='lazy'>${canEdit && !locked ? `<div class='geroy-variant-actions'>${o.status === 'approved' ? `<span>${t('утверждён', 'бекітілді')}</span>` : `<button type='button' class='btn small primary' data-obraz-utverdit='${escape(o.id)}'>${t('Утвердить', 'Бекіту')}</button>`}<button type='button' class='btn small' data-obraz-pravka='${escape(o.id)}' data-rakurs='${key}'>${t('Правка словами', 'Сөзбен түзету')}</button>${o.status === 'approved' ? '' : `<button type='button' class='btn small ghost' data-obraz-udalit='${escape(o.id)}'>${t('Убрать', 'Алып тастау')}</button>`}</div>` : ''}</div>`).join('')}</div>` : '';
      return `<figure class='geroy-portrait'><div class='geroy-portrait-frame'>${frame}</div><figcaption>${label}${draw ? ` ${draw}` : ''}</figcaption>${variants}</figure>`;
    };
    const refs = list(record.refs).map(ref => ({ ...ref, source: portraitSource(ref?.path) })).filter(ref => ref.source);
    const roleName = role => ({ identity: t('Внешность', 'Сыртқы келбет'), environment: t('Окружение', 'Орта'), costume: t('Костюм', 'Костюм'), composition: t('Композиция', 'Композиция') })[role] || t('Референс', 'Референс');
    const lockIcon = `<svg viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='currentColor' stroke-width='1.5' aria-hidden='true'><rect x='5' y='10' width='14' height='11' rx='3'/><path d='${locked ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 8 0'}'/></svg>`;
    content = `${empty ? `<p class='geroy-state'>${t('Паспорт пока пустой. Начните с роли и характера.', 'Паспорт әзірге бос. Рөлі мен мінезінен бастаңыз.')}</p>` : ''}${loading ? `<p class='geroy-note' role='status'>${t('Сверяем паспорт…', 'Паспортты тексеріп жатырмыз…')}</p>` : ''}<div class='geroy-grid'>
      <section class='geroy-section' aria-labelledby='geroy-passport-title'><header><h2 id='geroy-passport-title'>${t('Паспорт героя', 'Кейіпкер паспорты')}</h2>${edit()}</header><div class='geroy-sheet'><dl class='geroy-fields'>${field(t('Имя', 'Аты'), name)}${field(t('Роль в истории', 'Оқиғадағы рөлі'), value('role'))}${field(t('Характер', 'Мінезі'), value('identity'))}</dl></div></section>
      <section class='geroy-section' aria-labelledby='geroy-dna-title'><header><h2 id='geroy-dna-title'>${t('ДНК внешности', 'Сыртқы келбет ДНК-сы')}</h2><span class='geroy-lock' data-locked='${locked}'>${lockIcon}${locked ? t('зафиксирован', 'бекітілген') : t('замок открыт', 'құлып ашық')}</span></header><p class='geroy-note'>${locked ? t('Сохраняем эти детали во всех следующих кадрах.', 'Бұл бөлшектерді келесі кадрларда сақтаймыз.') : t('Сверим детали, чтобы узнавать героя в каждом кадре.', 'Кейіпкер әр кадрда танылуы үшін бөлшектерін тексерейік.')}</p><div class='geroy-sheet'><dl class='geroy-fields'>${field(t('Описание', 'Сипаттамасы'), value('identity'))}${field(t('Рост', 'Бойы'), value('height'))}</dl></div></section>
      <section class='geroy-section geroy-wide' aria-labelledby='geroy-taboo-title'><header><h2 id='geroy-taboo-title'>${t('Табу — чего не рисовать', 'Табу — нені салуға болмайды')}</h2></header><div class='geroy-sheet'>${taboo.length ? `<ul class='geroy-taboo'>${taboo.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : `<p class='geroy-empty'>${t('Обсудите с художником, какие детали исключить.', 'Қай бөлшектерді алып тастау керегін суретшімен талқылаңыз.')}</p>`}</div></section>
      <section class='geroy-section geroy-wide' aria-labelledby='geroy-portraits-title'><header><h2 id='geroy-portraits-title'>${t('Портреты · пять ракурсов', 'Портреттер · бес ракурс')}</h2></header><p class='geroy-note'>${obrazy.length ? t('Утверждённый ракурс подкладывается в каждый следующий кадр. Правка словами — «свет холоднее», «шапка выше».', 'Бекітілген ракурс келесі әр кадрға қосылады.') : t('Нажмите «Нарисовать» — портрет соберётся по паспорту: внешность, табу, стиль проекта. Цена видна на кнопке.', '«Салу» басыңыз — портрет паспорт бойынша жиналады.')}</p><div class='geroy-portraits'>${angles.map(portrait).join('')}</div>${refs.length ? `<h3>${t('Референсы', 'Референстер')}</h3><p class='geroy-note'>${t('Сверяем по ним детали. Ракурсы ещё не назначены.', 'Бөлшектерді осы бойынша тексереміз. Ракурстар әлі белгіленбеген.')}</p><div class='geroy-refs'>${refs.map((ref, i) => `<figure class='geroy-portrait'><div class='geroy-portrait-frame'><img src='${escape(ref.source)}' alt='${escape(t('Референс героя', 'Кейіпкер референсі'))} ${i + 1}' width='1600' height='900' loading='lazy' referrerpolicy='no-referrer'></div><figcaption>${roleName(ref.role)}</figcaption></figure>`).join('')}</div>` : ''}</section>
      <section class='geroy-section geroy-wide' aria-labelledby='geroy-scenes-title'><header><h2 id='geroy-scenes-title'>${t('В каких сценах появляется', 'Қай көріністерде пайда болады')}</h2></header>${list(record.scenes).length ? `<div class='geroy-sheet geroy-scenes'>${list(record.scenes).map(number => `<a class='geroy-scene' href='#/studio/script'><span class='geroy-scene-number'>${escape(number)}</span><span>${t('Открыть сценарий', 'Сценарийді ашу')}</span></a>`).join('')}</div>` : `<p class='geroy-empty'>${t('Разберите сценарий на сцены — и увидим, где нужен герой.', 'Сценарийді көріністерге бөліңіз — кейіпкер қайда керегін көреміз.')}</p>`}</section>
    </div>`;
  }
  return `<section class='geroy-cex' data-cinema-mode='${mode === 'light' ? 'light' : 'graphite'}' aria-busy='${loading}'><div class='geroy-heading'><a class='btn' href='#/studio/heroes'>${t('← В кабинет', '← Кабинетке')}</a><div class='geroy-title'><h1>${escape(name)}</h1><p>${t('Соберём героя, которого узнают в каждом кадре.', 'Әр кадрда танылатын кейіпкер жасайық.')}</p></div>${record ? `<span class='geroy-status'>${locked ? t('зафиксирован', 'бекітілген') : t('черновик', 'нобай')}</span>` : ''}<div class='geroy-actions'>${connected ? `<button type='button' class='btn' data-action='refresh-breakdown'${loading ? ' disabled' : ''}>${t('Обновить', 'Жаңарту')}</button>` : ''}${record && !error ? `<button type='button' class='btn primary' data-action='fill-hero-passport'${loading ? ' disabled' : ''}>${t('Заполнить по сценарию', 'Сценарий бойынша толтыру')}</button>` : ''}</div></div>${content}</section>`;
}
