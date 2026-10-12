/* Сценарная studio.neyra.vision — блок 1. Проекты в localStorage; с ?project=<slug> и ключом окна — черновик и помощник на сервере команды (№43 шаг 1). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const LS = { projects: 'nvs.projects', current: 'nvs.current', view: 'nvs.view', api: 'nvs.api' };

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
  let currentId = localStorage.getItem(LS.current);
  let parsed = Fountain.parse('');
  let apiBase = localStorage.getItem(LS.api) || '';
  let busy = false;
  // ---------- режим сервера (№43 шаг 1): редактор работает с черновиком проекта на сервере команды ----------
  const serverMode = (() => {
    try {
      const slug = new URLSearchParams(location.search).get('project');
      const settings = JSON.parse(localStorage.getItem('neyra-vision-server-settings-v1') || 'null');
      if (!slug || !settings || !settings.key || !settings.url) return null;
      return { slug, url: String(settings.url).replace(/\/+$/, ''), key: settings.key, loaded: false, timer: null };
    } catch (e) { return null; }
  })();
  async function serverFetch(path, method, body) {
    const r = await fetch(serverMode.url + path, { method: method || 'GET', headers: { 'X-Key': serverMode.key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('ошибка ' + r.status));
    return j;
  }
  async function serverOpen() {
    const id = 'srv:' + serverMode.slug;
    const meta = await serverFetch('/api/projects/' + encodeURIComponent(serverMode.slug));
    const script = await serverFetch('/api/projects/' + encodeURIComponent(serverMode.slug) + '/script');
    const text = (script.data && script.data.text) || '';
    const title = (meta.data && (typeof meta.data.title === 'string' ? meta.data.title : (meta.data.title && meta.data.title.ru))) || serverMode.slug;
    if (!projects[id]) projects[id] = { id, title, text, created: Date.now(), updated: Date.now(), beats: {}, meta: { logline: '', genre: '', synopsis: '', notes: '' }, chat: [] };
    projects[id].title = title; projects[id].text = text; projects[id].server = serverMode.slug;
    currentId = id; serverMode.lastText = text; serverMode.loaded = true; save(); open(id);
    $('#saveState').textContent = 'сценарий с сервера · ' + text.length + ' зн.';
  }
  function serverSave() {
    if (!serverMode || !serverMode.loaded || currentId !== 'srv:' + serverMode.slug) return;
    if (cur().text === serverMode.lastText) return; // ничего не менялось — на сервер не ходим, ревизию не трогаем
    clearTimeout(serverMode.timer);
    serverMode.timer = setTimeout(async () => {
      try { const text = cur().text; await serverFetch('/api/projects/' + encodeURIComponent(serverMode.slug) + '/script', 'PUT', { text }); serverMode.lastText = text; $('#saveState').textContent = 'сохранено на сервере'; }
      catch (e) { $('#saveState').textContent = 'сервер не принял: ' + e.message; }
    }, 1200);
  }

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save() {
    try { localStorage.setItem(LS.projects, JSON.stringify(projects)); localStorage.setItem(LS.current, currentId); $('#saveState').textContent = 'сохранено'; serverSave(); }
    catch (e) { $('#saveState').textContent = 'не сохраняется: ' + e.message; }
  }
  function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36); }
  function cur() { return projects[currentId]; }

  function newProject(title, text) {
    const id = uid();
    projects[id] = { id, title: title || 'Без названия', text: text || '', created: Date.now(), updated: Date.now(), beats: {}, meta: { logline: '', genre: '', synopsis: '', notes: '' }, chat: [] };
    currentId = id; save(); return projects[id];
  }

  // ---------- DOM ----------
  const src = $('#src'), page = $('#page'), titleIn = $('#title'), chat = $('#chat');

  function open(id) {
    if (!projects[id]) return;
    currentId = id; localStorage.setItem(LS.current, id);
    const p = cur();
    titleIn.value = p.title; src.value = p.text;
    $('#f-logline').value = p.meta.logline || ''; $('#f-genre').value = p.meta.genre || ''; $('#f-synopsis').value = p.meta.synopsis || ''; $('#f-notes').value = p.meta.notes || '';
    src.setSelectionRange(0, 0); renderChat(); update(); src.scrollTop = 0;
  }

  let t1;
  src.addEventListener('input', () => { $('#saveState').textContent = 'пишу…'; clearTimeout(t1); t1 = setTimeout(() => { cur().text = src.value; cur().updated = Date.now(); save(); update(); }, 180); });
  src.addEventListener('keyup', scopeHint); src.addEventListener('click', scopeHint); src.addEventListener('select', scopeHint);
  titleIn.addEventListener('input', () => { cur().title = titleIn.value; save(); });
  ['logline', 'genre', 'synopsis', 'notes'].forEach((k) => $('#f-' + k).addEventListener('input', (e) => { cur().meta[k] = e.target.value; save(); }));

  function update() {
    parsed = Fountain.parse(src.value);
    page.innerHTML = Fountain.render(parsed) || '<p class="ac" style="color:#999">Пустая страница. Начните с заголовка сцены: ИНТ. МЕСТО — ВРЕМЯ</p>';
    const s = parsed.stats;
    $('#stats').innerHTML = `<span><b class="num">${s.pages}</b> стр.</span><span><b class="num">${s.scenes}</b> сцен</span><span><b class="num">${s.words}</b> слов</span><span>диалог <b class="num">${s.dialogueShare}%</b></span>`;
    renderScenes(); renderChars(); renderBeats(); scopeHint();
  }

  function renderScenes() {
    const ul = $('#scenes'); ul.innerHTML = '';
    if (!parsed.scenes.length) { ul.innerHTML = '<li class="empty">Сцен пока нет. Заголовок сцены — строка капсом, начинающаяся с ИНТ. или НАТ.</li>'; return; }
    const curLine = lineAtCursor();
    for (const sc of parsed.scenes) {
      const li = document.createElement('li');
      const nextLine = parsed.scenes[sc.index] ? parsed.scenes[sc.index].line : Infinity;
      if (curLine >= sc.line && curLine < nextLine) li.classList.add('cur');
      li.innerHTML = `<span class="n">${sc.num}</span><span>${esc(sc.heading)}<span class="meta">${Array.from(sc.characters).join(', ') || '— без реплик'} · ${sc.words} сл.</span></span><span class="pg">${sc.page}</span>`;
      li.addEventListener('click', () => gotoLine(sc.line));
      ul.appendChild(li);
    }
  }
  function renderChars() {
    const ul = $('#chars'); ul.innerHTML = '';
    const list = Object.values(parsed.characters).sort((a, b) => b.words - a.words);
    if (!list.length) { ul.innerHTML = '<li class="empty">Герои появятся, когда будет первая реплика: имя КАПСОМ на отдельной строке, под ним текст.</li>'; return; }
    for (const c of list) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(c.name)}<span class="meta">${c.lines} реплик · ${c.words} слов · сцен: ${Array.from(c.scenes).join(', ')}</span></span>`;
      li.addEventListener('click', () => { const sc = parsed.scenes.find((s) => s.index === Array.from(c.scenes)[0]); if (sc) gotoLine(sc.line); });
      ul.appendChild(li);
    }
  }
  function renderBeats() {
    const box = $('#beats');
    if (box.dataset.built !== currentId) {
      box.innerHTML = '';
      BEATS.forEach(([name, a, b], i) => {
        const d = document.createElement('div'); d.className = 'beat';
        d.innerHTML = `<header><b>${i + 1}. ${name}</b><span class="pg" data-beat-pg="${i}"></span></header><textarea data-beat="${i}" placeholder="что происходит в этом бите"></textarea>`;
        d.querySelector('textarea').value = (cur().beats || {})[i] || '';
        d.querySelector('textarea').addEventListener('input', (e) => { cur().beats[i] = e.target.value; save(); });
        box.appendChild(d);
      });
      box.dataset.built = currentId;
    }
    const pages = Math.max(parsed.stats.pages, 1);
    BEATS.forEach(([name, a, b], i) => { const el = box.querySelector(`[data-beat-pg="${i}"]`); el.textContent = b ? `стр. ${Math.max(1, Math.round(a * pages))}–${Math.round(b * pages)}` : `стр. ${Math.max(1, Math.round(a * pages))}`; });
  }

  // вкладки левой панели
  $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
    $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
  }));

  // вид
  function setView(v) { $('#edWrap').className = 'ed-wrap ' + v; $$('.seg [data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v)); localStorage.setItem(LS.view, v); }
  $$('.seg [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  setView(localStorage.getItem(LS.view) || 'both');
  $('#mobLeft').addEventListener('click', () => document.body.classList.toggle('show-left'));
  $('#mobRight').addEventListener('click', () => document.body.classList.toggle('show-right'));

  // ---------- курсор, сцены, вставки ----------
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
  src.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); insertAtCursor(...INS['heading-int']); }
    if (e.key === 'Tab') { e.preventDefault(); insertAtCursor(...INS.character); }
  });

  // ---------- проекты ----------
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
    const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + 6) + 'px'; m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 12) + 'px';
    menuEl = m;
  }
  $('#btnProjects').addEventListener('click', (e) => {
    const list = Object.values(projects).sort((a, b) => b.updated - a.updated).map((p) => ({ label: p.title || 'Без названия', meta: new Date(p.updated).toLocaleDateString('ru'), run: () => open(p.id) }));
    menu(e.currentTarget, [
      { label: '+ Новый сценарий', run: () => { newProject('Без названия', ''); open(currentId); titleIn.focus(); } },
      { label: '↑ Импорт (.fountain, .txt, .fdx, .json)', run: () => $('#fileIn').click() },
      '-', ...list, '-',
      { label: '✕ Удалить текущий', run: delCurrent },
    ]);
  });
  function delCurrent() {
    const p = cur(); if (!p) return;
    if (!confirm(`Удалить «${p.title}»? Это нельзя отменить. Сначала скачайте .fountain, если нужно.`)) return;
    delete projects[p.id]; const ids = Object.keys(projects); if (!ids.length) newProject('Без названия', ''); else currentId = ids[0]; save(); open(currentId);
  }
  $('#fileIn').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return; const txt = await f.text(); const name = f.name.replace(/\.[^.]+$/, '');
    if (/\.fdx$/i.test(f.name)) newProject(name, Fountain.fromFDX(txt));
    else if (/\.json$/i.test(f.name)) { try { const j = JSON.parse(txt); if (j.text !== undefined) { const p = newProject(j.title || name, j.text); Object.assign(p, { beats: j.beats || {}, meta: Object.assign(p.meta, j.meta || {}), chat: j.chat || [] }); save(); } } catch (err) { toast('Не прочитал JSON'); return; } }
    else newProject(name, txt);
    open(currentId); e.target.value = ''; toast('Импортировано: ' + f.name);
  });
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function slug() { return (cur().title || 'scenariy').replace(/[^\wА-Яа-яЁё-]+/g, '-').slice(0, 60); }
  $('#btnExport').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Fountain (.fountain)', meta: 'текст', run: () => download(slug() + '.fountain', src.value) },
    { label: 'Final Draft (.fdx)', meta: 'FDX', run: () => download(slug() + '.fdx', Fountain.toFDX(parsed), 'application/xml') },
    { label: 'PDF / печать', meta: 'A4', run: () => { const v = $('#edWrap').className; setView('page'); setTimeout(() => { window.print(); setView(v.replace('ed-wrap ', '')); }, 100); } },
    { label: 'Резервная копия проекта (.json)', meta: 'всё', run: () => download(slug() + '.json', JSON.stringify(cur(), null, 2), 'application/json') },
  ]));

  // ---------- NEYRA ----------
  function scopeHint() {
    const sel = src.value.slice(src.selectionStart, src.selectionEnd);
    const sc = Fountain.sceneAt(parsed, lineAtCursor(), src.value);
    const mode = $('#scope').value;
    let what;
    if (mode === 'selection' || (mode === 'auto' && sel.trim())) what = sel.trim() ? `выделение · ${Fountain.countWords(sel)} сл.` : 'ничего не выделено';
    else if (mode === 'scene' || (mode === 'auto' && sc)) what = sc ? `сцена ${sc.scene.num} · ${sc.scene.heading}` : 'сцены нет';
    else what = `весь сценарий · ${parsed.stats.pages} стр.`;
    $('#scopeWhat').textContent = what;
    renderScenes();
  }
  $('#scope').addEventListener('change', scopeHint);
  function getScope(force) {
    const mode = force || $('#scope').value;
    const a = src.selectionStart, b = src.selectionEnd, sel = src.value.slice(a, b);
    const sc = Fountain.sceneAt(parsed, lineAtCursor(), src.value);
    if (mode === 'all') return { kind: 'all', text: src.value, label: 'весь сценарий' };
    if ((mode === 'selection' || mode === 'auto') && sel.trim()) return { kind: 'selection', text: sel, start: a, end: b, label: 'выделенный фрагмент' };
    if ((mode === 'scene' || mode === 'auto') && sc) {
      const lines = src.value.split('\n'); let s0 = 0; for (let i = 0; i < sc.start; i++) s0 += lines[i].length + 1; const e0 = s0 + sc.text.length;
      return { kind: 'scene', text: sc.text, start: s0, end: e0, label: `сцена ${sc.scene.num} «${sc.scene.heading}»` };
    }
    return { kind: 'all', text: src.value, label: 'весь сценарий' };
  }

  const ACTS = {
    coverage: { scope: 'all', title: 'Читательское заключение', prompt: (t, p) => `Прочитай сценарий целиком и напиши читательское заключение: логлайн, как ты его понял · синопсис в 10 строк · разбор по элементам (премиса, структура, герой, антагонист, сцены, диалог, темп, тон, мир) · что работает · что не работает, с номерами сцен · 5–10 вопросов автору. ${ctx(p)}\n\nСЦЕНАРИЙ:\n${t}` },
    beats: { scope: 'all', title: 'Бит-шит', prompt: (t, p) => `Разметь сценарий по 15 битам Снайдера: для каждого бита — есть ли он, в какой сцене, на какой примерно странице (всего ≈${p.stats.pages} стр.), и что с ним не так. В конце — какие биты пропущены или стоят не на месте, и один главный вывод о структуре. ${ctx(p)}\n\nСЦЕНАРИЙ:\n${t}`, fillBeats: true },
    continuity: { scope: 'all', title: 'Проверка непрерывности', prompt: (t) => `Проверь непрерывность: имена и возраста сходятся · день/ночь и время года не прыгают · герой не знает того, чего ещё не узнал · ружья из первого акта стреляют · ничего не исчезло без объяснения · факты реального мира, которые стоит [уточнить]. Выдай список расхождений с номерами сцен. Если всё чисто — скажи, что именно проверил.\n\nСЦЕНАРИЙ:\n${t}` },
    improve: { title: 'Улучшить сцену', rewrite: true, prompt: (t, p, s) => `Перепиши ${s.label}, усилив три вещи: чего герой хочет здесь, что мешает, что изменилось к концу. Входи позже, выходи раньше. Сохрани голос автора, имена и факты. Ответ — только текст в формате Fountain, без пояснений.\n\nТЕКСТ:\n${t}` },
    dialogue: { title: 'Диалог живее', rewrite: true, prompt: (t, p, s) => `Перепиши диалог в ${s.label}: убери прямую экспозицию, добавь подтекст, сделай каждого героя узнаваемым по реплике без имени, сократи лишние первые и последние реплики. Действие и структуру не меняй. Ответ — только текст в формате Fountain, без пояснений.\n\nТЕКСТ:\n${t}` },
    modernize: { title: 'Модернизировать', rewrite: true, prompt: (t, p, s) => `Модернизируй ${s.label}: перенеси в наше время (2026), современный живой язык, реальные сегодняшние детали быта, связи и технологий (телефоны, мессенджеры, такси, камеры), без штампов и без «как ты знаешь». Суть конфликта и характеры сохрани. Ответ — только текст в формате Fountain, без пояснений.\n\nТЕКСТ:\n${t}` },
    turns: { title: 'Три поворота', prompt: (t, p, s) => `Для ${s.label} предложи три разных варианта ключевого поворота (что меняется к концу сцены). Для каждого: одна строка сути · как меняется последняя треть сцены (3–6 строк в формате Fountain) · чем это платит дальше по истории. Не выбирай за автора.\n\nТЕКСТ:\n${t}` },
    logline: { scope: 'all', title: 'Логлайн и синопсис', toMeta: true, prompt: (t) => `По сценарию напиши: ЛОГЛАЙН (1–2 фразы по формуле герой с изъяном / цель / ставки / препятствие) · ЖАНР и формат · СИНОПСИС в 10–12 строк. Отвечай строго в виде трёх блоков с заголовками ЛОГЛАЙН:, ЖАНР:, СИНОПСИС: на отдельных строках.\n\nСЦЕНАРИЙ:\n${t}` },
    kazakh: { title: 'На казахский', rewrite: true, prompt: (t, p, s) => `Переведи ${s.label} на казахский язык, сохранив формат Fountain: заголовки сцен капсом (ІШКІ. / СЫРТҚЫ. вместо ИНТ. / НАТ., форсируй точкой в начале строки, если нужно), имена героев капсом, ремарки в скобках. Речь живая, разговорная, по характеру героев. Ответ — только текст, без пояснений.\n\nТЕКСТ:\n${t}` },
    expand: { title: 'Расписать в сцены', rewrite: true, prompt: (t, p, s) => `Расписать ${s.label} в сцены: если это синопсис, заметка или поэпизодник — преврати в черновик сцен в формате Fountain (заголовки сцен, действие, диалог). Если это уже сцена — расширь её, добавив недостающие биты. Отметь [[заметками]] места, где нужны решения автора. Ответ — только текст в формате Fountain.\n\nТЕКСТ:\n${t}` },
    cut: { title: 'Сжать', rewrite: true, prompt: (t, p, s) => `Сократи ${s.label} примерно на треть без потери сути: входи поздно, выходи рано, убери повторы и описания, которые камера не покажет. Ответ — только текст в формате Fountain, без пояснений.\n\nТЕКСТ:\n${t}` },
  };
  function ctx(p) { const m = cur().meta; const bits = []; if (m.logline) bits.push('Логлайн автора: ' + m.logline); if (m.genre) bits.push('Жанр/формат: ' + m.genre); return bits.length ? '\nКонтекст: ' + bits.join('. ') : ''; }

  $('#actions').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) runAct(b.dataset.act); });
  async function runAct(key) {
    const act = ACTS[key]; const s = getScope(act.scope);
    if (!s.text.trim()) return toast('Нечего отправлять: сценарий пуст');
    const prompt = act.prompt(s.text, parsed, s);
    await ask(prompt, act.title + ' · ' + s.label, { act, scope: s, key });
  }
  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#askIn').value.trim(); if (!q) return; $('#askIn').value = ''; const s = getScope(); ask(`${q}\n\n(${s.label.toUpperCase()}):\n${s.text}`, q, { scope: s, free: true }); });
  $('#askIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#askForm').requestSubmit(); } });

  async function ask(prompt, label, info) {
    if (busy) return toast('NEYRA ещё отвечает');
    busy = true;
    const p = cur();
    p.chat.push({ role: 'user', label, ts: Date.now() }); renderChat();
    const wait = addMsg({ role: 'assistant', label: 'NEYRA думает', text: '', wait: true });
    try {
      const history = p.chat.filter((m) => m.role === 'assistant' && m.text).slice(-2).map((m) => ({ role: 'assistant', content: m.text.slice(0, 3000) }));
      const messages = [];
      // короткая память последних ответов, чтобы можно было переспросить
      if (history.length && info.free) { messages.push({ role: 'user', content: 'Напоминание о предыдущих ответах по этому сценарию.' }); messages.push({ role: 'assistant', content: history.map((h) => h.content).join('\n---\n') }); }
      messages.push({ role: 'user', content: prompt });
      let j;
      if (serverMode && serverMode.loaded) {
        const hist = history.map((m) => ({ role: 'assistant', content: m.content }));
        j = await serverFetch('/api/projects/' + encodeURIComponent(serverMode.slug) + '/assistant', 'POST', { question: prompt, section: 'script', history: hist });
        j = { text: (j.data && j.data.answer) || '' };
      } else {
        const r = await fetch(apiBase + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, max_tokens: info.scope && info.scope.kind === 'all' ? 6000 : 3000 }) });
        j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || ('ошибка ' + r.status));
      }
      wait.remove();
      const text = (j.text || '').trim();
      p.chat.push({ role: 'assistant', label: label, text, key: info.key, rewrite: !!(info.act && info.act.rewrite), scope: info.scope ? { kind: info.scope.kind, start: info.scope.start, end: info.scope.end, label: info.scope.label } : null, ts: Date.now() });
      if (p.chat.length > 40) p.chat = p.chat.slice(-40);
      save(); renderChat();
      if (info.act && info.act.toMeta) applyMeta(text);
    } catch (err) {
      wait.remove(); addMsg({ role: 'assistant', label: 'не получилось', text: err.message, err: true });
    } finally { busy = false; }
  }
  function applyMeta(text) {
    const grab = (k) => { const m = text.match(new RegExp(k + ':\\s*([\\s\\S]*?)(?=\\n[А-ЯЁ ]{3,}:|$)')); return m ? m[1].trim() : ''; };
    const l = grab('ЛОГЛАЙН'), g = grab('ЖАНР'), s = grab('СИНОПСИС');
    if (l) { cur().meta.logline = l; $('#f-logline').value = l; }
    if (g) { cur().meta.genre = g; $('#f-genre').value = g; }
    if (s) { cur().meta.synopsis = s; $('#f-synopsis').value = s; }
    save(); toast('Карточка «Замысел» заполнена');
  }
  function renderChat() {
    chat.innerHTML = '';
    const p = cur(); if (!p) return;
    if (!p.chat.length) { chat.innerHTML = '<div class="empty">Выберите, с чем работать, и нажмите действие. Ответы, которые переписывают текст, можно вставить в сценарий одной кнопкой.</div>'; return; }
    for (const m of p.chat) addMsg(m, true);
    chat.scrollTop = chat.scrollHeight;
  }
  function addMsg(m, noScroll) {
    const d = document.createElement('div');
    d.className = 'msg ' + (m.role === 'user' ? 'u' : 'a') + (m.err ? ' err' : '') + (m.wait ? ' wait' : '');
    d.innerHTML = `<div class="lbl">${esc(m.role === 'user' ? 'Запрос · ' + m.label : m.label)}</div>${m.text ? `<div class="body">${esc(m.text)}</div>` : ''}`;
    if (m.role === 'assistant' && m.text && !m.err) {
      const ops = document.createElement('div'); ops.className = 'ops';
      const mk = (l, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.addEventListener('click', f); ops.appendChild(b); };
      if (m.rewrite && m.scope && m.scope.kind !== 'all') mk('Заменить ' + (m.scope.kind === 'scene' ? 'сцену' : 'выделенное'), () => replaceRange(m));
      mk('Вставить в текст', () => insertAtCursor(m.text.replace(/\n*$/, '\n\n')));
      mk('Копировать', () => navigator.clipboard.writeText(m.text).then(() => toast('Скопировано')));
      mk('В заметки', () => { cur().meta.notes = (cur().meta.notes ? cur().meta.notes + '\n\n' : '') + '— ' + m.label + ' —\n' + m.text; $('#f-notes').value = cur().meta.notes; save(); toast('Добавлено в «Замысел → Заметки»'); });
      d.appendChild(ops);
    }
    chat.appendChild(d); if (!noScroll) chat.scrollTop = chat.scrollHeight; return d;
  }
  function replaceRange(m) {
    const s = m.scope; const v = src.value;
    // если текст изменился и границы не совпадают с текущей сценой — заменяем по подтверждению
    const old = v.slice(s.start, s.end);
    if (!old.trim()) return toast('Исходный фрагмент не найден, вставьте вручную');
    if (!confirm(`Заменить ${s.label} текстом NEYRA? Старый текст уйдёт в заметки.`)) return;
    cur().meta.notes = (cur().meta.notes ? cur().meta.notes + '\n\n' : '') + `— было (${s.label}, ${new Date().toLocaleString('ru')}) —\n` + old; $('#f-notes').value = cur().meta.notes;
    src.value = v.slice(0, s.start) + m.text.replace(/\n*$/, '\n') + v.slice(s.end);
    src.setSelectionRange(s.start, s.start + m.text.length); src.focus(); src.dispatchEvent(new Event('input')); toast('Заменено. Старый текст — в заметках');
  }

  async function checkApi() {
    if (serverMode) {
      try { await serverFetch('/api/me'); $('#aiDot').className = 'dot on'; $('#aiState').textContent = 'сервер проекта · ' + serverMode.slug; } catch (e) { $('#aiDot').className = 'dot off'; $('#aiState').textContent = 'сервер: ' + e.message; }
      return;
    }
    try { const r = await fetch(apiBase + '/api/status'); const j = await r.json(); $('#aiDot').className = 'dot ' + (j.key ? 'on' : 'off'); $('#aiState').textContent = j.key ? 'на связи' : 'ключ не задан на сервере'; }
    catch (e) { $('#aiDot').className = 'dot off'; $('#aiState').textContent = 'нет сервера станции'; }
  }

  // ---------- утилиты ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  let tt; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 2200); }
  async function serverVersion() {
    if (!serverMode || !serverMode.loaded) return false;
    clearTimeout(serverMode.timer);
    const path = '/api/projects/' + encodeURIComponent(serverMode.slug);
    await serverFetch(path + '/script', 'PUT', { text: cur().text });
    const stamp = new Date(); const label = 'редактор · ' + stamp.toLocaleDateString('ru-RU') + ' ' + stamp.toTimeString().slice(0, 5);
    await serverFetch(path + '/versions', 'POST', { label });
    $('#saveState').textContent = 'версия зафиксирована · ' + label;
    return true;
  }
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); cur().text = src.value; save(); if (serverMode && serverMode.loaded) serverVersion().then(() => toast('Версия сценария зафиксирована на сервере')).catch((err) => toast('Сервер не принял версию: ' + err.message)); else toast('Сохранено в браузере'); } });

  // ---------- встраивание в окно проекта (№43 шаг 1.5) ----------
  if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embed');
  // ---------- старт ----------
  if (!Object.keys(projects).length) newProject('Последний поезд (пример)', DEMO);
  if (!projects[currentId]) currentId = Object.keys(projects)[0];
  open(currentId); checkApi();
  if (serverMode) serverOpen().catch((e) => { $('#saveState').textContent = 'сервер: ' + e.message; toast('Не удалось открыть сценарий с сервера: ' + e.message); });
})();
