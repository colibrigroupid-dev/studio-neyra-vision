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
    'Длительность': 'Ұзақтығы', 'стр.': 'бет', 'Заголовок сцены': 'Көрініс тақырыбы', 'Участники сцены': 'Көрініс қатысушылары', 'Простой текст': 'Қарапайым мәтін', 'Описание действия': 'Әрекет сипаттамасы', 'Персонаж': 'Кейіпкер', 'Ремарка': 'Ремарка', 'Реплика': 'Реплика', 'Лирика': 'Лирика', 'Кадр': 'Кадр', 'Переход': 'Ауысу', 'Заметка по тексту': 'Мәтін жазбасы', 'Группа (эпизод)': 'Топ (эпизод)', 'Акт': 'Акт', 'Разрыв страницы': 'Бет үзілісі',
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
  function blank(title, text) { return { id: uid(), title: title || T('Без названия', 'Атаусыз'), text: text || '', created: Date.now(), updated: Date.now(), beats: {}, meta: { logline: '', genre: '', synopsis: '', notes: '', credit: '', author: '', date: '', contact: '' }, chat: [], versions: [], docs: [], korzina: [] }; }
  function newProject(title, text) { const p = blank(title, text); projects[p.id] = p; currentId = p.id; save(); return p; }

  // ---------- лист ----------
  const ed = ScriptEditor.create($('#editor'), {});
  function flush() { if (pendingSave) { clearTimeout(pendingSave); pendingSave = null; const p = cur(); if (p) { const t = ed.text(); if (t !== p.text) { p.text = t; p.updated = Date.now(); save(); } } } }
  ed.onChange = () => { if (loading) { refreshAll(); updateTypeBox(); return; } setSaveState(T('пишу…', 'жазып жатырмын…')); clearTimeout(pendingSave); pendingSave = setTimeout(() => { pendingSave = null; const p = cur(); if (!p) return; const t = ed.text(); if (t !== p.text) { p.text = t; p.updated = Date.now(); save(); } refreshAll(); }, 250); updateTypeBox(); };
  ed.onCaret = () => { updateTypeBox(); markCurrentScene(); scopeHint(); renderScenePanel(); };
  function updateTypeBox() { const p = ed.curPara(); if (p) $('#ptype').value = ed.typeOf(p); }
  $('#ptype').addEventListener('change', (e) => { ed.setType(e.target.value); ed.root.focus(); });
  $('#btnUndo').addEventListener('click', () => { ed.undo(); ed.root.focus(); });
  $('#btnRedo').addEventListener('click', () => { ed.redo(); ed.root.focus(); });
  window.addEventListener('beforeunload', flush); document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  // ---------- сервер команды ----------
  let server = (() => { const s = load(LS.server, null); return s && s.key ? { url: String(s.url || DEFAULT_SERVER).replace(/\/+$/, ''), key: s.key } : null; })();
  let serverMode = null; let sceneStatus = {}; // n → {status, approvedAt}
  async function loadSceneStatus() { const p = cur(); sceneStatus = {}; if (!server || !p || !p.server) { renderScenes(); return; } try { const list = await serverFetch('/api/projects/' + encodeURIComponent(p.server) + '/scenes'); const arr = (list.data && (list.data.scenes || list.data)) || []; if (Array.isArray(arr)) for (const x of arr) if (x.n != null) sceneStatus[+x.n] = { status: x.status || 'draft', approvedAt: x.approvedAt || '' }; } catch (e) { /* статусы необязательны */ } renderScenes(); renderScenePanel(true); }
  async function serverFetch(path, method, body, extraHeaders) {
    if (!server) throw new Error(T('нет ключа участника', 'қатысушы кілті жоқ'));
    const r = await fetch(server.url + path, { method: method || 'GET', headers: Object.assign({ 'X-Key': server.key, 'content-type': 'application/json' }, extraHeaders || {}), body: body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store' });
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
    currentId = id; save(); open(id); loadSceneStatus();
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
    const r = await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/versions', 'POST', { label });
    const rz = r.data && r.data.razbor; return rz ? ' · ' + T('сцен', 'көрініс') + ' ' + (rz.scenes ?? '—') + ' · ' + T('героев', 'кейіпкер') + ' ' + (rz.characters ?? '—') + ' · ' + T('локаций', 'локация') + ' ' + (rz.locations ?? '—') : '';
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
  function showTokens(tk) { const el = $('#tokenInfo'); if (!tk) { el.textContent = ''; return; } if (tk.unlimited) el.textContent = T('токены без лимита', 'токендер шексіз'); else if (!tk.balance) el.textContent = T('Нет доступных токенов', 'Қолжетімді токендер жоқ'); else el.textContent = T('Токенов: ', 'Токендер: ') + tk.balance + (tk.cena_voprosa ? ' · ' + T('вопрос от ', 'сұрақ ') + tk.cena_voprosa : ''); }
  async function checkApi() {
    const dot = $('#aiDot'), st = $('#aiStateText'), p = cur();
    const q = p && p.server ? '?proekt=' + encodeURIComponent(p.server) : ''; $('#lnkArt').href = STUDIO + q + '#/studio/art'; $('#lnkDirector').href = STUDIO + q + '#/studio/director'; $('#lnkProduction').href = STUDIO + q + '#/studio/production';
    if (server) {
      try { const me = await serverFetch('/api/me'); showTokens(me.data && (me.data.tokeny || me.data.wallet)); dot.className = 'dot on'; st.textContent = (p && p.server) ? T('сервер команды · ', 'команда сервері · ') + p.server : T('сервер команды · этот сценарий в браузере', 'команда сервері · бұл сценарий браузерде'); }
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
    const p = cur(); if (!p.versions) p.versions = []; if (!p.meta) p.meta = {}; if (!p.docs) p.docs = []; if (!p.korzina) p.korzina = []; if (!p.server) serverMode = null; curUserDoc = null;
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
    if (doc === 'title') renderTitlePreview(); if (doc === 'stats') renderStats(); if (doc === 'chars') renderChars(); if (doc === 'locs') renderLocs(); if (doc === 'treatment') renderTreatment(); if (doc === 'trash') renderTrash(); if (doc === 'userdoc') renderUserDoc();
    if (doc !== 'script') document.body.classList.remove('scene-open'); else { let sv = '1'; try { sv = localStorage.getItem('nvs.scene') || '1'; } catch (e) { /* */ } if (sv === '1' && window.innerWidth > 1100 && !document.body.classList.contains('neyra-open')) document.body.classList.add('scene-open'); }
    document.body.classList.remove('show-nav');
    if (doc === 'script') ed.root.focus();
  }
  $('#docs').addEventListener('click', (e) => { const b = e.target.closest('[data-doc]'); if (b) showDoc(b.dataset.doc); });
  $('#mobNav').addEventListener('click', () => document.body.classList.toggle('show-nav'));

  function refreshAll() { renderScenes(); renderRuler(); renderCounts(); renderStoreNote(); markPages(); renderScenePanel(); renderUserDocsNav(); }
  // ---------- поэпизодник: сцены с описаниями (= строки Fountain) ----------
  function sceneSynopsisText(s) { const out = []; let n = s.el.nextElementSibling; while (n && ed.typeOf(n) === 'synopsis') { const txt = (n.textContent || '').trim(); if (!/^(тон|визуал|ton|visual)\s*:/i.test(txt)) out.push(txt); n = n.nextElementSibling; } return out.join('\n'); }
  function setSceneSynopsis(s, text) {
    const old = []; let n = s.el.nextElementSibling; while (n && ed.typeOf(n) === 'synopsis') { const txt = (n.textContent || '').trim(); if (!/^(тон|визуал|ton|visual)\s*:/i.test(txt)) old.push(n); n = n.nextElementSibling; }
    let anchor = s.el; let m = s.el.nextElementSibling; while (m && ed.typeOf(m) === 'synopsis') { anchor = m; m = m.nextElementSibling; }
    old.forEach((x) => x.remove()); if (anchor.parentNode !== ed.root) anchor = s.el;
    const lines = text.split('\n').map((x) => x.trim()).filter(Boolean); let last = anchor; if (!last.parentNode) last = s.el;
    for (const l of lines) { const p = ed.mk('synopsis', l); last.after(p); last = p; }
    ed.root.dispatchEvent(new Event('input'));
  }
  function renderTreatment() {
    const sc = ed.scenes(); const box = $('#treatmentCard');
    box.innerHTML = `<h2>${T('Поэпизодник', 'Эпизодтық жоспар')}</h2><p class="empty" style="padding-top:0">${T('Коротко о каждой сцене: что происходит и что меняется. Описание хранится в сценарии служебной строкой под заголовком и видно Art и Director.', 'Әр көрініс туралы қысқаша.')}</p><ul class="treat">${sc.map((s) => `<li data-i="${s.index}"><div class="h"><span class="n">${s.num}.</span><b>${esc(s.heading)}</b><span class="n" style="margin-left:auto">${fmt(s.seconds)}</span></div><textarea rows="2" data-syn="${s.index}" placeholder="${T('что происходит в сцене', 'көріністе не болады')}">${esc(sceneSynopsisText(s))}</textarea></li>`).join('')}</ul><div class="sp-ops"><button type="button" id="treatAdd">+ ${T('Добавить сцену', 'Көрініс қосу')}</button></div>`;
    let tm = null;
    box.querySelectorAll('[data-syn]').forEach((ta) => ta.addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { const s = currentSceneByIndex(+e.target.dataset.syn); if (s) setSceneSynopsis(s, e.target.value); }, 500); }));
    box.querySelector('#treatAdd').addEventListener('click', () => { const hd = prompt(T('Заголовок новой сцены', 'Жаңа көрініс тақырыбы'), 'ИНТ. МЕСТО - ВРЕМЯ'); if (!hd) return; ed.pushUndo(); const p = ed.mk('scene_heading', hd.toUpperCase()); ed.root.appendChild(p); ed.root.dispatchEvent(new Event('input')); renderTreatment(); });
  }
  // ---------- корзина ----------
  function toTrash(kind, title, text) { const p = cur(); if (!p.korzina) p.korzina = []; p.korzina.unshift({ ts: Date.now(), kind, title, text }); if (p.korzina.length > 50) p.korzina = p.korzina.slice(0, 50); save(); renderCounts(); }
  function renderTrash() {
    const p = cur(); const box = $('#trashCard'); const items = p.korzina || [];
    box.innerHTML = `<h2>${T('Корзина', 'Себет')}</h2>` + (items.length ? items.map((it, i) => `<div class="trash-i"><span class="t">${esc(it.title)}<small>${it.kind === 'scene' ? T('сцена', 'көрініс') : T('документ', 'құжат')} · ${new Date(it.ts).toLocaleString('ru')} · ${Fountain.countWords(it.text)} ${T('сл.', 'сөз')}</small></span><button type="button" class="btn btn--sm" data-restore="${i}">${T('Вернуть', 'Қайтару')}</button><button type="button" class="btn btn--sm" data-purge="${i}" title="${T('Удалить навсегда', 'Біржола жою')}">✕</button></div>`).join('') : `<div class="empty">${T('Пусто. Сюда попадают удалённые сцены и документы, их можно вернуть.', 'Бос. Жойылған көріністер мен құжаттар осында.')}</div>`);
    box.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => { const it = p.korzina.splice(+b.dataset.restore, 1)[0]; if (!it) return; if (it.kind === 'scene') { ed.pushUndo(); const tmp = document.createElement('div'); const sub = ScriptEditor.create(tmp, {}); sub.loadExact(it.text); Array.from(tmp.children).forEach((x) => ed.root.appendChild(x)); ed.root.dispatchEvent(new Event('input')); toast(T('Сцена возвращена в конец сценария', 'Көрініс сценарийдің соңына қайтарылды')); } else { p.docs.push({ id: uid(), title: it.title, text: it.text, updated: Date.now() }); toast(T('Документ возвращён', 'Құжат қайтарылды')); } save(); renderTrash(); refreshAll(); }));
    box.querySelectorAll('[data-purge]').forEach((b) => b.addEventListener('click', () => { if (!confirm(T('Удалить навсегда?', 'Біржола жою керек пе?'))) return; p.korzina.splice(+b.dataset.purge, 1); save(); renderTrash(); renderCounts(); }));
  }
  // ---------- документы автора ----------
  let curUserDoc = null, udTimer = null;
  function renderUserDocsNav() { const p = cur(); const box = $('#userDocs'); if (!p) return; box.innerHTML = (p.docs || []).map((d) => `<button type="button" class="doc-i sub${curDoc === 'userdoc' && curUserDoc === d.id ? ' on' : ''}" data-ud="${d.id}"><i>▭</i><span>${esc(d.title || T('Документ', 'Құжат'))}</span></button>`).join(''); box.querySelectorAll('[data-ud]').forEach((b) => b.addEventListener('click', () => { curUserDoc = b.dataset.ud; showDoc('userdoc'); renderUserDocsNav(); })); $('#trashCount').textContent = (p.korzina || []).length || ''; }
  function renderUserDoc() { const d = (cur().docs || []).find((x) => x.id === curUserDoc); if (!d) return showDoc('script'); $('#ud-title').value = d.title || ''; $('#ud-text').value = d.text || ''; }
  $('#addDoc').addEventListener('click', () => { const title = prompt(T('Название документа (логлайн, тритмент, заметки…)', 'Құжат атауы'), T('Заметки', 'Жазбалар')); if (!title) return; const d = { id: uid(), title: title.trim(), text: '', updated: Date.now() }; cur().docs.push(d); save(); curUserDoc = d.id; showDoc('userdoc'); renderUserDocsNav(); $('#ud-text').focus(); });
  $('#ud-title').addEventListener('input', (e) => { const d = (cur().docs || []).find((x) => x.id === curUserDoc); if (d) { d.title = e.target.value; d.updated = Date.now(); save(); renderUserDocsNav(); } });
  $('#ud-text').addEventListener('input', (e) => { clearTimeout(udTimer); udTimer = setTimeout(() => { const d = (cur().docs || []).find((x) => x.id === curUserDoc); if (d) { d.text = e.target.value; d.updated = Date.now(); save(); } }, 300); });
  $('#ud-del').addEventListener('click', () => { const p = cur(); const i = (p.docs || []).findIndex((x) => x.id === curUserDoc); if (i < 0) return; if (!confirm(T('Удалить документ? Он попадёт в корзину.', 'Құжатты жою керек пе? Ол себетке түседі.'))) return; const d = p.docs.splice(i, 1)[0]; toTrash('doc', d.title, d.text); curUserDoc = null; showDoc('script'); renderUserDocsNav(); });
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }
  function renderScenes() {
    const ul = $('#scenes'); const sc = ed.scenes(); const st = ed.stats();
    ul.innerHTML = sc.length ? '' : `<li class="empty">${T('Сцен пока нет. Первый абзац — заголовок: ИНТ. МЕСТО - ВРЕМЯ, затем Enter.', 'Көріністер әзірге жоқ. Бірінші абзац — тақырып: ІШКІ. ОРЫН - УАҚЫТ, сосын Enter.')}</li>`;
    for (const s of sc) {
      const li = document.createElement('li'); li.dataset.i = s.index; li.draggable = true;
      const st = sceneStatus[s.index]; if (st && st.status === 'approved') li.classList.add('ok');
      li.innerHTML = `<div class="h"><span class="n">${s.num}.</span><b>${esc(s.heading)}</b><span class="d">${st && st.status === 'approved' ? '✓ ' : ''}${fmt(s.seconds)}</span></div>${s.firstAction ? `<div class="a">${esc(s.firstAction)}</div>` : ''}`;
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
    renderRuler();
  }
  // лента времени как в STARC: деления по секундам, рамка — отрезок сценария, видимый сейчас на экране; рамку можно тащить
  const ruler = $('#ruler'), view = $('#view-script');
  function renderRuler() {
    if (!ruler.clientWidth || curDoc !== 'script') return;
    const ps = ed.paras(); const total = Math.max(12, ed.stats().seconds); const w = ruler.clientWidth;
    const step = total <= 30 ? 1 : total <= 120 ? 5 : total <= 600 ? 30 : total <= 1800 ? 60 : 300;
    let h = '';
    for (let s = 0; s <= total; s += step) h += `<span class="tick" style="left:${(s / total * w).toFixed(1)}px"><i></i>${fmt(s)}</span>`;
    // видимый отрезок: по положению абзацев относительно окна прокрутки
    const vt = view.scrollTop, vb = vt + view.clientHeight; const sheet = ed.root; const base = sheet.offsetTop;
    let acc = 0, tStart = null, tEnd = 0;
    const perPara = ps.map((p) => { const sec = paraDur(p); const top = base + p.offsetTop, bottom = top + p.offsetHeight; const r = { top, bottom, t0: acc, t1: acc + sec }; acc += sec; return r; });
    for (const r of perPara) { if (r.bottom < vt || r.top > vb) continue; const frac0 = Math.max(0, Math.min(1, (vt - r.top) / Math.max(1, r.bottom - r.top))); const frac1 = Math.max(0, Math.min(1, (vb - r.top) / Math.max(1, r.bottom - r.top))); if (tStart === null) tStart = r.t0 + (r.t1 - r.t0) * frac0; tEnd = r.t0 + (r.t1 - r.t0) * frac1; }
    if (tStart === null) { tStart = 0; tEnd = Math.min(total, acc || 0); }
    const x0 = tStart / total * w, x1 = Math.max(x0 + 24, tEnd / total * w);
    h += `<div class="win" style="left:${x0.toFixed(1)}px;width:${(x1 - x0).toFixed(1)}px"><b class="l">${fmt(tStart)}</b><b class="r">${fmt(tEnd)}</b></div>`;
    ruler.innerHTML = h; ruler.dataset.total = total;
  }
  function paraDur(p) { const type = ed.typeOf(p); if (type === 'page_break') return 0; const txt = (p.textContent || '').trim(); const cols = { scene_heading: 58, action: 58, character: 31, parenthetical: 18, dialogue: 28, lyrics: 43, transition: 58, shot: 58, inline_note: 31, sequence_heading: 58, act_heading: 58, centered: 58, synopsis: 58 }[type] || 58; const before = /^(scene_heading|action|character|transition|shot|inline_note|sequence_heading|act_heading|centered|synopsis)$/.test(type) ? 1 : 0; const lines = before + Math.max(1, Math.ceil(txt.length / cols)); return lines / 61 * 60 * 1.01; }
  view.addEventListener('scroll', () => { if (!rulerTick) rulerTick = requestAnimationFrame(() => { rulerTick = null; renderRuler(); }); });
  let rulerTick = null, dragging = null;
  function scrollToTime(t) { const ps = ed.paras(); let acc = 0; const base = ed.root.offsetTop; for (const p of ps) { const d = paraDur(p); if (acc + d >= t) { const frac = d ? (t - acc) / d : 0; view.scrollTop = base + p.offsetTop + p.offsetHeight * frac - 8; return; } acc += d; } view.scrollTop = view.scrollHeight; }
  ruler.addEventListener('mousedown', (e) => { const total = +ruler.dataset.total || 60; const win = e.target.closest('.win'); const rect = ruler.getBoundingClientRect(); if (win) { const wr = win.getBoundingClientRect(); dragging = { offset: e.clientX - wr.left, width: wr.width, total, rect }; } else { scrollToTime((e.clientX - rect.left) / rect.width * total - (view.clientHeight / Math.max(1, ed.root.offsetHeight) * total) / 2); } e.preventDefault(); });
  window.addEventListener('mousemove', (e) => { if (!dragging) return; const x = e.clientX - dragging.rect.left - dragging.offset; scrollToTime(Math.max(0, x / dragging.rect.width * dragging.total)); });
  window.addEventListener('mouseup', () => { dragging = null; });
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
      { label: '↑ ' + T('Импорт', 'Импорт'), meta: 'docx txt pdf fdx fountain', run: () => $('#fileIn').click() },
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
  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('не загрузилась библиотека')); document.head.appendChild(s); }); }
  async function docxToLines(file) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer()); const xml = await zip.file('word/document.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml'); const out = [];
    doc.querySelectorAll('p').forEach((p) => { let line = ''; p.childNodes.forEach(function walk(n) { if (n.nodeType === 1) { const tag = n.localName; if (tag === 't') line += n.textContent; else if (tag === 'tab') line += ' '; else if (tag === 'br') line += '\n'; else n.childNodes.forEach(walk); } }); out.push(...line.split('\n')); });
    return out;
  }
  async function pdfToLines(file) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; const out = [];
    for (let i = 1; i <= pdf.numPages; i++) { const page = await pdf.getPage(i); const tc = await page.getTextContent(); const rows = new Map(); for (const it of tc.items) { if (!it.str) continue; const y = Math.round(it.transform[5]); const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2); const kk = key === undefined ? y : key; rows.set(kk, (rows.get(kk) || []).concat([{ x: it.transform[4], s: it.str }])); } const ys = [...rows.keys()].sort((a, b) => b - a); for (const y of ys) out.push(rows.get(y).sort((a, b) => a.x - b.x).map((r) => r.s).join('')); out.push(''); }
    if (!out.some((l) => l.trim())) throw new Error(T('в PDF нет текстового слоя (скан) — нужен отдельный распознаватель', 'PDF-те мәтін қабаты жоқ'));
    return out;
  }
  function linesToFountain(lines) { // текст из Word/PDF → Fountain: заголовки, персонажи над репликами, действие
    const out = []; const isCaps = (s) => /[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]/.test(s) && s === s.toUpperCase(); const head = (s) => /^(ИНТ|НАТ|ЭКСТ|ІШКІ|СЫРТҚЫ|INT|EXT|EST|I\/E)[\.\s\-–—/]/i.test(s);
    const ls = lines.map((l) => l.replace(/\s+$/, '').replace(/^\s+/, ''));
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i]; if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
      const next = (ls[i + 1] || '').trim(); const prevBlank = !out.length || out[out.length - 1] === '';
      if (head(l)) { if (!prevBlank) out.push(''); out.push(l.toUpperCase(), ''); continue; }
      if (isCaps(l) && l.length < 40 && next && !isCaps(next) && !head(next)) { if (!prevBlank) out.push(''); out.push(l); continue; } // персонаж над репликой
      if (/^\(.*\)$/.test(l) && !prevBlank) { out.push(l); continue; }
      if (!prevBlank && out.length && isCaps(out[out.length - 1]) && !head(out[out.length - 1])) { out.push(l); continue; } // реплика под персонажем
      if (!prevBlank && out.length && /^\(.*\)$/.test(out[out.length - 1])) { out.push(l); continue; }
      if (!prevBlank && out.length && !isCaps(out[out.length - 1])) { out[out.length - 1] += ' ' + l; continue; } // продолжение абзаца
      if (!prevBlank) out.push('');
      out.push(l);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  $('#fileIn').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return; const name = f.name.replace(/\.[^.]+$/, '');
    try {
      flush();
      if (/\.docx$/i.test(f.name)) { toast(T('Читаю DOCX…', 'DOCX оқып жатырмын…')); newProject(name, linesToFountain(await docxToLines(f))); }
      else if (/\.pdf$/i.test(f.name)) { toast(T('Читаю PDF…', 'PDF оқып жатырмын…')); newProject(name, linesToFountain(await pdfToLines(f))); }
      else { const txt = await f.text();
      if (/\.fdx$/i.test(f.name)) newProject(name, Fountain.fromFDX(txt));
      else if (/\.json$/i.test(f.name)) { const j = JSON.parse(txt); if (!j || typeof j !== 'object' || typeof j.text !== 'string') throw new Error(T('это не резервная копия проекта', 'бұл жоба көшірмесі емес')); const p = newProject(typeof j.title === 'string' ? j.title : name, j.text); p.meta = Object.assign(p.meta, (j.meta && typeof j.meta === 'object') ? j.meta : {}); p.chat = Array.isArray(j.chat) ? j.chat : []; p.versions = Array.isArray(j.versions) ? j.versions : []; save(); }
      else if (/\.(fountain|md)$/i.test(f.name)) newProject(name, txt);
      else newProject(name, /\n\s*\n/.test(txt) ? txt : linesToFountain(txt.split('\n'))); }
      serverMode = null; open(currentId); toast(T('Импортировано: ', 'Импортталды: ') + f.name + T('. Проверьте разбиение на сцены', '. Көріністерге бөлінуін тексеріңіз'));
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
    <li><kbd>Ctrl+0…9</kbd>${T('тип абзаца: 1 заголовок, 2 участники сцены, 3 действие, 4 персонаж, 5 ремарка, 6 реплика, 7 лирика, 8 кадр, 9 переход, 0 простой текст', 'абзац түрі')}</li>
    <li><kbd>↑ ↓ Enter</kbd>${T('подсказка: ИНТ./НАТ., локации, время, имена, переходы', 'ұсыныс: ІШКІ./СЫРТҚЫ., локациялар, уақыт, есімдер')}</li>
    <li><kbd>⌘Z / ⌘⇧Z</kbd>${T('отменить / повторить', 'болдырмау / қайталау')}</li>
    <li><kbd>⌘S</kbd>${T('зафиксировать версию', 'нұсқаны бекіту')}</li>
    <li><kbd>⌘⇧F</kbd>${T('только лист', 'тек парақ')}</li>
  </ul><div class="row" style="margin-top:.8rem"><button class="btn btn--main" data-m="close" type="button">OK</button></div>`, async () => true));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.key === 'А' || e.key === 'а')) { e.preventDefault(); toggleFocus(); return; }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 's' || e.key === 'ы')) {
      e.preventDefault(); flush();
      if (serverMode && serverMode.loaded && cur().server) { const stamp = new Date(); const label = 'сценарная · ' + stamp.toLocaleDateString('ru-RU') + ' ' + stamp.toTimeString().slice(0, 5); serverVersion(label).then((extra) => { loadSceneStatus(); toast(T('Версия зафиксирована на сервере', 'Нұсқа серверде бекітілді') + (extra || '') + (extra ? T('. Art уже видит героев', '. Art кейіпкерлерді көреді') : '')); }).catch((err) => toast(T('Сервер не принял версию: ', 'Сервер нұсқаны қабылдамады: ') + err.message)); }
      else if (!storageOk) toast(T('Хранилище браузера недоступно — скачайте .fountain', 'Браузер қоймасы қолжетімсіз'));
      else toast(snapshot('') ? T('Версия сохранена', 'Нұсқа сақталды') : T('Без изменений с прошлой версии', 'Өзгеріс жоқ'));
    }
  });

  // ---------- панель сцены (контекст: участники, локация, время, тон, визуал) ----------
  function sceneBlock(s, sc) { const idx = sc.indexOf(s); let last = s.el; let n = s.el.nextElementSibling; const stop = idx + 1 < sc.length ? sc[idx + 1].el : null; while (n && n !== stop) { last = n; n = n.nextElementSibling; } return { from: s.el, to: last }; }
  function sceneSyn(s, key) { let n = s.el.nextElementSibling; while (n && ed.typeOf(n) === 'synopsis') { const m = (n.textContent || '').match(/^\s*([^:]+):\s*(.*)$/); if (m && m[1].trim().toLowerCase() === key.toLowerCase()) return { el: n, text: m[2].trim() }; n = n.nextElementSibling; } return null; }
  function setSceneSyn(s, key, text) {
    const cur = sceneSyn(s, key);
    if (!text.trim()) { if (cur) { cur.el.remove(); ed.root.dispatchEvent(new Event('input')); } return; }
    if (cur) { cur.el.textContent = key + ': ' + text.trim(); }
    else { const p = ed.mk('synopsis', key + ': ' + text.trim()); let anchor = s.el; while (anchor.nextElementSibling && ed.typeOf(anchor.nextElementSibling) === 'synopsis') anchor = anchor.nextElementSibling; anchor.after(p); }
    ed.root.dispatchEvent(new Event('input'));
  }
  let spTimer = null, spTimer2 = null, spSceneIdx = 0;
  function renderScenePanel(force) {
    if (!document.body.classList.contains('scene-open')) return;
    const cs = currentScene(); const body = $('#spBody');
    if (!cs) { $('#spTitle').textContent = T('Сцена', 'Көрініс'); body.innerHTML = `<div class="empty">${T('Поставьте курсор в сцену — здесь её участники, локация, время и ваши требования к изображению.', 'Курсорды көрініске қойыңыз.')}</div>`; spSceneIdx = 0; return; }
    const s = cs.scene; const up = s.heading; const m = up.match(/^([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.(?:\/[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.)?)\s*(.*?)\s*(?:\s[-–—]\s(.*))?$/);
    const kind = m ? m[1] : '', loc = m ? m[2] : up, time = m && m[3] ? m[3] : '';
    const sameScene = !force && spSceneIdx === s.index && body.querySelector('[data-f=ton]');
    $('#spTitle').textContent = `${s.num}. ${s.heading}`;
    if (sameScene) { body.querySelector('[data-chips]').innerHTML = s.characters.map((n) => `<span class="chip">${esc(n)}</span>`).join('') || `<span class="val dim">${T('— пока без реплик', '— репликасыз')}</span>`; body.querySelector('[data-loc]').textContent = (kind ? kind + ' ' : '') + loc; body.querySelector('[data-time]').textContent = time || '—'; body.querySelector('[data-dur]').textContent = fmt(s.seconds); return; }
    spSceneIdx = s.index;
    const ton = sceneSyn(s, 'Тон'), viz = sceneSyn(s, 'Визуал');
    body.innerHTML = `<label><span>${T('Участники', 'Қатысушылар')}</span><div class="chips" data-chips>${s.characters.map((n) => `<span class="chip">${esc(n)}</span>`).join('') || `<span class="val dim">${T('— пока без реплик', '— репликасыз')}</span>`}</div></label>
      <label><span>${T('Локация', 'Локация')}</span><div class="val" data-loc>${esc((kind ? kind + ' ' : '') + loc)}</div></label>
      <label><span>${T('Время', 'Уақыт')}</span><div class="val" data-time>${esc(time || '—')}</div></label>
      <label><span>${T('Длительность', 'Ұзақтығы')}</span><div class="val" data-dur>${fmt(s.seconds)}</div></label>
      <label><span>${T('Эмоциональный тон', 'Эмоциялық реңк')}</span><input data-f="ton" type="text" value="${esc(ton ? ton.text : '')}" placeholder="${T('тревога, нежность, ирония…', 'мазасыздық, нәзіктік…')}"></label>
      <label><span>${T('Требования к изображению', 'Бейнеге талаптар')}</span><textarea data-f="viz" rows="5" placeholder="${T('эпоха, атмосфера, свет, детали, что обязательно в кадре', 'дәуір, атмосфера, жарық, детальдар')}">${esc(viz ? viz.text : '')}</textarea></label>
      <div class="sp-ops"><button type="button" data-op="up">↑ ${T('выше', 'жоғары')}</button><button type="button" data-op="down">↓ ${T('ниже', 'төмен')}</button><button type="button" data-op="del">${T('Удалить сцену', 'Көріністі жою')}</button></div>
      ${cur().server ? (sceneStatus[s.index] && sceneStatus[s.index].status === 'approved' ? `<div class="sp-ops"><span class="val">✓ ${T('Утверждено', 'Бекітілді')}${sceneStatus[s.index].approvedAt ? ' · ' + new Date(sceneStatus[s.index].approvedAt).toLocaleDateString('ru') : ''}</span><button type="button" data-op="unapprove">${T('Снять утверждение', 'Бекітуді алу')}</button></div>` : `<div class="sp-ops"><button type="button" class="approve" data-op="approve">${T('Утвердить и передать в Art', 'Бекітіп, Art-қа беру')}</button></div>`) : ''}
      <p class="empty" style="font-size:.76rem">${T('Тон и требования уходят в бриф для Art вместе с текстом сцены.', 'Реңк пен талаптар Art брифіне кетеді.')}</p>`;
    body.querySelector('[data-f=ton]').addEventListener('input', (e) => { clearTimeout(spTimer); spTimer = setTimeout(() => { const c = currentSceneByIndex(s.index); if (c) setSceneSyn(c, 'Тон', e.target.value); }, 400); });
    body.querySelector('[data-f=viz]').addEventListener('input', (e) => { clearTimeout(spTimer2); spTimer2 = setTimeout(() => { const c = currentSceneByIndex(s.index); if (c) setSceneSyn(c, 'Визуал', e.target.value); }, 400); });
    body.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => (b.dataset.op === 'approve' ? approveScene(s.index) : b.dataset.op === 'unapprove' ? approveScene(s.index, true) : sceneOp(s.index, b.dataset.op))));
  }
  async function approveScene(index, otmena) {
    const s = currentSceneByIndex(index); if (!s || !cur().server) return;
    const missing = []; if (otmena) missing.length = 0; else { if (!s.characters.length) missing.push(T('участники (нет реплик)', 'қатысушылар')); if (!sceneSyn(s, 'Тон')) missing.push(T('эмоциональный тон', 'эмоциялық реңк')); if (!sceneSyn(s, 'Визуал')) missing.push(T('требования к изображению', 'бейнеге талаптар'));
    if (missing.length && !confirm(T('Не заполнено: ', 'Толтырылмаған: ') + missing.join(', ') + T('. Утвердить всё равно?', '. Бәрібір бекіту керек пе?'))) return; }
    const slug = cur().server;
    try {
      flush(); if (serverMode && serverMode.loaded) { clearTimeout(serverMode.timer); await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/script', 'PUT', { text: cur().text }); serverMode.lastText = cur().text; }
      const meta = await serverFetch('/api/projects/' + encodeURIComponent(slug)); const rev = meta.data && meta.data.revision;
      const list = await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/scenes'); const arr = (list.data && (list.data.scenes || list.data)) || [];
      const sv = Array.isArray(arr) ? arr.find((x) => +x.n === s.index) : null;
      if (!sv) throw new Error(T('сцена ещё не в разбивке сервера — нажмите ⌘S и повторите', 'көрініс әлі сервер бөлінісінде жоқ — ⌘S басып, қайталаңыз'));
      await serverFetch('/api/projects/' + encodeURIComponent(slug) + '/scenes/' + encodeURIComponent(sv.id) + '/utverdit', 'POST', otmena ? { otmena: true } : {}, rev ? { 'If-Match': String(rev) } : {});
      toast(otmena ? T(`Утверждение сцены ${s.num} снято`, `${s.num} көрінісінің бекітуі алынды`) : T(`Сцена ${s.num} утверждена и передана в Art`, `${s.num} көрінісі бекітілді`)); loadSceneStatus();
    } catch (e) { toast(T('Не утвердилось: ', 'Бекітілмеді: ') + (/404|не найден/i.test(e.message) ? T('сервер ещё не обновлён до утверждения сцен', 'сервер әлі жаңартылмаған') : e.message)); }
  }
  function currentSceneByIndex(i) { return ed.scenes().find((x) => x.index === i) || null; }
  function sceneOp(index, op) {
    const sc = ed.scenes(); const s = sc.find((x) => x.index === index); if (!s) return; const blk = sceneBlock(s, sc);
    if (op === 'del') { if (!confirm(T(`Удалить сцену ${s.num} «${s.heading}»? Её можно вернуть из версий (⌘S сохранит текущее состояние).`, `${s.num} көрінісін жою керек пе?`))) return; snapshot(T('до удаления сцены ', 'көріністі жоюға дейін ') + s.num); toTrash('scene', s.num + '. ' + s.heading, ed.textRange(blk.from, blk.to)); ed.pushUndo(); let n = blk.from; const stop = blk.to.nextElementSibling; while (n && n !== stop) { const nx = n.nextElementSibling; n.remove(); n = nx; } ed.root.dispatchEvent(new Event('input')); toast(T('Сцена в корзине. Вернуть — ⌘Z или Корзина', 'Көрініс себетте')); return; }
    const i = sc.indexOf(s); const target = op === 'up' ? sc[i - 1] : sc[i + 1]; if (!target) return;
    moveScene(index, op === 'up' ? target.index : (sc[i + 2] ? sc[i + 2].index : null));
  }
  function moveScene(index, beforeIndex) { // переставить сцену index перед сценой beforeIndex (null — в конец)
    const sc = ed.scenes(); const s = sc.find((x) => x.index === index); if (!s || index === beforeIndex) return;
    const blk = sceneBlock(s, sc); const nodes = []; let n = blk.from; const stop = blk.to.nextElementSibling; while (n && n !== stop) { nodes.push(n); n = n.nextElementSibling; }
    ed.pushUndo();
    const before = beforeIndex ? sc.find((x) => x.index === beforeIndex) : null;
    if (before) { for (const x of nodes) before.el.before(x); } else { for (const x of nodes) ed.root.appendChild(x); }
    ed.focusPara(nodes[0], 0); ed.root.dispatchEvent(new Event('input')); nodes[0].scrollIntoView({ block: 'center' });
  }
  function toggleScenePanel(v) { document.body.classList.toggle('scene-open', v); try { localStorage.setItem('nvs.scene', v ? '1' : '0'); } catch (e) { /* */ } if (v) { document.body.classList.remove('neyra-open'); $('#neyra').classList.add('hidden'); renderScenePanel(); } }
  $('#btnScene').addEventListener('click', () => toggleScenePanel(!document.body.classList.contains('scene-open')));
  $('#spClose').addEventListener('click', () => toggleScenePanel(false));
  (function () { let v = '1'; try { v = localStorage.getItem('nvs.scene') || '1'; } catch (e) { /* */ } if (v === '1' && window.innerWidth > 1100) document.body.classList.add('scene-open'); })();
  // перетаскивание сцен в списке
  (function () {
    const ul = $('#scenes'); let dragIdx = null;
    ul.addEventListener('dragstart', (e) => { const li = e.target.closest('li[data-i]'); if (!li) return; dragIdx = +li.dataset.i; li.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
    ul.addEventListener('dragover', (e) => { const li = e.target.closest('li[data-i]'); if (!li || dragIdx === null) return; e.preventDefault(); ul.querySelectorAll('li.over').forEach((x) => x.classList.remove('over')); li.classList.add('over'); });
    ul.addEventListener('dragleave', (e) => { const li = e.target.closest('li[data-i]'); if (li) li.classList.remove('over'); });
    ul.addEventListener('drop', (e) => { const li = e.target.closest('li[data-i]'); ul.querySelectorAll('li.over,li.drag').forEach((x) => x.classList.remove('over', 'drag')); if (!li || dragIdx === null) return; e.preventDefault(); const to = +li.dataset.i; if (to !== dragIdx) moveScene(dragIdx, to); dragIdx = null; });
    ul.addEventListener('dragend', () => { ul.querySelectorAll('li.over,li.drag').forEach((x) => x.classList.remove('over', 'drag')); dragIdx = null; });
  })();

  // ---------- NEYRA ----------
  function openNeyra(v) { document.body.classList.toggle('neyra-open', v); $('#neyra').classList.toggle('hidden', !v); if (v) { document.body.classList.remove('scene-open'); scopeHint(); } else { let sv = '1'; try { sv = localStorage.getItem('nvs.scene') || '1'; } catch (e) { /* */ } if (sv === '1' && window.innerWidth > 1100) { document.body.classList.add('scene-open'); renderScenePanel(); } } }
  $('#btnNeyra').addEventListener('click', () => openNeyra(!document.body.classList.contains('neyra-open')));
  $('#btnNeyraClose').addEventListener('click', () => openNeyra(false));
  let tier = 'standard'; try { tier = localStorage.getItem(LS.tier) === 'pro' ? 'pro' : 'standard'; } catch (e) { /* */ }
  function setTier(v) { tier = v === 'pro' ? 'pro' : 'standard'; try { localStorage.setItem(LS.tier, tier); } catch (e) { /* */ } $$('.seg.tier [data-tier]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tier === tier)); }
  $$('.seg.tier [data-tier]').forEach((b) => b.addEventListener('click', () => { setTier(b.dataset.tier); toast(tier === 'pro' ? T('PRO: глубокий разбор всего сценария; на действиях со сценой — Стандарт.', 'PRO: бүкіл сценарийді терең талдау.') : T('Стандарт', 'Стандарт')); })); setTier(tier);
  const HEAVY = { coverage: 1, beats: 1, continuity: 1, logline: 1, summarize: 0 };
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
    paraphrase: { title: 'Перефразировать', rewrite: true, prompt: (t, s) => `Перефразируй ${s.label}: тот же смысл, те же события и имена, но живее и точнее; убери канцелярит и повторы. ${FMT}\n\nТЕКСТ:\n${t}` },
    expand: { title: 'Расширить', rewrite: true, prompt: (t, s) => `Расширь ${s.label} примерно в полтора раза: добавь конкретные детали действия, паузы, реакции и реплики, которые раскрывают героев; ничего не меняй в событиях. ${FMT}\n\nТЕКСТ:\n${t}` },
    continue: { title: 'Вставить продолжение', insert: true, prompt: (t, s) => `Продолжи сценарий сразу после ${s.label}: напиши следующий бит или сцену (до одной страницы), логично вытекающие из текста, в тоне и ритме автора. ${FMT}\n\nТЕКСТ:\n${t}` },
    summarize: { title: 'Подытожить', prompt: (t, s) => `Подытожь ${s.label} в 5–8 строках: что происходит, чего хотят герои, что меняется к концу, какие вопросы остаются открытыми.${PLAIN}\n\nТЕКСТ:\n${t}` },
    translate: { title: 'Перевести', rewrite: true, prompt: (t, s) => (/[ӘҒҚҢӨҰҮҺІәғқңөұүһі]/.test(t) && (t.match(/[ӘҒҚҢӨҰҮҺІәғқңөұүһі]/g) || []).length > t.length / 200 ? `Переведи ${s.label} на русский язык, сохранив формат Fountain (ИНТ. / НАТ., имена капсом, ремарки в скобках). ${FMT}` : `Переведи ${s.label} на казахский язык, сохранив формат Fountain (ІШКІ. / СЫРТҚЫ. вместо ИНТ. / НАТ., имена капсом, ремарки в скобках). Речь живая, по характеру героев. ${FMT}`) + `\n\nТЕКСТ:\n${t}` },
    generate: { title: 'Сгенерировать', insert: true, brief: true, prompt: (t, s, brief) => `Напиши по заданию автора черновик в формате Fountain (заголовок сцены, действие, диалог), 0,5–1,5 страницы, в тоне сценария. ${FMT}\n\nЗАДАНИЕ: ${brief}\n\nКОНТЕКСТ (${s.label}):\n${t.slice(0, 6000)}` },
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
  $('#aiMore').addEventListener('click', () => $('#aiExtra').classList.toggle('hidden'));
  async function runAct(key) {
    const act = ACTS[key]; const s = getScope(act.scope);
    if (!s.text.trim()) return toast(T('Нечего отправлять: сценарий пуст', 'Сценарий бос'));
    if (s.kind === 'all' && !ed.stats().scenes) return toast(T('Сначала напишите хотя бы одну сцену', 'Алдымен бір көрініс жазыңыз'));
    let brief = '';
    if (act.brief) { brief = prompt(T('Что написать? (сцена, герои, что должно произойти)', 'Не жазу керек?'), ''); if (!brief || !brief.trim()) return; }
    await ask(ctx(cur()) + act.prompt(s.text, s, brief) + (lang === 'kz' && !/На (казахский|русский)/.test(act.title) ? '\n\nОтвечай на казахском языке.' : ''), act.title + ' · ' + s.label, { act, scope: s, key });
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
        j = { text: (r.data && r.data.answer) || '', tokeny: r.data && r.data.tokeny }; if (j.tokeny) showTokens(j.tokeny);
      } else {
        const messages = []; if (history.length && info.free) { messages.push({ role: 'user', content: 'Напоминание о предыдущих ответах по этому сценарию.' }); messages.push({ role: 'assistant', content: history.map((h) => h.content).join('\n---\n') }); }
        messages.push({ role: 'user', content: prompt });
        const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, max_tokens: info.scope && info.scope.kind === 'all' ? 6000 : 3000, tier: useTier }) });
        j = await r.json().catch(() => ({ error: 'сервер ответил не JSON' })); if (!r.ok || j.error) throw new Error(j.error || ('ошибка ' + r.status));
      }
      wait.remove(); const text = (j.text || '').trim(); const target = projects[pid]; if (!target) return;
      target.chat.push({ role: 'assistant', label, text, key: info.key, rewrite: !!(info.act && info.act.rewrite), insert: !!(info.act && info.act.insert), scope: info.scope ? { kind: info.scope.kind, label: info.scope.label, original: info.scope.kind === 'all' ? '' : info.scope.text, sceneNum: info.scope.kind === 'scene' ? getScope('scene').kind === 'scene' && info.scope.label : '' } : null, ts: Date.now(), spent: j.tokeny && j.tokeny.spisano });
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
  try { curDoc = localStorage.getItem(LS.doc) || 'script'; } catch (e) { /* */ } if (!/^(script|title|synopsis|stats|chars|locs|treatment|trash)$/.test(curDoc)) curDoc = 'script';
  if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embed');
  if (!Object.keys(projects).length) newProject(T('Без названия', 'Атаусыз'), '');
  if (!projects[currentId]) currentId = Object.keys(projects)[0];
  setLang(lang); open(currentId);
  const qSlug = new URLSearchParams(location.search).get('project');
  if (qSlug) { if (server) serverOpen(qSlug).catch((e) => toast(T('Не удалось открыть сценарий с сервера: ', 'Серверден сценарий ашылмады: ') + e.message)); else toast(T('Для проекта с сервера нужен ключ участника → ≡ → Сервер', 'Сервердегі жоба үшін кілт керек')); }
  else if (cur().server && server) serverOpen(cur().server).catch(() => { serverMode = null; });
})();
