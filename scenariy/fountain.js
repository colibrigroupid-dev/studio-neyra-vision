/* Fountain для русской и английской записи. Без зависимостей.
   parse(text) -> { title:{}, tokens:[], scenes:[], characters:{}, stats:{} }
   render(parsed) -> HTML страницы сценария
   toFDX(parsed) -> Final Draft XML
*/
(function (global) {
  'use strict';

  const RE = {
    titleKey: /^([A-Za-zА-Яа-яЁё ]{2,30}):\s*(.*)$/,
    heading: /^(ИНТ\.?\/НАТ|НАТ\.?\/ИНТ|ИНТ|НАТ|ЭКСТ|INT\.?\/EXT|EXT\.?\/INT|I\/E|INT|EXT|EST)[\.\s\-–—/]/i,
    sceneNum: /\s*#([^#]+)#\s*$/,
    transition: /^(ПЕРЕХОД К|CUT TO|SMASH CUT TO|MATCH CUT TO|DISSOLVE TO|FADE OUT|FADE TO BLACK|FADE IN|ЗАТЕМНЕНИЕ|ЗТМ|НАПЛЫВ|ИЗ ЗТМ|ИЗ ЗАТЕМНЕНИЯ|ИЗ ЗТМ\.)\b.*[:\.]$/,
    allCapsChar: /^[^a-zа-яё]*[A-ZА-ЯЁ][^a-zа-яё]*$/,
    hasLetter: /[A-Za-zА-Яа-яЁё]/,
    parenthetical: /^\(.*\)$/,
    pageBreak: /^={3,}\s*$/,
  };

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(s) {
    let t = esc(s);
    t = t.replace(/\[\[([^\]]+)\]\]/g, '<span class="fn-note">$1</span>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    t = t.replace(/_([^_]+)_/g, '<u>$1</u>');
    return t;
  }
  function stripBoneyard(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
  }

  function parse(src) {
    const text = stripBoneyard((src || '').replace(/\r\n?/g, '\n'));
    const lines = text.split('\n');
    const out = { title: {}, tokens: [], scenes: [], characters: {}, stats: {} };

    // Титульная страница: пары "Ключ: значение" до первой пустой строки
    let i = 0;
    if (lines.length && RE.titleKey.test(lines[0]) && !RE.heading.test(lines[0])) {
      let key = null;
      while (i < lines.length && lines[i].trim() !== '') {
        const m = lines[i].match(RE.titleKey);
        if (m && !/^\s/.test(lines[i])) { key = m[1].trim(); out.title[key] = m[2].trim(); }
        else if (key) out.title[key] = (out.title[key] + '\n' + lines[i].trim()).trim();
        i++;
      }
    }

    const toks = out.tokens;
    const isBlank = (n) => n < 0 || n >= lines.length || lines[n].trim() === '';
    let inDialogue = false;
    let sceneIdx = 0;

    for (; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      const prevBlank = isBlank(i - 1);
      const nextBlank = isBlank(i + 1);

      if (line === '') { inDialogue = false; toks.push({ type: 'blank', line: i }); continue; }

      if (RE.pageBreak.test(line)) { toks.push({ type: 'page_break', line: i }); inDialogue = false; continue; }

      if (line.startsWith('#')) {
        const level = (line.match(/^#+/) || ['#'])[0].length;
        toks.push({ type: 'section', level, text: line.replace(/^#+\s*/, ''), line: i });
        inDialogue = false; continue;
      }
      if (line.startsWith('=')) {
        toks.push({ type: 'synopsis', text: line.replace(/^=\s*/, ''), line: i });
        inDialogue = false; continue;
      }
      if (/^\[\[.*\]\]$/.test(line)) {
        toks.push({ type: 'note', text: line.slice(2, -2), line: i });
        continue;
      }

      // Заголовок сцены (обычный или форсированный точкой)
      const forcedHeading = /^\.(?!\.)/.test(line);
      if ((forcedHeading || (RE.heading.test(line) && prevBlank)) && !inDialogue) {
        let h = forcedHeading ? line.slice(1).trim() : line;
        let num = null;
        const nm = h.match(RE.sceneNum);
        if (nm) { num = nm[1]; h = h.replace(RE.sceneNum, ''); }
        sceneIdx++;
        const tok = { type: 'scene_heading', text: h, num: num || String(sceneIdx), index: sceneIdx, line: i, tokenIndex: toks.length };
        toks.push(tok);
        out.scenes.push({ index: sceneIdx, num: tok.num, heading: h, line: i, tokenIndex: tok.tokenIndex, characters: new Set(), words: 0, dialogueWords: 0, actionWords: 0 });
        inDialogue = false; continue;
      }

      // Центрированный текст
      if (/^>.*<$/.test(line)) { toks.push({ type: 'centered', text: line.slice(1, -1).trim(), line: i }); inDialogue = false; continue; }
      // Переход
      if (line.startsWith('>') || (RE.transition.test(line) && RE.allCapsChar.test(line) && prevBlank)) {
        toks.push({ type: 'transition', text: line.replace(/^>\s*/, ''), line: i }); inDialogue = false; continue;
      }
      // Форсированное действие
      if (line.startsWith('!')) { toks.push({ type: 'action', text: line.slice(1), line: i }); inDialogue = false; continue; }

      // Персонаж
      const forcedChar = line.startsWith('@');
      if (!inDialogue && prevBlank && !nextBlank && (forcedChar || (RE.allCapsChar.test(line) && RE.hasLetter.test(line) && !RE.parenthetical.test(line)))) {
        let name = forcedChar ? line.slice(1).trim() : line;
        const dual = /\^\s*$/.test(name);
        name = name.replace(/\^\s*$/, '').trim();
        const base = name.replace(/\s*\(.*\)\s*$/, '').trim();
        toks.push({ type: 'character', text: name, name: base, dual, line: i });
        const c = out.characters[base] || (out.characters[base] = { name: base, lines: 0, words: 0, scenes: new Set() });
        c.lines++;
        if (out.scenes.length) { c.scenes.add(sceneIdx); out.scenes[out.scenes.length - 1].characters.add(base); }
        inDialogue = true; continue;
      }

      if (inDialogue) {
        if (RE.parenthetical.test(line)) { toks.push({ type: 'parenthetical', text: line, line: i }); continue; }
        const lyric = line.startsWith('~');
        const t = lyric ? line.slice(1).trim() : line;
        toks.push({ type: lyric ? 'lyrics' : 'dialogue', text: t, line: i });
        const w = countWords(t);
        // приписываем слова последнему персонажу
        for (let k = toks.length - 2; k >= 0; k--) { if (toks[k].type === 'character') { out.characters[toks[k].name].words += w; break; } if (toks[k].type === 'blank') break; }
        if (out.scenes.length) { out.scenes[out.scenes.length - 1].dialogueWords += w; }
        continue;
      }

      toks.push({ type: 'action', text: line, line: i });
      if (out.scenes.length) out.scenes[out.scenes.length - 1].actionWords += countWords(line);
    }

    // Статистика
    let words = 0, dialogueWords = 0, actionWords = 0, lineCount = 0;
    for (const t of toks) {
      const w = t.text ? countWords(t.text) : 0;
      switch (t.type) {
        case 'scene_heading': lineCount += 2; actionWords += w; break;
        case 'action': lineCount += Math.ceil((t.text.length || 1) / 60) + 1; actionWords += w; break;
        case 'character': lineCount += 1; break;
        case 'parenthetical': lineCount += Math.ceil((t.text.length || 1) / 28); break;
        case 'dialogue': case 'lyrics': lineCount += Math.ceil((t.text.length || 1) / 36); dialogueWords += w; break;
        case 'transition': case 'centered': lineCount += 2; break;
        case 'page_break': lineCount += 55 - (lineCount % 55); break;
        case 'blank': break;
        default: lineCount += 1;
      }
      words += w;
    }
    for (const s of out.scenes) s.words = s.dialogueWords + s.actionWords;
    const pages = Math.max(words ? 1 : 0, Math.round((lineCount / 55) * 10) / 10);
    out.stats = { words, dialogueWords, actionWords, pages, scenes: out.scenes.length, characters: Object.keys(out.characters).length, lines: lines.length, dialogueShare: words ? Math.round(dialogueWords / words * 100) : 0 };
    // страницы по сценам (примерно по положению строки)
    out.scenes.forEach((s) => { s.page = Math.max(1, Math.round((s.line / Math.max(1, lines.length)) * pages * 10) / 10); });
    return out;
  }

  function countWords(s) { const m = s.match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g); return m ? m.length : 0; }

  function renderTitle(title) {
    const t = title.Title || title['Название'];
    if (!t) return '';
    const by = title.Author || title.Authors || title['Автор'] || '';
    const credit = title.Credit || title['Сценарий'] || (by ? 'Сценарий' : '');
    const date = title['Draft date'] || title['Дата'] || '';
    const contact = title.Contact || title['Контакт'] || '';
    return `<section class="sp-title"><div class="sp-title-main"><h1>${esc(t)}</h1>${credit ? `<p>${esc(credit)}</p>` : ''}${by ? `<p>${esc(by)}</p>` : ''}</div><div class="sp-title-foot">${date ? `<p>${esc(date)}</p>` : ''}${contact ? `<p>${esc(contact).replace(/\n/g, '<br>')}</p>` : ''}</div></section>`;
  }

  function render(p) {
    const h = [renderTitle(p.title), '<section class="sp-body">'];
    const toks = p.tokens;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      switch (t.type) {
        case 'scene_heading': h.push(`<p class="sh" data-line="${t.line}" id="sc-${t.index}"><span class="sn">${esc(t.num)}</span>${inline(t.text)}</p>`); break;
        case 'action': h.push(`<p class="ac" data-line="${t.line}">${inline(t.text)}</p>`); break;
        case 'character': {
          // двойной диалог: следующий блок помечен ^
          const nextChar = findNextChar(toks, i + 1);
          if (nextChar >= 0 && toks[nextChar].dual && !t.dual) {
            const a = renderDialogueBlock(toks, i); const b = renderDialogueBlock(toks, nextChar);
            h.push(`<div class="dual"><div>${a.html}</div><div>${b.html}</div></div>`); i = b.end; break;
          }
          const blk = renderDialogueBlock(toks, i); h.push(blk.html); i = blk.end; break;
        }
        case 'transition': h.push(`<p class="tr" data-line="${t.line}">${inline(t.text)}</p>`); break;
        case 'centered': h.push(`<p class="ce" data-line="${t.line}">${inline(t.text)}</p>`); break;
        case 'section': h.push(`<p class="sec l${t.level}" data-line="${t.line}">${inline(t.text)}</p>`); break;
        case 'synopsis': h.push(`<p class="syn" data-line="${t.line}">${inline(t.text)}</p>`); break;
        case 'note': h.push(`<p class="note" data-line="${t.line}">${inline(t.text)}</p>`); break;
        case 'page_break': h.push('<hr class="pb">'); break;
        default: break;
      }
    }
    h.push('</section>');
    return h.join('\n');
  }
  function findNextChar(toks, from) {
    for (let k = from; k < toks.length; k++) {
      if (toks[k].type === 'character') return k;
      if (toks[k].type !== 'blank' && toks[k].type !== 'dialogue' && toks[k].type !== 'parenthetical' && toks[k].type !== 'lyrics') return -1;
    }
    return -1;
  }
  function renderDialogueBlock(toks, i) {
    const t = toks[i];
    const parts = [`<p class="ch" data-line="${t.line}">${inline(t.text)}</p>`];
    let k = i + 1;
    for (; k < toks.length; k++) {
      const x = toks[k];
      if (x.type === 'parenthetical') parts.push(`<p class="pa" data-line="${x.line}">${inline(x.text)}</p>`);
      else if (x.type === 'dialogue') parts.push(`<p class="di" data-line="${x.line}">${inline(x.text)}</p>`);
      else if (x.type === 'lyrics') parts.push(`<p class="di ly" data-line="${x.line}">${inline(x.text)}</p>`);
      else break;
    }
    return { html: `<div class="dlg">${parts.join('')}</div>`, end: k - 1 };
  }

  // Текст одной сцены (для передачи ассистенту) — по номеру строки
  function sceneAt(p, lineNo, src) {
    const lines = (src || '').replace(/\r\n?/g, '\n').split('\n');
    if (!p.scenes.length) return null;
    let s = p.scenes[0];
    for (const sc of p.scenes) { if (sc.line <= lineNo) s = sc; else break; }
    const idx = p.scenes.indexOf(s);
    const end = idx + 1 < p.scenes.length ? p.scenes[idx + 1].line : lines.length;
    return { scene: s, start: s.line, end, text: lines.slice(s.line, end).join('\n').replace(/\n+$/, '') };
  }

  // Экспорт в Final Draft (.fdx)
  function toFDX(p) {
    const x = (s) => esc(s || '');
    const para = (type, text, extra) => `<Paragraph Type="${type}"${extra || ''}><Text>${x(text)}</Text></Paragraph>`;
    const out = [];
    for (const t of p.tokens) {
      switch (t.type) {
        case 'scene_heading': out.push(para('Scene Heading', t.text, ` Number="${x(t.num)}"`)); break;
        case 'action': out.push(para('Action', t.text)); break;
        case 'character': out.push(para('Character', t.text)); break;
        case 'parenthetical': out.push(para('Parenthetical', t.text)); break;
        case 'dialogue': case 'lyrics': out.push(para('Dialogue', t.text)); break;
        case 'transition': out.push(para('Transition', t.text)); break;
        case 'centered': out.push(para('General', t.text, ' Alignment="Center"')); break;
        case 'section': case 'synopsis': case 'note': out.push(para('General', t.text)); break;
        default: break;
      }
    }
    const tp = p.title;
    const titleXml = tp.Title ? `<TitlePage><Content>${para('General', tp.Title, ' Alignment="Center"')}${tp.Credit ? para('General', tp.Credit, ' Alignment="Center"') : ''}${tp.Author ? para('General', tp.Author, ' Alignment="Center"') : ''}</Content></TitlePage>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n<Content>\n${out.join('\n')}\n</Content>\n${titleXml}\n</FinalDraft>\n`;
  }

  // Импорт .fdx → Fountain
  function fromFDX(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const paras = Array.from(doc.querySelectorAll('Content > Paragraph'));
    const lines = [];
    const tp = doc.querySelector('TitlePage');
    if (tp) {
      const tl = Array.from(tp.querySelectorAll('Paragraph')).map((q) => q.textContent.trim()).filter(Boolean);
      if (tl[0]) lines.push('Title: ' + tl[0]);
      if (tl[1]) lines.push('Credit: ' + tl[1]);
      if (tl[2]) lines.push('Author: ' + tl[2]);
      if (tl.length) lines.push('');
    }
    let prev = null;
    for (const q of paras) {
      const type = q.getAttribute('Type') || 'Action';
      const text = Array.from(q.querySelectorAll('Text')).map((n) => n.textContent).join('').trim();
      if (!text) continue;
      const num = q.getAttribute('Number');
      switch (type) {
        case 'Scene Heading': lines.push('', (RE.heading.test(text) ? '' : '.') + text + (num ? ` #${num}#` : ''), ''); break;
        case 'Action': case 'General': if (prev !== 'blank') lines.push(''); lines.push(text); break;
        case 'Character': lines.push('', RE.allCapsChar.test(text) ? text : '@' + text); break;
        case 'Parenthetical': lines.push(/^\(/.test(text) ? text : `(${text})`); break;
        case 'Dialogue': lines.push(text); break;
        case 'Transition': lines.push('', '> ' + text, ''); break;
        default: lines.push(text);
      }
      prev = type;
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  global.Fountain = { parse, render, toFDX, fromFDX, sceneAt, countWords };
})(window);
