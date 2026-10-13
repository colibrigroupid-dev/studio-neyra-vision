/* Сценарный лист «как в Story Architect»: абзацы с типами, Tab/Enter по таблице STARC, автодополнение, undo.
   Хранение — Fountain (project.text); лист ↔ Fountain через Fountain.parse и serialize().
   API: ScriptEditor.create(el, opts) → { load(text), text(), paras(), setType(t), focusPara(i), undo(), redo(), insertText(t), scenes(), stats() } */
(function (global) {
  'use strict';
  const T = { heading: 'scene_heading', action: 'action', character: 'character', paren: 'parenthetical', dialogue: 'dialogue', lyrics: 'lyrics', shot: 'shot', transition: 'transition', note: 'inline_note', sequence: 'sequence_heading', act: 'act_heading', centered: 'centered', pagebreak: 'page_break', synopsis: 'synopsis' };
  // переходы по умолчанию STARC (settings_storage.cpp): jumping — курсор в конце непустого абзаца; changing — абзац пустой
  const JUMP = {
    tab: { scene_heading: 'scene_characters', scene_characters: 'action', unformatted_text: 'unformatted_text', action: 'character', character: 'parenthetical', parenthetical: 'dialogue', dialogue: 'parenthetical', lyrics: 'parenthetical', transition: 'scene_heading', shot: 'action', inline_note: 'action', sequence_heading: 'scene_heading', act_heading: 'sequence_heading', centered: 'action', synopsis: 'action' },
    enter: { scene_heading: 'action', scene_characters: 'action', unformatted_text: 'unformatted_text', action: 'action', character: 'dialogue', parenthetical: 'dialogue', dialogue: 'action', lyrics: 'action', transition: 'scene_heading', shot: 'action', inline_note: 'action', sequence_heading: 'scene_heading', act_heading: 'scene_heading', centered: 'action', synopsis: 'action' },
  };
  const CHANGE = {
    tab: { scene_heading: 'scene_characters', scene_characters: 'action', unformatted_text: 'unformatted_text', action: 'character', character: 'action', parenthetical: 'dialogue', dialogue: 'parenthetical', lyrics: 'parenthetical', transition: 'action', shot: 'action', inline_note: 'inline_note', sequence_heading: 'scene_heading', act_heading: 'sequence_heading', centered: 'action', synopsis: 'action' },
    enter: { scene_heading: 'scene_heading', scene_characters: 'action', unformatted_text: 'unformatted_text', action: 'scene_heading', character: 'action', parenthetical: 'parenthetical', dialogue: 'action', lyrics: 'action', transition: 'transition', shot: 'shot', inline_note: 'inline_note', sequence_heading: 'act_heading', act_heading: 'act_heading', centered: 'action', synopsis: 'action' },
  };
  const UPPER = { scene_heading: 1, scene_characters: 1, character: 1, transition: 1, shot: 1, sequence_heading: 1, act_heading: 1 };
  // ширина строки в знаках (Courier 12 = 10 зн./дюйм) для шаблона A4 «Отечественный»: текст 147,5 мм ≈ 58 зн.
  const COLS = { scene_heading: 58, scene_characters: 58, unformatted_text: 58, action: 58, character: 31, parenthetical: 18, dialogue: 28, lyrics: 43, transition: 58, shot: 58, inline_note: 31, sequence_heading: 58, act_heading: 58, centered: 58, synopsis: 58 };
  const BEFORE = { scene_heading: 1, action: 1, character: 1, transition: 1, shot: 1, inline_note: 1, sequence_heading: 1, act_heading: 1, centered: 1, synopsis: 1 };
  const LINES_PER_PAGE = 61; // A4: 297 − 25 − 12,5 мм при 12 pt
  const SEC_PER_PAGE = 60;

  const DICT = {
    prefixes: ['ИНТ.', 'НАТ.', 'ИНТ./НАТ.', 'НАТ./ИНТ.', 'ІШКІ.', 'СЫРТҚЫ.', 'INT.', 'EXT.', 'INT./EXT.'],
    times: ['ДЕНЬ', 'НОЧЬ', 'УТРО', 'ВЕЧЕР', 'ПОСЛЕ ПОЛУДНЯ', 'ПОЗЖЕ', 'НЕМНОГО ПОЗЖЕ', 'ПРОДОЛЖЕНИЕ', 'НА СЛЕДУЮЩИЙ ДЕНЬ', 'РАССВЕТ', 'ЗАКАТ', 'КҮН', 'ТҮН', 'ТАҢ', 'КЕШ'],
    transitions: ['В ЗТМ.', 'ИЗ ЗТМ:', 'ЗАТЕМНЕНИЕ.', 'ПЕРЕХОД К:', 'CUT TO:', 'FADE IN:', 'FADE OUT', 'FADE TO:', 'DISSOLVE TO:', 'BACK TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'FADE TO BLACK'],
    extensions: ['ЗК', 'ГЗК', 'ВПЗ', 'СУБТИТР', 'ПРОД.', 'V.O.', 'O.S.', "CONT'D"],
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function create(root, opts) {
    opts = opts || {};
    root.classList.add('se');
    root.setAttribute('contenteditable', 'true');
    root.setAttribute('spellcheck', 'true');
    root.dataset.placeholder = opts.placeholder || '';
    const hint = document.createElement('div'); hint.className = 'se-hint hidden'; if (root.parentNode) root.parentNode.appendChild(hint);
    const undoStack = [], redoStack = []; let undoTimer = null, lastSnap = '';
    let hintItems = [], hintPick = 0, hintMode = '';
    const api = {};

    // ---------- абзацы ----------
    function paras() { return Array.from(root.children).filter((n) => n.tagName === 'P'); }
    function mk(type, text) { const p = document.createElement('p'); p.className = 'b b-' + type; p.dataset.t = type; p.textContent = text || ''; if (!text) p.appendChild(document.createElement('br')); return p; }
    function typeOf(p) { return p && p.dataset ? p.dataset.t : 'action'; }
    function setTypeOf(p, type) { if (!p) return; p.dataset.t = type; p.className = 'b b-' + type; }
    function sel() { const s = window.getSelection(); return s && s.rangeCount ? s.getRangeAt(0) : null; }
    function curPara() { const r = sel(); if (!r) return null; let n = r.startContainer; while (n && n !== root) { if (n.nodeType === 1 && n.tagName === 'P' && n.parentNode === root) return n; n = n.parentNode; } return null; }
    function textOf(p) { return (p.textContent || '').replace(/ /g, ' '); }
    function caretOffset(p) { const r = sel(); if (!r || !p) return 0; const pre = r.cloneRange(); pre.selectNodeContents(p); pre.setEnd(r.startContainer, r.startOffset); return pre.toString().length; }
    function placeCaret(p, offset) {
      if (!p) return; const r = document.createRange(); const s = window.getSelection();
      let node = p.firstChild; if (!node || node.nodeName === 'BR') { r.setStart(p, 0); r.collapse(true); s.removeAllRanges(); s.addRange(r); return; }
      let rem = offset == null ? textOf(p).length : offset;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let t;
      while ((t = walker.nextNode())) { if (rem <= t.length) { r.setStart(t, rem); r.collapse(true); s.removeAllRanges(); s.addRange(r); return; } rem -= t.length; }
      r.selectNodeContents(p); r.collapse(false); s.removeAllRanges(); s.addRange(r);
    }
    function normalizePara(p) { // следим, чтобы в абзаце не было вложенных блоков, а пустой держал <br>
      if (!p.firstChild) p.appendChild(document.createElement('br'));
      Array.from(p.querySelectorAll('div,p,span,b,i,u,font,a')).forEach((n) => { const t = document.createTextNode(n.textContent); n.replaceWith(t); });
      if (p.childNodes.length > 1) Array.from(p.querySelectorAll('br')).forEach((br) => { if (p.childNodes.length > 1) br.remove(); });
    }
    function normalize() {
      Array.from(root.childNodes).forEach((n) => {
        if (n.nodeType === 3) { if (n.textContent.trim()) { const p = mk('action', n.textContent); root.replaceChild(p, n); } else n.remove(); }
        else if (n.tagName !== 'P') { const p = mk(n.dataset && n.dataset.t ? n.dataset.t : 'action', n.textContent); root.replaceChild(p, n); }
        else normalizePara(n);
      });
      if (!paras().length) root.appendChild(mk('scene_heading', ''));
    }

    // ---------- загрузка / сериализация через Fountain ----------
    function load(text) {
      root.innerHTML = '';
      const p = Fountain.parse(text || '');
      const frag = document.createDocumentFragment();
      let prevType = null;
      for (const t of p.tokens) {
        let type = null, txt = t.text || '';
        switch (t.type) {
          case 'scene_heading': type = 'scene_heading'; break;
          case 'action': if (/^!/.test(txt) && txt === txt.toUpperCase()) { type = 'shot'; txt = txt.slice(1); } else type = 'action'; break;
          case 'character': type = 'character'; txt = t.text; break;
          case 'parenthetical': type = 'parenthetical'; txt = txt.replace(/^\(|\)$/g, ''); break;
          case 'dialogue': type = 'dialogue'; break;
          case 'lyrics': type = 'lyrics'; break;
          case 'transition': type = 'transition'; break;
          case 'centered': type = 'centered'; break;
          case 'section': type = t.level >= 2 ? 'sequence_heading' : 'act_heading'; break;
          case 'synopsis': type = 'synopsis'; break;
          case 'note': type = 'inline_note'; break;
          case 'page_break': type = 'page_break'; txt = ''; break;
          default: break;
        }
        if (!type) continue;
        // многострочное действие: Fountain даёт по строке — склеиваем соседние строки действия в один абзац, как в редакторах
        if (type === 'action' && prevType === 'action' && frag.lastChild && !frag.lastChild.dataset.closed) { frag.lastChild.textContent += ' ' + txt; continue; }
        if (type === 'dialogue' && prevType === 'dialogue' && frag.lastChild) { frag.lastChild.textContent += ' ' + txt; continue; }
        const el = mk(type, txt); frag.appendChild(el); prevType = type;
        if (t.type === 'blank') prevType = null;
      }
      root.appendChild(frag);
      // пустые строки между абзацами действия Fountain-парсер выдаёт как blank; склейку выше ограничим: если между action был blank — новый абзац
      normalize();
      undoStack.length = 0; redoStack.length = 0; lastSnap = snapshotHtml();
      api.onChange && api.onChange();
    }
    // точная склейка: перезагрузка с учётом пустых строк
    function loadExact(text) {
      root.innerHTML = '';
      const lines = (text || '').replace(/\r\n?/g, '\n');
      const parsed = Fountain.parse(lines);
      const frag = document.createDocumentFragment();
      let cur = null, curType = null;
      for (const t of parsed.tokens) {
        if (t.type === 'blank') { cur = null; curType = null; continue; }
        let type = null, txt = t.text || '';
        switch (t.type) {
          case 'scene_heading': type = 'scene_heading'; break;
          case 'action': if (t.forced && txt === txt.toUpperCase() && /^[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]/.test(txt)) { type = (frag.lastChild && frag.lastChild.dataset && frag.lastChild.dataset.t === 'scene_heading') ? 'scene_characters' : 'shot'; } else if (t.forced) type = 'unformatted_text'; else type = 'action'; break;
          case 'character': type = 'character'; break;
          case 'parenthetical': type = 'parenthetical'; txt = txt.replace(/^\(|\)$/g, ''); break;
          case 'dialogue': type = 'dialogue'; break;
          case 'lyrics': type = 'lyrics'; break;
          case 'transition': type = 'transition'; break;
          case 'centered': type = 'centered'; break;
          case 'section': type = t.level >= 2 ? 'sequence_heading' : 'act_heading'; break;
          case 'synopsis': type = 'synopsis'; break;
          case 'note': type = 'inline_note'; break;
          case 'page_break': type = 'page_break'; txt = ''; break;
          default: continue;
        }
        if ((type === 'action' || type === 'dialogue') && cur && curType === type) { cur.textContent += ' ' + txt; continue; }
        cur = mk(type, txt); curType = type; frag.appendChild(cur);
      }
      root.appendChild(frag); normalize();
      undoStack.length = 0; redoStack.length = 0; lastSnap = snapshotHtml();
      api.onChange && api.onChange();
    }
    function serialize() {
      const out = []; let prev = null;
      for (const p of paras()) {
        const type = typeOf(p); let txt = textOf(p).trim();
        if (UPPER[type]) txt = txt.toUpperCase();
        const needBlank = !(prev && ((type === 'dialogue' || type === 'parenthetical' || type === 'lyrics') && (prev === 'character' || prev === 'dialogue' || prev === 'parenthetical' || prev === 'lyrics')));
        if (type === 'page_break') { out.push('', '===', ''); prev = null; continue; }
        if (!txt) { continue; }
        let line = txt;
        switch (type) {
          case 'scene_heading': line = /^(ИНТ|НАТ|ЭКСТ|ІШКІ|СЫРТҚЫ|INT|EXT|EST|I\/E)[\.\s\-–—/]/i.test(txt) ? txt : '.' + txt; break;
          case 'character': line = /^[^a-zа-яё]*[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][^a-zа-яё]*$/.test(txt) ? txt : '@' + txt; break;
          case 'parenthetical': line = '(' + txt.replace(/^\(|\)$/g, '') + ')'; break;
          case 'lyrics': line = '~' + txt; break;
          case 'transition': line = '> ' + txt; break;
          case 'shot': case 'scene_characters': line = '!' + txt; break;
          case 'unformatted_text': line = '!' + (txt === txt.toUpperCase() ? txt.charAt(0) + txt.slice(1).toLowerCase() : txt); break;
          case 'inline_note': line = '[[' + txt + ']]'; break;
          case 'sequence_heading': line = '## ' + txt; break;
          case 'act_heading': line = '# ' + txt; break;
          case 'centered': line = '> ' + txt + ' <'; break;
          case 'synopsis': line = '= ' + txt; break;
          case 'action': if (/^(ИНТ|НАТ|INT|EXT)[\.\s]/i.test(txt) || /^[>#=!@~.]/.test(txt) || (/^[^a-zа-яё]*[A-ZА-ЯЁ][^a-zа-яё]*$/.test(txt) && txt.length < 40)) line = '!' + txt; break;
          default: break;
        }
        if (needBlank && out.length) out.push('');
        out.push(line); prev = type;
      }
      return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    // ---------- undo ----------
    function snapshotHtml() { return root.innerHTML; }
    function pushUndo(now) {
      const h = snapshotHtml(); if (h === lastSnap) return;
      undoStack.push({ html: lastSnap, caret: null }); if (undoStack.length > 200) undoStack.shift();
      redoStack.length = 0; lastSnap = h;
    }
    function scheduleUndo() { clearTimeout(undoTimer); undoTimer = setTimeout(() => pushUndo(), 600); }
    function undo() { clearTimeout(undoTimer); pushUndo(); const s = undoStack.pop(); if (!s) return; redoStack.push({ html: snapshotHtml() }); root.innerHTML = s.html; lastSnap = s.html; normalize(); const ps = paras(); placeCaret(ps[ps.length - 1]); changed(); }
    function redo() { const s = redoStack.pop(); if (!s) return; undoStack.push({ html: snapshotHtml() }); root.innerHTML = s.html; lastSnap = s.html; normalize(); changed(); }

    // ---------- действия ----------
    function changed() { api.onChange && api.onChange(); }
    function splitAt(p, type) { // новый абзац после p с текстом после курсора
      const off = caretOffset(p), full = textOf(p);
      const head = full.slice(0, off), tail = full.slice(off);
      p.textContent = head; normalizePara(p);
      const np = mk(type, tail); p.after(np); placeCaret(np, 0); return np;
    }
    function onEnter(p, shift) {
      const txt = textOf(p).trim();
      if (shift) { splitAt(p, typeOf(p)); return; }
      const type = typeOf(p);
      if (!txt) { setTypeOf(p, CHANGE.enter[type] || 'action'); return; }
      const off = caretOffset(p);
      if (off < textOf(p).length) { splitAt(p, type === 'character' ? 'dialogue' : type); return; }
      // автодополнение: Enter принимает подсказку и идёт дальше
      if (hintItems.length && !hint.classList.contains('hidden')) { acceptHint(hintPick, true); return; }
      const next = mk(JUMP.enter[type] || 'action', ''); p.after(next); placeCaret(next, 0);
    }
    function onTab(p, shift) {
      const type = typeOf(p), txt = textOf(p).trim();
      if (shift) { const order = ['scene_heading', 'scene_characters', 'action', 'character', 'parenthetical', 'dialogue', 'lyrics', 'shot', 'transition']; const i = order.indexOf(type); setTypeOf(p, order[(i - 1 + order.length) % order.length]); return; }
      if (hintItems.length && !hint.classList.contains('hidden')) { acceptHint(hintPick, false); return; }
      if (!txt) { setTypeOf(p, CHANGE.tab[type] || 'action'); return; }
      if (type === 'scene_heading') { // Tab в заголовке: поставить разделитель « - » перед временем
        const t = textOf(p); if (!/[-–—]\s*[^-–—]*$/.test(t.replace(/^[^.]*\.\s*/, '')) || !/\s[-–—]\s/.test(t)) { p.textContent = t.replace(/\s*$/, '') + ' - '; placeCaret(p); hintUpdate(); return; }
      }
      const next = mk(JUMP.tab[type] || 'action', ''); p.after(next); placeCaret(next, 0);
    }
    function onBackspace(p, e) {
      const off = caretOffset(p); const r = sel(); if (!r || !r.collapsed || off !== 0) return;
      e.preventDefault();
      const prev = p.previousElementSibling;
      if (!textOf(p).trim()) { if (prev) { p.remove(); placeCaret(prev); } else if (typeOf(p) !== 'action') setTypeOf(p, 'action'); changed(); return; }
      if (!prev) return;
      const plen = textOf(prev).trim().length;
      if (!textOf(prev).trim()) { prev.remove(); changed(); return; }
      prev.textContent = textOf(prev) + textOf(p); p.remove(); normalizePara(prev); placeCaret(prev, plen); changed();
    }
    function setType(type) { const p = curPara(); if (!p) return; pushUndo(); setTypeOf(p, type); if (type === 'page_break') { p.textContent = ''; normalizePara(p); } changed(); hintUpdate(); }

    // ---------- автодополнение ----------
    function knownLocations() { const set = new Set(); for (const p of paras()) if (typeOf(p) === 'scene_heading') { const m = textOf(p).toUpperCase().match(/^(?:[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.(?:\/[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.)?)\s*(.*?)\s*(?:\s[-–—]\s.*)?$/); if (m && m[1].trim()) set.add(m[1].trim()); } return Array.from(set); }
    function knownCharacters(p) {
      const all = [], scene = [];
      let inScene = false; const ps = paras(); const idx = ps.indexOf(p);
      for (let i = 0; i < ps.length; i++) { const q = ps[i]; if (typeOf(q) === 'scene_heading') inScene = i < idx; if (typeOf(q) === 'character' && q !== p) { const n = textOf(q).toUpperCase().replace(/\s*\(.*$/, '').replace(/\s*\^\s*$/, '').trim(); if (n) { if (!all.includes(n)) all.push(n); if (inScene && i < idx && !scene.includes(n)) scene.push(n); } } }
      return scene.reverse().concat(all.filter((n) => !scene.includes(n)));
    }
    function hintUpdate() {
      const p = curPara(); hintItems = []; hintMode = '';
      if (!p) return hideHint();
      const r = sel(); if (!r || !r.collapsed) return hideHint();
      const type = typeOf(p), txt = textOf(p), off = caretOffset(p);
      if (off !== txt.length) return hideHint();
      const up = txt.toUpperCase();
      let list = [], q = '';
      if (type === 'scene_heading') {
        const mPrefix = up.match(/^([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.(?:\/[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.)?)\s*/);
        if (!mPrefix) { q = up.trim(); list = DICT.prefixes.filter((x) => x.startsWith(q)); hintMode = 'prefix'; }
        else {
          const rest = up.slice(mPrefix[0].length);
          const sep = rest.search(/\s[-–—]\s|\s[-–—]$/);
          if (sep < 0) { q = rest.trim(); const locs = knownLocations(); list = locs.filter((x) => x.startsWith(q) && x !== q).concat(locs.filter((x) => !x.startsWith(q) && x.includes(q) && q)); hintMode = 'location'; }
          else { q = rest.slice(sep).replace(/^\s[-–—]\s?/, '').trim(); list = DICT.times.filter((x) => x.startsWith(q) && x !== q); hintMode = 'time'; }
        }
      } else if (type === 'character') {
        const m = up.match(/^(.*?)\s*\(([^)]*)$/);
        if (m) { q = m[2].trim(); list = DICT.extensions.filter((x) => x.startsWith(q) && x !== q); hintMode = 'ext'; }
        else { q = up.trim(); list = knownCharacters(p).filter((x) => x.startsWith(q) && x !== q); hintMode = 'name'; }
      } else if (type === 'transition') { q = up.trim(); list = DICT.transitions.filter((x) => x.startsWith(q) && x !== q); hintMode = 'transition'; }
      if (!list.length) return hideHint();
      hintItems = list.slice(0, 8); hintPick = 0;
      hint.innerHTML = hintItems.map((x, i) => `<div class="se-hint-i${i === 0 ? ' on' : ''}" data-i="${i}">${esc(x)}</div>`).join('');
      hint.classList.remove('hidden');
      const rect = r.getBoundingClientRect(), host = root.parentNode.getBoundingClientRect();
      hint.style.left = Math.max(0, rect.left - host.left) + 'px'; hint.style.top = (rect.bottom - host.top + 4) + 'px';
    }
    function hideHint() { hint.classList.add('hidden'); hintItems = []; }
    function acceptHint(i, jump) {
      const p = curPara(); const item = hintItems[i]; if (!p || !item) return;
      let txt = textOf(p); const up = txt.toUpperCase();
      if (hintMode === 'prefix') txt = item + ' ';
      else if (hintMode === 'location') { const m = up.match(/^([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.(?:\/[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+\.)?)\s*/); txt = (m ? txt.slice(0, m[0].length).toUpperCase().replace(/\s*$/, ' ') : '') + item + ' - '; }
      else if (hintMode === 'time') { txt = txt.replace(/(\s[-–—]\s?)[^-–—]*$/, '$1') ; if (!/\s[-–—]\s$/.test(txt)) txt = txt.replace(/\s*$/, '') + ' '; txt += item; }
      else if (hintMode === 'ext') txt = txt.replace(/\(([^)]*)$/, '(' + item + ')');
      else if (hintMode === 'name' || hintMode === 'transition') txt = item;
      p.textContent = txt; normalizePara(p); placeCaret(p); hideHint();
      if (jump && hintMode !== 'location' && hintMode !== 'prefix') { const next = mk(JUMP.enter[typeOf(p)] || 'action', ''); p.after(next); placeCaret(next, 0); }
      changed();
    }
    hint.addEventListener('mousedown', (e) => { const it = e.target.closest('[data-i]'); if (it) { e.preventDefault(); acceptHint(+it.dataset.i, false); } });

    // ---------- события ----------
    root.addEventListener('keydown', (e) => {
      const p = curPara();
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'я')) { e.preventDefault(); undo(); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')))) { e.preventDefault(); redo(); return; }
      if (e.ctrlKey && !e.metaKey && /^[0-9]$/.test(e.key)) { const map = { 1: 'scene_heading', 2: 'scene_characters', 3: 'action', 4: 'character', 5: 'parenthetical', 6: 'dialogue', 7: 'lyrics', 8: 'shot', 9: 'transition', 0: e.shiftKey ? 'inline_note' : 'unformatted_text' }; e.preventDefault(); setType(map[e.key]); return; }
      if (e.ctrlKey && !e.metaKey && e.key === ' ') { e.preventDefault(); setType(e.shiftKey ? 'act_heading' : 'sequence_heading'); return; }
      if (!p) return;
      if (hintItems.length && !hint.classList.contains('hidden')) {
        if (e.key === 'ArrowDown') { e.preventDefault(); hintPick = (hintPick + 1) % hintItems.length; hint.querySelectorAll('.se-hint-i').forEach((n, i) => n.classList.toggle('on', i === hintPick)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); hintPick = (hintPick - 1 + hintItems.length) % hintItems.length; hint.querySelectorAll('.se-hint-i').forEach((n, i) => n.classList.toggle('on', i === hintPick)); return; }
        if (e.key === 'Escape') { e.preventDefault(); hideHint(); return; }
      }
      if (e.key === 'Enter') { e.preventDefault(); pushUndo(); onEnter(p, e.shiftKey); changed(); setTimeout(hintUpdate, 0); return; }
      if (e.key === 'Tab') { e.preventDefault(); pushUndo(); onTab(p, e.shiftKey); changed(); setTimeout(hintUpdate, 0); return; }
      if (e.key === 'Backspace') { onBackspace(p, e); return; }
    });
    root.addEventListener('input', () => { normalize(); scheduleUndo(); changed(); hintUpdate(); });
    root.addEventListener('paste', (e) => {
      e.preventDefault(); const text = (e.clipboardData || window.clipboardData).getData('text/plain'); if (!text) return;
      pushUndo();
      const p = curPara(); const lines = text.replace(/\r\n?/g, '\n');
      if (!/\n/.test(lines)) { document.execCommand('insertText', false, lines); return; }
      // многострочная вставка: разбираем как Fountain и вставляем абзацы после текущего
      const tmp = document.createElement('div'); const sub = create(tmp, {}); sub.loadExact(lines);
      const items = Array.from(tmp.children).filter((n) => n.tagName === 'P'); let anchor = p || root.lastElementChild;
      if (anchor && !textOf(anchor).trim() && items.length) { anchor.replaceWith(items[0]); anchor = items[0]; items.shift(); }
      for (const it of items) { anchor.after(it); anchor = it; }
      placeCaret(anchor); changed();
    });
    root.addEventListener('click', () => setTimeout(hintUpdate, 0));
    root.addEventListener('keyup', (e) => { if (/^Arrow/.test(e.key)) hintUpdate(); api.onCaret && api.onCaret(); });
    root.addEventListener('mouseup', () => api.onCaret && api.onCaret());
    root.addEventListener('blur', () => setTimeout(hideHint, 150));

    // ---------- сцены и хронометраж ----------
    function linesOf(p) { const type = typeOf(p); const txt = textOf(p).trim(); if (type === 'page_break' || type === 'synopsis' || type === 'inline_note') return 0; const cols = COLS[type] || 58; return (BEFORE[type] ? 1 : 0) + Math.max(1, Math.ceil(txt.length / cols)); }
    function scenes() {
      const out = []; let cur = null; let line = 0; let idx = 0;
      for (const p of paras()) {
        const type = typeOf(p); const l = linesOf(p);
        if (type === 'scene_heading') { idx++; cur = { index: idx, num: String(idx), heading: textOf(p).trim().toUpperCase(), el: p, lines: 0, firstAction: '', characters: [], startLine: line, page: Math.floor(line / LINES_PER_PAGE) + 1 }; out.push(cur); }
        if (cur) { cur.lines += l; if (type === 'action' && !cur.firstAction) cur.firstAction = textOf(p).trim(); if (type === 'character') { const n = textOf(p).toUpperCase().replace(/\s*\(.*$/, '').trim(); if (n && !cur.characters.includes(n)) cur.characters.push(n); } }
        line += l;
      }
      for (const s of out) s.seconds = Math.round(s.lines / LINES_PER_PAGE * SEC_PER_PAGE * 1.01);
      return out;
    }
    function stats() {
      let lines = 0, words = 0, dwords = 0, chars = 0; const ps = paras(); const sc = scenes(); const names = {};
      for (const p of ps) { const type = typeOf(p); const txt = textOf(p).trim(); if (type === 'synopsis' || type === 'inline_note') continue; lines += linesOf(p); const w = Fountain.countWords(txt); words += w; chars += txt.length; if (type === 'dialogue' || type === 'lyrics') dwords += w; if (type === 'character') { const n = txt.toUpperCase().replace(/\s*\(.*$/, '').trim(); if (n) names[n] = (names[n] || 0) + 1; } }
      const pages = Math.max(ps.some((p) => textOf(p).trim()) ? 1 : 0, Math.round(lines / LINES_PER_PAGE * 10) / 10);
      return { pages, seconds: Math.round(lines / LINES_PER_PAGE * SEC_PER_PAGE * 1.01), words, dialogueWords: dwords, chars, scenes: sc.length, characters: Object.keys(names).length, lines, dialogueShare: words ? Math.round(dwords / words * 100) : 0 };
    }
    function pageMarks() { // где проходят границы страниц (для разметки на листе)
      let line = 0, page = 1; const marks = [];
      for (const p of paras()) { line += linesOf(p); if (line >= page * LINES_PER_PAGE) { marks.push({ el: p, page: page + 1 }); page++; } }
      return marks;
    }

    Object.assign(api, { mk, pushUndo, load: loadExact, loadExact, text: serialize, paras, setType, typeOf, curPara, focusPara: (p, off) => { placeCaret(p, off); root.focus(); api.onCaret && api.onCaret(); }, undo, redo, scenes, stats, pageMarks, root, hintUpdate, insertAfterCurrent: (type, text) => { const p = curPara() || root.lastElementChild; const np = mk(type, text); (p || root).after ? p.after(np) : root.appendChild(np); placeCaret(np); changed(); }, replaceParas: (fromEl, toEl, text) => { const tmp = document.createElement('div'); const sub = create(tmp, {}); sub.loadExact(text); const items = Array.from(tmp.children); pushUndo(); let n = fromEl; const stop = toEl.nextElementSibling; while (n && n !== stop) { const nx = n.nextElementSibling; n.remove(); n = nx; } let anchor = stop; if (anchor) { for (const it of items) anchor.before(it); } else for (const it of items) root.appendChild(it); if (items[0]) placeCaret(items[0], 0); changed(); }, textRange: (fromEl, toEl) => { const tmp = []; let n = fromEl; const stop = toEl.nextElementSibling; while (n && n !== stop) { tmp.push(n.cloneNode(true)); n = n.nextElementSibling; } const d = document.createElement('div'); tmp.forEach((x) => d.appendChild(x)); const sub = create(d, {}); return sub.text(); }, TYPES: T, DICT });
    normalize();
    return api;
  }
  global.ScriptEditor = { create };
})(window);
