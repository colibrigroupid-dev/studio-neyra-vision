/* Fountain для русской, казахской и английской записи. Без зависимостей.
   parse(text) -> { title:{}, tokens:[], scenes:[], characters:{}, stats:{} }
   render(parsed) -> HTML страницы сценария · toFDX / fromFDX · sceneAt · countWords
*/
(function (global) {
  'use strict';

  const L = 'A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі'; // буквы: латиница, кириллица, казахские
  const RE = {
    titleKey: new RegExp('^([' + L + ' ]{2,30}):\\s*(.*)$'),
    heading: /^(ИНТ\.?\/НАТ|НАТ\.?\/ИНТ|ИНТ|НАТ|ЭКСТ|ІШКІ\.?\/СЫРТҚЫ|СЫРТҚЫ\.?\/ІШКІ|ІШКІ|СЫРТҚЫ|INT\.?\/EXT|EXT\.?\/INT|I\/E|INT|EXT|EST)[\.\s\-–—/]/i,
    sceneNum: /\s*#([^#]+)#\s*$/,
    transition: /^(ПЕРЕХОД К|CUT TO|SMASH CUT TO|MATCH CUT TO|DISSOLVE TO|FADE OUT|FADE TO BLACK|FADE IN|ЗАТЕМНЕНИЕ|ЗТМ|НАПЛЫВ|ИЗ ЗТМ|ИЗ ЗАТЕМНЕНИЯ|ҚАРАҢҒЫЛАНУ|АУЫСУ)\b.*[:\.]$/,
    allCaps: new RegExp('^[^a-zа-яёәғқңөұүһі]*[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][^a-zа-яёәғқңөұүһі]*$'),
    hasLetter: new RegExp('[' + L + ']'),
    parenthetical: /^\(.*\)$/,
    pageBreak: /^={3,}\s*$/,
    word: new RegExp('[' + L + '0-9’\'-]+', 'g'),
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function inline(s) {
    let t = esc(s);
    t = t.replace(/\[\[([^\]]+)\]\]/g, '<span class="fn-note">$1</span>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    t = t.replace(/_([^_]+)_/g, '<u>$1</u>');
    return t;
  }
  function stripBoneyard(text) { return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')); }
  function countWords(s) { const m = String(s || '').match(RE.word); return m ? m.length : 0; }

  function parse(src) {
    const text = stripBoneyard((src || '').replace(/\r\n?/g, '\n'));
    const lines = text.split('\n');
    const out = { title: {}, tokens: [], scenes: [], characters: Object.create(null), stats: {} };

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
    let inDialogue = false, sceneIdx = 0, lastChar = null;

    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      const prevBlank = isBlank(i - 1), nextBlank = isBlank(i + 1);

      if (line === '') { inDialogue = false; lastChar = null; toks.push({ type: 'blank', line: i }); continue; }
      if (RE.pageBreak.test(line)) { toks.push({ type: 'page_break', line: i }); inDialogue = false; continue; }
      if (line.startsWith('#')) { const level = (line.match(/^#+/) || ['#'])[0].length; toks.push({ type: 'section', level, text: line.replace(/^#+\s*/, ''), line: i }); inDialogue = false; continue; }
      if (line.startsWith('=')) { toks.push({ type: 'synopsis', text: line.replace(/^=\s*/, ''), line: i }); inDialogue = false; continue; }
      if (/^\[\[.*\]\]$/.test(line)) { toks.push({ type: 'note', text: line.slice(2, -2), line: i, inDialogue }); continue; }

      const forcedHeading = /^\.(?!\.)/.test(line);
      if ((forcedHeading || (RE.heading.test(line) && prevBlank)) && !inDialogue) {
        let h = forcedHeading ? line.slice(1).trim() : line, num = null;
        const nm = h.match(RE.sceneNum);
        if (nm) { num = nm[1]; h = h.replace(RE.sceneNum, ''); }
        sceneIdx++;
        const tok = { type: 'scene_heading', text: h, num: num || String(sceneIdx), index: sceneIdx, line: i, tokenIndex: toks.length };
        toks.push(tok);
        out.scenes.push({ index: sceneIdx, num: tok.num, heading: h, line: i, tokenIndex: tok.tokenIndex, characters: new Set(), words: 0, dialogueWords: 0, actionWords: 0 });
        inDialogue = false; continue;
      }
      if (/^>.*<$/.test(line)) { toks.push({ type: 'centered', text: line.slice(1, -1).trim(), line: i }); inDialogue = false; continue; }
      if (line.startsWith('>') || (RE.transition.test(line) && RE.allCaps.test(line) && prevBlank)) { toks.push({ type: 'transition', text: line.replace(/^>\s*/, ''), line: i }); inDialogue = false; continue; }
      if (line.startsWith('!')) { toks.push({ type: 'action', text: line.slice(1), line: i }); inDialogue = false; continue; }

      const forcedChar = line.startsWith('@');
      if (!inDialogue && prevBlank && !nextBlank && (forcedChar || (RE.allCaps.test(line) && RE.hasLetter.test(line) && !RE.parenthetical.test(line)))) {
        let name = forcedChar ? line.slice(1).trim() : line;
        const dual = /\^\s*$/.test(name);
        name = name.replace(/\^\s*$/, '').trim();
        const base = name.replace(/\s*\(.*\)\s*$/, '').trim();
        toks.push({ type: 'character', text: name, name: base, dual, line: i });
        const c = out.characters[base] || (out.characters[base] = { name: base, lines: 0, words: 0, scenes: new Set() });
        c.lines++; lastChar = c;
        if (out.scenes.length) { c.scenes.add(sceneIdx); out.scenes[out.scenes.length - 1].characters.add(base); }
        inDialogue = true; continue;
      }
      if (inDialogue) {
        if (RE.parenthetical.test(line)) { toks.push({ type: 'parenthetical', text: line, line: i }); continue; }
        const lyric = line.startsWith('~');
        const t = lyric ? line.slice(1).trim() : line;
        toks.push({ type: lyric ? 'lyrics' : 'dialogue', text: t, line: i });
        const w = countWords(t);
        if (lastChar) lastChar.words += w;
        if (out.scenes.length) out.scenes[out.scenes.length - 1].dialogueWords += w;
        continue;
      }
      toks.push({ type: 'action', text: line, line: i });
      if (out.scenes.length) out.scenes[out.scenes.length - 1].actionWords += countWords(line);
    }

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
        case 'blank': case 'note': case 'section': case 'synopsis': break;
        default: lineCount += 1;
      }
      if (t.type !== 'note' && t.type !== 'section' && t.type !== 'synopsis') words += w;
    }
    for (const s of out.scenes) s.words = s.dialogueWords + s.actionWords;
    const pages = Math.max(words ? 1 : 0, Math.round((lineCount / 55) * 10) / 10);
    out.stats = { words, dialogueWords, actionWords, pages, minutes: Math.round(pages), scenes: out.scenes.length, characters: Object.keys(out.characters).length, lines: lines.length, dialogueShare: words ? Math.round(dialogueWords / words * 100) : 0 };
    out.scenes.forEach((s) => { s.page = Math.max(1, Math.round((s.line / Math.max(1, lines.length)) * pages * 10) / 10); });
    return out;
  }

  function titleField(title, keys) { for (const k of keys) if (title[k]) return title[k]; return ''; }
  const TK = { title: ['Title', 'Название', 'Атауы'], credit: ['Credit', 'Сценарий', 'Сценарийі'], author: ['Author', 'Authors', 'Автор', 'Авторы', 'Авторы'], date: ['Draft date', 'Дата', 'Күні'], contact: ['Contact', 'Контакт', 'Байланыс'] };

  function renderTitle(title) {
    const t = titleField(title, TK.title); if (!t) return '';
    const by = titleField(title, TK.author), credit = titleField(title, TK.credit) || (by ? 'Сценарий' : ''), date = titleField(title, TK.date), contact = titleField(title, TK.contact);
    return `<section class="sp-title"><div class="sp-title-main"><h1>${esc(t)}</h1>${credit ? `<p>${esc(credit)}</p>` : ''}${by ? `<p>${esc(by)}</p>` : ''}</div><div class="sp-title-foot">${date ? `<p>${esc(date)}</p>` : ''}${contact ? `<p>${esc(contact).replace(/\n/g, '<br>')}</p>` : ''}</div></section>`;
  }

  const DLG = { dialogue: 1, parenthetical: 1, lyrics: 1, note: 1 };
  function render(p) {
    const h = [renderTitle(p.title), '<section class="sp-body">'];
    const toks = p.tokens;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      switch (t.type) {
        case 'scene_heading': h.push(`<p class="sh" data-line="${t.line}" id="sc-${t.index}"><span class="sn">${esc(t.num)}</span>${inline(t.text)}</p>`); break;
        case 'action': h.push(`<p class="ac" data-line="${t.line}">${inline(t.text)}</p>`); break;
        case 'character': {
          const nextChar = findNextChar(toks, i + 1);
          if (nextChar >= 0 && toks[nextChar].dual && !t.dual) {
            const a = renderDialogueBlock(toks, i), b = renderDialogueBlock(toks, nextChar);
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
      if (toks[k].type !== 'blank' && !DLG[toks[k].type]) return -1;
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
      else if (x.type === 'note') parts.push(`<p class="note" data-line="${x.line}">${inline(x.text)}</p>`);
      else break;
    }
    return { html: `<div class="dlg">${parts.join('')}</div>`, end: k - 1 };
  }

  function sceneAt(p, lineNo, src) {
    const lines = (src || '').replace(/\r\n?/g, '\n').split('\n');
    if (!p.scenes.length) return null;
    let s = p.scenes[0];
    for (const sc of p.scenes) { if (sc.line <= lineNo) s = sc; else break; }
    const idx = p.scenes.indexOf(s);
    const end = idx + 1 < p.scenes.length ? p.scenes[idx + 1].line : lines.length;
    return { scene: s, start: s.line, end, text: lines.slice(s.line, end).join('\n').replace(/\n+$/, '') };
  }

  // ---- Final Draft .fdx ----
  function toFDX(p) {
    const para = (type, text, extra) => `<Paragraph Type="${type}"${extra || ''}><Text>${esc(text || '')}</Text></Paragraph>`;
    const out = []; let newPage = '';
    const np = () => { const s = newPage; newPage = ''; return s; };
    const toks = p.tokens;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      switch (t.type) {
        case 'scene_heading': out.push(para('Scene Heading', t.text, ` Number="${esc(t.num)}"` + np())); break;
        case 'action': out.push(para('Action', t.text, np())); break;
        case 'character': {
          const nextChar = findNextChar(toks, i + 1);
          if (nextChar >= 0 && toks[nextChar].dual && !t.dual) {
            const blk = (start) => { const r = [para('Character', toks[start].text)]; let k = start + 1; for (; k < toks.length; k++) { const x = toks[k]; if (x.type === 'parenthetical') r.push(para('Parenthetical', x.text)); else if (x.type === 'dialogue' || x.type === 'lyrics') r.push(para('Dialogue', x.text)); else if (x.type === 'note') continue; else break; } return { xml: r.join(''), end: k - 1 }; };
            const a = blk(i), b = blk(nextChar);
            out.push(`<Paragraph Type="Dialogue"${np()}><DualDialogue>${a.xml}${b.xml}</DualDialogue></Paragraph>`); i = b.end;
          } else out.push(para('Character', t.text, np()));
          break;
        }
        case 'parenthetical': out.push(para('Parenthetical', t.text)); break;
        case 'dialogue': case 'lyrics': out.push(para('Dialogue', t.text)); break;
        case 'transition': out.push(para('Transition', t.text, np())); break;
        case 'centered': out.push(para('General', t.text, ' Alignment="Center"' + np())); break;
        case 'section': case 'synopsis': case 'note': out.push(para('General', t.text, np())); break;
        case 'page_break': newPage = ' StartsNewPage="Yes"'; break;
        default: break;
      }
    }
    const tp = p.title, t = titleField(tp, TK.title), credit = titleField(tp, TK.credit), by = titleField(tp, TK.author), date = titleField(tp, TK.date), contact = titleField(tp, TK.contact);
    const titleXml = t ? `<TitlePage><Content>${para('General', t, ' Alignment="Center"')}${credit ? para('General', credit, ' Alignment="Center"') : ''}${by ? para('General', by, ' Alignment="Center"') : ''}${date ? para('General', date) : ''}${contact ? para('General', contact) : ''}</Content></TitlePage>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n<Content>\n${out.join('\n')}\n</Content>\n${titleXml}\n</FinalDraft>\n`;
  }

  function fromFDX(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('FDX не читается: повреждённый XML');
    const root = doc.querySelector('FinalDraft') || doc.documentElement;
    const content = Array.from(root.children).find((n) => n.tagName === 'Content');
    const paras = content ? Array.from(content.children).filter((n) => n.tagName === 'Paragraph') : [];
    const lines = [];
    const tp = root.querySelector('TitlePage');
    if (tp) {
      const tl = Array.from(tp.querySelectorAll('Paragraph')).map((q) => q.textContent.trim()).filter(Boolean);
      if (tl[0]) lines.push('Title: ' + tl[0]);
      if (tl[1]) lines.push('Credit: ' + tl[1]);
      if (tl[2]) lines.push('Author: ' + tl[2]);
      if (tl[3]) lines.push('Draft date: ' + tl[3]);
      if (tl.length) lines.push('');
    }
    const textOf = (q) => Array.from(q.children).filter((n) => n.tagName === 'Text').map((n) => n.textContent).join('').trim();
    const emit = (type, text, num, dualSecond) => {
      switch (type) {
        case 'Scene Heading': lines.push('', (RE.heading.test(text) ? '' : '.') + text + (num ? ` #${num}#` : ''), ''); break;
        case 'Character': lines.push('', (RE.allCaps.test(text) ? text : '@' + text) + (dualSecond ? ' ^' : '')); break;
        case 'Parenthetical': lines.push(/^\(/.test(text) ? text : `(${text})`); break;
        case 'Dialogue': lines.push(text); break;
        case 'Transition': lines.push('', '> ' + text, ''); break;
        default: lines.push('', text);
      }
    };
    for (const q of paras) {
      if (q.getAttribute('StartsNewPage') === 'Yes') lines.push('', '===', '');
      const dual = Array.from(q.children).find((n) => n.tagName === 'DualDialogue');
      if (dual) {
        let charCount = 0;
        for (const d of Array.from(dual.children).filter((n) => n.tagName === 'Paragraph')) {
          const ty = d.getAttribute('Type') || 'Dialogue'; const tx = textOf(d); if (!tx) continue;
          if (ty === 'Character') charCount++;
          emit(ty, tx, null, ty === 'Character' && charCount === 2);
        }
        continue;
      }
      const type = q.getAttribute('Type') || 'Action', text = textOf(q);
      if (!text) continue;
      emit(type, text, q.getAttribute('Number'));
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  global.Fountain = { parse, render, toFDX, fromFDX, sceneAt, countWords, LETTERS: L };
})(window);
