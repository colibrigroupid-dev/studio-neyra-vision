/* Сценарная studio.neyra.vision — блок 1.
   Проекты в localStorage; с ключом участника — проекты, черновик и помощник на сервере команды (api.studio.neyra.vision). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const LS = { tier: 'nvs.tier', projects: 'nvs.projects', current: 'nvs.current', view: 'nvs.view', api: 'nvs.api', lang: 'nv-lang', paper: 'neyra-vision-script-paper-v1', server: 'neyra-vision-server-settings-v1' };
  const DEFAULT_SERVER = 'https://api.studio.neyra.vision';
  const IS_LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);

  // ---------- язык интерфейса ----------
  const KZ = {
    'STUDIO · СЦЕНАРИЙ': 'STUDIO · СЦЕНАРИЙ', 'Сцены': 'Көріністер', 'Герои': 'Кейіпкерлер', 'Структура': 'Құрылым', 'Замысел': 'Ой', 'Версии': 'Нұсқалар',
    'Проекты': 'Жобалар', 'Экспорт': 'Экспорт', 'Текст': 'Мәтін', 'Оба': 'Екеуі', 'Страница': 'Бет', 'Фокус': 'Фокус', 'Сервер': 'Сервер',
    'Логлайн': 'Логлайн', 'Жанр · формат': 'Жанр · формат', 'Синопсис': 'Синопсис', 'Заметки': 'Жазбалар', 'Название проекта': 'Жоба атауы',
    'ИНТ.': 'ІШКІ.', 'НАТ.': 'СЫРТҚЫ.', 'ГЕРОЙ': 'КЕЙІПКЕР', '(ремарка)': '(ремарка)', 'ПЕРЕХОД': 'АУЫСУ', 'ТИТР': 'ТИТР', '[[заметка]]': '[[жазба]]', '#Акт': '#Акт', '=== разрыв': '=== үзіліс',
    'Бумага': 'Қағаз', 'светлая': 'ашық', 'графит': 'графит', 'сохранено': 'сақталды', 'проверяю связь': 'байланысты тексеру', 'Работать с': 'Жұмыс',
    'выделение → сцена → всё': 'белгіленген → көрініс → бәрі', 'выделенным': 'белгіленгенмен', 'текущей сценой': 'ағымдағы көрініспен', 'всем сценарием': 'бүкіл сценариймен',
    'Читательское заключение': 'Оқырман қорытындысы', 'весь сценарий: что работает, что ломается, вопросы автору': 'бүкіл сценарий: не жұмыс істейді, не бұзылады, авторға сұрақтар',
    'Бит-шит': 'Бит-парақ', '15 битов, где дыра': '15 бит, қайда олқылық', 'Непрерывность': 'Үздіксіздік', 'имена, время, ружья': 'есімдер, уақыт, мылтықтар',
    'Улучшить сцену': 'Көріністі жақсарту', 'цель · препятствие · перемена': 'мақсат · кедергі · өзгеріс', 'Диалог живее': 'Диалогты жандандыру', 'подтекст, голоса героев': 'астарлы мән, кейіпкер дауыстары',
    'Модернизировать': 'Жаңғырту', 'в наше время и язык': 'бүгінгі заман мен тілге', '3 поворота': '3 бұрылыс', 'варианты для сцены': 'көрініске нұсқалар',
    'Логлайн и синопсис': 'Логлайн және синопсис', 'в карточку «Замысел»': '«Ой» карточкасына', 'На казахский': 'Қазақшаға', 'На русский': 'Орысшаға', 'перевод с форматом': 'форматымен аудару',
    'Стандарт': 'Стандарт', 'Расписать': 'Көріністерге жазу', 'из синопсиса или заметки — сцены': 'синопсис немесе жазбадан — көріністер', 'Сжать': 'Қысқарту', 'входи поздно, выходи рано': 'кеш кір, ерте шық',
  };
  let lang = 'ru';
  function setLang(l) {
    lang = l === 'kz' ? 'kz' : 'ru';
    document.documentElement.setAttribute('data-lang', lang); document.documentElement.lang = lang === 'kz' ? 'kk' : 'ru';
    try { localStorage.setItem(LS.lang, lang); } catch (e) { /* нет хранилища */ }
    $$('[data-t]').forEach((el) => { const k = el.dataset.t; el.textContent = lang === 'kz' && KZ[k] ? KZ[k] : k; });
    $$('[data-tp]').forEach((el) => { if (!el.dataset.pRu) el.dataset.pRu = el.placeholder; el.placeholder = lang === 'kz' ? el.dataset.tp : el.dataset.pRu; });
    $$('.lang [data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang));
    INS['heading-int'][0] = lang === 'kz' ? 'ІШКІ. ОРЫН — УАҚЫТ\n\n' : 'ИНТ. МЕСТО — ВРЕМЯ\n\n';
    INS['heading-ext'][0] = lang === 'kz' ? 'СЫРТҚЫ. ОРЫН — УАҚЫТ\n\n' : 'НАТ. МЕСТО — ВРЕМЯ\n\n';
    INS.transition[0] = lang === 'kz' ? '> ҚАРАҢҒЫЛАНУ.\n\n' : '> ЗАТЕМНЕНИЕ.\n\n';
    renderStoreNote(); if (parsed) { update(); checkApi(); }
  }
  const T = (ru, kz) => (lang === 'kz' ? kz : ru);

  const DEMO = `Title: ПОСЛЕДНИЙ ПОЕЗД
Credit: сценарий
Author: Автор
Draft date: 13.10.2026

ИНТ. КУПЕ ПОЕЗДА — НОЧЬ

За окном мелькают огни. АЙГЕРИМ (30), в пальто поверх пижамы, сидит на нижней полке и смотрит на закрытую дверь.

АЙГЕРИМ
(тихо)
Ты обещал, что он не придёт.

ДАУРЕН (ГЗК)
Я обещал, что ты не узнаешь.

Дверь медленно открывается. Айгерим не двигается.

АЙГЕРИМ
Уходи.

ДАУРЕН ^
Останься.

НАТ. ПЕРРОН — РАССВЕТ

Пустой перрон. Поезд уходит.

> ЗАТЕМНЕНИЕ.
`;

  const BEATS = [
    ['Открывающий образ', 0.01], ['Тема заявлена', 0.05], ['Экспозиция', 0.01, 0.10], ['Катализатор', 0.11], ['Сомнения', 0.12, 0.23],
    ['Переход во 2-й акт', 0.23], ['Линия Б', 0.27], ['Игры и забавы', 0.27, 0.50], ['Середина', 0.50], ['Злодеи наступают', 0.50, 0.68],
    ['Всё потеряно', 0.68], ['Тёмная ночь души', 0.68, 0.77], ['Переход в 3-й акт', 0.77], ['Финал', 0.77, 0.99], ['Закрывающий образ', 1.0],
  ];

  // ---------- состояние ----------
  let projects = load(LS.projects, {});
  let currentId = null; try { currentId = localStorage.getItem(LS.current); } catch (e) { /* */ }
  let parsed = null;
  let apiBase = ''; try { apiBase = localStorage.getItem(LS.api) || ''; } catch (e) { /* */ }
  let busy = false, storageOk = true;
  let pendingSave = null; // таймер отложенного сохранения текста

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save() {
    try { localStorage.setItem(LS.projects, JSON.stringify(projects)); localStorage.setItem(LS.current, currentId); storageOk = true; setSaveState(T('сохранено', 'сақталды')); serverSave(); return true; }
    catch (e) { storageOk = false; setSaveState(T('не сохраняется: ', 'сақталмайды: ') + e.message); return false; }
  }
  function setSaveState(t) { $('#saveState').textContent = t; }
  function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36); }
  function cur() { return projects[currentId]; }
  function blank(title, text) { return { id: uid(), title: title || T('Без названия', 'Атаусыз'), text: text || '', created: Date.now(), updated: Date.now(), beats: {}, meta: { logline: '', genre: '', synopsis: '', notes: '' }, chat: [], versions: [] }; }
  function newProject(title, text) { const p = blank(title, text); projects[p.id] = p; currentId = p.id; save(); return p; }
  function flush() { // довести отложенное сохранение до конца перед сменой проекта / уходом
    if (pendingSave) { clearTimeout(pendingSave); pendingSave = null; const p = cur(); if (p && src.value !== p.text) { p.text = src.value; p.updated = Date.now(); save(); } }
  }

  // ---------- сервер команды ----------
  let server = (() => { const s = load(LS.server, null); return s && s.key ? { url: String(s.url || DEFAULT_SERVER).replace(/\/+$/, ''), key: s.key } : null; })();
  let serverMode = null; // { slug, lastText, timer, loaded }
  async function serverFetch(path, method, body) {
    if (!server) throw new Error(T('нет ключа участника', 'қатысушы кілті жоқ'));
    const r = await fetch(server.url + path, { method: method || 'GET', headers: { 'X-Key': server.key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || (T('ошибка ', 'қате ') + r.status));
    return j;
  }
  async function serverOpen(slug) {
    const id = 'srv:' + slug;
    const meta = await serverFetch('/api/projects/' + encodeURIComponent(slug));
    const script = await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/script');
    const text = (script.data && script.data.text) || '';
    const title = (meta.data && (typeof meta.data.title === 'string' ? meta.data.title : (meta.data.title && meta.data.title.ru))) || slug;
    if (!projects[id]) projects[id] = Object.assign(blank(title, text), { id });
    projects[id].title = title; projects[id].text = text; projects[id].server = slug;
    serverMode = { slug, lastText: text, timer: null, loaded: true };
    currentId = id; save(); open(id);
    setSaveState(T('сценарий с сервера · ', 'серверден сценарий · ') + text.length + T(' зн.', ' тб.'));
    checkApi();
  }
  function serverSave() {
    if (!serverMode || !serverMode.loaded || currentId !== 'srv:' + serverMode.slug) return;
    if (cur().text === serverMode.lastText) return;
    clearTimeout(serverMode.timer);
    const slug = serverMode.slug, text = cur().text;
    serverMode.timer = setTimeout(async () => {
      try { await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/script', 'PUT', { text }); if (serverMode && serverMode.slug === slug) { serverMode.lastText = text; setSaveState(T('сохранено на сервере', 'серверде сақталды')); } }
      catch (e) { setSaveState(T('сервер не принял: ', 'сервер қабылдамады: ') + e.message); }
    }, 1200);
  }
  async function serverVersion(label) {
    const slug = serverMode.slug; clearTimeout(serverMode.timer);
    await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/script', 'PUT', { text: cur().text });
    serverMode.lastText = cur().text;
    await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/versions', 'POST', { label });
  }
  function serverDialog() {
    const s = load(LS.server, {}) || {};
    modal(`<h2>${T('Сервер команды', 'Команда сервері')}</h2><p>${T('Ключ участника выдаёт продюсер проекта. С ключом здесь открываются проекты команды, черновик сохраняется на сервере, а NEYRA помнит весь проект.', 'Қатысушы кілтін жоба продюсері береді. Кілтпен команда жобалары ашылады, черновик серверде сақталады, NEYRA бүкіл жобаны есте сақтайды.')}</p>
      <label>${T('Адрес сервера', 'Сервер мекенжайы')}<input id="m-url" type="url" value="${esc(s.url || DEFAULT_SERVER)}"></label>
      <label>${T('Ключ участника', 'Қатысушы кілті')}<input id="m-key" type="password" value="${esc(s.key || '')}" autocomplete="off"></label>
      <div class="row"><button class="btn" data-m="forget" type="button">${T('Забыть ключ', 'Кілтті ұмыту')}</button><button class="btn btn--main" data-m="ok" type="button">${T('Подключиться', 'Қосылу')}</button></div>`,
      async (act, box) => {
        if (act === 'forget') { try { localStorage.removeItem(LS.server); } catch (e) { /* */ } server = null; serverMode = null; checkApi(); return true; }
        const url = $('#m-url', box).value.trim().replace(/\/+$/, ''), key = $('#m-key', box).value.trim();
        if (!key) { toast(T('Введите ключ', 'Кілтті енгізіңіз')); return false; }
        server = { url: url || DEFAULT_SERVER, key };
        try { await serverFetch('/api/me'); } catch (e) { toast(T('Сервер не принял ключ: ', 'Сервер кілтті қабылдамады: ') + e.message); server = null; return false; }
        try { localStorage.setItem(LS.server, JSON.stringify(server)); } catch (e) { /* */ }
        checkApi(); toast(T('Ключ принят. Проекты команды — в меню «Проекты»', 'Кілт қабылданды. Команда жобалары — «Жобалар» мәзірінде')); return true;
      });
  }

  // ---------- DOM ----------
  const src = $('#src'), page = $('#page'), titleIn = $('#title'), chat = $('#chat');

  function open(id) {
    if (!projects[id]) return;
    flush();
    currentId = id; try { localStorage.setItem(LS.current, id); } catch (e) { /* */ }
    const p = cur();
    if (!p.versions) p.versions = [];
    if (!p.server) serverMode = null;
    titleIn.value = p.title; src.value = p.text;
    $('#f-logline').value = p.meta.logline || ''; $('#f-genre').value = p.meta.genre || ''; $('#f-synopsis').value = p.meta.synopsis || ''; $('#f-notes').value = p.meta.notes || '';
    src.setSelectionRange(0, 0); $('#beats').dataset.built = '';
    renderChat(); update(); renderVersions(); renderStoreNote(); src.scrollTop = 0;
  }

  src.addEventListener('input', () => { setSaveState(T('пишу…', 'жазып жатырмын…')); clearTimeout(pendingSave); pendingSave = setTimeout(() => { pendingSave = null; cur().text = src.value; cur().updated = Date.now(); save(); update(); }, 180); hintUpdate(); });
  src.addEventListener('keyup', () => { scopeHint(); hintUpdate(); }); src.addEventListener('click', () => { scopeHint(); hintUpdate(); }); src.addEventListener('select', scopeHint);
  window.addEventListener('beforeunload', flush); document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  titleIn.addEventListener('input', () => { cur().title = titleIn.value; save(); });
  ['logline', 'genre', 'synopsis', 'notes'].forEach((k) => $('#f-' + k).addEventListener('input', (e) => { cur().meta[k] = e.target.value; save(); }));

  function update() {
    parsed = Fountain.parse(src.value);
    page.innerHTML = Fountain.render(parsed) || '';
    if (!parsed.tokens.some((t) => t.type !== 'blank')) page.innerHTML = `<p class="ac" style="color:#999">${T('Пустая страница. Начните с заголовка сцены: ИНТ. МЕСТО — ВРЕМЯ', 'Бос бет. Көрініс тақырыбынан бастаңыз: ІШКІ. ОРЫН — УАҚЫТ')}</p>`;
    const s = parsed.stats;
    $('#stats').innerHTML = `<span><b class="num">${s.pages}</b> ${T('стр.', 'бет')}</span><span>≈ <b class="num">${s.minutes}</b> ${T('мин', 'мин')}</span><span><b class="num">${s.scenes}</b> ${T('сцен', 'көрініс')}</span><span><b class="num">${s.words}</b> ${T('слов', 'сөз')}</span><span>${T('диалог', 'диалог')} <b class="num">${s.dialogueShare}%</b></span>`;
    renderScenes(); renderChars(); renderBeats(); scopeHint();
  }

  function renderScenes() {
    const ul = $('#scenes'); ul.innerHTML = '';
    if (!parsed.scenes.length) { ul.innerHTML = `<li class="empty">${T('Сцен пока нет. Заголовок сцены — строка капсом, начинающаяся с ИНТ. или НАТ. (ІШКІ. / СЫРТҚЫ.)', 'Көріністер әзірге жоқ. Көрініс тақырыбы — ІШКІ. немесе СЫРТҚЫ. деп басталатын бас әріпті жол')}</li>`; return; }
    const curLine = lineAtCursor();
    for (const sc of parsed.scenes) {
      const li = document.createElement('li');
      const nextLine = parsed.scenes[sc.index] ? parsed.scenes[sc.index].line : Infinity;
      if (curLine >= sc.line && curLine < nextLine) li.classList.add('cur');
      li.innerHTML = `<span class="n">${esc(sc.num)}</span><span>${esc(sc.heading)}<span class="meta">${esc(Array.from(sc.characters).join(', ')) || T('— без реплик', '— репликасыз')} · ${sc.words} ${T('сл.', 'сөз')}</span></span><span class="pg">${sc.page}</span>`;
      li.addEventListener('click', () => gotoLine(sc.line));
      ul.appendChild(li);
    }
  }
  function renderChars() {
    const ul = $('#chars'); ul.innerHTML = '';
    const list = Object.values(parsed.characters).sort((a, b) => b.words - a.words);
    if (!list.length) { ul.innerHTML = `<li class="empty">${T('Герои появятся, когда будет первая реплика: имя КАПСОМ на отдельной строке, под ним текст.', 'Кейіпкерлер алғашқы репликадан кейін пайда болады: жеке жолда БАС ӘРІППЕН есім, астында мәтін.')}</li>`; return; }
    for (const c of list) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(c.name)}<span class="meta">${c.lines} ${T('реплик', 'реплика')} · ${c.words} ${T('слов', 'сөз')} · ${T('сцен', 'көрініс')}: ${esc(Array.from(c.scenes).join(', '))}</span></span><span class="ops"><button type="button" title="${T('Переименовать во всём тексте', 'Бүкіл мәтінде атын өзгерту')}">✎</button></span>`;
      li.addEventListener('click', () => { const sc = parsed.scenes.find((s) => s.index === Array.from(c.scenes)[0]); if (sc) gotoLine(sc.line); });
      li.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); renameCharacter(c.name); });
      ul.appendChild(li);
    }
  }
  function renameCharacter(oldName) {
    const nn = prompt(T('Новое имя для ', 'Жаңа есім: ') + oldName + T(' (заменю во всём тексте, в репликах и в действии)', ' (бүкіл мәтінде ауыстырамын)'), oldName);
    if (!nn || nn.trim() === oldName) return;
    const newName = nn.trim();
    const re = new RegExp('(^|[^' + Fountain.LETTERS + '])(' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![' + Fountain.LETTERS + '])', 'gi');
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    let n = 0;
    const text = src.value.replace(re, (m, pre, w) => { n++; if (w === w.toUpperCase()) return pre + newName.toUpperCase(); if (w === cap(w)) return pre + cap(newName); return pre + newName.toLowerCase(); });
    snapshot(T('до переименования ', 'атын өзгертуге дейін ') + oldName);
    src.value = text; src.dispatchEvent(new Event('input')); toast(T('Заменено: ', 'Ауыстырылды: ') + n);
  }
  function renderBeats() {
    const box = $('#beats');
    if (box.dataset.built !== currentId) {
      box.innerHTML = '';
      BEATS.forEach(([name, a, b], i) => {
        const d = document.createElement('div'); d.className = 'beat';
        d.innerHTML = `<header><b>${i + 1}. ${name}</b><span class="pg" data-beat-pg="${i}"></span></header><textarea data-beat="${i}" placeholder="${T('что происходит в этом бите', 'осы битте не болады')}"></textarea>`;
        d.querySelector('textarea').value = (cur().beats || {})[i] || '';
        d.querySelector('textarea').addEventListener('input', (e) => { cur().beats[i] = e.target.value; save(); });
        box.appendChild(d);
      });
      box.dataset.built = currentId;
    }
    const pages = Math.max(parsed.stats.pages, 1);
    BEATS.forEach(([name, a, b], i) => { const el = box.querySelector(`[data-beat-pg="${i}"]`); el.textContent = b ? `${T('стр.', 'бет')} ${Math.max(1, Math.round(a * pages))}–${Math.round(b * pages)}` : `${T('стр.', 'бет')} ${Math.max(1, Math.round(a * pages))}`; });
  }
  // ---------- версии (локально; на сервере — через /versions) ----------
  function snapshot(label) {
    const p = cur(); if (!p.versions) p.versions = [];
    if (p.versions.length && p.versions[p.versions.length - 1].text === src.value) return false;
    p.versions.push({ ts: Date.now(), label: label || '', text: src.value, words: Fountain.countWords(src.value) });
    if (p.versions.length > 25) p.versions = p.versions.slice(-25);
    save(); renderVersions(); return true;
  }
  function renderVersions() {
    const box = $('#versions'); const p = cur(); box.innerHTML = '';
    const mk = document.createElement('button'); mk.type = 'button'; mk.className = 'btn btn--sm make'; mk.textContent = T('+ Зафиксировать версию (⌘S)', '+ Нұсқаны бекіту (⌘S)');
    mk.addEventListener('click', () => { const l = prompt(T('Подпись версии (например: драфт 2, после разбора)', 'Нұсқа жазбасы (мысалы: драфт 2)'), ''); if (l === null) return; snapshot(l) ? toast(T('Версия сохранена', 'Нұсқа сақталды')) : toast(T('Текст не изменился с прошлой версии', 'Мәтін өзгерген жоқ')); });
    box.appendChild(mk);
    const vs = (p.versions || []).slice().reverse();
    if (!vs.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = T('Версий пока нет. ⌘S фиксирует текущий текст; старые версии можно вернуть или сравнить по числу слов.', 'Нұсқалар әзірге жоқ. ⌘S ағымдағы мәтінді бекітеді.'); box.appendChild(e); }
    vs.forEach((v) => {
      const d = document.createElement('div'); d.className = 'v';
      d.innerHTML = `<span class="lbl">${esc(v.label || T('версия', 'нұсқа'))}<small>${new Date(v.ts).toLocaleString(lang === 'kz' ? 'kk' : 'ru')} · ${v.words} ${T('слов', 'сөз')}</small></span><button type="button" data-v="restore">${T('Вернуть', 'Қайтару')}</button><button type="button" data-v="del" title="${T('Удалить версию', 'Нұсқаны жою')}">✕</button>`;
      d.querySelector('[data-v=restore]').addEventListener('click', () => { if (!confirm(T('Вернуть эту версию? Текущий текст сохранится как версия «до возврата».', 'Осы нұсқаны қайтару керек пе? Ағымдағы мәтін нұсқа ретінде сақталады.'))) return; snapshot(T('до возврата', 'қайтаруға дейін')); src.value = v.text; src.dispatchEvent(new Event('input')); toast(T('Версия возвращена', 'Нұсқа қайтарылды')); });
      d.querySelector('[data-v=del]').addEventListener('click', () => { p.versions = p.versions.filter((x) => x !== v); save(); renderVersions(); });
      box.appendChild(d);
    });
  }
  function renderStoreNote() {
    const el = $('#storeNote'); const p = cur(); if (!p) return;
    el.innerHTML = p.server ? `<b>${T('сервер проекта', 'жоба сервері')}</b> · ${esc(p.server)} · ${T('черновик и версии на сервере команды', 'черновик пен нұсқалар команда серверінде')}`
      : `<b>${T('хранится в этом браузере', 'осы браузерде сақталады')}</b> · ${T('не в облаке. Скачивайте .fountain или подключите сервер команды (кнопка «Сервер»)', 'бұлтта емес. .fountain жүктеңіз немесе команда серверін қосыңыз («Сервер» түймесі)')}${storageOk ? '' : ' · <span style="color:var(--rec)">' + T('хранилище недоступно!', 'қойма қолжетімсіз!') + '</span>'}`;
  }

  // вкладки левой панели
  $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
    $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
  }));

  // вид, фокус, бумага, язык
  function setView(v) { $('#edWrap').className = 'ed-wrap ' + v; $$('.seg [data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v)); try { localStorage.setItem(LS.view, v); } catch (e) { /* */ } }
  $$('.seg [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  let viewSaved = 'both'; try { viewSaved = localStorage.getItem(LS.view) || 'both'; } catch (e) { /* */ } setView(viewSaved);
  function toggleFocus() { document.body.classList.toggle('focus'); if (document.body.classList.contains('focus')) { $('#edWrap').dataset.prev = $('#edWrap').className.replace('ed-wrap ', ''); setView('text'); src.focus(); } else setView($('#edWrap').dataset.prev || 'both'); }
  $('#btnFocus').addEventListener('click', toggleFocus);
  $('#mobLeft').addEventListener('click', () => { document.body.classList.remove('show-right'); document.body.classList.toggle('show-left'); });
  $('#mobRight').addEventListener('click', () => { document.body.classList.remove('show-left'); document.body.classList.toggle('show-right'); });
  function setPaper(v) { document.documentElement.dataset.paper = v; $('#paper').value = v; try { localStorage.setItem(LS.paper, v); } catch (e) { /* */ } }
  $('#paper').addEventListener('change', (e) => setPaper(e.target.value));
  (function () { let v = null; try { v = localStorage.getItem(LS.paper); } catch (e) { /* */ } if (v !== 'light' && v !== 'graphite') v = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'graphite' : 'light'; setPaper(v); })();
  $$('.lang [data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

  // ---------- курсор, сцены, вставки, подсказки ----------
  function lineAtCursor() { return src.value.slice(0, src.selectionStart).split('\n').length - 1; }
  function gotoLine(line) {
    const lines = src.value.split('\n'); let pos = 0; for (let i = 0; i < line; i++) pos += lines[i].length + 1;
    src.focus(); src.setSelectionRange(pos, pos);
    const lh = parseFloat(getComputedStyle(src).lineHeight) || 24; src.scrollTop = Math.max(0, line * lh - src.clientHeight / 3);
    const el = page.querySelector(`[data-line="${line}"]`); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.body.classList.remove('show-left'); renderScenes();
  }
  function insertAtCursor(text, selectFrom, selectLen) {
    const a = src.selectionStart, b = src.selectionEnd, v = src.value;
    const before = v.slice(0, a), after = v.slice(b);
    const needNL = before.length && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const ins = needNL + text;
    src.value = before + ins + after;
    const p = a + needNL.length + (selectFrom || 0); src.setSelectionRange(p, p + (selectLen || 0)); src.focus();
    src.dispatchEvent(new Event('input'));
  }
  const INS = {
    'heading-int': ['ИНТ. МЕСТО — ВРЕМЯ\n\n', 5, 5], 'heading-ext': ['НАТ. МЕСТО — ВРЕМЯ\n\n', 5, 5],
    character: ['ГЕРОЙ\nРеплика.\n\n', 0, 5], paren: ['(тихо)\n', 1, 4], transition: ['> ЗАТЕМНЕНИЕ.\n\n', 2, 11],
    title: ['ТИТР: ТЕКСТ\n\n', 6, 5], note: ['[[заметка]]\n\n', 2, 7], section: ['# Акт 1\n\n', 2, 5], pagebreak: ['===\n\n', 0, 0],
  };
  $('#edTools').addEventListener('click', (e) => { const b = e.target.closest('[data-ins]'); if (!b) return; const [t, f, l] = INS[b.dataset.ins]; insertAtCursor(t, f, l); });

  // подсказка имён героев и заголовков сцен: в начале блока набираешь первые буквы → Tab подставляет
  let hintItems = [];
  function hintUpdate() {
    const box = $('#hint'); hintItems = [];
    if (!parsed) return box.classList.add('hidden');
    const pos = src.selectionStart, v = src.value;
    if (src.selectionEnd !== pos) return box.classList.add('hidden');
    const ls = v.lastIndexOf('\n', pos - 1) + 1; const line = v.slice(ls, pos);
    const prevLine = ls >= 2 ? v.slice(v.lastIndexOf('\n', ls - 2) + 1, ls - 1) : '';
    if (!line.trim() || line.length < 1 || prevLine.trim() !== '' || v.slice(pos, v.indexOf('\n', pos) < 0 ? v.length : v.indexOf('\n', pos)).trim()) return box.classList.add('hidden');
    const q = line.trim().toUpperCase();
    const names = Object.keys(parsed.characters).filter((n) => n.startsWith(q) && n !== q);
    const heads = Array.from(new Set(parsed.scenes.map((s) => s.heading))).filter((h) => h.toUpperCase().startsWith(q) && h.toUpperCase() !== q);
    hintItems = names.map((n) => ({ text: n, kind: 'ch' })).concat(heads.map((h) => ({ text: h, kind: 'sh' }))).slice(0, 6);
    if (!hintItems.length) return box.classList.add('hidden');
    box.innerHTML = hintItems.map((it, i) => `<button type="button" class="${i === 0 ? 'first' : ''}" data-i="${i}">${esc(it.text)}</button>`).join('') + `<kbd>Tab</kbd>`;
    box.classList.remove('hidden');
    box.dataset.ls = ls; box.dataset.pos = pos;
  }
  function hintAccept(i) {
    const it = hintItems[i]; if (!it) return false;
    const ls = +$('#hint').dataset.ls, pos = +$('#hint').dataset.pos;
    src.value = src.value.slice(0, ls) + it.text + '\n' + src.value.slice(pos);
    const np = ls + it.text.length + 1; src.setSelectionRange(np, np); src.focus();
    $('#hint').classList.add('hidden'); hintItems = []; src.dispatchEvent(new Event('input')); return true;
  }
  $('#hint').addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); hintAccept(+b.dataset.i); } });
  src.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); if (!hintAccept(0)) insertAtCursor(...INS.character); return; }
    if (e.key === 'Escape') { $('#hint').classList.add('hidden'); hintItems = []; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); insertAtCursor(...INS['heading-int']); }
  });
  src.addEventListener('blur', () => setTimeout(() => $('#hint').classList.add('hidden'), 150));

  // ---------- меню, модалки ----------
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('#btnProjects,#btnExport')) closeMenu(); });
  function menu(anchor, items) {
    closeMenu();
    const m = document.createElement('div'); m.className = 'menu';
    for (const it of items) {
      if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
      const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `${esc(it.label)}${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ''}`;
      b.addEventListener('click', () => { closeMenu(); it.run(); }); m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + 6) + 'px'; m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 12)) + 'px';
    menuEl = m;
  }
  function modal(html, onAct) {
    const wrap = document.createElement('div'); wrap.className = 'modal'; wrap.innerHTML = `<div class="box">${html}</div>`;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => { if (b.dataset.m === 'close') return close(); const ok = await onAct(b.dataset.m, wrap); if (ok) close(); }));
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(wrap); const f = wrap.querySelector('input,button'); if (f) f.focus();
  }
  $('#btnProjects').addEventListener('click', async (e) => {
    const list = Object.values(projects).sort((a, b) => b.updated - a.updated).map((p) => ({ label: (p.server ? '☁ ' : '') + (p.title || T('Без названия', 'Атаусыз')), meta: new Date(p.updated).toLocaleDateString('ru'), run: () => (p.server ? serverOpen(p.server).catch((err) => toast(T('Сервер: ', 'Сервер: ') + err.message)) : open(p.id)) }));
    const items = [
      { label: '+ ' + T('Новый сценарий', 'Жаңа сценарий'), run: () => { flush(); newProject(T('Без названия', 'Атаусыз'), ''); serverMode = null; open(currentId); titleIn.focus(); } },
      { label: '↑ ' + T('Импорт (.fountain, .txt, .fdx, .json)', 'Импорт (.fountain, .txt, .fdx, .json)'), run: () => $('#fileIn').click() },
      { label: '☁ ' + T('Проекты команды на сервере…', 'Серверде команда жобалары…'), meta: server ? '' : T('нужен ключ', 'кілт керек'), run: serverProjects },
      '-', ...list, '-',
      { label: '✕ ' + T('Удалить текущий', 'Ағымдағыны жою'), run: delCurrent },
    ];
    menu(e.currentTarget, items);
  });
  async function serverProjects() {
    if (!server) return serverDialog();
    let j; try { j = await serverFetch('/api/projects'); } catch (err) { return toast(T('Сервер: ', 'Сервер: ') + err.message); }
    const arr = (j.data && (j.data.projects || j.data)) || [];
    if (!Array.isArray(arr) || !arr.length) return toast(T('На сервере нет доступных проектов', 'Серверде қолжетімді жобалар жоқ'));
    modal(`<h2>${T('Проекты команды', 'Команда жобалары')}</h2><div class="keys" style="margin-bottom:.8rem">${arr.map((p) => `<li><button class="btn btn--sm" type="button" data-m="p:${esc(p.slug)}">${esc(typeof p.title === 'string' ? p.title : (p.title && p.title.ru) || p.slug)}</button><span class="caps">${esc(p.slug)}</span></li>`).join('')}</div><div class="row"><button class="btn" data-m="close" type="button">${T('Закрыть', 'Жабу')}</button></div>`,
      async (act) => { if (!act.startsWith('p:')) return false; const slug = act.slice(2); try { flush(); await serverOpen(slug); } catch (err) { toast(T('Не удалось открыть: ', 'Ашу мүмкін болмады: ') + err.message); return false; } return true; });
  }
  function delCurrent() {
    const p = cur(); if (!p) return;
    if (!confirm(T(`Удалить «${p.title}» из этого браузера? Это нельзя отменить. Сначала скачайте .fountain, если нужно.`, `«${p.title}» осы браузерден жою керек пе? Бұны болдырмау мүмкін емес.`))) return;
    clearTimeout(pendingSave); pendingSave = null;
    delete projects[p.id]; serverMode = null; const ids = Object.keys(projects); if (!ids.length) newProject(T('Без названия', 'Атаусыз'), ''); else currentId = ids[0]; save(); open(currentId);
  }
  $('#fileIn').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return; const txt = await f.text(); const name = f.name.replace(/\.[^.]+$/, '');
    try {
      flush();
      if (/\.fdx$/i.test(f.name)) newProject(name, Fountain.fromFDX(txt));
      else if (/\.json$/i.test(f.name)) {
        const j = JSON.parse(txt);
        if (!j || typeof j !== 'object' || typeof j.text !== 'string') throw new Error(T('это не резервная копия проекта (нет поля text)', 'бұл жоба көшірмесі емес (text өрісі жоқ)'));
        const p = newProject(typeof j.title === 'string' ? j.title : name, j.text);
        p.beats = (j.beats && typeof j.beats === 'object') ? j.beats : {}; p.meta = Object.assign(p.meta, (j.meta && typeof j.meta === 'object') ? j.meta : {}); p.chat = Array.isArray(j.chat) ? j.chat : []; p.versions = Array.isArray(j.versions) ? j.versions : []; save();
      } else newProject(name, txt);
      serverMode = null; open(currentId); toast(T('Импортировано: ', 'Импортталды: ') + f.name);
    } catch (err) { toast(T('Не прочитал файл: ', 'Файл оқылмады: ') + err.message); }
    e.target.value = '';
  });
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function slug() { return (cur().title || 'scenariy').replace(new RegExp('[^' + Fountain.LETTERS + '0-9-]+', 'g'), '-').slice(0, 60); }
  $('#btnExport').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Fountain (.fountain)', meta: T('текст', 'мәтін'), run: () => download(slug() + '.fountain', src.value) },
    { label: 'Final Draft (.fdx)', meta: 'FDX', run: () => download(slug() + '.fdx', Fountain.toFDX(parsed), 'application/xml') },
    { label: T('PDF / печать', 'PDF / басып шығару'), meta: 'A4', run: () => { const v = $('#edWrap').className.replace('ed-wrap ', ''); setView('page'); setTimeout(() => { window.print(); setView(v); }, 150); } },
    { label: T('Резервная копия проекта (.json)', 'Жобаның сақтық көшірмесі (.json)'), meta: T('всё', 'бәрі'), run: () => download(slug() + '.json', JSON.stringify(cur(), null, 2), 'application/json') },
  ]));
  $('#btnHelp').addEventListener('click', () => modal(`<h2>${T('Клавиши и подсказки', 'Пернелер мен кеңестер')}</h2><ul class="keys">
    <li><kbd>Tab</kbd>${T('подставить подсказанное имя героя или заголовок; без подсказки — вставить ГЕРОЙ/реплику', 'ұсынылған есімді қою; ұсыныс болмаса — КЕЙІПКЕР/реплика')}</li>
    <li><kbd>⌘/Ctrl + Enter</kbd>${T('новый заголовок сцены', 'жаңа көрініс тақырыбы')}</li>
    <li><kbd>⌘/Ctrl + S</kbd>${T('зафиксировать версию (на сервере — версию проекта)', 'нұсқаны бекіту')}</li>
    <li><kbd>⌘/Ctrl + ⇧ + F</kbd>${T('фокус: только текст', 'фокус: тек мәтін')}</li>
    <li><kbd>Esc</kbd>${T('закрыть подсказку или окно', 'ұсынысты немесе терезені жабу')}</li>
    <li><kbd>ИНТ. / НАТ.</kbd>${T('заголовок сцены: капсом, пустая строка до и после', 'көрініс тақырыбы: бас әріппен, алды-арты бос жол')}</li>
    <li><kbd>ИМЯ</kbd>${T('имя героя капсом на своей строке, под ним реплика; (ремарка) — в скобках', 'кейіпкер есімі бас әріппен, астында реплика')}</li>
    <li><kbd>ИМЯ ^</kbd>${T('двойной диалог (говорят одновременно)', 'қос диалог')}</li>
    <li><kbd>> ПЕРЕХОД:</kbd>${T('переход; > ТЕКСТ < — по центру', 'ауысу; > МӘТІН < — ортада')}</li>
    <li><kbd>[[ ]]</kbd>${T('заметка себе, в печать не идёт', 'өзіңе жазба, басылымға кірмейді')}</li>
    <li><kbd>#</kbd>${T('раздел (акт), = синопсис сцены, === разрыв страницы', 'бөлім (акт), = синопсис, === бет үзілісі')}</li>
  </ul><div class="row" style="margin-top:.8rem"><button class="btn btn--main" data-m="close" type="button">OK</button></div>`, async () => true));
  $('#btnServer').addEventListener('click', serverDialog);
  $('#aiState').addEventListener('click', () => { const p = cur(); if (server && p && !p.server) chooseCtx(p); });

  // ---------- режим NEYRA: Стандарт / PRO ----------
  let tier = 'standard'; try { tier = localStorage.getItem(LS.tier) === 'pro' ? 'pro' : 'standard'; } catch (e) { /* */ }
  function setTier(v) { tier = v === 'pro' ? 'pro' : 'standard'; try { localStorage.setItem(LS.tier, tier); } catch (e) { /* */ } $$('.seg.tier [data-tier]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tier === tier)); }
  $$('.seg.tier [data-tier]').forEach((b) => b.addEventListener('click', () => { setTier(b.dataset.tier); toast(tier === 'pro' ? T('PRO: глубокий разбор всего сценария. На простых действиях со сценой — Стандарт.', 'PRO: бүкіл сценарийді терең талдау. Қарапайым әрекеттерде — Стандарт.') : T('Стандарт', 'Стандарт')); }));
  setTier(tier);
  const HEAVY = { coverage: 1, beats: 1, continuity: 1, logline: 1 }; // всё остальное — простые действия со сценой
  function effectiveTier(info) { if (tier !== 'pro') return 'standard'; if (info.free) return info.scope && info.scope.kind === 'all' ? 'pro' : 'standard'; return HEAVY[info.key] ? 'pro' : 'standard'; }
  // ---------- NEYRA ----------
  function scopeHint() {
    const sel = src.value.slice(src.selectionStart, src.selectionEnd);
    const sc = Fountain.sceneAt(parsed, lineAtCursor(), src.value);
    const mode = $('#scope').value;
    let what;
    if (mode === 'selection' || (mode === 'auto' && sel.trim())) what = sel.trim() ? `${T('выделение', 'белгіленген')} · ${Fountain.countWords(sel)} ${T('сл.', 'сөз')}` : T('ничего не выделено', 'ештеңе белгіленбеген');
    else if (mode === 'scene' || (mode === 'auto' && sc)) what = sc ? `${T('сцена', 'көрініс')} ${sc.scene.num} · ${sc.scene.heading}` : T('сцены нет', 'көрініс жоқ');
    else what = `${T('весь сценарий', 'бүкіл сценарий')} · ${parsed.stats.pages} ${T('стр.', 'бет')}`;
    $('#scopeWhat').textContent = what;
    renderScenes();
  }
  $('#scope').addEventListener('change', scopeHint);
  function getScope(force) {
    const mode = force || $('#scope').value;
    const a = src.selectionStart, b = src.selectionEnd, sel = src.value.slice(a, b);
    const sc = Fountain.sceneAt(parsed, lineAtCursor(), src.value);
    if (mode === 'all') return { kind: 'all', text: src.value, label: T('весь сценарий', 'бүкіл сценарий') };
    if ((mode === 'selection' || mode === 'auto') && sel.trim()) return { kind: 'selection', text: sel, start: a, end: b, label: T('выделенный фрагмент', 'белгіленген үзінді') };
    if ((mode === 'scene' || mode === 'auto') && sc) {
      const lines = src.value.split('\n'); let s0 = 0; for (let i = 0; i < sc.start; i++) s0 += lines[i].length + 1; const e0 = s0 + sc.text.length;
      return { kind: 'scene', text: sc.text, start: s0, end: e0, label: `${T('сцена', 'көрініс')} ${sc.scene.num} «${sc.scene.heading}»` };
    }
    return { kind: 'all', text: src.value, label: T('весь сценарий', 'бүкіл сценарий') };
  }
  const FMT = 'Ответ — только текст в формате Fountain, без вступлений и пояснений.';
  const ACTS = {
    coverage: { scope: 'all', title: 'Читательское заключение', prompt: (t) => `Прочитай сценарий целиком и напиши читательское заключение: логлайн, как ты его понял · синопсис в 10 строк · разбор по элементам (премиса, структура, герой, антагонист, сцены, диалог, темп, тон, мир) · что работает · что не работает, с номерами сцен · 5–10 вопросов автору.\n\nСЦЕНАРИЙ:\n${t}` },
    beats: { scope: 'all', title: 'Бит-шит', prompt: (t, p) => `Разметь сценарий по 15 битам Снайдера: для каждого бита — есть ли он, в какой сцене, на какой примерно странице (всего ≈${p.stats.pages} стр.), и что с ним не так. В конце — какие биты пропущены или стоят не на месте, и один главный вывод о структуре.\n\nСЦЕНАРИЙ:\n${t}` },
    continuity: { scope: 'all', title: 'Проверка непрерывности', prompt: (t) => `Проверь непрерывность: имена и возраста сходятся · день/ночь и время года не прыгают · герой не знает того, чего ещё не узнал · ружья из первого акта стреляют · ничего не исчезло без объяснения · факты реального мира, которые стоит [уточнить]. Выдай список расхождений с номерами сцен. Если всё чисто — скажи, что именно проверил.\n\nСЦЕНАРИЙ:\n${t}` },
    improve: { title: 'Улучшить сцену', rewrite: true, prompt: (t, p, s) => `Перепиши ${s.label}, усилив три вещи: чего герой хочет здесь, что мешает, что изменилось к концу. Входи позже, выходи раньше. Сохрани голос автора, имена и факты. ${FMT}\n\nТЕКСТ:\n${t}` },
    dialogue: { title: 'Диалог живее', rewrite: true, prompt: (t, p, s) => `Перепиши диалог в ${s.label}: убери прямую экспозицию, добавь подтекст, сделай каждого героя узнаваемым по реплике без имени, сократи лишние первые и последние реплики. Действие и структуру не меняй. ${FMT}\n\nТЕКСТ:\n${t}` },
    modernize: { title: 'Модернизировать', rewrite: true, prompt: (t, p, s) => `Модернизируй ${s.label}: перенеси в наше время (${new Date().getFullYear()}), современный живой язык, реальные сегодняшние детали быта, связи и технологий (телефоны, мессенджеры, такси, камеры), без штампов и без «как ты знаешь». Суть конфликта и характеры сохрани. ${FMT}\n\nТЕКСТ:\n${t}` },
    turns: { title: 'Три поворота', prompt: (t, p, s) => `Для ${s.label} предложи три разных варианта ключевого поворота (что меняется к концу сцены). Для каждого: одна строка сути · как меняется последняя треть сцены (3–6 строк в формате Fountain) · чем это платит дальше по истории. Не выбирай за автора.\n\nТЕКСТ:\n${t}` },
    logline: { scope: 'all', title: 'Логлайн и синопсис', toMeta: true, prompt: (t) => `По сценарию напиши: ЛОГЛАЙН (1–2 фразы по формуле герой с изъяном / цель / ставки / препятствие) · ЖАНР и формат · СИНОПСИС в 10–12 строк. Отвечай строго в виде трёх блоков с заголовками ЛОГЛАЙН:, ЖАНР:, СИНОПСИС: на отдельных строках.\n\nСЦЕНАРИЙ:\n${t}` },
    kazakh: { title: 'На казахский', rewrite: true, prompt: (t, p, s) => `Переведи ${s.label} на казахский язык, сохранив формат Fountain: заголовки сцен капсом (ІШКІ. / СЫРТҚЫ. вместо ИНТ. / НАТ.), имена героев капсом, ремарки в скобках. Речь живая, разговорная, по характеру героев. ${FMT}\n\nТЕКСТ:\n${t}` },
    russian: { title: 'На русский', rewrite: true, prompt: (t, p, s) => `Переведи ${s.label} на русский язык, сохранив формат Fountain: заголовки сцен капсом (ИНТ. / НАТ.), имена героев капсом, ремарки в скобках. Речь живая, разговорная, по характеру героев. ${FMT}\n\nТЕКСТ:\n${t}` },
    expand: { title: 'Расписать в сцены', rewrite: true, prompt: (t, p, s) => `Расписать ${s.label} в сцены: если это синопсис, заметка или поэпизодник — преврати в черновик сцен в формате Fountain (заголовки сцен, действие, диалог). Если это уже сцена — расширь её, добавив недостающие биты. Отметь [[заметками]] места, где нужны решения автора. ${FMT}\n\nТЕКСТ:\n${t}` },
    cut: { title: 'Сжать', rewrite: true, prompt: (t, p, s) => `Сократи ${s.label} примерно на треть без потери сути: входи поздно, выходи рано, убери повторы и описания, которые камера не покажет. ${FMT}\n\nТЕКСТ:\n${t}` },
  };
  function ctx(p) { // память проекта — в каждую просьбу
    const m = p.meta || {}; const bits = [];
    if (m.logline) bits.push('Логлайн: ' + m.logline.trim());
    if (m.genre) bits.push('Жанр/формат: ' + m.genre.trim());
    if (m.synopsis) bits.push('Синопсис автора: ' + m.synopsis.trim().slice(0, 1500));
    const bs = Object.entries(p.beats || {}).filter(([, v]) => v && v.trim()).map(([i, v]) => `${+i + 1}. ${BEATS[i][0]}: ${v.trim()}`);
    if (bs.length) bits.push('Биты (план автора): ' + bs.join(' · ').slice(0, 1500));
    if (m.notes) bits.push('Заметки автора: ' + m.notes.trim().slice(-800));
    return bits.length ? 'ПАМЯТЬ ПРОЕКТА (контекст, не для пересказа):\n' + bits.join('\n') + '\n\n' : '';
  }
  $('#actions').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) runAct(b.dataset.act); });
  async function runAct(key) {
    const act = ACTS[key]; const s = getScope(act.scope);
    if (!s.text.trim()) return toast(T('Нечего отправлять: сценарий пуст', 'Жіберетін ештеңе жоқ: сценарий бос'));
    const prompt = ctx(cur()) + act.prompt(s.text, parsed, s) + (lang === 'kz' && !/На (казахский|русский)/.test(act.title) ? '\n\nОтвечай на казахском языке.' : '');
    await ask(prompt, act.title + ' · ' + s.label, { act, scope: s, key });
  }
  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#askIn').value.trim(); if (!q) return; $('#askIn').value = ''; const s = getScope(); ask(ctx(cur()) + `${q}\n\n(${s.label.toUpperCase()}):\n${s.text}`, q, { scope: s, free: true }); });
  $('#askIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#askForm').requestSubmit(); } });

  async function ask(prompt, label, info) {
    if (busy) return toast(T('NEYRA ещё отвечает', 'NEYRA әлі жауап беруде'));
    if (!server && !IS_LOCAL) { addMsg({ role: 'assistant', label: T('нет связи с NEYRA', 'NEYRA-мен байланыс жоқ'), text: T('Чтобы NEYRA отвечала, подключите сервер команды: кнопка «Сервер» → ключ участника. Ключ выдаёт продюсер проекта.', 'NEYRA жауап беруі үшін команда серверін қосыңыз: «Сервер» түймесі → қатысушы кілті.'), err: true }); return; }
    busy = true;
    const pid = currentId, p = cur();
    const useTier = effectiveTier(info); if (useTier === 'pro') label += ' · PRO';
    p.chat.push({ role: 'user', label, ts: Date.now() }); renderChat();
    const wait = addMsg({ role: 'assistant', label: T('NEYRA думает', 'NEYRA ойлануда'), text: '', wait: true });
    try {
      const history = p.chat.filter((m) => m.role === 'assistant' && m.text).slice(-2).map((m) => ({ role: 'assistant', content: m.text.slice(0, 3000) }));
      let j;
      if (server) {
        const slug = p.server || p.ctxSlug; // сценарий из браузера: без памяти проекта, пока автор сам её не подключит (щелчок по строке состояния)
        const path = slug ? '/api/projects/' + encodeURIComponent(slug) + '/assistant' : '/api/assistant';
        let r;
        try { r = await serverFetch(path, 'POST', { question: prompt, section: 'script', history: info.free ? history : [], tier: useTier }); }
        catch (e) { if (!slug && /404|не найден/i.test(e.message)) throw new Error(T('Сервер команды ещё не обновлён до режима «без проекта». Подключите память проекта щелчком по строке состояния или обновите сервер.', 'Команда сервері әлі жаңартылмаған. Жоба жадын қосыңыз немесе серверді жаңартыңыз.')); throw e; }
        j = { text: (r.data && r.data.answer) || '' };
      } else {
        const messages = [];
        if (history.length && info.free) { messages.push({ role: 'user', content: 'Напоминание о предыдущих ответах по этому сценарию.' }); messages.push({ role: 'assistant', content: history.map((h) => h.content).join('\n---\n') }); }
        messages.push({ role: 'user', content: prompt });
        const r = await fetch(apiBase + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, max_tokens: info.scope && info.scope.kind === 'all' ? 6000 : 3000, tier: useTier }) });
        j = await r.json().catch(() => ({ error: T('сервер ответил не JSON', 'сервер JSON емес жауап берді') }));
        if (!r.ok || j.error) throw new Error(j.error || (T('ошибка ', 'қате ') + r.status));
      }
      wait.remove();
      const text = (j.text || '').trim();
      const target = projects[pid]; if (!target) return;
      target.chat.push({ role: 'assistant', label, text, key: info.key, rewrite: !!(info.act && info.act.rewrite), scope: info.scope ? { kind: info.scope.kind, start: info.scope.start, end: info.scope.end, label: info.scope.label, original: info.scope.kind === 'all' ? '' : info.scope.text } : null, ts: Date.now() });
      if (target.chat.length > 40) target.chat = target.chat.slice(-40);
      save(); if (pid === currentId) renderChat();
      if (info.act && info.act.toMeta) applyMeta(pid, text);
    } catch (err) {
      wait.remove(); if (pid === currentId) addMsg({ role: 'assistant', label: T('не получилось', 'болмады'), text: err.message, err: true });
    } finally { busy = false; }
  }
  function applyMeta(pid, text) {
    const p = projects[pid]; if (!p) return;
    const grab = (k) => { const m = text.match(new RegExp(k + ':\\s*([\\s\\S]*?)(?=\\n[А-ЯЁ ]{3,}:|$)')); return m ? m[1].trim() : ''; };
    const l = grab('ЛОГЛАЙН'), g = grab('ЖАНР'), s = grab('СИНОПСИС');
    if (l) p.meta.logline = l; if (g) p.meta.genre = g; if (s) p.meta.synopsis = s;
    save();
    if (pid === currentId) { $('#f-logline').value = p.meta.logline; $('#f-genre').value = p.meta.genre; $('#f-synopsis').value = p.meta.synopsis; toast(T('Карточка «Замысел» заполнена', '«Ой» карточкасы толтырылды')); }
  }
  function renderChat() {
    chat.innerHTML = '';
    const p = cur(); if (!p) return;
    if (!p.chat.length) { chat.innerHTML = `<div class="empty">${T('Выберите, с чем работать, и нажмите действие. Ответы, которые переписывают текст, можно вставить в сценарий одной кнопкой; старый текст уходит в заметки.', 'Немен жұмыс істейтініңізді таңдап, әрекетті басыңыз. Мәтінді қайта жазатын жауаптарды бір түймемен сценарийге қоюға болады.')}</div>`; return; }
    for (const m of p.chat) addMsg(m, true);
    chat.scrollTop = chat.scrollHeight;
  }
  function addMsg(m, noScroll) {
    const d = document.createElement('div');
    d.className = 'msg ' + (m.role === 'user' ? 'u' : 'a') + (m.err ? ' err' : '') + (m.wait ? ' wait' : '');
    d.innerHTML = `<div class="lbl">${esc(m.role === 'user' ? T('Запрос · ', 'Сұрау · ') + m.label : m.label)}</div>${m.text ? `<div class="body">${esc(m.text)}</div>` : ''}`;
    if (m.role === 'assistant' && m.text && !m.err) {
      const ops = document.createElement('div'); ops.className = 'ops';
      const mk = (l, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.addEventListener('click', f); ops.appendChild(b); };
      if (m.rewrite && m.scope && m.scope.kind !== 'all') mk(T('Заменить ', 'Ауыстыру: ') + (m.scope.kind === 'scene' ? T('сцену', 'көрініс') : T('выделенное', 'белгіленген')), () => replaceRange(m));
      mk(T('Вставить в текст', 'Мәтінге қою'), () => insertAtCursor(m.text.replace(/\n*$/, '\n\n')));
      mk(T('Копировать', 'Көшіру'), () => navigator.clipboard.writeText(m.text).then(() => toast(T('Скопировано', 'Көшірілді'))));
      mk(T('В заметки', 'Жазбаларға'), () => { cur().meta.notes = (cur().meta.notes ? cur().meta.notes + '\n\n' : '') + '— ' + m.label + ' —\n' + m.text; $('#f-notes').value = cur().meta.notes; save(); toast(T('Добавлено в «Замысел → Заметки»', '«Ой → Жазбалар» бөліміне қосылды')); });
      d.appendChild(ops);
    }
    chat.appendChild(d); if (!noScroll) chat.scrollTop = chat.scrollHeight; return d;
  }
  function replaceRange(m) {
    const s = m.scope; const v = src.value;
    let start = s.start, end = s.end;
    const original = s.original || '';
    if (!original.trim()) return toast(T('Исходный фрагмент не сохранён, вставьте вручную', 'Бастапқы үзінді сақталмаған, қолмен қойыңыз'));
    if (v.slice(start, end) !== original) { // текст сдвинулся — ищем исходный фрагмент по содержимому
      const idx = v.indexOf(original);
      if (idx < 0) return toast(T('Исходный текст уже изменён — вставьте ответ вручную', 'Бастапқы мәтін өзгертілген — жауапты қолмен қойыңыз'));
      start = idx; end = idx + original.length;
    }
    if (!confirm(T(`Заменить ${s.label} текстом NEYRA? Старый текст уйдёт в заметки и в версию.`, `${s.label} NEYRA мәтінімен ауыстыру керек пе? Ескі мәтін жазбалар мен нұсқаға кетеді.`))) return;
    snapshot(T('до замены: ', 'ауыстыруға дейін: ') + s.label);
    cur().meta.notes = (cur().meta.notes ? cur().meta.notes + '\n\n' : '') + `— ${T('было', 'бұрын')} (${s.label}, ${new Date().toLocaleString('ru')}) —\n` + original; $('#f-notes').value = cur().meta.notes;
    src.value = v.slice(0, start) + m.text.replace(/\n*$/, '\n') + v.slice(end);
    src.setSelectionRange(start, start + m.text.length); src.focus(); src.dispatchEvent(new Event('input')); toast(T('Заменено. Старый текст — в заметках и версиях', 'Ауыстырылды. Ескі мәтін — жазбалар мен нұсқаларда'));
  }

  async function chooseCtx(p) {
    let arr; try { const lst = await serverFetch('/api/projects'); arr = (lst.data && (lst.data.projects || lst.data)) || []; } catch (e) { toast(T('Сервер: ', 'Сервер: ') + e.message); return ''; }
    if (!Array.isArray(arr) || !arr.length) { toast(T('У ключа нет ни одного проекта на сервере', 'Кілттің серверде бірде-бір жобасы жоқ')); return ''; }
    return new Promise((resolve) => {
      let picked = '';
      modal(`<h2>${T('Память для NEYRA', 'NEYRA жады')}</h2><p>${T('Этот сценарий хранится в браузере, и NEYRA отвечает только по его тексту. Если это часть проекта команды, подключите его: NEYRA будет помнить героев, мир и решения проекта.', 'Бұл сценарий браузерде сақталады. NEYRA жауап бергенде қай команда жобасының кейіпкерлері мен шешімдерін есте сақтайтынын таңдаңыз.')}</p><ul class="keys" style="margin-bottom:.8rem">${arr.map((x) => `<li><button class="btn btn--sm" type="button" data-m="p:${esc(x.slug)}">${esc(typeof x.title === 'string' ? x.title : (x.title && x.title.ru) || x.slug)}</button><span class="caps">${esc(x.slug)}</span></li>`).join('')}</ul><div class="row"><button class="btn" data-m="none" type="button">${T('Без памяти проекта', 'Жоба жадысыз')}</button><button class="btn" data-m="close" type="button">${T('Отмена', 'Болдырмау')}</button></div>`,
        async (act) => { if (act === 'none') { p.ctxSlug = ''; save(); checkApi(); return true; } if (!act.startsWith('p:')) return false; picked = act.slice(2); p.ctxSlug = picked; save(); checkApi(); return true; });
      const iv = setInterval(() => { if (!document.querySelector('.modal')) { clearInterval(iv); resolve(picked); } }, 200);
    });
  }
  async function checkApi() {
    const dot = $('#aiDot'), st = $('#aiState');
    if (server) {
      try { await serverFetch('/api/me'); dot.className = 'dot on'; const p = cur(); st.textContent = T('сервер команды', 'команда сервері') + (p && p.server ? ' · ' + p.server : (p && p.ctxSlug ? ' · ' + T('память', 'жады') + ': ' + p.ctxSlug : ' · ' + T('без памяти проекта', 'жоба жадысыз'))); st.style.cursor = (p && !p.server) ? 'pointer' : ''; st.title = (p && !p.server) ? T('Сменить проект-память для NEYRA', 'NEYRA жадын ауыстыру') : ''; }
      catch (e) { dot.className = 'dot off'; st.textContent = T('сервер: ', 'сервер: ') + e.message; }
      return;
    }
    if (!IS_LOCAL) { dot.className = 'dot off'; st.textContent = T('нужен ключ участника → «Сервер»', 'қатысушы кілті керек → «Сервер»'); return; }
    try { const r = await fetch(apiBase + '/api/status'); const j = await r.json(); dot.className = 'dot ' + (j.key ? 'on' : 'off'); st.textContent = j.key ? T('на связи (станция)', 'байланыста (станция)') : T('ключ не задан на станции', 'станцияда кілт жоқ'); }
    catch (e) { dot.className = 'dot off'; st.textContent = T('нет сервера станции', 'станция сервері жоқ'); }
  }

  // ---------- утилиты ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  let tt; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 2600); }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.key === 'А' || e.key === 'а')) { e.preventDefault(); toggleFocus(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'ы')) {
      e.preventDefault(); flush();
      if (serverMode && serverMode.loaded && cur().server) { const stamp = new Date(); const label = 'редактор · ' + stamp.toLocaleDateString('ru-RU') + ' ' + stamp.toTimeString().slice(0, 5); serverVersion(label).then(() => { setSaveState(T('версия на сервере · ', 'серверде нұсқа · ') + label); toast(T('Версия сценария зафиксирована на сервере', 'Сценарий нұсқасы серверде бекітілді')); }).catch((err) => toast(T('Сервер не принял версию: ', 'Сервер нұсқаны қабылдамады: ') + err.message)); }
      else if (!storageOk) toast(T('Хранилище браузера недоступно — скачайте .fountain', 'Браузер қоймасы қолжетімсіз — .fountain жүктеңіз'));
      else { snapshot('') ? toast(T('Версия сохранена в браузере', 'Нұсқа браузерде сақталды')) : toast(T('Без изменений с прошлой версии', 'Өткен нұсқадан бері өзгеріс жоқ')); }
    }
  });

  // ---------- старт ----------
  if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embed');
  (function () { let l = new URLSearchParams(location.search).get('lang'); if (!l) { try { l = localStorage.getItem(LS.lang); } catch (e) { /* */ } } setLang(l || 'ru'); })();
  if (!Object.keys(projects).length) newProject('Последний поезд (пример)', DEMO);
  if (!projects[currentId]) currentId = Object.keys(projects)[0];
  open(currentId); checkApi();
  const qSlug = new URLSearchParams(location.search).get('project');
  if (qSlug) { if (server) serverOpen(qSlug).catch((e) => { setSaveState(T('сервер: ', 'сервер: ') + e.message); toast(T('Не удалось открыть сценарий с сервера: ', 'Серверден сценарий ашылмады: ') + e.message); }); else toast(T('Для проекта с сервера нужен ключ участника → «Сервер»', 'Сервердегі жоба үшін қатысушы кілті керек → «Сервер»')); }
  else if (cur().server && server) serverOpen(cur().server).catch(() => { serverMode = null; });
})();
