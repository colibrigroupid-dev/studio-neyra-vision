/* Сценарная studio.neyra.vision. Лист сценария (editor.js) + проект (localStorage или сервер команды) + NEYRA. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const LS = { projects: 'nvs.projects', current: 'nvs.current', lang: 'nv-lang', paper: 'neyra-vision-script-paper-v1', server: 'neyra-vision-server-settings-v1', tier: 'nvs.tier', api: 'nvs.api', doc: 'nvs.doc' };
  const DEFAULT_SERVER = 'https://api.studio.neyra.vision';
  const IS_LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
  const STUDIO = '../studio/';

  // ---------- язык ----------
  const KZ = {
    'Сценарная': 'Сценарий беті', 'Режиссёрская': 'Режиссёр беті', 'Титульная страница': 'Титул беті', 'Синопсис': 'Синопсис', 'Сценарий': 'Сценарий', 'Статистика': 'Статистика', 'Персонажи': 'Кейіпкерлер', 'Локации': 'Локациялар',
    'Длительность': 'Ұзақтығы', 'стр.': 'бет', 'Заголовок сцены': 'Көрініс тақырыбы', 'Описание действия': 'Әрекет сипаттамасы', 'Персонаж': 'Кейіпкер', 'Ремарка': 'Ремарка', 'Реплика': 'Реплика', 'Лирика': 'Лирика', 'Кадр': 'Кадр', 'Переход': 'Ауысу', 'Заметка по тексту': 'Мәтін жазбасы', 'Группа (эпизод)': 'Топ (эпизод)', 'Акт': 'Акт', 'Разрыв страницы': 'Бет үзілісі',
    'сохранено': 'сақталды', 'проверяю связь': 'байланысты тексеру', 'Название': 'Атауы', 'Подзаголовок / жанр': 'Тақырыпша / жанр', 'Автор': 'Автор', 'Дата черновика': 'Черновик күні', 'Контакты': 'Байланыс', 'Логлайн': 'Логлайн', 'Заметки': 'Жазбалар',
    'Стандарт': 'Стандарт', 'Работать с': 'Жұмыс', 'выделение → сцена → всё': 'белгіленген → көрініс → бәрі', 'выделенным': 'белгіленгенмен', 'текущей сценой': 'ағымдағы көрініспен', 'всем сценарием': 'бүкіл сценариймен',
    'Читательское заключение': 'Оқырман қорытындысы', 'весь сценарий: что работает, что ломается': 'бүкіл сценарий: не жұмыс істейді, не бұзылады', 'Бит-шит': 'Бит-парақ', '15 битов, где дыра': '15 бит, қайда олқылық', 'Непрерывность': 'Үздіксіздік', 'имена, время, ружья': 'есімдер, уақыт, мылтықтар',
    'Улучшить сцену': 'Көріністі жақсарту', 'цель · препятствие · перемена': 'мақсат · кедергі · өзгеріс', 'Диалог живее': 'Диалогты жандандыру', 'подтекст, голоса героев': 'астарлы мән, дауыстар', 'Модернизировать': 'Жаңғырту', 'в наше время и язык': 'бүгінгі заман мен тілге', '3 поворота': '3 бұрылыс', 'варианты для сцены': 'көрініске нұсқалар',
    'Логлайн и синопсис': 'Логлайн және синопсис', 'в документ «Синопсис»': '«Синопсис» құжатына', 'На казахский': 'Қазақшаға', 'На русский': 'Орысшаға', 'перевод с форматом': 'форматымен аудару', 'Расписать': 'Көріністерге жазу', 'из синопсиса — сцены': 'синопсистен — көріністер', 'Сжать': 'Қысқарту', 'входи поздно, выходи рано': 'кеш кір, ерте шық',
  };
  let lang = 'ru';
  const T = (ru, kz) => (lang === 'kz' ? kz : ru);
  function setLang(l) {
    lang = l === 'kz' ? 'kz' : 'ru';
    document.documentElement.setAttribute('data-lang', lang); document.documentElement.lang = lang === 'kz' ? 'kk' : 'ru';
    try { localStorage.setItem(LS.lang, lang); } catch (e) { /* */ }
    $$('[data-t]').forEach((el) => { const k = el.dataset.t; el.textContent = lang === 'kz' && KZ[k] ? KZ[k] : k; });
    $$('[data-tp]').forEach((el) => { if (!el.dataset.pRu) el.dataset.pRu = el.placeholder; el.placeholder = lang === 'kz' ? el.dataset.tp : el.dataset.pRu; });
    refreshAll(); checkApi();
  }

  // ---------- состояние ----------
  let projects = load(LS.projects, {});
  let currentId = null; try { currentId = localStorage.getItem(LS.current); } catch (e) { /* */ }
  let storageOk = true, busy = false, pendingSave = null, curDoc = 'script', loading = false;
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save() {
    try { localStorage.setItem(LS.projects, JSON.stringify(projects)); localStorage.setItem(LS.current, currentId); storageOk = true; setSaveState(T('сохранено', 'сақталды')); serverSave(); return true; }
    catch (e) { storageOk = false; setSaveState(T('не сохраняется', 'сақталмайды')); return false; }
  }
  function setSaveState(t) { $('#saveState').textContent = t; }
  function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36); }
  function cur() { return projects[currentId]; }
  function blank(title, text) { return { id: uid(), title: title || T('Без названия', 'Атаусыз'), text: text || '', created: Date.now(), updated: Date.now(), beats: {}, meta: { logline: '', genre: '', synopsis: '', notes: '', credit: '', author: '', date: '', contact: '' }, chat: [], versions: [] }; }
  function newProject(title, text) { const p = blank(title, text); projects[p.id] = p; currentId = p.id; save(); return p; }

  // ---------- лист ----------
  const ed = ScriptEditor.create($('#editor'), {});
  function flush() { if (pendingSave) { clearTimeout(pendingSave); pendingSave = null; const p = cur(); if (p) { const t = ed.text(); if (t !== p.text) { p.text = t; p.updated = Date.now(); save(); } } } }
  ed.onChange = () => { if (loading) { refreshAll(); updateTypeBox(); return; } setSaveState(T('пишу…', 'жазып жатырмын…')); clearTimeout(pendingSave); pendingSave = setTimeout(() => { pendingSave = null; const p = cur(); if (!p) return; const t = ed.text(); if (t !== p.text) { p.text = t; p.updated = Date.now(); save(); } refreshAll(); }, 250); updateTypeBox(); };
  ed.onCaret = () => { updateTypeBox(); markCurrentScene(); scopeHint(); };
  function updateTypeBox() { const p = ed.curPara(); if (p) $('#ptype').value = ed.typeOf(p); }
  $('#ptype').addEventListener('change', (e) => { ed.setType(e.target.value); ed.root.focus(); });
  $('#btnUndo').addEventListener('click', () => { ed.undo(); ed.root.focus(); });
  $('#btnRedo').addEventListener('click', () => { ed.redo(); ed.root.focus(); });
  window.addEventListener('beforeunload', flush); document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  // ---------- сервер команды ----------
  let server = (() => { const s = load(LS.server, null); return s && s.key ? { url: String(s.url || DEFAULT_SERVER).replace(/\/+$/, ''), key: s.key } : null; })();
  let serverMode = null;
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
    if (meta.data && meta.data.synopsis && !projects[id].meta.synopsis) projects[id].meta.synopsis = meta.data.synopsis;
    serverMode = { slug, lastText: text, timer: null, loaded: true };
    currentId = id; save(); open(id);
    setSaveState(T('сценарий с сервера', 'серверден сценарий')); checkApi();
  }
  function serverSave() {
    if (!serverMode || !serverMode.loaded || currentId !== 'srv:' + serverMode.slug) return;
    if (cur().text === serverMode.lastText) return;
    clearTimeout(serverMode.timer);
    const slug = serverMode.slug, text = cur().text;
    serverMode.timer = setTimeout(async () => {
      try { await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/script', 'PUT', { text }); if (serverMode && serverMode.slug === slug) { serverMode.lastText = text; setSaveState(T('сохранено на сервере', 'серверде сақталды')); } }
      catch (e) { setSaveState(T('сервер не принял', 'сервер қабылдамады')); toast(T('Сервер не принял: ', 'Сервер қабылдамады: ') + e.message); }
    }, 1200);
  }
  async function serverVersion(label) {
    const slug = serverMode.slug; clearTimeout(serverMode.timer);
    await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/script', 'PUT', { text: cur().text }); serverMode.lastText = cur().text;
    await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/versions', 'POST', { label });
  }
  function serverDialog() {
    const s = load(LS.server, {}) || {};
    modal(`<h2>${T('Сервер команды', 'Команда сервері')}</h2><p>${T('Ключ участника выдаёт продюсер проекта. С ключом открываются проекты команды, черновик хранится на сервере, NEYRA помнит весь проект, а «Режиссёрская» видит тот же сценарий.', 'Қатысушы кілтін жоба продюсері береді.')}</p>
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
        checkApi(); toast(T('Ключ принят. Проекты команды — в меню ≡', 'Кілт қабылданды. Команда жобалары — ≡ мәзірінде')); return true;
      });
  }
  async function serverProjects() {
    if (!server) return serverDialog();
    let j; try { j = await serverFetch('/api/projects'); } catch (err) { return toast(T('Сервер: ', 'Сервер: ') + err.message); }
    const arr = (j.data && (j.data.projects || j.data)) || [];
    if (!Array.isArray(arr) || !arr.length) return toast(T('На сервере нет доступных проектов', 'Серверде қолжетімді жобалар жоқ'));
    modal(`<h2>${T('Проекты команды', 'Команда жобалары')}</h2><ul class="keys" style="margin-bottom:.8rem">${arr.map((p) => `<li><button class="btn btn--sm" type="button" data-m="p:${esc(p.slug)}">${esc(typeof p.title === 'string' ? p.title : (p.title && p.title.ru) || p.slug)}</button><span class="caps">${esc(p.slug)}</span></li>`).join('')}</ul><div class="row"><button class="btn" data-m="close" type="button">${T('Закрыть', 'Жабу')}</button></div>`,
      async (act) => { if (!act.startsWith('p:')) return false; try { flush(); await serverOpen(act.slice(2)); } catch (err) { toast(T('Не удалось открыть: ', 'Ашу мүмкін болмады: ') + err.message); return false; } return true; });
  }
  async function checkApi() {
    const dot = $('#aiDot'), st = $('#aiStateText'), p = cur();
    $('#lnkDirector').href = STUDIO + (p && p.server ? '?proekt=' + encodeURIComponent(p.server) + '#/studio/heroes' : '');
    if (server) {
      try { await serverFetch('/api/me'); dot.className = 'dot on'; st.textContent = (p && p.server) ? T('сервер команды · ', 'команда сервері · ') + p.server : T('сервер команды · этот сценарий в браузере', 'команда сервері · бұл сценарий браузерде'); }
      catch (e) { dot.className = 'dot off'; st.textContent = T('сервер: ', 'сервер: ') + e.message; }
      return;
    }
    dot.className = 'dot off'; st.textContent = IS_LOCAL ? T('станция', 'станция') : T('нет ключа участника', 'қатысушы кілті жоқ');
  }
  $('#aiState').addEventListener('click', serverDialog);

  // ---------- проект: открыть ----------
  function open(id) {
    if (!projects[id]) return;
    flush();
    currentId = id; try { localStorage.setItem(LS.current, id); } catch (e) { /* */ }
    const p = cur(); if (!p.versions) p.versions = []; if (!p.meta) p.meta = {}; if (!p.server) serverMode = null;
    $('#title').value = p.title;
    loading = true; try { ed.load(p.text); } finally { loading = false; }
    ['logline', 'synopsis', 'notes'].forEach((k) => { $('#f-' + k).value = p.meta[k] || ''; });
    const tp = Fountain.parse(p.text).title; const tf = (keys) => { for (const k of keys) if (tp[k]) return tp[k]; return ''; };
    $('#t-title').value = tf(['Title', 'Название']); $('#t-credit').value = tf(['Credit', 'Сценарий']); $('#t-author').value = tf(['Author', 'Authors', 'Автор']); $('#t-date').value = tf(['Draft date', 'Дата']); $('#t-contact').value = tf(['Contact', 'Контакт']);
    renderChat(); refreshAll(); showDoc(curDoc === 'script' ? 'script' : curDoc); checkApi();
    const first = ed.paras()[0]; if (first && curDoc === 'script') ed.focusPara(first, 0);
  }
  $('#title').addEventListener('input', () => { cur().title = $('#title').value; save(); });
  ['logline', 'synopsis', 'notes'].forEach((k) => $('#f-' + k).addEventListener('input', (e) => { cur().meta[k] = e.target.value; save(); }));
  // титульная страница живёт в начале Fountain-текста
  ['title', 'credit', 'author', 'date', 'contact'].forEach((k) => $('#t-' + k).addEventListener('input', () => { writeTitlePage(); renderTitlePreview(); }));
  function titleBlock() {
    const v = (id) => $(id).value.trim(); const out = [];
    if (v('#t-title')) out.push('Title: ' + v('#t-title')); if (v('#t-credit')) out.push('Credit: ' + v('#t-credit')); if (v('#t-author')) out.push('Author: ' + v('#t-author')); if (v('#t-date')) out.push('Draft date: ' + v('#t-date')); if (v('#t-contact')) out.push('Contact: ' + v('#t-contact').split('\n').join('\n    '));
    return out.length ? out.join('\n') + '\n\n' : '';
  }
  function writeTitlePage() { const p = cur(); const body = ed.text(); p.text = titleBlock() + body; p.updated = Date.now(); save(); }
  // ed.text() не содержит титульную страницу — склеиваем при сохранении
  const edText = ed.text; ed.text = () => titleBlock() + edText();

  // ---------- документы ----------
  function showDoc(doc) {
    curDoc = doc; try { localStorage.setItem(LS.doc, doc); } catch (e) { /* */ }
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + doc));
    $$('.doc-i').forEach((b) => b.classList.toggle('on', b.dataset.doc === doc));
    $('#tb').classList.toggle('hidden', doc !== 'script'); $('#ruler').classList.toggle('hidden', doc !== 'script');
    $('#scenesPane').classList.toggle('hidden', doc !== 'script');
    if (doc === 'title') renderTitlePreview(); if (doc === 'stats') renderStats(); if (doc === 'chars') renderChars(); if (doc === 'locs') renderLocs();
    document.body.classList.remove('show-nav');
    if (doc === 'script') ed.root.focus();
  }
  $('#docs').addEventListener('click', (e) => { const b = e.target.closest('[data-doc]'); if (b) showDoc(b.dataset.doc); });
  $('#mobNav').addEventListener('click', () => document.body.classList.toggle('show-nav'));

  function refreshAll() { renderScenes(); renderRuler(); renderCounts(); renderStoreNote(); markPages(); }
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }
  function renderScenes() {
    const ul = $('#scenes'); const sc = ed.scenes(); const st = ed.stats();
    ul.innerHTML = sc.length ? '' : `<li class="empty">${T('Сцен пока нет. Первый абзац — заголовок: ИНТ. МЕСТО - ВРЕМЯ, затем Enter.', 'Көріністер әзірге жоқ. Бірінші абзац — тақырып: ІШКІ. ОРЫН - УАҚЫТ, сосын Enter.')}</li>`;
    for (const s of sc) {
      const li = document.createElement('li'); li.dataset.i = s.index;
      li.innerHTML = `<div class="h"><span class="n">${s.num}.</span><b>${esc(s.heading)}</b><span class="d">${fmt(s.seconds)}</span></div>${s.firstAction ? `<div class="a">${esc(s.firstAction)}</div>` : ''}`;
      li.addEventListener('click', () => { ed.focusPara(s.el, 0); s.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); document.body.classList.remove('show-nav'); });
      ul.appendChild(li);
    }
    renderCounter(st);
    // номера сцен на листе
    ed.paras().forEach((p) => { const n = p.querySelector('.sn'); if (n) n.remove(); });
    markCurrentScene();
  }
  let counterMode = 'duration'; try { counterMode = localStorage.getItem('nvs.counter') || 'duration'; } catch (e) { /* */ }
  function counterLines(st) { const chars = ed.paras().reduce((n, p) => n + (p.textContent || '').trim().length, 0); const charsSp = ed.paras().reduce((n, p) => n + (p.textContent || '').trim().replace(/\s+/g, '').length, 0); return [
    ['duration', T('Длительность', 'Ұзақтығы') + ': ' + fmt(st.seconds)],
    ['pages', st.pages + ' ' + T(plural(st.pages, 'страница', 'страницы', 'страниц'), 'бет')],
    ['scenes', st.scenes + ' ' + T(plural(st.scenes, 'сцена', 'сцены', 'сцен'), 'көрініс')],
    ['words', st.words + ' ' + T(plural(st.words, 'слово', 'слова', 'слов'), 'сөз')],
    ['chars', charsSp + ' ' + T(plural(charsSp, 'символ', 'символа', 'символов'), 'таңба')],
    ['charsSp', chars + ' ' + T(plural(chars, 'символ', 'символа', 'символов') + ' с пробелами', 'таңба (бос орынмен)')],
  ]; }
  function plural(n, a, b, c) { n = Math.abs(Math.round(n)); const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return a; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b; return c; }
  function renderCounter(st) { const rows = counterLines(st || ed.stats()); const row = rows.find((r) => r[0] === counterMode) || rows[0]; $('#counterText').textContent = row[1]; }
  $('#counter').addEventListener('click', (e) => { const rows = counterLines(ed.stats()); menu(e.currentTarget, rows.map(([k, label]) => ({ label, on: k === counterMode, run: () => { counterMode = k; try { localStorage.setItem('nvs.counter', k); } catch (err) { /* */ } renderCounter(); } }))); });
  function markCurrentScene() {
    const p = ed.curPara(); if (!p) return; const ps = ed.paras(); let idx = 0, cur = 0;
    for (const q of ps) { if (ed.typeOf(q) === 'scene_heading') idx++; if (q === p) { cur = idx; break; } }
    $$('#scenes li').forEach((li) => li.classList.toggle('cur', +li.dataset.i === cur));
    renderRuler(cur);
  }
  function renderRuler(curIdx) {
    const r = $('#ruler'); const sc = ed.scenes(); const total = Math.max(60, ed.stats().seconds); const w = r.clientWidth || 800;
    const step = total <= 180 ? 10 : total <= 900 ? 30 : 60; let h = '';
    for (let s = 0; s <= total; s += step) h += `<div class="tick" style="left:${(s / total * w).toFixed(1)}px">${fmt(s)}</div>`;
    let acc = 0; for (const s of sc) { if (curIdx && s.index === curIdx) { h += `<div class="pos" style="left:${(acc / total * w).toFixed(1)}px"></div>`; } acc += s.seconds; }
    r.innerHTML = h;
  }
  function markPages() { ed.paras().forEach((p) => { p.classList.remove('pgmark'); delete p.dataset.page; }); for (const m of ed.pageMarks()) { m.el.classList.add('pgmark'); m.el.dataset.page = m.page; } }
  function renderCounts() { const st = ed.stats(); $('#charsCount').textContent = st.characters || ''; $('#locsCount').textContent = locations().length || ''; }
  function characters() {
    const map = {}; let scene = 0;
    for (const p of ed.paras()) { const t = ed.typeOf(p); const txt = (p.textContent || '').trim(); if (t === 'scene_heading') scene++; if (t === 'character') { const n = txt.toUpperCase().replace(/\s*\(.*$/, '').replace(/\s*\^\s*$/, '').trim(); if (!n) continue; const c = map[n] || (map[n] = { name: n, lines: 0, words: 0, scenes: new Set() }); c.lines++; c.scenes.add(scene); let q = p.nextElementSibling; while (q && (ed.typeOf(q) === 'dialogue' || ed.typeOf(q) === 'parenthetical' || ed.typeOf(q) === 'lyrics')) { if (ed.typeOf(q) !== 'parenthetical') c.words += Fountain.countWords(q.textContent); q = q.nextElementSibling; } } }
    return Object.values(map).sort((a, b) => b.words - a.words);
  }
  function locations() {
    const map = {}; let scene = 0;
    for (const p of ed.paras()) { if (ed.typeOf(p) !== 'scene_heading') continue; scene++; const up = (p.textContent || '').toUpperCase().trim(); const m = up.match(/^([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.(?:\/[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.)?)\s*(.*?)\s*(?:\s[-–—]\s(.*))?$/); const loc = m ? (m[2] || '').trim() : up; if (!loc) continue; const l = map[loc] || (map[loc] = { name: loc, kinds: new Set(), times: new Set(), scenes: [] }); if (m) { l.kinds.add(m[1]); if (m[3]) l.times.add(m[3].trim()); } l.scenes.push(scene); }
    return Object.values(map).sort((a, b) => b.scenes.length - a.scenes.length);
  }
  function renderChars() {
    const list = characters(); const box = $('#charsCard');
    box.innerHTML = `<h2>${T('Персонажи', 'Кейіпкерлер')}</h2>` + (list.length ? `<table class="tbl"><thead><tr><th>${T('Имя', 'Есім')}</th><th>${T('Реплик', 'Реплика')}</th><th>${T('Слов', 'Сөз')}</th><th>${T('Сцены', 'Көріністер')}</th><th></th></tr></thead><tbody>${list.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.lines}</td><td class="num">${c.words}</td><td>${Array.from(c.scenes).join(', ')}</td><td class="ops"><button type="button" data-ren="${esc(c.name)}">${T('Переименовать', 'Атын өзгерту')}</button></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${T('Персонажи появятся из текста: абзац «Персонаж» (Tab после действия) и реплика под ним.', 'Кейіпкерлер мәтіннен пайда болады.')}</div>`);
    box.querySelectorAll('[data-ren]').forEach((b) => b.addEventListener('click', () => renameCharacter(b.dataset.ren)));
  }
  function renderLocs() {
    const list = locations(); const box = $('#locsCard');
    box.innerHTML = `<h2>${T('Локации', 'Локациялар')}</h2>` + (list.length ? `<table class="tbl"><thead><tr><th>${T('Локация', 'Локация')}</th><th>${T('Тип', 'Түрі')}</th><th>${T('Время', 'Уақыт')}</th><th>${T('Сцены', 'Көріністер')}</th></tr></thead><tbody>${list.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(Array.from(l.kinds).join(', '))}</td><td>${esc(Array.from(l.times).join(', '))}</td><td>${l.scenes.join(', ')}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${T('Локации берутся из заголовков сцен: ИНТ. КУПЕ ПОЕЗДА - НОЧЬ → «КУПЕ ПОЕЗДА».', 'Локациялар көрініс тақырыптарынан алынады.')}</div>`);
  }
  function renderStats() {
    const st = ed.stats(); const list = characters();
    $('#statsCard').innerHTML = `<h2>${T('Статистика', 'Статистика')}</h2><div class="stat-grid">
      <div class="stat"><b>${st.pages}</b><small>${T('страниц (A4)', 'бет (A4)')}</small></div><div class="stat"><b>${fmt(st.seconds)}</b><small>${T('хронометраж', 'хронометраж')}</small></div>
      <div class="stat"><b>${st.scenes}</b><small>${T('сцен', 'көрініс')}</small></div><div class="stat"><b>${st.words}</b><small>${T('слов', 'сөз')}</small></div>
      <div class="stat"><b>${st.dialogueShare}%</b><small>${T('диалог', 'диалог')}</small></div><div class="stat"><b>${st.characters}</b><small>${T('персонажей', 'кейіпкер')}</small></div></div>
      ${list.length ? `<table class="tbl"><thead><tr><th>${T('Персонаж', 'Кейіпкер')}</th><th>${T('Реплик', 'Реплика')}</th><th>${T('Слов', 'Сөз')}</th><th>${T('Доля', 'Үлесі')}</th></tr></thead><tbody>${list.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.lines}</td><td class="num">${c.words}</td><td class="num">${st.dialogueWords ? Math.round(c.words / st.dialogueWords * 100) : 0}%</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="empty">${T('Хронометраж считается по шаблону A4: 61 строка на страницу, страница ≈ минута. Это оценка, не правило.', 'Хронометраж A4 шаблоны бойынша есептеледі: бет ≈ минут.')}</p>`;
  }
  function renderTitlePreview() {
    const v = (id) => esc($(id).value.trim());
    $('#titlePreview').innerHTML = `<div><h1>${v('#t-title') || esc($('#title').value)}</h1><p>${v('#t-credit')}</p><p>${v('#t-author')}</p></div><div class="foot">${v('#t-date')}${v('#t-date') && v('#t-contact') ? '\n' : ''}${v('#t-contact')}</div>`;
  }
  function renderStoreNote() {
    const el = $('#storeNote'); const p = cur(); if (!p) return;
    el.innerHTML = p.server ? `<b>${T('проект команды', 'команда жобасы')}</b> · ${esc(p.server)}` : `<b>${T('хранится в этом браузере', 'осы браузерде сақталады')}</b> · ${T('скачивайте .fountain или подключите сервер команды (≡)', '.fountain жүктеңіз немесе команда серверін қосыңыз (≡)')}${storageOk ? '' : ' · <span style="color:var(--rec)">' + T('хранилище недоступно!', 'қойма қолжетімсіз!') + '</span>'}`;
  }
  function renameCharacter(oldName) {
    const nn = prompt(T('Новое имя для ', 'Жаңа есім: ') + oldName + T(' (заменю во всём тексте)', ' (бүкіл мәтінде ауыстырамын)'), oldName);
    if (!nn || nn.trim().toUpperCase() === oldName) return;
    const newName = nn.trim(); const re = new RegExp('(^|[^' + Fountain.LETTERS + '])(' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![' + Fountain.LETTERS + '])', 'gi');
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); let n = 0;
    snapshot(T('до переименования ', 'атын өзгертуге дейін ') + oldName);
    const text = ed.text().replace(re, (m, pre, w) => { n++; if (w === w.toUpperCase()) return pre + newName.toUpperCase(); if (w === cap(w)) return pre + cap(newName); return pre + newName.toLowerCase(); });
    cur().text = text; save(); ed.load(stripTitle(text)); refreshAll(); renderChars(); toast(T('Заменено: ', 'Ауыстырылды: ') + n);
  }
  function stripTitle(text) { const lines = (text || '').replace(/\r\n?/g, '\n').split('\n'); if (!lines.length || !/^[A-Za-zА-Яа-яЁё ]{2,30}:\s*/.test(lines[0]) || /^(ИНТ|НАТ|INT|EXT)/i.test(lines[0])) return text; let i = 0; while (i < lines.length && lines[i].trim() !== '') i++; return lines.slice(i).join('\n').replace(/^\n+/, ''); }
  // лист грузим без титульной страницы (она в форме)
  const edLoad = ed.load; ed.load = (t) => edLoad(stripTitle(t));

  // ---------- версии ----------
  function snapshot(label) { const p = cur(); if (!p.versions) p.versions = []; const t = ed.text(); if (p.versions.length && p.versions[p.versions.length - 1].text === t) return false; p.versions.push({ ts: Date.now(), label: label || '', text: t, words: Fountain.countWords(t) }); if (p.versions.length > 25) p.versions = p.versions.slice(-25); save(); return true; }
  function versionsDialog() {
    const p = cur(); const vs = (p.versions || []).slice().reverse();
    modal(`<h2>${T('Версии', 'Нұсқалар')}</h2><p>${T('⌘S фиксирует версию. Вернуть — текущий текст тоже сохранится как версия.', '⌘S нұсқаны бекітеді.')}</p><ul class="keys">${vs.length ? vs.map((v, i) => `<li><button class="btn btn--sm" type="button" data-m="r:${vs.length - 1 - i}">${T('Вернуть', 'Қайтару')}</button><span>${esc(v.label || T('версия', 'нұсқа'))} <small class="caps">${new Date(v.ts).toLocaleString('ru')} · ${v.words} ${T('сл.', 'сөз')}</small></span></li>`).join('') : `<li class="empty">${T('Версий пока нет', 'Нұсқалар әзірге жоқ')}</li>`}</ul><div class="row" style="margin-top:.8rem"><button class="btn" data-m="close" type="button">${T('Закрыть', 'Жабу')}</button></div>`,
      async (act) => { if (!act.startsWith('r:')) return false; const v = (p.versions || [])[+act.slice(2)]; if (!v) return false; if (!confirm(T('Вернуть эту версию?', 'Осы нұсқаны қайтару керек пе?'))) return false; snapshot(T('до возврата', 'қайтаруға дейін')); p.text = v.text; save(); open(currentId); toast(T('Версия возвращена', 'Нұсқа қайтарылды')); return true; });
  }

  // ---------- меню ----------
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('#btnMenu,#counter')) closeMenu(); });
  function menu(anchor, items) {
    closeMenu(); const m = document.createElement('div'); m.className = 'menu';
    for (const it of items) {
      if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
      if (it.cap) { const c = document.createElement('div'); c.className = 'cap'; c.textContent = it.cap; m.appendChild(c); continue; }
      const b = document.createElement('button'); b.type = 'button'; if (it.on) b.className = 'on'; b.innerHTML = `${esc(it.label)}${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ''}`;
      b.addEventListener('click', () => { closeMenu(); it.run(); }); m.appendChild(b);
    }
    document.body.appendChild(m); const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + 6 + m.offsetHeight > window.innerHeight ? Math.max(8, r.top - m.offsetHeight - 6) : r.bottom + 6) + 'px'; m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 12)) + 'px'; menuEl = m;
  }
  function modal(html, onAct) {
    const wrap = document.createElement('div'); wrap.className = 'modal'; wrap.innerHTML = `<div class="box">${html}</div>`;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => { if (b.dataset.m === 'close') return close(); const ok = await onAct(b.dataset.m, wrap); if (ok) close(); }));
    document.addEventListener('keydown', function escK(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escK); } });
    document.body.appendChild(wrap); const f = wrap.querySelector('input,button'); if (f) f.focus();
  }
  $('#btnMenu').addEventListener('click', (e) => {
    const list = Object.values(projects).sort((a, b) => b.updated - a.updated).slice(0, 12).map((p) => ({ label: (p.server ? '☁ ' : '') + (p.title || T('Без названия', 'Атаусыз')), meta: new Date(p.updated).toLocaleDateString('ru'), run: () => (p.server ? serverOpen(p.server).catch((err) => toast(T('Сервер: ', 'Сервер: ') + err.message)) : open(p.id)) }));
    menu(e.currentTarget, [
      { cap: T('Проект', 'Жоба') },
      { label: '+ ' + T('Новый сценарий', 'Жаңа сценарий'), run: () => { flush(); newProject(T('Без названия', 'Атаусыз'), ''); serverMode = null; open(currentId); $('#title').focus(); } },
      { label: '↑ ' + T('Импорт', 'Импорт'), meta: '.fountain .fdx .txt', run: () => $('#fileIn').click() },
      { label: '☁ ' + T('Проекты команды…', 'Команда жобалары…'), meta: server ? '' : T('нужен ключ', 'кілт керек'), run: serverProjects },
      { label: '⏱ ' + T('Версии…', 'Нұсқалар…'), meta: '⌘S', run: versionsDialog },
      { label: '✕ ' + T('Удалить текущий', 'Ағымдағыны жою'), run: delCurrent },
      '-', { cap: T('Экспорт', 'Экспорт') },
      { label: 'Fountain (.fountain)', run: () => download(slug() + '.fountain', ed.text()) },
      { label: 'Final Draft (.fdx)', run: () => download(slug() + '.fdx', Fountain.toFDX(Fountain.parse(ed.text())), 'application/xml') },
      { label: T('PDF / печать', 'PDF / басып шығару'), meta: 'A4', run: () => { showDoc('script'); setTimeout(() => window.print(), 150); } },
      { label: T('Резервная копия (.json)', 'Сақтық көшірме (.json)'), run: () => download(slug() + '.json', JSON.stringify(Object.assign({}, cur(), { text: ed.text() }), null, 2), 'application/json') },
      '-', { cap: T('Настройки', 'Баптаулар') },
      { label: T('Сервер команды (ключ)…', 'Команда сервері (кілт)…'), run: serverDialog },
      { label: T('Язык: ', 'Тіл: ') + (lang === 'kz' ? 'Қазақша → Русский' : 'Русский → Қазақша'), run: () => setLang(lang === 'kz' ? 'ru' : 'kz') },
      '-', ...list,
    ]);
  });
  function delCurrent() {
    const p = cur(); if (!p) return;
    if (!confirm(T(`Удалить «${p.title}» из этого браузера? Это нельзя отменить.`, `«${p.title}» осы браузерден жою керек пе?`))) return;
    clearTimeout(pendingSave); pendingSave = null; delete projects[p.id]; serverMode = null;
    const ids = Object.keys(projects); if (!ids.length) newProject(T('Без названия', 'Атаусыз'), ''); else currentId = ids[0]; save(); open(currentId);
  }
  $('#fileIn').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return; const txt = await f.text(); const name = f.name.replace(/\.[^.]+$/, '');
    try {
      flush();
      if (/\.fdx$/i.test(f.name)) newProject(name, Fountain.fromFDX(txt));
      else if (/\.json$/i.test(f.name)) { const j = JSON.parse(txt); if (!j || typeof j !== 'object' || typeof j.text !== 'string') throw new Error(T('это не резервная копия проекта', 'бұл жоба көшірмесі емес')); const p = newProject(typeof j.title === 'string' ? j.title : name, j.text); p.meta = Object.assign(p.meta, (j.meta && typeof j.meta === 'object') ? j.meta : {}); p.chat = Array.isArray(j.chat) ? j.chat : []; p.versions = Array.isArray(j.versions) ? j.versions : []; save(); }
      else newProject(name, txt);
      serverMode = null; open(currentId); toast(T('Импортировано: ', 'Импортталды: ') + f.name);
    } catch (err) { toast(T('Не прочитал файл: ', 'Файл оқылмады: ') + err.message); }
    e.target.value = '';
  });
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function slug() { return (cur().title || 'scenariy').replace(new RegExp('[^' + Fountain.LETTERS + '0-9-]+', 'g'), '-').slice(0, 60); }

  // ---------- вид: фокус, бумага, справка ----------
  function toggleFocus() { document.body.classList.toggle('focus'); ed.root.focus(); }
  $('#btnFocus').addEventListener('click', toggleFocus);
  function setPaper(v) { document.documentElement.dataset.paper = v; try { localStorage.setItem(LS.paper, v); } catch (e) { /* */ } }
  $('#btnPaper').addEventListener('click', () => setPaper(document.documentElement.dataset.paper === 'graphite' ? 'light' : 'graphite'));
  (function () { let v = null; try { v = localStorage.getItem(LS.paper); } catch (e) { /* */ } if (v !== 'light' && v !== 'graphite') v = 'light'; setPaper(v); })();
  $('#btnHelp').addEventListener('click', () => modal(`<h2>${T('Клавиши', 'Пернелер')}</h2><ul class="keys">
    <li><kbd>Enter</kbd>${T('следующий абзац: заголовок → действие, персонаж → реплика, реплика → действие', 'келесі абзац')}</li>
    <li><kbd>Tab</kbd>${T('действие → персонаж, персонаж → ремарка, реплика → ремарка; в пустом абзаце меняет тип', 'әрекет → кейіпкер, кейіпкер → ремарка')}</li>
    <li><kbd>Enter</kbd> ${T('в пустом абзаце', 'бос абзацта')}: ${T('действие → заголовок сцены, персонаж → действие', 'әрекет → көрініс тақырыбы')}</li>
    <li><kbd>Ctrl+1…9</kbd>${T('тип абзаца: 1 заголовок, 3 действие, 4 персонаж, 5 ремарка, 6 реплика, 7 лирика, 8 кадр, 9 переход', 'абзац түрі')}</li>
    <li><kbd>↑ ↓ Enter</kbd>${T('подсказка: ИНТ./НАТ., локации, время, имена, переходы', 'ұсыныс: ІШКІ./СЫРТҚЫ., локациялар, уақыт, есімдер')}</li>
    <li><kbd>⌘Z / ⌘⇧Z</kbd>${T('отменить / повторить', 'болдырмау / қайталау')}</li>
    <li><kbd>⌘S</kbd>${T('зафиксировать версию', 'нұсқаны бекіту')}</li>
    <li><kbd>⌘⇧F</kbd>${T('только лист', 'тек парақ')}</li>
  </ul><div class="row" style="margin-top:.8rem"><button class="btn btn--main" data-m="close" type="button">OK</button></div>`, async () => true));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.key === 'А' || e.key === 'а')) { e.preventDefault(); toggleFocus(); return; }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 's' || e.key === 'ы')) {
      e.preventDefault(); flush();
      if (serverMode && serverMode.loaded && cur().server) { const stamp = new Date(); const label = 'сценарная · ' + stamp.toLocaleDateString('ru-RU') + ' ' + stamp.toTimeString().slice(0, 5); serverVersion(label).then(() => toast(T('Версия зафиксирована на сервере', 'Нұсқа серверде бекітілді'))).catch((err) => toast(T('Сервер не принял версию: ', 'Сервер нұсқаны қабылдамады: ') + err.message)); }
      else if (!storageOk) toast(T('Хранилище браузера недоступно — скачайте .fountain', 'Браузер қоймасы қолжетімсіз'));
      else toast(snapshot('') ? T('Версия сохранена', 'Нұсқа сақталды') : T('Без изменений с прошлой версии', 'Өзгеріс жоқ'));
    }
  });

  // ---------- NEYRA ----------
  function openNeyra(v) { document.body.classList.toggle('neyra-open', v); $('#neyra').classList.toggle('hidden', !v); if (v) scopeHint(); }
  $('#btnNeyra').addEventListener('click', () => openNeyra(!document.body.classList.contains('neyra-open')));
  $('#btnNeyraClose').addEventListener('click', () => openNeyra(false));
  let tier = 'standard'; try { tier = localStorage.getItem(LS.tier) === 'pro' ? 'pro' : 'standard'; } catch (e) { /* */ }
  function setTier(v) { tier = v === 'pro' ? 'pro' : 'standard'; try { localStorage.setItem(LS.tier, tier); } catch (e) { /* */ } $$('.seg.tier [data-tier]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tier === tier)); }
  $$('.seg.tier [data-tier]').forEach((b) => b.addEventListener('click', () => { setTier(b.dataset.tier); toast(tier === 'pro' ? T('PRO: глубокий разбор всего сценария; на действиях со сценой — Стандарт.', 'PRO: бүкіл сценарийді терең талдау.') : T('Стандарт', 'Стандарт')); })); setTier(tier);
  const HEAVY = { coverage: 1, beats: 1, continuity: 1, logline: 1 };
  function effectiveTier(info) { if (tier !== 'pro') return 'standard'; if (info.free) return info.scope && info.scope.kind === 'all' ? 'pro' : 'standard'; return HEAVY[info.key] ? 'pro' : 'standard'; }

  function currentScene() { const p = ed.curPara(); if (!p) return null; const sc = ed.scenes(); let s = null; for (const x of sc) { if (x.el.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING || x.el === p) s = x; } if (!s) return null; const idx = sc.indexOf(s); let last = s.el; let n = s.el.nextElementSibling; const stop = idx + 1 < sc.length ? sc[idx + 1].el : null; while (n && n !== stop) { last = n; n = n.nextElementSibling; } return { scene: s, from: s.el, to: last, text: ed.textRange(s.el, last) }; }
  function getScope(force) {
    const mode = force || $('#scope').value; const sel = window.getSelection(); const selText = sel && !sel.isCollapsed && ed.root.contains(sel.anchorNode) ? sel.toString() : '';
    if (mode === 'all') return { kind: 'all', text: ed.text(), label: T('весь сценарий', 'бүкіл сценарий') };
    if ((mode === 'selection' || mode === 'auto') && selText.trim()) return { kind: 'selection', text: selText, label: T('выделенный фрагмент', 'белгіленген үзінді') };
    const cs = currentScene();
    if ((mode === 'scene' || mode === 'auto') && cs) return { kind: 'scene', text: cs.text, from: cs.from, to: cs.to, label: `${T('сцена', 'көрініс')} ${cs.scene.num} «${cs.scene.heading}»` };
    return { kind: 'all', text: ed.text(), label: T('весь сценарий', 'бүкіл сценарий') };
  }
  function scopeHint() { if (!document.body.classList.contains('neyra-open')) return; const s = getScope(); $('#scopeWhat').textContent = s.label + (s.kind === 'all' ? ' · ' + ed.stats().pages + ' ' + T('стр.', 'бет') : ''); }
  $('#scope').addEventListener('change', scopeHint);
  const FMT = 'Ответ — только текст в формате Fountain (заголовки сцен капсом, имя героя капсом на своей строке, ремарка в скобках), без вступлений и пояснений.';
  const PLAIN = ' Оформление: обычный текст с короткими заголовками и списками, без markdown-таблиц и без решётки перед заголовками.';
  const ACTS = {
    coverage: { scope: 'all', title: 'Читательское заключение', prompt: (t) => `Прочитай сценарий целиком и напиши читательское заключение: логлайн, как ты его понял · синопсис в 10 строк · разбор по элементам (премиса, структура, герой, антагонист, сцены, диалог, темп, тон, мир) · что работает · что не работает, с номерами сцен · 5–10 вопросов автору.${PLAIN}\n\nСЦЕНАРИЙ:\n${t}` },
    beats: { scope: 'all', title: 'Бит-шит', prompt: (t) => `Разметь сценарий по 15 битам Снайдера: для каждого бита — есть ли он, в какой сцене, на какой примерно странице (всего ≈${ed.stats().pages} стр.), и что с ним не так. В конце — какие биты пропущены или стоят не на месте, и один главный вывод о структуре.${PLAIN}\n\nСЦЕНАРИЙ:\n${t}` },
    continuity: { scope: 'all', title: 'Проверка непрерывности', prompt: (t) => `Проверь непрерывность: имена и возраста сходятся · день/ночь и время года не прыгают · герой не знает того, чего ещё не узнал · ружья из первого акта стреляют · ничего не исчезло без объяснения · факты реального мира, которые стоит [уточнить]. Выдай список расхождений с номерами сцен. Если всё чисто — скажи, что именно проверил.${PLAIN}\n\nСЦЕНАРИЙ:\n${t}` },
    improve: { title: 'Улучшить сцену', rewrite: true, prompt: (t, s) => `Перепиши ${s.label}, усилив три вещи: чего герой хочет здесь, что мешает, что изменилось к концу. Входи позже, выходи раньше. Сохрани голос автора, имена и факты. ${FMT}\n\nТЕКСТ:\n${t}` },
    dialogue: { title: 'Диалог живее', rewrite: true, prompt: (t, s) => `Перепиши диалог в ${s.label}: убери прямую экспозицию, добавь подтекст, сделай каждого героя узнаваемым по реплике без имени, сократи лишние первые и последние реплики. Действие и структуру не меняй. ${FMT}\n\nТЕКСТ:\n${t}` },
    modernize: { title: 'Модернизировать', rewrite: true, prompt: (t, s) => `Модернизируй ${s.label}: перенеси в наше время (${new Date().getFullYear()}), современный живой язык, реальные сегодняшние детали быта, связи и технологий, без штампов и без «как ты знаешь». Суть конфликта и характеры сохрани. ${FMT}\n\nТЕКСТ:\n${t}` },
    turns: { title: 'Три поворота', prompt: (t, s) => `Для ${s.label} предложи три разных варианта ключевого поворота (что меняется к концу сцены). Для каждого: одна строка сути · как меняется последняя треть сцены (3–6 строк в формате Fountain) · чем это платит дальше по истории. Не выбирай за автора.${PLAIN}\n\nТЕКСТ:\n${t}` },
    logline: { scope: 'all', title: 'Логлайн и синопсис', toMeta: true, prompt: (t) => `По сценарию напиши: ЛОГЛАЙН (1–2 фразы по формуле герой с изъяном / цель / ставки / препятствие) · ЖАНР и формат · СИНОПСИС в 10–12 строк. Отвечай строго в виде трёх блоков с заголовками ЛОГЛАЙН:, ЖАНР:, СИНОПСИС: на отдельных строках.\n\nСЦЕНАРИЙ:\n${t}` },
    kazakh: { title: 'На казахский', rewrite: true, prompt: (t, s) => `Переведи ${s.label} на казахский язык, сохранив формат Fountain: заголовки сцен капсом (ІШКІ. / СЫРТҚЫ. вместо ИНТ. / НАТ.), имена героев капсом, ремарки в скобках. Речь живая, разговорная, по характеру героев. ${FMT}\n\nТЕКСТ:\n${t}` },
    russian: { title: 'На русский', rewrite: true, prompt: (t, s) => `Переведи ${s.label} на русский язык, сохранив формат Fountain: заголовки сцен капсом (ИНТ. / НАТ.), имена героев капсом, ремарки в скобках. ${FMT}\n\nТЕКСТ:\n${t}` },
    expand: { title: 'Расписать в сцены', rewrite: true, prompt: (t, s) => `Расписать ${s.label} в сцены: если это синопсис или заметка — преврати в черновик сцен в формате Fountain (заголовки сцен, действие, диалог). Если это уже сцена — расширь её, добавив недостающие биты. ${FMT}\n\nТЕКСТ:\n${t}` },
    cut: { title: 'Сжать', rewrite: true, prompt: (t, s) => `Сократи ${s.label} примерно на треть без потери сути: входи поздно, выходи рано, убери повторы и описания, которые камера не покажет. ${FMT}\n\nТЕКСТ:\n${t}` },
  };
  function ctx(p) { const m = p.meta || {}; const bits = []; if (m.logline) bits.push('Логлайн: ' + m.logline.trim()); if (m.synopsis) bits.push('Синопсис автора: ' + m.synopsis.trim().slice(0, 1500)); if (m.notes) bits.push('Заметки автора: ' + m.notes.trim().slice(-800)); return bits.length ? 'ПАМЯТЬ ПРОЕКТА (контекст, не для пересказа):\n' + bits.join('\n') + '\n\n' : ''; }
  $('#actions').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) runAct(b.dataset.act); });
  async function runAct(key) {
    const act = ACTS[key]; const s = getScope(act.scope);
    if (!s.text.trim()) return toast(T('Нечего отправлять: сценарий пуст', 'Сценарий бос'));
    if (s.kind === 'all' && !ed.stats().scenes) return toast(T('Сначала напишите хотя бы одну сцену', 'Алдымен бір көрініс жазыңыз'));
    await ask(ctx(cur()) + act.prompt(s.text, s) + (lang === 'kz' && !/На (казахский|русский)/.test(act.title) ? '\n\nОтвечай на казахском языке.' : ''), act.title + ' · ' + s.label, { act, scope: s, key });
  }
  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#askIn').value.trim(); if (!q) return; $('#askIn').value = ''; const s = getScope(); ask(ctx(cur()) + `${q}\n\n(${s.label.toUpperCase()}):\n${s.text}`, q, { scope: s, free: true }); });
  $('#askIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#askForm').requestSubmit(); } });
  async function ask(prompt, label, info) {
    if (busy) return toast(T('NEYRA ещё отвечает', 'NEYRA әлі жауап беруде'));
    if (!server && !IS_LOCAL) { addMsg({ role: 'assistant', label: T('нет связи с NEYRA', 'NEYRA-мен байланыс жоқ'), text: T('Чтобы NEYRA отвечала, подключите сервер команды: ≡ → «Сервер команды (ключ)». Ключ выдаёт продюсер.', 'NEYRA жауап беруі үшін команда серверін қосыңыз.'), err: true }); return; }
    busy = true; const pid = currentId, p = cur(); const useTier = effectiveTier(info); if (useTier === 'pro') label += ' · PRO';
    p.chat.push({ role: 'user', label, ts: Date.now() }); renderChat();
    const wait = addMsg({ role: 'assistant', label: T('NEYRA думает', 'NEYRA ойлануда'), text: '', wait: true });
    try {
      const history = p.chat.filter((m) => m.role === 'assistant' && m.text).slice(-2).map((m) => ({ role: 'assistant', content: m.text.slice(0, 3000) }));
      let j;
      if (server) {
        const slug = p.server; const path = slug ? '/api/projects/' + encodeURIComponent(slug) + '/assistant' : '/api/assistant';
        const r = await serverFetch(path, 'POST', { question: prompt, section: 'script', history: info.free ? history : [], tier: useTier });
        j = { text: (r.data && r.data.answer) || '', tokeny: r.data && r.data.tokeny };
      } else {
        const messages = []; if (history.length && info.free) { messages.push({ role: 'user', content: 'Напоминание о предыдущих ответах по этому сценарию.' }); messages.push({ role: 'assistant', content: history.map((h) => h.content).join('\n---\n') }); }
        messages.push({ role: 'user', content: prompt });
        const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, max_tokens: info.scope && info.scope.kind === 'all' ? 6000 : 3000, tier: useTier }) });
        j = await r.json().catch(() => ({ error: 'сервер ответил не JSON' })); if (!r.ok || j.error) throw new Error(j.error || ('ошибка ' + r.status));
      }
      wait.remove(); const text = (j.text || '').trim(); const target = projects[pid]; if (!target) return;
      target.chat.push({ role: 'assistant', label, text, key: info.key, rewrite: !!(info.act && info.act.rewrite), scope: info.scope ? { kind: info.scope.kind, label: info.scope.label, original: info.scope.kind === 'all' ? '' : info.scope.text, sceneNum: info.scope.kind === 'scene' ? getScope('scene').kind === 'scene' && info.scope.label : '' } : null, ts: Date.now(), spent: j.tokeny && j.tokeny.spisano });
      if (target.chat.length > 40) target.chat = target.chat.slice(-40);
      save(); if (pid === currentId) renderChat();
      if (info.act && info.act.toMeta) applyMeta(pid, text);
    } catch (err) { wait.remove(); if (pid === currentId) addMsg({ role: 'assistant', label: T('не получилось', 'болмады'), text: /TOKENY_EMPTY|Токены закончились/.test(err.message) ? T('Токены закончились. Пополнить — в окне проекта (Режиссёрская), меню слева внизу.', 'Токендер таусылды.') : err.message, err: true }); }
    finally { busy = false; }
  }
  function applyMeta(pid, text) {
    const p = projects[pid]; if (!p) return; const grab = (k) => { const m = text.match(new RegExp(k + ':\\s*([\\s\\S]*?)(?=\\n[А-ЯЁ ]{3,}:|$)')); return m ? m[1].trim() : ''; };
    const l = grab('ЛОГЛАЙН'), g = grab('ЖАНР'), s = grab('СИНОПСИС'); if (l) p.meta.logline = l; if (g) p.meta.genre = g; if (s) p.meta.synopsis = s; save();
    if (pid === currentId) { $('#f-logline').value = p.meta.logline || ''; $('#f-synopsis').value = p.meta.synopsis || ''; toast(T('Документ «Синопсис» заполнен', '«Синопсис» құжаты толтырылды')); }
  }
  function renderChat() {
    const chat = $('#chat'); chat.innerHTML = ''; const p = cur(); if (!p) return;
    if (!p.chat.length) { chat.innerHTML = `<div class="empty">${T('Выберите действие. Ответы, которые переписывают текст, можно поставить на место сцены одной кнопкой; старое уйдёт в версии.', 'Әрекетті таңдаңыз.')}</div>`; return; }
    for (const m of p.chat) addMsg(m, true); chat.scrollTop = chat.scrollHeight;
  }
  function addMsg(m, noScroll) {
    const chat = $('#chat'); const d = document.createElement('div');
    d.className = 'msg ' + (m.role === 'user' ? 'u' : 'a') + (m.err ? ' err' : '') + (m.wait ? ' wait' : '');
    d.innerHTML = `<div class="lbl">${esc(m.role === 'user' ? T('Запрос · ', 'Сұрау · ') + m.label : m.label)}${m.spent ? ` · ${T('списано', 'шегерілді')} ${m.spent}` : ''}</div>${m.text ? `<div class="body">${esc(m.text)}</div>` : ''}`;
    if (m.role === 'assistant' && m.text && !m.err) {
      const ops = document.createElement('div'); ops.className = 'ops';
      const mk = (l, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.addEventListener('click', f); ops.appendChild(b); };
      if (m.rewrite && m.scope && m.scope.kind === 'scene') mk(T('Заменить сцену', 'Көріністі ауыстыру'), () => replaceScene(m));
      mk(T('Вставить после курсора', 'Курсордан кейін қою'), () => { const cs = currentScene(); const to = cs ? cs.to : ed.curPara(); if (to) ed.replaceParas(to, to, ed.textRange(to, to) + '\n\n' + m.text); else ed.insertAfterCurrent('action', m.text); showDoc('script'); });
      mk(T('Копировать', 'Көшіру'), () => navigator.clipboard.writeText(m.text).then(() => toast(T('Скопировано', 'Көшірілді'))));
      mk(T('В заметки', 'Жазбаларға'), () => { cur().meta.notes = (cur().meta.notes ? cur().meta.notes + '\n\n' : '') + '— ' + m.label + ' —\n' + m.text; $('#f-notes').value = cur().meta.notes; save(); toast(T('Добавлено в «Синопсис → Заметки»', 'Жазбаларға қосылды')); });
      d.appendChild(ops);
    }
    chat.appendChild(d); if (!noScroll) chat.scrollTop = chat.scrollHeight; return d;
  }
  function replaceScene(m) {
    const original = (m.scope && m.scope.original) || ''; const sc = ed.scenes();
    let target = null; for (const s of sc) { const idx = sc.indexOf(s); const last = (() => { let l = s.el; let n = s.el.nextElementSibling; const stop = idx + 1 < sc.length ? sc[idx + 1].el : null; while (n && n !== stop) { l = n; n = n.nextElementSibling; } return l; })(); if (ed.textRange(s.el, last).trim() === original.trim()) { target = { from: s.el, to: last, s }; break; } }
    if (!target) return toast(T('Исходная сцена уже изменена — вставьте ответ вручную', 'Бастапқы көрініс өзгертілген'));
    if (!confirm(T(`Заменить ${m.scope.label} текстом NEYRA? Старый текст сохранится в версиях.`, `${m.scope.label} ауыстыру керек пе?`))) return;
    snapshot(T('до замены: ', 'ауыстыруға дейін: ') + m.scope.label);
    ed.replaceParas(target.from, target.to, m.text); showDoc('script'); toast(T('Сцена заменена. Старый текст — в версиях (⌘S → меню)', 'Көрініс ауыстырылды'));
  }

  // ---------- утилиты ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  let tt; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 2800); }
  window.addEventListener('resize', () => renderRuler());

  // ---------- старт ----------
  (function () { let l = new URLSearchParams(location.search).get('lang'); if (!l) { try { l = localStorage.getItem(LS.lang); } catch (e) { /* */ } } lang = l === 'kz' ? 'kz' : 'ru'; })();
  try { curDoc = localStorage.getItem(LS.doc) || 'script'; } catch (e) { /* */ } if (!/^(script|title|synopsis|stats|chars|locs)$/.test(curDoc)) curDoc = 'script';
  if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embed');
  if (!Object.keys(projects).length) newProject(T('Без названия', 'Атаусыз'), '');
  if (!projects[currentId]) currentId = Object.keys(projects)[0];
  setLang(lang); open(currentId);
  const qSlug = new URLSearchParams(location.search).get('project');
  if (qSlug) { if (server) serverOpen(qSlug).catch((e) => toast(T('Не удалось открыть сценарий с сервера: ', 'Серверден сценарий ашылмады: ') + e.message)); else toast(T('Для проекта с сервера нужен ключ участника → ≡ → Сервер', 'Сервердегі жоба үшін кілт керек')); }
  else if (cur().server && server) serverOpen(cur().server).catch(() => { serverMode = null; });
})();
