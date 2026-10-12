import { makeDemo } from './data.js';
import { frameAt, totalDuration } from './timeline.js';
import { StudioServer } from './storage.js';

const storeKey = 'neyra-vision-prototype-v1';
const fresh = () => ({ locale: 'ru', scriptLang: 'ru', activeId: 'demo', projects: { demo: makeDemo() } });
let state = fresh();
try { const saved = JSON.parse(localStorage.getItem(storeKey)); if (saved?.projects && saved.projects[saved.activeId]?.scenes && saved.projects[saved.activeId]?.shots) state = saved; } catch { /* An unreadable draft leaves the example available. */ }
if (!['ru', 'kk'].includes(state.locale)) state.locale = 'ru';
if (!['ru', 'kk'].includes(state.scriptLang)) state.scriptLang = 'ru';
for (const record of Object.values(state.projects)) record.snapshots ||= [{ version: record.version, date: new Date().toISOString(), scenes: structuredClone(record.scenes) }];
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
let selectedScene = null;
let processStep = 0;
let sceneFilter = 'all';
let playback = null;
let playTime = 0;
let toastTimer;
let lastFocus;
const t = (ru, kk) => state.locale === 'kk' ? kk : ru;
const local = value => value?.[state.locale] || value?.ru || '';
const e = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll(String.fromCharCode(39), '&#39;').replaceAll(String.fromCharCode(34), '&quot;');
const project = () => state.projects[state.activeId];
const settingsKey = 'neyra-vision-server-settings-v1';
let settings = { url: 'http://127.0.0.1:8770', key: '' };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(settingsKey)) }; } catch { /* Device settings are optional. */ }
let localWorkspace = state;
let serverClient = null;
let connecting = false;
let storageError = '';
let pendingWrites = 0;
let writeQueue = Promise.resolve();
let draftTimer;
let draftProjectId;
let busy = false;
const storageLabel = () => connecting ? t('подключение к серверу…', 'серверге қосылу…') : serverClient ? storageError ? t('ошибка сохранения', 'сақтау қатесі') : pendingWrites || draftTimer || busy ? t('сохраняется на сервере…', 'серверде сақталуда…') : t('сохранено на сервере', 'серверде сақталды') : t('только в этом браузере', 'тек осы браузерде');
function updateStorageLabel() {
  document.querySelectorAll('[data-storage-label]').forEach(el => { el.textContent = storageLabel(); });
  document.querySelectorAll('[data-storage-error]').forEach(el => { el.textContent = storageError; el.hidden = !storageError; });
}
function persistLocal() {
  try { localStorage.setItem(storeKey, JSON.stringify(state)); localWorkspace = state; return true; }
  catch { storageError = t('Не удалось сохранить в браузере. Скачайте текст сценария.', 'Браузерде сақтау мүмкін болмады. Сценарий мәтінін жүктеп алыңыз.'); updateStorageLabel(); toast(storageError); return false; }
}
function useLocal(keepCurrent = false) {
  if (keepCurrent && serverClient) {
    // Keep both the original browser projects and copies of the current server drafts.
    const active = state.activeId;
    for (const [id, record] of Object.entries(state.projects)) {
      const copy = structuredClone(record);
      const sceneText = copy.scenes.map(s => `${s.title[copy._language]}\n\n${s.text[copy._language]}`).join('\n\n');
      if (copy._scriptText && copy._scriptText !== sceneText) {
        const draftText = { ru: copy._scriptTranslations?.ru || '', kk: copy._scriptTranslations?.kk || '' };
        draftText[copy._language] = copy._scriptText;
        copy.scenes.push({ id: `recovery-${crypto.randomUUID()}`, title: { ru: 'Сохранённый черновик', kk: 'Сақталған жұмыс нұсқасы' }, text: draftText });
      }
      for (const snapshot of copy.snapshots) {
        const lang = snapshot.scriptLanguage || copy._language;
        const source = snapshot.scenes.map(s => `${s.title[lang]}\n\n${s.text[lang]}`).join('\n\n');
        if (snapshot.scriptText && snapshot.scriptText !== source) {
          const text = { ru: snapshot.scriptTranslations?.ru || '', kk: snapshot.scriptTranslations?.kk || '' };
          text[lang] = snapshot.scriptText;
          snapshot.scenes.push({ id: `recovery-${crypto.randomUUID()}`, title: { ru: 'Сохранённый черновик', kk: 'Сақталған жұмыс нұсқасы' }, text });
        }
      }
      for (const key of Object.keys(copy)) if (key.startsWith('_')) delete copy[key];
      const target = localWorkspace.projects[id] ? `server-${id}-${crypto.randomUUID()}` : id;
      localWorkspace.projects[target] = copy;
      if (id === active) localWorkspace.activeId = target;
    }
    localWorkspace.locale = state.locale;
    localWorkspace.scriptLang = state.scriptLang;
  }
  serverClient = null;
  state = localWorkspace;
  selectedScene = null;
  return persistLocal();
}
function reportStorageError(error) {
  storageError = `${t('Ошибка:', 'Қате:')} ${error.message || t('Не удалось сохранить.', 'Сақтау мүмкін болмады.')}`;
  if (error.status === 0) {
    const savedLocally = useLocal(true);
    storageError += savedLocally ? t(' Текущий проект сохранён локальной копией; подключитесь повторно через «Сервер».', 'Қазіргі жоба жергілікті көшірме ретінде сақталды; «Сервер» арқылы қайта қосылыңыз.') : t(' Локальная запись тоже не удалась. Скачайте сценарий до закрытия страницы.', 'Жергілікті сақтау да орындалмады. Бетті жаппас бұрын сценарийді жүктеп алыңыз.');
    render();
  }
  updateStorageLabel(); toast(storageError);
}
async function persist(id = state.activeId) {
  if (!serverClient) return persistLocal();
  const client = serverClient;
  const record = state.projects[id];
  if (!record) return false;
  const draft = structuredClone(record);
  const originalScenes = JSON.stringify(record.scenes);
  const originalText = record._scriptText;
  const originalStatus = record.scriptStatus;
  pendingWrites += 1; updateStorageLabel();
  const save = writeQueue.then(async () => {
    if (client !== serverClient) return false;
    try {
      await client.saveProject(id, draft);
      record._revision = draft._revision;
      if (originalScenes === JSON.stringify(record.scenes) && originalText === record._scriptText) {
        record._scriptText = draft._scriptText;
        record._scriptTranslations = draft._scriptTranslations;
        record._language = draft._language;
      }
      if (originalStatus === record.scriptStatus) record.scriptStatus = draft.scriptStatus;
      for (const shot of record.shots) if (draft.shots.find(s => s.id === shot.id)?.needsReview) shot.needsReview = true;
      for (const member of record.members) {
        const saved = draft.members.find(m => m.keyId && m.keyId === member.keyId);
        if (saved) member.id = saved.id;
      }
      storageError = ''; return true;
    } catch (error) { reportStorageError(error); return false; }
    finally { updateStorageLabel(); }
  });
  writeQueue = save.then(() => undefined);
  const saved = await save;
  pendingWrites -= 1; updateStorageLabel();
  return saved;
}
function schedulePersist() {
  clearTimeout(draftTimer); draftProjectId = state.activeId;
  if (!serverClient) { persistLocal(); return; }
  draftTimer = setTimeout(() => { draftTimer = null; persist(draftProjectId); }, 350);
  updateStorageLabel();
}
function preserveIndependentDraft(p) {
  if (!serverClient || !p._scriptText) return;
  const sceneText = p.scenes.map(s => `${s.title[p._language]}\n\n${s.text[p._language]}`).join('\n\n');
  if (sceneText === p._scriptText) return;
  const text = { ru: p._scriptTranslations?.ru || '', kk: p._scriptTranslations?.kk || '' };
  text[p._language] = p._scriptText;
  p.scenes.push({ id: `recovery-${crypto.randomUUID()}`, title: { ru: 'Сохранённый черновик', kk: 'Сақталған жұмыс нұсқасы' }, text });
}
async function flushDraft() {
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; return persist(draftProjectId); }
  await writeQueue;
  return storageError ? persist() : true;
}
async function connectServer() {
  if (!settings.key) { useLocal(); storageError = ''; connecting = false; render(); return; }
  connecting = true; storageError = ''; updateStorageLabel();
  try {
    const client = new StudioServer(settings);
    const projects = await client.loadProjects();
    if (!serverClient) localWorkspace = state;
    serverClient = client;
    state = { locale: state.locale, scriptLang: state.scriptLang, activeId: projects[state.activeId] ? state.activeId : Object.keys(projects)[0] || '', projects };
    selectedScene = null; sceneFilter = 'all'; playTime = 0;
  } catch (error) {
    storageError = `${t('Не удалось подключиться:', 'Қосылу мүмкін болмады:')} ${error.message}`;
    if (serverClient) useLocal(true);
    toast(storageError);
  } finally { connecting = false; render(); }
}
const svgPaths = { arrow: 'M4 10h12M11 4l6 6-6 6', plus: 'M10 3v14M3 10h14', close: 'M4 4l12 12M16 4L4 16', check: 'M3 10l5 5L17 5', overview: 'M3 3h6v6H3zM12 3h5v6h-5zM3 12h6v5H3zM12 12h5v5h-5z', script: 'M5 2h8l3 3v13H5zM8 8h5M8 11h5M8 14h3', storyboard: 'M2 4h16v12H2zM7 4v12M13 4v12', animatic: 'M7 4l9 6-9 6z', shots: 'M2 5h16v12H2zM2 5l3-3h13v3M5 2l3 3M10 2l3 3', team: 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 18v-2a5 5 0 0 1 10 0v2M13 5a3 3 0 0 1 0 6M16 18v-2a5 5 0 0 0-2-4', post: 'M3 5h14M3 10h14M3 15h14M7 2v6M13 7v6M8 12v6', download: 'M10 2v10M6 8l4 4 4-4M3 14v4h14v-4', save: 'M3 3h12l2 2v12H3zM6 3v5h7V3M6 17v-6h8v6', back: 'M16 10H4M9 4l-6 6 6 6', pause: 'M6 4v12M14 4v12', upload: 'M10 13V3M6 7l4-4 4 4M3 13v4h14v-4' };
const icon = name => `<svg class='icon' viewBox='0 0 20 20' aria-hidden='true'><path d='${svgPaths[name] || svgPaths.arrow}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
const btn = (label, action, primary = false, ico = '') => `<button class='btn ${primary ? 'primary' : ''}' data-action='${action}'>${e(label)}${ico ? icon(ico) : ''}</button>`;
const brand = () => `<a class='brand' href='#/' aria-label='neyra.vision'>neyra<span>.vision</span></a>`;
const langs = () => `<div class='langs' aria-label='${t('Язык интерфейса', 'Интерфейс тілі')}'><button data-lang='ru' class='${state.locale === 'ru' ? 'active' : ''}' aria-pressed='${state.locale === 'ru'}'>РУС</button><button data-lang='kk' class='${state.locale === 'kk' ? 'active' : ''}' aria-pressed='${state.locale === 'kk'}'>ҚАЗ</button></div>`;
const statusName = status => ({ draft: t('Черновик', 'Жұмыс нұсқасы'), review: t('На согласовании', 'Келісілуде'), approved: t('Утверждено', 'Бекітілді'), working: t('В работе', 'Орындалуда') })[status] || t('Черновик', 'Жұмыс нұсқасы');
const status = value => `<span class='badge ${e(value)}'><span class='dot'></span>${statusName(value)}</span>`;
const roles = () => ({ director: t('Режиссёр', 'Режиссер'), writer: t('Сценарист', 'Сценарист'), artist: t('Художник', 'Суретші'), producer: t('Продюсер', 'Продюсер'), ...(serverClient ? { admin: t('Администратор', 'Әкімші'), editor: t('Монтажёр', 'Монтажшы'), viewer: t('Наблюдатель', 'Бақылаушы') } : {}) });
const stages = () => [
  { id: 'script', title: t('Сценарий', 'Сценарий'), short: t('От идеи к истории', 'Идеядан оқиғаға'), description: t('Пишите по сценам, обсуждайте правки и фиксируйте утверждённую версию. Сценарий становится основой всех следующих этапов.', 'Көріністерді жазыңыз, түзетулерді талқылаңыз және бекітілген нұсқаны сақтаңыз. Сценарий келесі кезеңдердің негізіне айналады.'), result: t('Версия сценария · сцены · персонажи', 'Сценарий нұсқасы · көріністер · кейіпкерлер') },
  { id: 'storyboard', title: t('Раскадровка', 'Кадрлық жоспар'), short: t('История обретает форму', 'Оқиға бейнеге айналады'), description: t('Разложите сцены на кадры. Соберите действие, композицию и изображения в единую визуальную последовательность.', 'Көріністерді кадрларға бөліңіз. Әрекет, композиция мен суреттерді бірізді визуалды жоспарға біріктіріңіз.'), result: t('Кадры · изображения · визуальные решения', 'Кадрлар · суреттер · визуалды шешімдер') },
  { id: 'animatic', title: t('ИИматик', 'ЖИ-аниматик'), short: t('Почувствуйте ритм фильма', 'Фильмнің ырғағын сезініңіз'), description: t('Соберите предварительную последовательность изображений с длительностями. Оцените ритм и порядок до начала производства.', 'Суреттердің экранда қанша уақыт көрсетілетінін белгілеп, алдын ала нұсқа құрастырыңыз. Өндіріс басталмай тұрып, ырғақ пен реттілікті бағалаңыз.'), result: t('Последовательность · хронометраж · версия сборки', 'Реттілік · хронометраж · құрастырылған нұсқа') },
  { id: 'shots', title: t('Каждый кадр', 'Әр кадр'), short: t('От замысла к результату', 'Ойдан нәтижеге'), description: t('У каждого кадра своя карточка: описание, камера, промпт, исполнитель, варианты и статус согласования.', 'Әр кадрдың өз карточкасы бар: сипаттама, камера, промпт, орындаушы, нұсқалар және келісу мәртебесі.'), result: t('Карточка кадра · материалы · согласование', 'Кадр карточкасы · материалдар · келісу') },
  { id: 'team', title: t('Работа команды', 'Команданың жұмысы'), short: t('Один проект для всех', 'Бәріне ортақ бір жоба'), description: t('Режиссёр, сценарист, художник и продюсер работают в разделах одного проекта. У каждого понятная роль и зона ответственности.', 'Режиссер, сценарист, суретші мен продюсер бір жобаның бөлімдерінде жұмыс істейді. Әркімнің рөлі мен міндеті айқын.'), result: t('Участники · роли · доступ к разделам', 'Қатысушылар · рөлдер · бөлімдерге қолжетімділік') },
  { id: 'post', title: t('Постпродакшен', 'Постпродакшн'), short: t('Фильм становится целым', 'Фильм біртұтас туындыға айналады'), description: t('Планируйте монтаж, цвет, звук и VFX. Соберите работу отделов в один процесс завершения фильма.', 'Монтажды, түсті, дыбысты және VFX жұмыстарын жоспарлаңыз. Бөлімдердің жұмысын фильмді аяқтаудың ортақ үдерісіне біріктіріңіз.'), result: t('Монтаж · звук · цвет · VFX', 'Монтаж · дыбыс · түс · VFX') }
];
const navItems = () => [{ id: 'overview', title: t('Обзор проекта', 'Жобаға шолу') }, ...stages()];
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4000); }
function download(name, value, type = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob(['\uFEFF', value], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function demoOpen() { if (!serverClient && state.projects.demo) state.activeId = 'demo'; go('overview'); }
function go(page) { const hash = `#/studio/${page}`; if (location.hash === hash) render(); else location.hash = hash; }
function route() { return location.hash.startsWith('#/studio/') ? location.hash.split('/')[2] || 'overview' : 'home'; }
function stopPlayback() { if (playback) clearInterval(playback); playback = null; }

function landing() {
  const steps = stages();
  return `<header class='section-shell'><div class='site-nav'>${brand()}<nav aria-label='${t('Главное меню', 'Негізгі мәзір')}'><a href='#process'>${t('Процесс', 'Үдеріс')}</a><a href='#project'>${t('Пространство проекта', 'Жоба кеңістігі')}</a><a href='#about'>${t('О платформе', 'Платформа туралы')}</a></nav><div class='nav-actions'>${langs()}${btn(t('Сервер', 'Сервер'), 'server')}${btn(t('В студию', 'Студияға'), 'demo', false, 'arrow')}</div></div></header>
  <main><section class='hero'><img class='hero-image' src='assets/hero.jpg' alt='${t('Горы Заилийского Алатау на рассвете', 'Таңғы Іле Алатауы')}' fetchpriority='high'><div class='hero-content'><div class='eyebrow'>${t('КИНОПЛАТФОРМА · КАЗАХСТАН', 'КИНО ПЛАТФОРМАСЫ · ҚАЗАҚСТАН')}</div><h1>${t('От первой строки<br>до <em>финального кадра.</em>', 'Алғашқы жолдан<br><em>соңғы кадрға дейін.</em>')}</h1><p>${t('Ваша история. Ваша команда. Одно пространство.<br>Сценарий, изображения и ИИматик — начало пути к фильму, который вы создаёте вместе.', 'Сіздің оқиғаңыз. Сіздің командаңыз. Ортақ кеңістік.<br>Сценарий, суреттер және ЖИ-аниматик — бірге түсіретін фильмге бастайтын жол.')}</p><div class='hero-buttons'>${btn(t('Создать проект', 'Жоба құру'), 'create', true, 'plus')}${btn(t('Открыть демопроект', 'Демо жобаны ашу'), 'demo', false, 'arrow')}</div><div class='hero-foot'><span class='line'></span><span>${t('СЦЕНАРИЙ → КАДР → ФИЛЬМ', 'СЦЕНАРИЙ → КАДР → ФИЛЬМ')}</span></div></div><div class='shot-label'>NEYRA.VISION / 001<br>${t('ВИЗУАЛЬНЫЙ РЕФЕРЕНС · АЛМАТЫ', 'ВИЗУАЛДЫ РЕФЕРЕНС · АЛМАТЫ')}</div></section>
  <section class='intro-strip section-shell'><h2>${t('Один проект.<br>Вся команда. Каждый кадр.', 'Бір жоба.<br>Бүкіл команда. Әр кадр.')}</h2><p>${t('Фильм не складывается из разрозненных файлов. Ему нужны общий сценарий, понятные этапы и место, где видно работу над каждой сценой. neyra.vision связывает этот процесс — от первого замысла до постпродакшена.', 'Фильм шашыраңқы файлдардан құралмайды. Оған ортақ сценарий, айқын кезеңдер және әр көріністің жұмысын бақылауға болатын кеңістік қажет. neyra.vision алғашқы ойдан постпродакшнға дейінгі үдерісті байланыстырады.')}</p></section>
  <section class='section section-shell' id='process'><div class='eyebrow'>01 / ${t('ОТ ИСТОРИИ К ФИЛЬМУ', 'ОҚИҒАДАН ФИЛЬМГЕ')}</div><div class='section-heading'><h2>${t('Двигаемся по этапам.<br>Сохраняем целое.', 'Кезең-кезеңімен алға.<br>Ортақ ойды сақтаймыз.')}</h2><p>${t('Начинаем со сценария. Каждый следующий этап опирается на принятые решения.', 'Сценарийден бастаймыз. Әр келесі кезең қабылданған шешімдерге сүйенеді.')}</p></div><div class='process-grid'>${steps.map((s, i) => `<button class='process-item ${i === processStep ? 'active' : ''}' data-step='${i}' aria-pressed='${i === processStep}'><span class='num'>0${i + 1}</span><h3>${s.title}</h3><p>${s.short}</p></button>`).join('')}</div><div class='process-detail'><div><span class='eyebrow'>${t('ЭТАП', 'КЕЗЕҢ')} 0${processStep + 1}</span><h3>${steps[processStep].title}</h3><p>${steps[processStep].description}</p></div><div class='process-result'><small>${t('ЧТО ПЕРЕХОДИТ ДАЛЬШЕ', 'КЕЛЕСІ КЕЗЕҢГЕ НЕ ӨТЕДІ')}</small><div>${steps[processStep].result}</div><a class='btn small' href='#/studio/${steps[processStep].id}'>${t('Посмотреть в прототипе', 'Прототиптен көру')}${icon('arrow')}</a></div></div></section>
  <section class='section section-shell' id='project'><div class='project-showcase'><div class='project-preview'><div class='preview-top'><span>neyra.vision / studio</span><span class='muted'>${t('ДЕМОПРОЕКТ', 'ДЕМО ЖОБА')}</span></div><div class='preview-photo'><img src='assets/hero.jpg' alt='' loading='lazy'><h3>${t('Там, где начинается свет', 'Жарық бастау алған жер')}</h3></div><div class='preview-tabs'><span>${t('Обзор', 'Шолу')}</span><span>${t('Сценарий', 'Сценарий')}</span><span>${t('Раскадровка', 'Кадрлық жоспар')}</span><span>${t('Команда', 'Команда')}</span></div></div><div class='showcase-copy'><div class='eyebrow'>02 / ${t('ПРОЕКТ В ЦЕНТРЕ', 'ОРТАҚ ЖОБА')}</div><h2>${t('У вашей истории<br>есть своё пространство.', 'Оқиғаңыздың<br>өз кеңістігі бар.')}</h2><p>${t('Страница проекта — рабочий центр фильма. Здесь встречаются творческий замысел, материалы и люди, которые превращают их в кино.', 'Жоба беті — фильмнің жұмыс орталығы. Мұнда шығармашылық ой, материалдар және оларды киноға айналдыратын адамдар тоғысады.')}</p><ul class='text-list'><li>${icon('check')}${t('Сцены и версии сценария', 'Көріністер мен сценарий нұсқалары')}</li><li>${icon('check')}${t('Отдельная карточка каждого кадра', 'Әр кадрдың жеке карточкасы')}</li><li>${icon('check')}${t('Роли, комментарии и согласования', 'Рөлдер, пікірлер және келісу')}</li></ul>${btn(t('Исследовать демопроект', 'Демо жобамен танысу'), 'demo', true, 'arrow')}</div></div></section>
  <section class='section section-shell bilingual-section' id='about'><div><div class='eyebrow'>03 / ${t('ДВА ЯЗЫКА. ОДИН ЗАМЫСЕЛ.', 'ЕКІ ТІЛ. БІР ОЙ.')}</div><h2>${t('Создано для работы<br>в Казахстане.', 'Қазақстандағы<br>жұмысқа арналған.')}</h2><p>${t('Интерфейс на русском и казахском. Язык сценария выбирается отдельно: авторский текст остаётся вашим, когда вы переключаете язык платформы.', 'Орыс және қазақ тілдеріндегі интерфейс. Сценарий тілі бөлек таңдалады: платформаның тілін ауыстырғанда авторлық мәтін өзгермейді.')}</p></div><div class='language-display'>РУС ${icon('arrow')} <span>ҚАЗ</span></div></section>
  <section class='section section-shell faq-grid'><div><div class='eyebrow'>${t('ПЕРЕД НАЧАЛОМ', 'БАСТАМАС БҰРЫН')}</div><h2>${t('Как будем работать?', 'Қалай жұмыс істейміз?')}</h2></div><div>${[
    [t('С чего начинается проект?', 'Жоба неден басталады?'), t('С названия и сценария. Вы можете открыть демопроект, создать свой и писать отдельными сценами. Первый настоящий модуль платформы — работа над сценарием.', 'Атау мен сценарийден. Демо жобаны ашып немесе өз жобаңызды құрып, көріністерді жаза аласыз. Платформаның алғашқы толық модулі — сценариймен жұмыс.')],
    [t('Что такое ИИматик?', 'ЖИ-аниматик деген не?'), t('Предварительная сборка фильма из изображений, длительностей и временного звука. В прототипе можно посмотреть последовательность визуальных референсов с заданным хронометражем.', 'Суреттерден, ұзақтықтардан және уақытша дыбыстан құрастырылған фильмнің алдын ала нұсқасы. Прототипте визуалды референстердің берілген уақыт бойынша реттілігін көре аласыз.')],
    [t('Как подключается команда?', 'Команда қалай қосылады?'), t('В проекте предусмотрены участники, роли и разделы. Без сервера это локальная модель. На сервере доступ открывается после добавления участника с идентификатором ключа роли. Ключ выдаёт оператор сервера.', 'Жобада қатысушылар, рөлдер мен бөлімдер қарастырылған. Серверсіз бұл — жергілікті үлгі. Серверде қатысушыны рөл кілтінің идентификаторымен қосқаннан кейін қолжетімділік ашылады. Кілтті сервер операторы береді.')],
    [t('Что работает в этой версии?', 'Бұл нұсқада не жұмыс істейді?'), t('Переходы между экранами, RU/ҚАЗ, создание проекта, редактирование и сохранение сцен, карточки кадров, комментарии и просмотр последовательности. Без ключа данные остаются в этом браузере. В настройке «Сервер» можно подключить общую базу по ключу роли. Генерация ИИ пока не подключена.', 'Экрандар арасындағы ауысу, РУС/ҚАЗ, жоба құру, көріністерді өңдеу мен сақтау, кадр карточкалары, пікірлер және реттілікті көру. Кілтсіз деректер осы браузерде сақталады. «Сервер» параметрінде рөл кілті арқылы ортақ базаға қосылуға болады. ЖИ генерациясы әлі қосылмаған.')]
  ].map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div></section><section class='section-shell closing'><div class='eyebrow'>NEYRA.VISION / STUDIO</div><h2>${t('Начнём с вашей истории.', 'Сіздің оқиғаңыздан бастайық.')}</h2>${btn(t('Создать проект', 'Жоба құру'), 'create', true, 'arrow')}</section></main><footer class='section-shell'><div class='footer'>${brand()}<small>${t('КЛИКАБЕЛЬНЫЙ ПРОТОТИП · РУССКИЙ / КАЗАХСКИЙ', 'ИНТЕРАКТИВТІ ПРОТОТИП · ОРЫСША / ҚАЗАҚША')}</small><small>studio.neyra.vision</small></div></footer>`;
}

function pageHeading(title, description, actions = '') { return `<div class='page-heading'><div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div><div class='row'>${actions}</div></div>`; }
function overview() {
  const p = project();
  return `${pageHeading(t('Обзор проекта', 'Жобаға шолу'), t('Ваша история и работа команды — в одном месте.', 'Оқиғаңыз бен команданың жұмысы — бір кеңістікте.'), btn(t('К сценарию', 'Сценарийге'), 'script', true, 'arrow'))}<div class='project-hero'><img src='assets/hero.jpg' alt='${t('Визуальный референс проекта', 'Жобаның визуалды референсі')}'><div class='project-hero-copy'><div class='row wrap'>${status(p.scriptStatus)}<span class='badge'>${t('Визуальный референс', 'Визуалды референс')}</span></div><h2>${e(local(p.title))}</h2></div></div><div class='stat-row'><div class='stat'><strong>${p.scenes.length}</strong><small>${t('Сцен в сценарии', 'Сценарийдегі көріністер')}</small></div><div class='stat'><strong>${p.shots.length}</strong><small>${t('Кадров в проекте', 'Жобадағы кадрлар')}</small></div><div class='stat'><strong>${p.members.length}</strong><small>${t('Участников команды', 'Командадағы қатысушылар')}</small></div><div class='stat'><strong>${String(totalDuration(p.shots)).padStart(2, '0')} <small>${t('сек', 'сек')}</small></strong><small>${t('Хронометраж ИИматика', 'ЖИ-аниматик хронометражы')}</small></div></div><div class='two-cols'><section class='panel'><h2>${t('Путь проекта', 'Жобаның кезеңдері')}</h2><ol class='stage-list'>${stages().map((s, i) => `<li><a href='#/studio/${s.id}'><span><span class='num'>0${i + 1}</span>${s.title}</span>${i === 0 ? status(p.scriptStatus) : icon('arrow')}</a></li>`).join('')}</ol></section><div><section class='panel'><h2>${t('История', 'Оқиға')}</h2><p>${e(local(p.synopsis) || t('Добавьте историю через сценарий.', 'Оқиғаны сценарий арқылы жазыңыз.'))}</p><div class='scene-minis'>${p.scenes.slice(0, 3).map((s, i) => `<a class='scene-mini' href='#/studio/script' data-scene='${e(s.id)}'><span class='mono'>0${i + 1}</span>${e(s.title[state.scriptLang])}</a>`).join('')}</div></section><section class='panel' style='margin-top:24px'><div class='row between'><h2>${t('Команда', 'Команда')}</h2><a href='#/studio/team' aria-label='${t('Открыть команду', 'Команданы ашу')}'>${icon('arrow')}</a></div><div class='avatars'>${p.members.map(m => `<span class='avatar' title='${e(m.name)}'>${e(m.name.slice(0, 1))}</span>`).join('')}</div><p>${t('Творческий процесс начинается с общего замысла.', 'Шығармашылық үдеріс ортақ ойдан басталады.')}</p></section></div></div>`;
}
function scriptPage() {
  const p = project();
  const scene = p.scenes.find(s => s.id === selectedScene) || p.scenes[0];
  if (scene) selectedScene = scene.id;
  return `${pageHeading(t('Сценарий', 'Сценарий'), `${t('Версия', 'Нұсқа')} ${p.version} · ${t('От текста — к сценам и кадрам.', 'Мәтіннен — көріністер мен кадрларға.')}`, status(p.scriptStatus))}${serverClient ? `<details class='server-draft'><summary>${t('Черновик целиком', 'Толық жұмыс нұсқасы')} · ${e(p._language)}</summary><label for='draft-text'>${t('Авторский текст', 'Автор мәтіні')}</label><textarea id='draft-text' rows='10'>${e(p._scriptText)}</textarea><p>${t('Редактирование сцены обновит этот черновик. Правка целого текста не разбивает его на сцены.', 'Көріністі өңдеу осы жұмыс нұсқасын жаңартады. Толық мәтінді өңдеу оны көріністерге бөлмейді.')}</p></details>` : ''}<div class='editor-toolbar'><label for='script-language'>${t('Язык сценария', 'Сценарий тілі')}</label><select id='script-language'><option value='ru' ${state.scriptLang === 'ru' ? 'selected' : ''}>Русский</option><option value='kk' ${state.scriptLang === 'kk' ? 'selected' : ''}>Қазақша</option></select><button class='btn small' data-action='import'>${icon('upload')}${t('Импорт TXT', 'TXT импорттау')}</button><input id='import-file' type='file' accept='.txt,.fountain,text/plain' hidden><button class='btn small' data-action='download'>${icon('download')}${t('Скачать сценарий', 'Сценарийді жүктеп алу')}</button>${serverClient ? btn(t('Сохранить версию', 'Нұсқаны сақтау'), 'save-script', false, 'save') : ''}<button class='btn small' data-action='versions'>${t('Версии', 'Нұсқалар')} / ${p.snapshots.length}</button></div><div class='script-layout'><aside class='scene-list' aria-label='${t('Сцены', 'Көріністер')}'><h2>${t('СЦЕНЫ', 'КӨРІНІСТЕР')} / ${p.scenes.length}</h2>${p.scenes.map((s, i) => `<button class='scene-option ${s.id === selectedScene ? 'active' : ''}' data-select-scene='${e(s.id)}'><span class='mono'>${String(i + 1).padStart(2, '0')}</span><span>${e(s.title[state.scriptLang] || t('Новая сцена', 'Жаңа көрініс'))}</span></button>`).join('')}<button class='btn small' data-action='add-scene'>${icon('plus')}${t('Добавить сцену', 'Көрініс қосу')}</button></aside><div>${scene ? `<section class='script-paper'><div class='paper-head'><span>NEYRA.VISION / ${e(local(p.title))}</span><span>${String(p.scenes.indexOf(scene) + 1).padStart(2, '0')}</span></div><label for='scene-title'>${t('ЗАГОЛОВОК СЦЕНЫ', 'КӨРІНІС ТАҚЫРЫБЫ')}</label><input id='scene-title' value='${e(scene.title[state.scriptLang])}'><label for='scene-text'>${t('ДЕЙСТВИЕ И ДИАЛОГ', 'ӘРЕКЕТ ПЕН ДИАЛОГ')}</label><textarea id='scene-text' spellcheck='false'>${e(scene.text[state.scriptLang])}</textarea></section><div class='editor-foot'><button class='btn small' data-action='save-script'>${icon('save')}${t('Сохранить версию', 'Нұсқаны сақтау')}</button><div class='row wrap'>${p.scriptStatus === 'review' ? btn(t('Утвердить версию', 'Нұсқаны бекіту'), 'approve-script', true, 'check') : btn(t('Отправить на согласование', 'Келісуге жіберу'), 'review-script', true, 'arrow')}</div></div><div class='editor-note'>${t('Место сохранения указано в шапке. Язык интерфейса и язык сценария независимы. Изменение утверждённого текста вернёт сценарий в черновик.', 'Сақтау орны жоғарғы бөлікте көрсетілген. Интерфейс пен сценарий тілдері бөлек. Бекітілген мәтінді өзгерткенде сценарий жұмыс нұсқасына қайтады.')}</div>` : `<div class='empty'>${icon('script')}<h2>${t('Первая сцена — начало истории.', 'Алғашқы көрініс — оқиғаның бастауы.')}</h2><p>${t('Добавьте сцену и начните писать.', 'Көрініс қосып, жазуды бастаңыз.')}</p>${btn(t('Добавить сцену', 'Көрініс қосу'), 'add-scene', true, 'plus')}</div>`}</div></div>`;
}
function shotCard(shot, i) { return `<button class='shot-card' data-shot='${e(shot.id)}' aria-label='${t('Открыть кадр', 'Кадрды ашу')} ${e(shot.id)}: ${e(local(shot.title))}'><div class='shot-image crop-${i % 6}'><img src='assets/hero.jpg' alt='' loading='lazy'><div class='frame-overlay'></div><span class='frame-tag'>${t('РЕФЕРЕНС', 'РЕФЕРЕНС')} / ${e(shot.id)}</span><span class='frame-time'>${shot.duration}s</span></div><div class='shot-body'><div class='row between'><small class='mono'>${t('КАДР', 'КАДР')} ${e(shot.id)}</small>${status(shot.status)}</div><h2>${e(local(shot.title))}</h2><p>${e(local(shot.description))}</p>${shot.needsReview ? `<p style='color:var(--accent)'>${t('Проверить после изменения сценария', 'Сценарий өзгергеннен кейін тексеру')}</p>` : ''}<div class='row between'><small>${e(shot.lens)} · ${e(local(shot.movement))}</small>${icon('arrow')}</div></div></button>`; }
function shotsPage(page) {
  const p = project();
  const list = p.shots.filter(s => sceneFilter === 'all' || s.sceneId === sceneFilter);
  return `${pageHeading(page === 'storyboard' ? t('Раскадровка', 'Кадрлық жоспар') : t('Работа над кадрами', 'Кадрлармен жұмыс'), t('Откройте кадр: замысел, камера, промпт и согласование.', 'Кадрды ашыңыз: ой, камера, промпт және келісу.'), btn(t('Добавить кадр', 'Кадр қосу'), 'add-shot', true, 'plus'))}<div class='filter-row'><label for='scene-filter' style='margin:0'>${t('Сцена', 'Көрініс')}</label><select id='scene-filter'><option value='all'>${t('Все сцены', 'Барлық көріністер')}</option>${p.scenes.map((s, i) => `<option value='${e(s.id)}' ${sceneFilter === s.id ? 'selected' : ''}>${i + 1}. ${e(s.title[state.scriptLang])}</option>`).join('')}</select><small>${t('Изображения — демонстрационные референсы, не сгенерированные кадры сценария.', 'Суреттер — сценарий бойынша жасалған кадрлар емес, демонстрациялық референстер.')}</small></div>${list.length ? `<div class='shot-grid'>${list.map(s => shotCard(s, p.shots.indexOf(s))).join('')}</div>` : `<div class='empty'><h2>${t('Здесь появятся кадры сцены.', 'Мұнда көріністің кадрлары пайда болады.')}</h2><p>${t('Добавьте первый кадр и опишите его.', 'Алғашқы кадрды қосып, сипаттаңыз.')}</p>${btn(t('Добавить кадр', 'Кадр қосу'), 'add-shot', true, 'plus')}</div>`}`;
}
function animaticPage() {
  const p = project();
  if (!p.shots.length) return `${pageHeading(t('ИИматик', 'ЖИ-аниматик'), '')}<div class='empty'><h2>${t('Сначала создадим кадры.', 'Алдымен кадрларды жасайық.')}</h2><p>${t('ИИматик собирается из последовательности кадров.', 'ЖИ-аниматик кадрлардың реттілігінен құрастырылады.')}</p>${btn(t('К раскадровке', 'Кадрлық жоспарға'), 'storyboard', true, 'arrow')}</div>`;
  playTime = Math.min(playTime, totalDuration(p.shots));
  const index = frameAt(p.shots, playTime);
  return `${pageHeading(t('ИИматик', 'ЖИ-аниматик'), t('Предварительный ритм фильма. Просмотр референсов без звука.', 'Фильмнің алдын ала ырғағы. Референстерді дыбыссыз көру.'))}<div class='animatic-screen'><img id='animatic-image' src='assets/hero.jpg' alt='${t('Демонстрационный визуальный референс', 'Демонстрациялық визуалды референс')}'><div class='animatic-label'>NEYRA.VISION / ${t('ВИЗУАЛЬНЫЙ РЕФЕРЕНС', 'ВИЗУАЛДЫ РЕФЕРЕНС')}</div><div class='animatic-caption' id='animatic-caption'>${e(local(p.shots[index].title))}</div></div><div class='play-controls'><button class='icon-btn' data-action='play' aria-label='${t('Воспроизвести', 'Ойнату')}' id='play-button'>${icon('animatic')}</button><input class='seek' id='play-seek' type='range' min='0' max='${totalDuration(p.shots)}' step='0.1' value='${playTime}' aria-label='${t('Позиция воспроизведения', 'Ойнату орны')}'><span class='mono' id='play-time' style='font-size:11px'>${playTime.toFixed(1)} / ${totalDuration(p.shots)}s</span></div><div class='timeline'>${p.shots.map((s, i) => `<button data-seek-shot='${i}' class='${i === index ? 'active' : ''}'><span class='mono'>${e(s.id)}</span> / ${e(local(s.title))}<span class='duration'>${s.duration} ${t('сек', 'сек')}</span></button>`).join('')}</div><div class='access-note'>${t('В прототипе используется один собственный визуальный референс с разным кадрированием. Длительность каждого плана меняется в карточке кадра. Генерация изображений, временный звук и видеоэкспорт — следующие этапы.', 'Прототипте бір авторлық визуалды референс әртүрлі кадрлаумен қолданылады. Әр кадрдың ұзақтығын оның карточкасында өзгертуге болады. Сурет генерациясы, уақытша дыбыс және бейнеэкспорт — келесі кезеңдер.')}</div>`;
}
function teamPage() { const p = project(); return `${pageHeading(t('Команда проекта', 'Жоба командасы'), t('Участники, роли и разделы рабочего пространства.', 'Жұмыс кеңістігінің қатысушылары, рөлдері және бөлімдері.'), btn(t('Добавить участника', 'Қатысушы қосу'), 'member', true, 'plus'))}<div class='panel'><table class='team-table'><thead><tr><th>${t('УЧАСТНИК', 'ҚАТЫСУШЫ')}</th><th>${t('РОЛЬ', 'РӨЛ')}</th><th>${t('РАЗДЕЛЫ', 'БӨЛІМДЕР')}</th></tr></thead><tbody>${p.members.map(m => `<tr><td><div class='member-info'><span class='avatar'>${e(m.name.slice(0, 1))}</span>${e(m.name)}</div></td><td>${roles()[m.role] || e(m.role)}</td><td><div class='sections'>${m.sections.map(id => `<span class='badge'>${stages().find(s => s.id === id)?.title || e(id)}</span>`).join('')}</div></td></tr>`).join('')}</tbody></table></div><div class='access-note'>${serverClient ? t('Добавление участника с keyId открывает доступ по его внешнему ключу и указанным разделам. Значение ключа выдаёт оператор сервера; приглашение автоматически не отправляется.', 'Қатысушыны keyId арқылы қосу оның сыртқы кілті мен көрсетілген бөлімдері бойынша қолжетімділік ашады. Кілтті сервер операторы береді; шақыру автоматты түрде жіберілмейді.') : t('Локальная модель команды. Добавление участника не открывает доступ другому человеку.', 'Команданың жергілікті үлгісі. Қатысушыны қосу басқа адамға қолжетімділік бермейді.')}</div>`; }
const postInfo = () => ({ edit: [t('Монтаж', 'Монтаж'), t('Собрать утверждённые планы в последовательность фильма.', 'Бекітілген кадрларды фильмнің ретімен монтаждау.')], color: [t('Цвет', 'Түс'), t('Согласовать общий визуальный характер и цвет кадров.', 'Кадрлардың ортақ визуалды сипаты мен түсін келісу.')], sound: [t('Звук', 'Дыбыс'), t('Подготовить диалоги, атмосферу, музыку и финальный микс.', 'Диалогтарды, атмосфераны, музыканы және соңғы миксті дайындау.')], vfx: [t('VFX и графика', 'VFX және графика'), t('Проверить эффекты, титры и финальные правки.', 'Эффектілерді, титрлерді және соңғы түзетулерді тексеру.')] });
function postPage() { const p = project(); if (!p.post.length) p.post = ['edit', 'color', 'sound', 'vfx'].map(id => ({ id, done: false })); return `${pageHeading(t('План постпродакшена', 'Постпродакшн жоспары'), t('Список работ для завершения фильма.', 'Фильмді аяқтауға арналған жұмыстар тізімі.'), `<span class='badge'>${p.post.filter(v => v.done).length} / ${p.post.length}</span>`)}<div class='post-list'>${p.post.map(task => `<div class='post-task ${task.done ? 'completed' : ''}'><input id='post-${task.id}' data-post='${task.id}' type='checkbox' ${task.done ? 'checked' : ''}><label for='post-${task.id}'><h2>${postInfo()[task.id][0]}</h2><p>${postInfo()[task.id][1]}</p></label>${status(task.done ? 'approved' : 'draft')}</div>`).join('')}</div><div class='access-note'>${t('В этом разделе планируем работу. Монтажные инструменты, звук, цветокоррекция и экспорт мастер-файла пока не подключены.', 'Бұл бөлімде жұмысты жоспарлаймыз. Монтаж құралдары, дыбыс, түс түзету және мастер-файл экспорты әлі қосылмаған.')}</div>`; }
function workspace(page) {
  const p = project();
  const pages = { overview, script: scriptPage, storyboard: () => shotsPage('storyboard'), animatic: animaticPage, shots: () => shotsPage('shots'), team: teamPage, post: postPage };
  if (!pages[page]) page = 'overview';
  const section = ['storyboard', 'shots', 'animatic'].includes(page) ? 'shots' : page === 'team' ? 'team' : page === 'script' ? 'script' : page;
  const denied = p?._denied?.includes(section);
  const content = !p ? `<div class='empty'><h1>${t('Нет доступных проектов', 'Қолжетімді жобалар жоқ')}</h1><p>${t('Создайте проект ключом администратора, режиссёра или продюсера. Для доступа другой роли добавьте участника в проект с его keyId.', 'Әкімші, режиссер немесе продюсер кілтімен жоба құрыңыз. Басқа рөлге қолжетімділік беру үшін оны keyId арқылы жобаға қосыңыз.')}</p>${btn(t('Создать проект', 'Жоба құру'), 'create', true, 'plus')}</div>` : denied ? `<div class='empty'><h1>${t('Нет доступа к разделу', 'Бөлімге қолжетімділік жоқ')}</h1><p>${t('Сервер проверяет ключ роли и разделы участника. Попросите руководителя добавить ваш keyId через раздел «Команда».', 'Сервер рөл кілтін және қатысушы бөлімдерін тексереді. Жетекшіден keyId идентификаторыңызды «Команда» бөлімі арқылы қосуды сұраңыз.')}</p></div>` : pages[page]();
  return `<div class='workspace'><header class='work-header'><div class='row wrap'>${brand()}<span class='storage-label' data-storage-label role='status'>${e(storageLabel())}</span></div><div class='row work-controls'><select id='project-switch' aria-label='${t('Выбрать проект', 'Жобаны таңдау')}'>${Object.entries(state.projects).map(([id, record]) => `<option value='${e(id)}' ${id === state.activeId ? 'selected' : ''}>${e(local(record.title))}</option>`).join('')}</select>${langs()}${btn(t('Сервер', 'Сервер'), 'server')}<button class='btn small' data-action='create' aria-label='${t('Создать проект', 'Жоба құру')}'>${icon('plus')}</button></div></header><div class='work-grid'><aside class='sidebar'><div class='project-name'>${e(p ? local(p.title) : t('Проекты', 'Жобалар'))}<small>${t('РАБОЧЕЕ ПРОСТРАНСТВО', 'ЖҰМЫС КЕҢІСТІГІ')}</small></div><nav class='side-nav' aria-label='${t('Разделы проекта', 'Жоба бөлімдері')}'>${navItems().map(n => `<a href='#/studio/${n.id}' class='${page === n.id ? 'active' : ''}' ${page === n.id ? `aria-current='page'` : ''}>${icon(n.id)}${n.title}</a>`).join('')}</nav><div class='side-foot'>studio.neyra.vision<br>${t('СЦЕНАРИЙ → КАДР → ФИЛЬМ', 'СЦЕНАРИЙ → КАДР → ФИЛЬМ')}</div></aside><main class='work-main'><div class='prototype-note'>${t('ПРОТОТИП · Генерация изображений и видео пока не подключена.', 'ПРОТОТИП · Сурет пен бейне генерациясы әлі қосылмаған.')}</div><p class='storage-error' data-storage-error role='alert' ${storageError ? '' : 'hidden'}>${e(storageError)}</p>${content}</main></div></div>`;
}

function openDialog(html) { lastFocus = document.activeElement; dialog.innerHTML = html; dialog.showModal(); }
const dialogHead = (title, subtitle = '') => `<div class='dialog-header'><div><div class='eyebrow'>NEYRA.VISION / STUDIO</div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class='icon-btn' data-close aria-label='${t('Закрыть', 'Жабу')}'>${icon('close')}</button></div>`;
const dialogActions = label => `<div class='dialog-actions'><button type='button' class='btn' data-close>${t('Отмена', 'Бас тарту')}</button><button type='submit' class='btn primary'>${label}${icon('arrow')}</button></div>`;
function createDialog() { openDialog(`${dialogHead(t('Начнём новую историю.', 'Жаңа оқиғаны бастайық.'), t('Ваш текущий проект останется в списке проектов.', 'Қазіргі жобаңыз жобалар тізімінде сақталады.'))}<form id='create-form'><label for='project-title'>${t('Название проекта', 'Жоба атауы')}</label><input id='project-title' name='title' required maxlength='120' placeholder='${t('Название вашего фильма', 'Фильміңіздің атауы')}'><label for='project-synopsis'>${t('О чём ваша история?', 'Оқиғаңыз не туралы?')}</label><textarea id='project-synopsis' name='synopsis' rows='3' maxlength='4000'></textarea>${dialogActions(t('Создать проект', 'Жоба құру'))}</form>`); }
function serverDialog() {
  openDialog(`${dialogHead(t('Сервер', 'Сервер'), t('Адрес и ключ роли сохраняются только на этом устройстве.', 'Мекенжай мен рөл кілті тек осы құрылғыда сақталады.'))}<form id='server-form'><label for='server-url'>${t('Сервер', 'Сервер')}</label><input id='server-url' name='url' type='url' required value='${e(settings.url)}'><label for='server-key'>${t('Ключ роли', 'Рөл кілті')} (X-Key)</label><input id='server-key' name='key' type='password' autocomplete='off' maxlength='512' value='${e(settings.key)}'><p class='access-note'>${t('Пустой ключ включает локальный режим. Локальные проекты сохраняются отдельно и не загружаются на сервер автоматически. Роли требуется членство в проекте: руководитель добавляет участника с keyId в разделе «Команда».', 'Бос кілт жергілікті режимді қосады. Жергілікті жобалар бөлек сақталады және серверге автоматты түрде жүктелмейді. Рөл жобаға мүше болуы керек: жетекші «Команда» бөлімінде keyId арқылы қатысушыны қосады.')}</p>${dialogActions(t('Сохранить и подключиться', 'Сақтау және қосылу'))}</form>`);
}
function memberDialog() {
  const sections = [{ id: 'overview', title: t('Обзор', 'Шолу') }, ...stages()];
  openDialog(`${dialogHead(t('Добавить участника', 'Қатысушы қосу'), serverClient ? t('Ключ должен быть создан оператором сервера заранее.', 'Кілтті сервер операторы алдын ала жасауы керек.') : t('Локальная модель роли. Приглашение не отправляется.', 'Рөлдің жергілікті үлгісі. Шақыру жіберілмейді.'))}<form id='member-form'><label for='member-name'>${t('Имя', 'Аты')}</label><input id='member-name' name='name' required maxlength='80'><label for='member-role'>${t('Роль', 'Рөлі')}</label><select id='member-role' name='role'>${Object.entries(roles()).map(([key, name]) => `<option value='${key}'>${name}</option>`).join('')}</select>${serverClient ? `<label for='member-key-id'>${t('Идентификатор ключа', 'Кілт идентификаторы')} (keyId)</label><input id='member-key-id' name='keyId' required maxlength='80' pattern='[A-Za-z0-9_-]+'><small>${t('Это id ключа из конфигурации сервера, например writer-local.', 'Бұл — сервер конфигурациясындағы кілт id мәні, мысалы writer-local.')}</small>` : ''}<label>${t('Разделы проекта', 'Жоба бөлімдері')}</label>${sections.map(s => `<label class='field-check'><input type='checkbox' name='sections' value='${s.id}' ${['overview', 'script'].includes(s.id) ? 'checked' : ''}>${s.title}</label>`).join('')}${dialogActions(t('Добавить участника', 'Қатысушы қосу'))}</form>`);
}

function shotDialog(id) {
  const shot = project().shots.find(s => s.id === id);
  if (!shot) return;
  openDialog(`${dialogHead(`${t('Кадр', 'Кадр')} ${e(shot.id)} / ${e(local(shot.title))}`)}<div class='dialog-preview'><img src='assets/hero.jpg' alt='${t('Демонстрационный референс', 'Демонстрациялық референс')}'></div><form id='shot-form' data-id='${e(id)}'><label for='shot-title'>${t('Название кадра', 'Кадр атауы')}</label><input id='shot-title' name='title' value='${e(local(shot.title))}' required maxlength='140'><div class='form-row'><div><label for='shot-duration'>${t('Длительность, сек', 'Ұзақтығы, сек')}</label><input id='shot-duration' name='duration' type='number' min='1' max='60' step='1' value='${shot.duration}' required></div><div><label for='shot-status'>${t('Статус', 'Мәртебе')}</label><select id='shot-status' name='status'>${['draft', 'working', 'review', 'approved'].map(s => `<option value='${s}' ${s === shot.status ? 'selected' : ''}>${statusName(s)}</option>`).join('')}</select></div></div><div class='form-row'><div><label for='shot-owner'>${t('Ответственный', 'Жауапты')}</label><input id='shot-owner' name='owner' value='${e(shot.owner)}' maxlength='80'></div><div><label for='shot-lens'>${t('Объектив', 'Объектив')}</label><input id='shot-lens' name='lens' value='${e(shot.lens)}' maxlength='80'></div></div><label for='shot-description'>${t('Действие и композиция', 'Әрекет пен композиция')}</label><textarea id='shot-description' name='description' rows='2' maxlength='4000'>${e(local(shot.description))}</textarea><label for='shot-prompt'>${t('Промпт для следующего этапа', 'Келесі кезеңге арналған промпт')}</label><textarea id='shot-prompt' name='prompt' rows='3' maxlength='8000'>${e(local(shot.prompt))}</textarea>${dialogActions(t('Сохранить изменения', 'Өзгерістерді сақтау'))}</form><section class='comment-list'><h3>${t('Комментарии', 'Пікірлер')} / ${shot.comments.length}</h3><div id='comments'>${shot.comments.map(c => `<div class='comment'><strong>${e(c.author)}</strong><p>${e(c.text)}</p></div>`).join('')}</div><label for='comment-text'>${t('Ваш комментарий', 'Сіздің пікіріңіз')}</label><textarea id='comment-text' class='comment-input' rows='2' maxlength='2000'></textarea><button class='btn small' data-comment-shot='${e(id)}' style='margin-top:12px'>${t('Оставить комментарий', 'Пікір қалдыру')}${icon('plus')}</button></section>`);
}
function versionsDialog() { const p = project(); openDialog(`${dialogHead(t('История сценария', 'Сценарий тарихы'), t('Перед восстановлением откройте текст. Текущая редакция сохранится в истории.', 'Қалпына келтірмес бұрын мәтінді ашыңыз. Қазіргі мәтін тарихта сақталады.'))}<div>${p.snapshots.map((snapshot, index) => `<details class='version-entry'><summary>${t('Версия', 'Нұсқа')} ${snapshot.version} · ${new Date(snapshot.date).toLocaleString(state.locale === 'kk' ? 'kk-KZ' : 'ru-RU')} ${snapshot.kind === 'backup' ? `· ${t('Резервная копия', 'Сақтық көшірме')}` : ''}</summary><pre>${e(serverClient ? snapshot.scriptTranslations?.[state.scriptLang] ?? snapshot.scriptText : snapshot.scenes.map(scene => `${scene.title[state.scriptLang]}\n\n${scene.text[state.scriptLang]}`).join('\n\n————————\n\n'))}</pre><button class='btn small' data-restore-version='${index}'>${t('Восстановить как новую версию', 'Жаңа нұсқа ретінде қалпына келтіру')}${icon('back')}</button></details>`).reverse().join('')}</div>`); }
async function addScene() { const p = project(); preserveIndependentDraft(p); const id = `s-${crypto.randomUUID()}`; p.scenes.push({ id, title: { ru: 'НАТ. НОВАЯ СЦЕНА — ДЕНЬ', kk: 'СЫРТҚЫ КӨРІНІС. ЖАҢА КӨРІНІС — КҮНДІЗ' }, text: { ru: '', kk: '' } }); selectedScene = id; p.scriptStatus = 'draft'; await persist(); go('script'); }
async function addShot() { const p = project(); if (!p.scenes.length) { toast(t('Сначала добавьте сцену в сценарий.', 'Алдымен сценарийге көрініс қосыңыз.')); go('script'); return; } const id = String(Math.max(0, ...p.shots.map(s => Number(s.id) || 0)) + 1).padStart(2, '0'); const sceneId = p.scenes.some(scene => scene.id === sceneFilter) ? sceneFilter : p.scenes[0].id; const shot = { id, sceneId, title: { ru: 'Новый кадр', kk: 'Жаңа кадр' }, description: { ru: '', kk: '' }, prompt: { ru: '', kk: '' }, duration: 5, status: 'draft', owner: '', lens: '35 mm', movement: { ru: 'Статика', kk: 'Қозғалыссыз' }, comments: [] }; p.shots.push(shot); if (!await persist()) return; render(); shotDialog(id); }
function updatePlayer() { const shots = project().shots; if (!shots.length || !document.querySelector('#play-seek')) return; const index = frameAt(shots, playTime); document.querySelector('#play-seek').value = playTime; document.querySelector('#play-time').textContent = `${playTime.toFixed(1)} / ${totalDuration(shots)}s`; document.querySelector('#animatic-caption').textContent = local(shots[index].title); document.querySelector('#animatic-image').style.objectPosition = `${[12, 85, 35, 60, 95, 50][index % 6]}% 50%`; document.querySelectorAll('[data-seek-shot]').forEach((el, i) => el.classList.toggle('active', i === index)); const button = document.querySelector('#play-button'); button.innerHTML = icon(playback ? 'pause' : 'animatic'); button.setAttribute('aria-label', playback ? t('Пауза', 'Кідірту') : t('Воспроизвести', 'Ойнату')); }
function togglePlay() { if (playback) stopPlayback(); else { if (playTime >= totalDuration(project().shots)) playTime = 0; let last = performance.now(); playback = setInterval(() => { const now = performance.now(); playTime = Math.min(totalDuration(project().shots), playTime + (now - last) / 1000); last = now; if (playTime >= totalDuration(project().shots)) stopPlayback(); updatePlayer(); }, 100); } updatePlayer(); }

async function runOperation(action) {
  if (busy || connecting) return;
  busy = true; app.inert = true; dialog.inert = true;
  updateStorageLabel();
  try { await action(); } catch (error) { reportStorageError(error); }
  finally { busy = false; app.inert = false; dialog.inert = false; updateStorageLabel(); }
}
function persistPreferences() {
  localWorkspace.locale = state.locale; localWorkspace.scriptLang = state.scriptLang;
  if (!serverClient) localWorkspace.activeId = state.activeId;
  try { localStorage.setItem(storeKey, JSON.stringify(localWorkspace)); }
  catch { toast(t('Не удалось сохранить настройки в браузере.', 'Браузерде параметрлерді сақтау мүмкін болмады.')); }
}
app.addEventListener('click', async event => {
  const lang = event.target.closest('[data-lang]');
  if (lang) { state.locale = lang.dataset.lang; persistPreferences(); render(); return; }
  const step = event.target.closest('[data-step]');
  if (step) { const y = window.scrollY; processStep = Number(step.dataset.step); render(); window.scrollTo(0, y); document.querySelector(`[data-step='${processStep}']`)?.focus({ preventScroll: true }); return; }
  const scene = event.target.closest('[data-select-scene], [data-scene]');
  if (scene) { selectedScene = scene.dataset.selectScene || scene.dataset.scene; if (scene.dataset.selectScene) render(); }
  const shot = event.target.closest('[data-shot]');
  if (shot) shotDialog(shot.dataset.shot);
  const seek = event.target.closest('[data-seek-shot]');
  if (seek && project()) { playTime = project().shots.slice(0, Number(seek.dataset.seekShot)).reduce((n, s) => n + s.duration, 0); updatePlayer(); }
  const action = event.target.closest('[data-action]')?.dataset.action;
  const p = project();
  if (action === 'server') serverDialog();
  else if (action === 'demo') demoOpen();
  else if (action === 'create') createDialog();
  else if (['script', 'storyboard', 'team'].includes(action)) go(action);
  else if (!p) return;
  else if (action === 'add-scene' || action === 'add-shot') await runOperation(async () => { if (await flushDraft()) await (action === 'add-scene' ? addScene() : addShot()); });
  else if (action === 'member') memberDialog();
  else if (action === 'versions') versionsDialog();
  else if (action === 'play') togglePlay();
  else if (action === 'save-script') await runOperation(async () => {
    if (!await flushDraft() || !await persist()) return;
    if (serverClient) { state.projects[state.activeId] = await serverClient.saveVersion(state.activeId, p); }
    else { p.version += 1; p.snapshots.push({ version: p.version, date: new Date().toISOString(), scenes: structuredClone(p.scenes) }); if (!await persist()) return; }
    toast(t('Версия сценария сохранена.', 'Сценарий нұсқасы сақталды.')); render();
  });
  else if (action === 'review-script' || action === 'approve-script') await runOperation(async () => {
    if (!await flushDraft()) return;
    if (action === 'approve-script' && p.scriptStatus !== 'review') return;
    p.scriptStatus = action === 'review-script' ? 'review' : 'approved';
    const saved = await persist(); render(); if (saved) toast(statusName(p.scriptStatus));
  });
  else if (action === 'download') download('neyra-vision-script.txt', serverClient ? p._scriptTranslations?.[state.scriptLang] ?? p._scriptText : `${p.title[state.scriptLang]}\n\n${p.scenes.map((s, i) => `${i + 1}. ${s.title[state.scriptLang]}\n\n${s.text[state.scriptLang]}`).join('\n\n————————————————————\n\n')}`);
  else if (action === 'import') document.querySelector('#import-file').click();
});
app.addEventListener('input', event => {
  const p = project(); if (!p) return;
  if (event.target.id === 'draft-text') { p._scriptText = event.target.value; p._scriptTranslations[p._language] = p._scriptText; p.scriptStatus = 'draft'; schedulePersist(); }
  if (event.target.id === 'scene-title' || event.target.id === 'scene-text') {
    const scene = p.scenes.find(s => s.id === selectedScene); if (!scene) return;
    preserveIndependentDraft(p);
    const field = event.target.id === 'scene-title' ? 'title' : 'text'; scene[field][state.scriptLang] = event.target.value;
    if (p.scriptStatus !== 'draft') {
      p.scriptStatus = 'draft'; document.querySelector('.page-heading .row').innerHTML = status('draft');
      document.querySelector('.editor-foot .row').innerHTML = btn(t('Отправить на согласование', 'Келісуге жіберу'), 'review-script', true, 'arrow');
    }
    p.shots.filter(shot => shot.sceneId === scene.id).forEach(shot => shot.needsReview = true);
    const sceneLabel = [...document.querySelectorAll('[data-select-scene]')].find(el => el.dataset.selectScene === selectedScene)?.querySelector('span:last-child');
    if (field === 'title' && sceneLabel) sceneLabel.textContent = event.target.value;
    if (serverClient) {
      p._scriptTranslations = Object.fromEntries(['ru', 'kk'].map(lang => [lang, p.scenes.map(s => `${s.title[lang]}\n\n${s.text[lang]}`).join('\n\n')]));
      p._scriptText = p._scriptTranslations[p._language];
      const draft = document.querySelector('#draft-text'); if (draft) draft.value = p._scriptText;
    }
    schedulePersist();
  }
  if (event.target.id === 'play-seek') { playTime = Number(event.target.value); updatePlayer(); }
});
app.addEventListener('change', async event => {
  if (event.target.id === 'script-language') { state.scriptLang = event.target.value; persistPreferences(); render(); }
  if (event.target.id === 'scene-filter') { sceneFilter = event.target.value; render(); }
  if (event.target.id === 'project-switch') await runOperation(async () => {
    const id = event.target.value; if (!await flushDraft()) { render(); return; }
    if (serverClient) state.projects[id] = await serverClient.loadProject(id);
    state.activeId = id; selectedScene = null; sceneFilter = 'all'; playTime = 0; persistPreferences(); render();
  });
  if (event.target.dataset.post) await runOperation(async () => { project().post.find(v => v.id === event.target.dataset.post).done = event.target.checked; await persist(); render(); });
  if (event.target.id === 'import-file') {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast(t('Для прототипа выберите текстовый файл до 2 МБ.', 'Прототип үшін 2 МБ-қа дейінгі мәтін файлын таңдаңыз.')); return; }
    await runOperation(async () => {
      if (!await flushDraft()) return;
      const id = `s-${crypto.randomUUID()}`;
      const scene = { id, title: { ru: file.name, kk: file.name }, text: { ru: '', kk: '' } };
      scene.text[state.scriptLang] = await file.text(); preserveIndependentDraft(project()); project().scenes.push(scene); project().scriptStatus = 'draft';
      const saved = await persist(); selectedScene = id; render();
      if (saved) toast(t('Файл добавлен отдельной сценой. Исходный текст сохранён.', 'Файл жеке көрініс ретінде қосылды. Бастапқы мәтін сақталды.'));
    });
  }
});
dialog.addEventListener('click', async event => {
  if (event.target.closest('[data-close]')) dialog.close();
  const restore = event.target.closest('[data-restore-version]');
  if (restore) await runOperation(async () => {
    if (!await flushDraft() || !await persist()) return;
    const p = project(); const snapshot = p.snapshots[Number(restore.dataset.restoreVersion)]; if (!snapshot) return;
    if (serverClient) state.projects[state.activeId] = await serverClient.restoreVersion(state.activeId, snapshot.id);
    else {
      const scenes = structuredClone(snapshot.scenes);
      p.snapshots.push({ version: p.version, kind: 'backup', date: new Date().toISOString(), scenes: structuredClone(p.scenes) });
      p.scenes = scenes; p.version += 1; p.snapshots.push({ version: p.version, date: new Date().toISOString(), scenes: structuredClone(scenes) });
      p.scriptStatus = 'draft'; p.shots.forEach(shot => shot.needsReview = true); if (!await persist()) return;
    }
    selectedScene = null; sceneFilter = 'all'; dialog.close(); render();
    toast(t('Версия восстановлена. Текущий текст сохранён в истории.', 'Нұсқа қалпына келтірілді. Қазіргі мәтін тарихта сақталды.'));
  });
  const comment = event.target.closest('[data-comment-shot]');
  if (comment) await runOperation(async () => {
    const input = document.querySelector('#comment-text'); const text = input.value.trim(); if (!text) return;
    const shot = project().shots.find(s => s.id === comment.dataset.commentShot);
    shot.comments.push({ author: t('Вы', 'Сіз'), text, date: new Date().toISOString() });
    if (!await persist()) { shot.comments.pop(); return; }
    // Rerendering uses the same escaping as stored and freshly entered comments.
    dialog.close(); shotDialog(shot.id); toast(t('Комментарий сохранён.', 'Пікір сақталды.'));
  });
});
dialog.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target; const data = new FormData(form);
  await runOperation(async () => {
    if (form.id === 'server-form') {
      await flushDraft(); await writeQueue;
      if (serverClient && storageError) useLocal(true);
      const next = { url: data.get('url').trim(), key: data.get('key').trim() };
      const client = new StudioServer(next); next.url = client.url;
      try { localStorage.setItem(settingsKey, JSON.stringify(next)); }
      catch { toast(t('Не удалось сохранить настройки сервера на устройстве.', 'Құрылғыда сервер параметрлерін сақтау мүмкін болмады.')); return; }
      if (serverClient) useLocal();
      settings = next; await connectServer(); dialog.close(); return;
    }
    if (!await flushDraft()) return;
    if (form.id === 'create-form') {
      const title = data.get('title').trim(); if (!title) return;
      const id = crypto.randomUUID(); const p = makeDemo();
      Object.assign(p, { title: { ru: title, kk: title }, synopsis: { ru: data.get('synopsis').trim(), kk: data.get('synopsis').trim() }, scenes: [], shots: [], members: [{ id: 'owner', name: t('Вы', 'Сіз'), role: 'director', sections: stages().map(s => s.id) }], version: 1, scriptStatus: 'draft', snapshots: [{ version: 1, date: new Date().toISOString(), scenes: [] }] });
      if (serverClient) { p._language = state.scriptLang; state.projects[id] = await serverClient.createProject(id, p); }
      else state.projects[id] = p;
      state.activeId = id; selectedScene = null; sceneFilter = 'all'; playTime = 0;
      if (!serverClient && !await persist()) return;
      dialog.close(); go('script'); toast(t('Проект создан. Добавьте первую сцену.', 'Жоба құрылды. Алғашқы көріністі қосыңыз.'));
    } else if (form.id === 'member-form') {
      const name = data.get('name').trim(); if (!name) return;
      const sections = data.getAll('sections'); if (!sections.length) { toast(t('Выберите хотя бы один раздел.', 'Кемінде бір бөлімді таңдаңыз.')); return; }
      const keyId = serverClient ? data.get('keyId').trim() : '';
      const previous = keyId ? project().members.find(m => m.keyId === keyId) : undefined;
      if (previous) Object.assign(previous, { name, role: data.get('role'), sections });
      else project().members.push({ id: crypto.randomUUID(), name, role: data.get('role'), sections, ...(serverClient ? { keyId } : {}) });
      if (!await persist()) return;
      dialog.close(); render(); toast(serverClient ? t('Участник добавлен на сервер. Доступ открыт по его ключу.', 'Қатысушы серверге қосылды. Кілті бойынша қолжетімділік ашылды.') : t('Участник добавлен в локальный прототип.', 'Қатысушы жергілікті прототипке қосылды.'));
    } else if (form.id === 'shot-form') {
      const shot = project().shots.find(s => s.id === form.dataset.id); const duration = Number(data.get('duration'));
      if (!shot || !Number.isFinite(duration) || duration < 1 || duration > 60) return;
      shot.title[state.locale] = data.get('title').trim(); shot.description[state.locale] = data.get('description'); shot.prompt[state.locale] = data.get('prompt');
      shot.owner = data.get('owner').trim(); shot.lens = data.get('lens').trim(); shot.duration = duration; shot.status = data.get('status');
      if (shot.status === 'approved') shot.needsReview = false;
      if (!await persist()) return;
      dialog.close(); render(); toast(t('Изменения кадра сохранены.', 'Кадр өзгерістері сақталды.'));
    }
  });
});
dialog.addEventListener('close', () => { if (lastFocus?.isConnected) lastFocus.focus(); });
function render() { stopPlayback(); document.documentElement.lang = state.locale; document.title = t('neyra.vision — от истории к кадру', 'neyra.vision — оқиғадан кадрға'); app.innerHTML = route() === 'home' ? landing() : workspace(route()); app.inert = busy || connecting; if (route() === 'animatic') updatePlayer(); }
window.addEventListener('hashchange', () => { render(); const hash = location.hash; if (['#process', '#project', '#about'].includes(hash)) document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }); else window.scrollTo(0, 0); });
render();

window.addEventListener('beforeunload', event => { if (serverClient && (draftTimer || pendingWrites || storageError)) { event.preventDefault(); event.returnValue = ''; } });
if (settings.key) connectServer();
