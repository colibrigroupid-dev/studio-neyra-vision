// Голосовые и текстовые команды окна проекта (№45, грамматика RAZBOR/10). Чистые функции: текст → команда.
// Ничего не выполняет само: разбор отдельно, действие — в app.js с проверкой прав и подтверждением платного.
const NUM_RU = { 'ноль': 0, 'один': 1, 'одна': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13, 'четырнадцать': 14, 'пятнадцать': 15, 'шестнадцать': 16, 'семнадцать': 17, 'восемнадцать': 18, 'девятнадцать': 19, 'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50 };
const NUM_KK = { 'нөл': 0, 'бір': 1, 'екі': 2, 'үш': 3, 'төрт': 4, 'бес': 5, 'алты': 6, 'жеті': 7, 'сегіз': 8, 'тоғыз': 9, 'он': 10, 'жиырма': 20, 'отыз': 30, 'қырық': 40, 'елу': 50 };
const SECTIONS = {
  overview: ['обзор', 'шолу'], map: ['карта', 'карту', 'карта производства'], script: ['сценарий', 'сценарийді'], breakdown: ['разбивка', 'разбивку', 'талдау'],
  heroes: ['герои', 'героев', 'кейіпкерлер'], locations: ['локации', 'локацию', 'локациялар'], storyboard: ['раскадровка', 'раскадровку', 'борды', 'кадрлық жоспар'],
  shots: ['кадры', 'каждый кадр', 'кадрлар'], animatic: ['ииматик', 'аниматик'], team: ['команда', 'команду', 'люди', 'команда'], post: ['пост', 'постпродакшен', 'монтаж']
};
const VERBS = [
  ['accept', ['принять', 'принят', 'принято', 'зелёный', 'зеленый', 'қабылдау', 'қабылда']],
  ['return', ['вернуть', 'верни', 'красный', 'қайтару', 'қайтар']],
  ['review', ['жёлтый', 'желтый', 'на доработку', 'сары']],
  ['open', ['открой', 'открыть', 'покажи', 'показать', 'перейди', 'аш', 'көрсет']],
  ['variants', ['ещё', 'еще', 'сделай', 'варианты', 'тағы']],
  ['video', ['видео', 'ролик', 'бейне']],
  ['note', ['замечание', 'запиши', 'заметка', 'ескерту', 'жаз']],
  ['waiting', ['кто тормозит', 'что ждёт', 'что ждет', 'ждёт меня', 'ждет меня', 'кім кешіктіреді', 'мені не күтеді']],
  ['take', ['в работу', 'беру', 'жұмысқа']],
  ['done', ['готово', 'сдаю', 'дайын']],
  ['dictate', ['диктуй', 'пиши', 'жаз']],
  ['version', ['версия', 'зафиксируй', 'нұсқа']],
  ['help', ['помощник', 'көмекші']]
];
function wordsToNumber(tokens) {
  let total = 0, any = false;
  for (const w of tokens) {
    if (/^\d+$/.test(w)) { total = total * (total ? 1 : 1) + Number(w); any = true; continue; }
    const v = NUM_RU[w] ?? NUM_KK[w];
    if (v == null) return any ? total : null;
    total += v; any = true;
  }
  return any ? total : null;
}
/** Номер объекта из текста: «12.3», «12-3», «двенадцать три» → '12.3'; «сцена четыре» → '4'. */
export function parseNumber(text) {
  const t = String(text).toLowerCase().replace(/ё/g, 'е');
  const m = t.match(/(\d{1,3})\s*[.\-–]\s*(\d{1,2})/);
  if (m) return `${Number(m[1])}.${Number(m[2])}`;
  const single = t.match(/(?:^|\s)(\d{1,3})(?:\s|$|,)/);
  const words = t.split(/[\s,]+/).filter(Boolean);
  const nums = [];
  for (let i = 0; i < words.length; i++) {
    if (/^\d+$/.test(words[i]) || NUM_RU[words[i]] != null || NUM_KK[words[i]] != null) {
      let j = i; const chunk = [];
      while (j < words.length && (/^\d+$/.test(words[j]) || NUM_RU[words[j]] != null || NUM_KK[words[j]] != null)) { chunk.push(words[j]); j++; }
      // «двенадцать три» → две группы: 12 и 3 (десятки + единицы не складываем через границу «двадцать один» = 21)
      const groups = []; let cur = [];
      for (const w of chunk) {
        const v = /^\d+$/.test(w) ? Number(w) : (NUM_RU[w] ?? NUM_KK[w]);
        if (cur.length && !(wordsToNumber(cur) >= 10 && v < 10 && wordsToNumber(cur) % 10 === 0)) { groups.push(cur); cur = [w]; } else cur.push(w);
      }
      if (cur.length) groups.push(cur);
      nums.push(...groups.map(g => wordsToNumber(g)));
      i = j;
    }
  }
  if (nums.length >= 2) return `${nums[0]}.${nums[1]}`;
  if (nums.length === 1) return String(nums[0]);
  return single ? single[1] : null;
}
export function parseSection(text) {
  const t = String(text).toLowerCase();
  let best = null;
  for (const [id, names] of Object.entries(SECTIONS)) for (const name of names) if (t.includes(name) && (!best || name.length > best.len)) best = { id, len: name.length };
  return best?.id || null;
}
/** Разбор фразы → { kind, target, tail, section, text, confirm } или { kind: 'ask', text } если это вопрос помощнику. */
export function parseCommand(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const t = text.toLowerCase().replace(/ё/g, 'е');
  let kind = null, matched = '';
  for (const [k, names] of VERBS) for (const name of names) { const n = name.replace(/ё/g, 'е'); if ((t === n || t.startsWith(n + ' ') || t.includes(' ' + n + ' ') || t.includes(' ' + n)) && n.length > matched.length) { kind = k; matched = n; } }
  const section = parseSection(t);
  const tail = (t.includes(',') ? text.slice(text.indexOf(',') + 1) : '').trim();
  const target = parseNumber(t.split(',')[0]);
  if (kind === 'open' && section && !target) return { kind: 'open', section, text };
  if (kind === 'open' && target) return { kind: 'open', target, section: section || null, text };
  if (!kind) return { kind: 'ask', text };
  const paid = kind === 'variants' || kind === 'video';
  return { kind, target, section, tail, text, confirm: paid ? 'price' : (kind === 'accept' || kind === 'return') ? 'show' : null };
}
/** Короткое человеческое описание разбора — что сейчас произойдёт. */
export function describeCommand(cmd, locale = 'ru') {
  const ru = locale !== 'kk';
  if (!cmd) return '';
  const T = cmd.target ? ` ${cmd.target}` : '';
  switch (cmd.kind) {
    case 'open': return cmd.section ? (ru ? `Открываю раздел «${cmd.section}»` : `«${cmd.section}» бөлімін ашамын`) : (ru ? `Открываю${T}` : `${T} ашамын`);
    case 'accept': return ru ? `Принять${T} — подтвердите` : `${T} қабылдау — растаңыз`;
    case 'return': return ru ? `Вернуть${T}${cmd.tail ? `: «${cmd.tail}»` : ' — нужна причина'}` : `${T} қайтару${cmd.tail ? `: «${cmd.tail}»` : ' — себеп керек'}`;
    case 'review': return ru ? `На доработку${T}` : `${T} пысықтауға`;
    case 'variants': return ru ? `Ещё варианты${T} — покажу цену, запуск касанием` : `${T} тағы нұсқалар — бағасын көрсетемін`;
    case 'video': return ru ? `Видео${T} — только после принятого кадра и «да»` : `${T} бейне — тек қабылданған кадрдан кейін`;
    case 'note': return ru ? `Записать замечание${T}` : `${T} ескерту жазу`;
    case 'waiting': return ru ? 'Что ждёт меня' : 'Мені не күтеді';
    case 'take': return ru ? `Беру в работу${T}` : `${T} жұмысқа аламын`;
    case 'done': return ru ? `Сдать на проверку${T}` : `${T} тексеруге беру`;
    case 'dictate': return ru ? 'Диктовка в поле' : 'Өріске жазу';
    case 'version': return ru ? 'Зафиксировать версию сценария' : 'Сценарий нұсқасын бекіту';
    case 'help': case 'ask': return ru ? 'Вопрос помощнику' : 'Көмекшіге сұрақ';
    default: return cmd.text;
  }
}
