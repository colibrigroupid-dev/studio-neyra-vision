import { makeDemo, DEFAULT_SERVER_URL } from './data.js';
import { frameAt, totalDuration } from './timeline.js';
import { StudioServer } from './storage.js';
import { ProductionMapApi, canApproveCell } from './production-map-api.js';
import { BreakdownApi, canWriteBreakdownSection } from './breakdown-api.js';
import { renderBreakdownSection, renderPassportEditor } from './breakdown.js';
import { renderProductionMap, renderProductionCell, productionObjectLabel, productionStageName } from './production-map.js';
import { parseCommand, describeCommand } from './golos.js';

const storeKey = 'neyra-vision-prototype-v1';
const fresh = () => ({ locale: 'ru', scriptLang: 'ru', activeId: 'demo', projects: { demo: makeDemo() } });
let state = fresh();
try { const saved = JSON.parse(localStorage.getItem(storeKey)); if (saved?.projects && saved.projects[saved.activeId]?.scenes && saved.projects[saved.activeId]?.shots) state = saved; } catch { /* An unreadable draft leaves the example available. */ }
if (!['ru', 'kk'].includes(state.locale)) state.locale = 'ru';
if (!['ru', 'kk'].includes(state.scriptLang)) state.scriptLang = 'ru';
for (const record of Object.values(state.projects)) record.snapshots ||= [{ version: record.version, date: new Date().toISOString(), scenes: structuredClone(record.scenes) }];
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const paperKey = 'neyra-vision-script-paper-v1';
const paperScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
let paperPreference = null;
try {
  const savedPaper = localStorage.getItem(paperKey);
  if (['light', 'graphite'].includes(savedPaper)) paperPreference = savedPaper;
} catch { /* Without a device preference, follow the system. */ }
const paperMode = () => paperPreference || (paperScheme?.matches ? 'graphite' : 'light');
function applyPaperMode() {
  document.documentElement.dataset.scriptPaper = paperMode();
  document.querySelectorAll('[data-paper-mode]').forEach(control => { control.value = paperMode(); });
  document.querySelectorAll('.production-map, .map-dialog').forEach(surface => { surface.dataset.mapMode = paperMode(); });
  document.querySelectorAll('.cinema-section, .passport-dialog').forEach(surface => { surface.dataset.cinemaMode = paperMode(); });
  document.querySelectorAll('[data-cinema-mode]').forEach(control => { control.value = paperMode(); });
  const mapControl = document.querySelector('#production-map-mode');
  if (mapControl) mapControl.value = paperMode();
}
paperScheme?.addEventListener?.('change', () => { if (!paperPreference) applyPaperMode(); });
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
let settings = { url: DEFAULT_SERVER_URL, key: '' };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(settingsKey)) }; } catch { /* Device settings are optional. */ }
// Ключ из ссылки (пробный вход с главной, ссылка из письма): сохраняем на устройстве и убираем из адреса.
try {
  const fromLink = /(?:^|[?&])klyuch=([^&]+)/.exec(String(location.search || ''));
  if (fromLink) {
    settings = { url: settings.url || DEFAULT_SERVER_URL, key: decodeURIComponent(fromLink[1]) };
    try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* Device storage is optional. */ }
    if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', location.pathname + (location.hash || '#/studio/overview'));
  }
} catch { /* A broken link must not break the window. */ }
let localWorkspace = state;
let serverClient = null;
let connecting = false;
let storageError = '';
let pendingWrites = 0;
let writeQueue = Promise.resolve();
let draftTimer;
let draftProjectId;
let busy = false;
// The production snapshot is transient: never save task rights or approvals to
// the browser workspace, and discard late reads from another project/key.
let mapState = { client: null, slug: '', snapshot: null, loading: false, ready: false, error: '', token: 0 };
let mapFilter = 'all';
let mapCard = null;
const cinemaPages = ['breakdown', 'heroes', 'locations'];
let cinemaState = { client: null, slug: '', snapshot: null, loading: false, ready: false, error: '', token: 0 };
let passportCard = null;
let importCard = null;
const storageLabel = () => connecting ? t('подключение к серверу…', 'серверге қосылу…') : serverClient ? storageError ? t('ошибка сохранения', 'сақтау қатесі') : pendingWrites || draftTimer || busy ? t('сохраняется на сервере…', 'серверде сақталуда…') : t('всё сохранено', 'серверде сақталды') : t('только в этом браузере', 'тек осы браузерде');
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
    storageError = `${t('Не получилось подключиться:', 'Қосылу мүмкін болмады:')} ${error.message}`;
    if (serverClient) useLocal(true);
    toast(storageError);
  } finally { connecting = false; render(); }
}
const svgPaths = { map: 'M2 4h16v12H2zM2 8h16M2 12h16M7 4v12M13 4v12', breakdown: 'M3 3h14v14H3zM3 8h14M8 8v9', heroes: 'M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 17a5 5 0 0 1 10 0M14 10a2.5 2.5 0 1 0 0-5M18 17a4 4 0 0 0-5-3.9', locations: 'M10 18s-5-5.2-5-9a5 5 0 0 1 10 0c0 3.8-5 9-5 9zM10 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', globe: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM2 10h16M10 2c3 3 3 13 0 16M10 2c-3 3-3 13 0 16', arrow: 'M4 10h12M11 4l6 6-6 6', plus: 'M10 3v14M3 10h14', close: 'M4 4l12 12M16 4L4 16', check: 'M3 10l5 5L17 5', overview: 'M3 3h6v6H3zM12 3h5v6h-5zM3 12h6v5H3zM12 12h5v5h-5z', script: 'M5 2h8l3 3v13H5zM8 8h5M8 11h5M8 14h3', storyboard: 'M2 4h16v12H2zM7 4v12M13 4v12', animatic: 'M7 4l9 6-9 6z', shots: 'M2 5h16v12H2zM2 5l3-3h13v3M5 2l3 3M10 2l3 3', team: 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 18v-2a5 5 0 0 1 10 0v2M13 5a3 3 0 0 1 0 6M16 18v-2a5 5 0 0 0-2-4', post: 'M3 5h14M3 10h14M3 15h14M7 2v6M13 7v6M8 12v6', download: 'M10 2v10M6 8l4 4 4-4M3 14v4h14v-4', save: 'M3 3h12l2 2v12H3zM6 3v5h7V3M6 17v-6h8v6', back: 'M16 10H4M9 4l-6 6 6 6', pause: 'M6 4v12M14 4v12', upload: 'M10 13V3M6 7l4-4 4 4M3 13v4h14v-4' };
const icon = name => `<svg class='icon' viewBox='0 0 20 20' aria-hidden='true'><path d='${svgPaths[name] || svgPaths.arrow}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
const btn = (label, action, primary = false, ico = '') => `<button class='btn ${primary ? 'primary' : ''}' data-action='${action}'>${e(label)}${ico ? icon(ico) : ''}</button>`;
const brand = () => `<a class='brand' href='#/' aria-label='Neyra Vision Studio' title='Neyra Vision Studio'><img src='../assets/znak-nv.png' alt='' width='32' height='32'></a>`;
const langs = () => `<div class='langs' aria-label='${t('Язык интерфейса', 'Интерфейс тілі')}'><button data-lang='ru' class='${state.locale === 'ru' ? 'active' : ''}' aria-pressed='${state.locale === 'ru'}'>Рус</button><button data-lang='kk' class='${state.locale === 'kk' ? 'active' : ''}' aria-pressed='${state.locale === 'kk'}'>Қаз</button></div>`;
const statusName = status => ({ draft: t('Черновик', 'Жұмыс нұсқасы'), review: t('На согласовании', 'Келісілуде'), approved: t('Утверждено', 'Бекітілді'), working: t('В работе', 'Орындалуда') })[status] || t('Черновик', 'Жұмыс нұсқасы');
const status = value => `<span class='badge ${e(value)}'><span class='dot'></span>${statusName(value)}</span>`;
const roles = () => ({ producer: t('Продюсер', 'Продюсер'), director: t('Режиссёр', 'Режиссер'), writer: t('Сценарист', 'Сценарист'), cinematographer: t('Оператор', 'Оператор'), artist: t('Художник', 'Суретші'), editor: t('Монтажёр', 'Монтажшы'), viewer: t('Наблюдатель', 'Бақылаушы') });
const roleName = role => roles()[role] || ({ admin: t('Администратор', 'Әкімші'), assistant_director: t('Второй режиссёр', 'Екінші режиссер') })[role] || role;
const teamSections = () => [
  ['overview', t('Обзор проекта', 'Жобаға шолу')], ['script', t('Сценарий', 'Сценарий')],
  ['breakdown', t('Разбивка', 'Сценарийді талдау')], ['heroes', t('Герои и кастинг', 'Кейіпкерлер мен кастинг')],
  ['locations', t('Локации', 'Локациялар')], ['world', t('Мир', 'Әлем')],
  ['storyboard', t('Раскадровка', 'Кадрлық жоспар')], ['shots', t('Кадры', 'Кадрлар')],
  ['continuity', t('Непрерывность', 'Үздіксіздік')], ['sound', t('Звук', 'Дыбыс')],
  ['edit', t('Монтаж и мастер', 'Монтаж және мастер')], ['plan', t('План и смета', 'Жоспар мен смета')],
  ['journal', t('Журнал', 'Журнал')], ['team', t('Команда', 'Команда')]
].map(([id, title]) => ({ id, title }));
const sectionName = id => teamSections().find(section => section.id === id)?.title || stages().find(section => section.id === id)?.title || id;
const defaultSections = role => ['producer', 'admin'].includes(role) ? teamSections().map(section => section.id)
  : role === 'director' ? teamSections().filter(section => section.id !== 'plan').map(section => section.id)
    : role === 'viewer' ? teamSections().filter(section => section.id !== 'plan').map(section => section.id)
      : ['overview', ...({ writer: ['script', 'breakdown'], cinematographer: ['storyboard', 'shots'], artist: ['heroes', 'locations', 'world'], editor: ['edit', 'sound'] }[role] || [])];
// Роль задаёт набор разделов по умолчанию; открыть можно любой раздел в пределах своих прав.
const roleSections = () => [...teamSections().map(section => section.id), 'animatic', 'post'];
function grantableSections() {
  const p = project(); const principal = p?._principal;
  if (!serverClient || !principal) return [...teamSections().map(section => section.id), 'animatic', 'post'];
  const membership = p.members.find(member => member.keyId === principal.id);
  return (principal.sections || []).filter(section => principal.role === 'admin' || membership?.sections.includes(section));
}
const roleHint = role => ({
  producer: t('Видит весь проект, вехи и смету; управляет командой.', 'Бүкіл жобаны, кезеңдер мен сметаны көреді; команданы басқарады.'),
  director: t('Видит творческие разделы и статусы кадров; управляет командой. Смета отдельно.', 'Шығармашылық бөлімдер мен кадр мәртебелерін көреді; команданы басқарады. Смета бөлек.'),
  writer: t('Работает со сценарием; читает разбивку.', 'Сценариймен жұмыс істейді; талдауды оқиды.'),
  cinematographer: t('Работает с раскадровкой и кадрами.', 'Кадрлық жоспар мен кадрлармен жұмыс істейді.'),
  artist: t('Работает с героями, локациями и миром.', 'Кейіпкерлермен, локациялармен және әлеммен жұмыс істейді.'),
  editor: t('Работает с монтажом; читает раздел звука.', 'Монтажбен жұмыс істейді; дыбыс бөлімін оқиды.'),
  viewer: t('Только просмотр выбранных разделов, без изменения материалов.', 'Таңдалған бөлімдерді ғана көреді, материалдарды өзгерте алмайды.'),
  admin: t('Управляет проектом и командой.', 'Жобаны және команданы басқарады.')
})[role] || t('Доступ определяется ролью и выбранными разделами.', 'Қолжетімділік рөл мен таңдалған бөлімдерге байланысты.');
const canManageTeam = () => !serverClient || project()?._capabilities?.manageTeam === true;
const stages = () => [
  { id: 'script', title: t('Сценарий', 'Сценарий'), short: t('От идеи к истории', 'Идеядан оқиғаға'), description: t('Пишите по сценам, обсуждайте правки и фиксируйте утверждённую версию. Сценарий становится основой всех следующих этапов.', 'Көріністерді жазыңыз, түзетулерді талқылаңыз және бекітілген нұсқаны сақтаңыз. Сценарий келесі кезеңдердің негізіне айналады.'), result: t('Версия сценария · сцены · персонажи', 'Сценарий нұсқасы · көріністер · кейіпкерлер') },
  { id: 'storyboard', title: t('Раскадровка', 'Кадрлық жоспар'), short: t('История обретает форму', 'Оқиға бейнеге айналады'), description: t('Разложите сцены на кадры. Соберите действие, композицию и изображения в единую визуальную последовательность.', 'Көріністерді кадрларға бөліңіз. Әрекет, композиция мен суреттерді бірізді визуалды жоспарға біріктіріңіз.'), result: t('Кадры · изображения · визуальные решения', 'Кадрлар · суреттер · визуалды шешімдер') },
  { id: 'animatic', title: t('ИИматик', 'ЖИ-аниматик'), short: t('Почувствуйте ритм фильма', 'Фильмнің ырғағын сезініңіз'), description: t('Соберите предварительную последовательность изображений с длительностями. Оцените ритм и порядок до начала производства.', 'Суреттердің экранда қанша уақыт көрсетілетінін белгілеп, алдын ала нұсқа құрастырыңыз. Өндіріс басталмай тұрып, ырғақ пен реттілікті бағалаңыз.'), result: t('Последовательность · хронометраж · версия сборки', 'Реттілік · хронометраж · құрастырылған нұсқа') },
  { id: 'shots', title: t('Каждый кадр', 'Әр кадр'), short: t('От замысла к результату', 'Ойдан нәтижеге'), description: t('У каждого кадра своя карточка: описание, камера, промпт, исполнитель, варианты и статус согласования.', 'Әр кадрдың өз карточкасы бар: сипаттама, камера, промпт, орындаушы, нұсқалар және келісу мәртебесі.'), result: t('Карточка кадра · материалы · согласование', 'Кадр карточкасы · материалдар · келісу') },
  { id: 'team', title: t('Команда', 'Команда'), short: t('Один проект для всех', 'Бәріне ортақ бір жоба'), description: t('Режиссёр, сценарист, художник и продюсер работают в разделах одного проекта. У каждого понятная роль и зона ответственности.', 'Режиссер, сценарист, суретші мен продюсер бір жобаның бөлімдерінде жұмыс істейді. Әркімнің рөлі мен міндеті айқын.'), result: t('Участники · роли · доступ к разделам', 'Қатысушылар · рөлдер · бөлімдерге қолжетімділік') },
  { id: 'post', title: t('Постпродакшен', 'Постпродакшн'), short: t('Фильм становится целым', 'Фильм біртұтас туындыға айналады'), description: t('Планируйте монтаж, цвет, звук и VFX. Соберите работу отделов в один процесс завершения фильма.', 'Монтажды, түсті, дыбысты және VFX жұмыстарын жоспарлаңыз. Бөлімдердің жұмысын фильмді аяқтаудың ортақ үдерісіне біріктіріңіз.'), result: t('Монтаж · звук · цвет · VFX', 'Монтаж · дыбыс · түс · VFX') }
];
const navItems = () => [{ id: 'overview', title: t('Обзор проекта', 'Жобаға шолу') }, { id: 'map', title: t('Карта производства', 'Өндіріс картасы') }, ...stages().flatMap(stage => stage.id === 'script' ? [stage, ...cinemaPages.map(id => ({ id, title: ({ breakdown: t('Разбивка', 'Сценарийді талдау'), heroes: t('Герои', 'Кейіпкерлер'), locations: t('Локации', 'Локациялар') })[id] }))] : [stage])];
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4000); }
function download(name, value, type = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob(['\uFEFF', value], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function demoOpen() { if (!serverClient && state.projects.demo) state.activeId = 'demo'; go('overview'); }
function go(page) { const hash = `#/studio/${page}`; if (location.hash === hash) render(); else location.hash = hash; }
function route() { return location.hash.startsWith('#/studio/') ? location.hash.split('/')[2] || 'overview' : 'home'; }
function stopPlayback() { if (playback) clearInterval(playback); playback = null; }

function landing() {
  const steps = stages();
  return `<header class='section-shell'><div class='site-nav'>${brand()}<nav aria-label='${t('Главное меню', 'Негізгі мәзір')}'><a href='#process'>${t('Процесс', 'Үдеріс')}</a><a href='#project'>${t('Пространство проекта', 'Жоба кеңістігі')}</a><a href='#about'>${t('О платформе', 'Платформа туралы')}</a></nav><div class='nav-actions'>${langs()}${btn(t('Сервер', 'Сервер'), 'server')}${btn(t('В студию', 'Студияға'), 'demo', false, 'arrow')}</div></div></header>
  <main>${participantHint()}<section class='hero'><img class='hero-image' src='assets/hero.jpg' alt='${t('Горы Заилийского Алатау на рассвете', 'Таңғы Іле Алатауы')}' fetchpriority='high'><div class='hero-content'><div class='eyebrow'>${t('КИНОПЛАТФОРМА · КАЗАХСТАН', 'КИНО ПЛАТФОРМАСЫ · ҚАЗАҚСТАН')}</div><h1>${t('От первой строки<br>до <em>финального кадра.</em>', 'Алғашқы жолдан<br><em>соңғы кадрға дейін.</em>')}</h1><p>${t('Ваша история. Ваша команда. Одно пространство.<br>Сценарий, изображения и ИИматик — начало пути к фильму, который вы создаёте вместе.', 'Сіздің оқиғаңыз. Сіздің командаңыз. Ортақ кеңістік.<br>Сценарий, суреттер және ЖИ-аниматик — бірге түсіретін фильмге бастайтын жол.')}</p><div class='hero-buttons'>${btn(t('Создать проект', 'Жоба құру'), 'create', true, 'plus')}${btn(t('Открыть демопроект', 'Демо жобаны ашу'), 'demo', false, 'arrow')}</div><div class='hero-foot'><span class='line'></span><span>${t('СЦЕНАРИЙ → КАДР → ФИЛЬМ', 'СЦЕНАРИЙ → КАДР → ФИЛЬМ')}</span></div></div><div class='shot-label'>NEYRA.VISION / 001<br>${t('ВИЗУАЛЬНЫЙ РЕФЕРЕНС · АЛМАТЫ', 'ВИЗУАЛДЫ РЕФЕРЕНС · АЛМАТЫ')}</div></section>
  <section class='intro-strip section-shell'><h2>${t('Один проект.<br>Вся команда. Каждый кадр.', 'Бір жоба.<br>Бүкіл команда. Әр кадр.')}</h2><p>${t('Фильм не складывается из разрозненных файлов. Ему нужны общий сценарий, понятные этапы и место, где видно работу над каждой сценой. neyra.vision связывает этот процесс — от первого замысла до постпродакшена.', 'Фильм шашыраңқы файлдардан құралмайды. Оған ортақ сценарий, айқын кезеңдер және әр көріністің жұмысын бақылауға болатын кеңістік қажет. neyra.vision алғашқы ойдан постпродакшнға дейінгі үдерісті байланыстырады.')}</p></section>
  <section class='section section-shell' id='process'><div class='eyebrow'>01 / ${t('ОТ ИСТОРИИ К ФИЛЬМУ', 'ОҚИҒАДАН ФИЛЬМГЕ')}</div><div class='section-heading'><h2>${t('Двигаемся по этапам.<br>Сохраняем целое.', 'Кезең-кезеңімен алға.<br>Ортақ ойды сақтаймыз.')}</h2><p>${t('Начинаем со сценария. Каждый следующий этап опирается на принятые решения.', 'Сценарийден бастаймыз. Әр келесі кезең қабылданған шешімдерге сүйенеді.')}</p></div><div class='process-grid'>${steps.map((s, i) => `<button class='process-item ${i === processStep ? 'active' : ''}' data-step='${i}' aria-pressed='${i === processStep}'><span class='num'>0${i + 1}</span><h3>${s.title}</h3><p>${s.short}</p></button>`).join('')}</div><div class='process-detail'><div><span class='eyebrow'>${t('ЭТАП', 'КЕЗЕҢ')} 0${processStep + 1}</span><h3>${steps[processStep].title}</h3><p>${steps[processStep].description}</p></div><div class='process-result'><small>${t('ЧТО ПЕРЕХОДИТ ДАЛЬШЕ', 'КЕЛЕСІ КЕЗЕҢГЕ НЕ ӨТЕДІ')}</small><div>${steps[processStep].result}</div><a class='btn small' href='#/studio/${steps[processStep].id}'>${t('Посмотреть в прототипе', 'Прототиптен көру')}${icon('arrow')}</a></div></div></section>
  <section class='section section-shell' id='project'><div class='project-showcase'><div class='project-preview'><div class='preview-top'><span>neyra.vision / studio</span><span class='muted'>${t('ДЕМОПРОЕКТ', 'ДЕМО ЖОБА')}</span></div><div class='preview-photo'><img src='assets/hero.jpg' alt='' loading='lazy'><h3>${t('Там, где начинается свет', 'Жарық бастау алған жер')}</h3></div><div class='preview-tabs'><span>${t('Обзор', 'Шолу')}</span><span>${t('Сценарий', 'Сценарий')}</span><span>${t('Раскадровка', 'Кадрлық жоспар')}</span><span>${t('Команда', 'Команда')}</span></div></div><div class='showcase-copy'><div class='eyebrow'>02 / ${t('ПРОЕКТ В ЦЕНТРЕ', 'ОРТАҚ ЖОБА')}</div><h2>${t('У вашей истории<br>есть своё пространство.', 'Оқиғаңыздың<br>өз кеңістігі бар.')}</h2><p>${t('Страница проекта — рабочий центр фильма. Здесь встречаются творческий замысел, материалы и люди, которые превращают их в кино.', 'Жоба беті — фильмнің жұмыс орталығы. Мұнда шығармашылық ой, материалдар және оларды киноға айналдыратын адамдар тоғысады.')}</p><ul class='text-list'><li>${icon('check')}${t('Сцены и версии сценария', 'Көріністер мен сценарий нұсқалары')}</li><li>${icon('check')}${t('Отдельная карточка каждого кадра', 'Әр кадрдың жеке карточкасы')}</li><li>${icon('check')}${t('Роли, комментарии и согласования', 'Рөлдер, пікірлер және келісу')}</li></ul>${btn(t('Исследовать демопроект', 'Демо жобамен танысу'), 'demo', true, 'arrow')}</div></div></section>
  <section class='section section-shell bilingual-section' id='about'><div><div class='eyebrow'>03 / ${t('ДВА ЯЗЫКА. ОДИН ЗАМЫСЕЛ.', 'ЕКІ ТІЛ. БІР ОЙ.')}</div><h2>${t('Создано для работы<br>в Казахстане.', 'Қазақстандағы<br>жұмысқа арналған.')}</h2><p>${t('Интерфейс на русском и казахском. Язык сценария выбирается отдельно: авторский текст остаётся вашим, когда вы переключаете язык платформы.', 'Орыс және қазақ тілдеріндегі интерфейс. Сценарий тілі бөлек таңдалады: платформаның тілін ауыстырғанда авторлық мәтін өзгермейді.')}</p></div><div class='language-display'>РУС ${icon('arrow')} <span>ҚАЗ</span></div></section>
  <section class='section section-shell faq-grid'><div><div class='eyebrow'>${t('ПЕРЕД НАЧАЛОМ', 'БАСТАМАС БҰРЫН')}</div><h2>${t('Как будем работать?', 'Қалай жұмыс істейміз?')}</h2></div><div>${[
    [t('С чего начинается проект?', 'Жоба неден басталады?'), t('С названия и сценария. Вы можете открыть демопроект, создать свой и писать отдельными сценами. Первый настоящий модуль платформы — работа над сценарием.', 'Атау мен сценарийден. Демо жобаны ашып немесе өз жобаңызды құрып, көріністерді жаза аласыз. Платформаның алғашқы толық модулі — сценариймен жұмыс.')],
    [t('Что такое ИИматик?', 'ЖИ-аниматик деген не?'), t('Предварительная сборка фильма из изображений, длительностей и временного звука. В прототипе можно посмотреть последовательность визуальных референсов с заданным хронометражем.', 'Суреттерден, ұзақтықтардан және уақытша дыбыстан құрастырылған фильмнің алдын ала нұсқасы. Прототипте визуалды референстердің берілген уақыт бойынша реттілігін көре аласыз.')],
    [t('Как подключается команда?', 'Команда қалай қосылады?'), t('Продюсер или режиссёр добавляет участника в разделе «Команда», выбирает роль и разделы. Сервер выдаёт ключ один раз; его передают лично. Без сервера доступна локальная модель команды.', 'Продюсер немесе режиссер «Команда» бөлімінде қатысушыны қосып, рөл мен бөлімдерді таңдайды. Сервер кілтті бір рет береді; оны жеке тапсырады. Серверсіз команданың жергілікті үлгісі қолжетімді.')],
    [t('Что работает в этой версии?', 'Бұл нұсқада не жұмыс істейді?'), t('Переходы между экранами, RU/ҚАЗ, создание проекта, редактирование и сохранение сцен, карточки кадров, комментарии и просмотр последовательности. Без ключа данные остаются в этом браузере. В настройке «Сервер» можно подключить общую базу по ключу роли. Генерация ИИ пока не подключена.', 'Экрандар арасындағы ауысу, РУС/ҚАЗ, жоба құру, көріністерді өңдеу мен сақтау, кадр карточкалары, пікірлер және реттілікті көру. Кілтсіз деректер осы браузерде сақталады. «Сервер» параметрінде рөл кілті арқылы ортақ базаға қосылуға болады. ЖИ генерациясы әлі қосылмаған.')]
  ].map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div></section><section class='section-shell closing'><div class='eyebrow'>NEYRA.VISION / STUDIO</div><h2>${t('Начнём с вашей истории.', 'Сіздің оқиғаңыздан бастайық.')}</h2>${btn(t('Создать проект', 'Жоба құру'), 'create', true, 'arrow')}</section></main><footer class='section-shell'><div class='footer'>${brand()}<small>${t('КЛИКАБЕЛЬНЫЙ ПРОТОТИП · РУССКИЙ / КАЗАХСКИЙ', 'ИНТЕРАКТИВТІ ПРОТОТИП · ОРЫСША / ҚАЗАҚША')}</small><small>studio.neyra.vision</small></div></footer>`;
}

function pageHeading(title, description, actions = '') { return `<div class='page-heading'><div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div><div class='row'>${actions}</div></div>`; }
const simpleOverview = () => /(?:^|[?&])prostoy=1(?:&|$)/.test(String(location.search || ''));
function overview() {
  const p = project();
  if (simpleOverview()) return `<div class='simple-head'><h1>${t('Что снимаем сегодня?', 'Бүгін не түсіреміз?')}</h1><p class='lead'>${t('Скажите помощнику внизу или откройте раздел слева. Всё, что ждёт вашего решения, — здесь.', 'Төмендегі көмекшіге айтыңыз немесе сол жақтан бөлімді ашыңыз. Шешіміңізді күткеннің бәрі — осында.')}</p></div>${awaitingSheet()}`;
  return `${awaitingSheet()}${pageHeading(t('Обзор проекта', 'Жобаға шолу'), t('Где мы, что ждёт решения, кто чем занят.', 'Оқиғаңыз бен команданың жұмысы — бір кеңістікте.'), btn(t('К сценарию', 'Сценарийге'), 'script', true, 'arrow'))}<div class='project-hero'><img src='assets/hero.jpg' alt='${t('Визуальный референс проекта', 'Жобаның визуалды референсі')}'><div class='project-hero-copy'><div class='row wrap'>${status(p.scriptStatus)}<span class='badge'>${t('Визуальный референс', 'Визуалды референс')}</span></div><h2>${e(local(p.title))}</h2></div></div><div class='stat-row'><div class='stat'><strong>${p.scenes.length}</strong><small>${t('Сцен в сценарии', 'Сценарийдегі көріністер')}</small></div><div class='stat'><strong>${p.shots.length}</strong><small>${t('Кадров в проекте', 'Жобадағы кадрлар')}</small></div><div class='stat'><strong>${p.members.length}</strong><small>${t('Участников команды', 'Командадағы қатысушылар')}</small></div><div class='stat'><strong>${String(totalDuration(p.shots)).padStart(2, '0')} <small>${t('сек', 'сек')}</small></strong><small>${t('Хронометраж ИИматика', 'ЖИ-аниматик хронометражы')}</small></div></div><div class='two-cols'><section class='panel'><h2>${t('Путь проекта', 'Жобаның кезеңдері')}</h2><ol class='stage-list'>${stages().map((s, i) => `<li><a href='#/studio/${s.id}'><span><span class='num'>0${i + 1}</span>${s.title}</span>${i === 0 ? status(p.scriptStatus) : icon('arrow')}</a></li>`).join('')}</ol></section><div><section class='panel'><h2>${t('История', 'Оқиға')}</h2><p>${e(local(p.synopsis) || t('Добавьте историю через сценарий.', 'Оқиғаны сценарий арқылы жазыңыз.'))}</p><div class='scene-minis'>${p.scenes.slice(0, 3).map((s, i) => `<a class='scene-mini' href='#/studio/script' data-scene='${e(s.id)}'><span class='mono'>0${i + 1}</span>${e(s.title[state.scriptLang])}</a>`).join('')}</div></section><section class='panel' style='margin-top:24px'><div class='row between'><h2>${t('Команда', 'Команда')}</h2><a href='#/studio/team' aria-label='${t('Открыть команду', 'Команданы ашу')}'>${icon('arrow')}</a></div><div class='avatars'>${p.members.map(m => `<span class='avatar' title='${e(m.name)}'>${e(m.name.slice(0, 1))}</span>`).join('')}</div><p>${t('Творческий процесс начинается с общего замысла.', 'Шығармашылық үдеріс ортақ ойдан басталады.')}</p></section></div></div>`;
}
function scriptPage() {
  const p = project();
  const scene = p.scenes.find(s => s.id === selectedScene) || p.scenes[0];
  if (scene) selectedScene = scene.id;
  const editorFrame = serverClient ? `<div class='editor-frame-wrap'><iframe class='editor-frame' src='../scenariy/?project=${e(state.activeId)}&embed=1' title='${t('Редактор NEYRA', 'NEYRA редакторы')}' loading='lazy'></iframe></div>` : '';
  return `${pageHeading(t('Сценарий', 'Сценарий'), `${t('Версия', 'Нұсқа')} ${p.version} · ${t('От текста — к сценам и кадрам.', 'Мәтіннен — көріністер мен кадрларға.')}`, status(p.scriptStatus) + (serverClient ? `<a class='btn' href='../scenariy/?project=${e(state.activeId)}' target='_blank' rel='noopener'>${t('Редактор NEYRA ↗', 'NEYRA редакторы ↗')}</a>` : ''))}${editorFrame}${serverClient ? `<details class='server-draft'><summary>${t('Черновик целиком', 'Толық жұмыс нұсқасы')} · ${e(p._language)}</summary><label for='draft-text'>${t('Авторский текст', 'Автор мәтіні')}</label><textarea id='draft-text' rows='10'>${e(p._scriptText)}</textarea><p>${t('Редактирование сцены обновит этот черновик. Правка целого текста не разбивает его на сцены.', 'Көріністі өңдеу осы жұмыс нұсқасын жаңартады. Толық мәтінді өңдеу оны көріністерге бөлмейді.')}</p></details>` : ''}<div class='editor-toolbar'><label for='script-language'>${t('Язык сценария', 'Сценарий тілі')}</label><select id='script-language'><option value='ru' ${state.scriptLang === 'ru' ? 'selected' : ''}>Русский</option><option value='kk' ${state.scriptLang === 'kk' ? 'selected' : ''}>Қазақша</option></select><div class='paper-control'><label for='script-paper-mode'>${t('Бумага:', 'Қағаз:')}</label><select id='script-paper-mode' data-paper-mode><option value='light' ${paperMode() === 'light' ? 'selected' : ''}>${t('светлая', 'ашық')}</option><option value='graphite' ${paperMode() === 'graphite' ? 'selected' : ''}>${t('графит', 'графит')}</option></select></div><button class='btn small' data-action='import'>${icon('upload')}${t('Импорт TXT', 'TXT импорттау')}</button><input id='import-file' type='file' accept='.txt,.fountain,text/plain' hidden><button class='btn small' data-action='download'>${icon('download')}${t('Скачать сценарий', 'Сценарийді жүктеп алу')}</button>${serverClient ? btn(t('Сохранить версию', 'Нұсқаны сақтау'), 'save-script', false, 'save') : ''}<button class='btn small' data-action='versions'>${t('Версии', 'Нұсқалар')} / ${p.snapshots.length}</button></div><div class='script-layout'><aside class='scene-list' aria-label='${t('Сцены', 'Көріністер')}'><h2>${t('СЦЕНЫ', 'КӨРІНІСТЕР')} / ${p.scenes.length}</h2>${p.scenes.map((s, i) => `<button class='scene-option ${s.id === selectedScene ? 'active' : ''}' data-select-scene='${e(s.id)}'><span class='mono'>${String(i + 1).padStart(2, '0')}</span><span>${e(s.title[state.scriptLang] || t('Новая сцена', 'Жаңа көрініс'))}</span></button>`).join('')}<button class='btn small' data-action='add-scene'>${icon('plus')}${t('Добавить сцену', 'Көрініс қосу')}</button></aside><div>${scene ? `<section class='script-paper'><div class='paper-head'><span>NEYRA.VISION / ${e(local(p.title))}</span><span>${String(p.scenes.indexOf(scene) + 1).padStart(2, '0')}</span></div><label for='scene-title'>${t('ЗАГОЛОВОК СЦЕНЫ', 'КӨРІНІС ТАҚЫРЫБЫ')}</label><input id='scene-title' value='${e(scene.title[state.scriptLang])}'><label for='scene-text'>${t('ДЕЙСТВИЕ И ДИАЛОГ', 'ӘРЕКЕТ ПЕН ДИАЛОГ')}</label><textarea id='scene-text' spellcheck='false'>${e(scene.text[state.scriptLang])}</textarea></section><div class='editor-foot'><button class='btn small' data-action='save-script'>${icon('save')}${t('Сохранить версию', 'Нұсқаны сақтау')}</button><div class='row wrap'>${p.scriptStatus === 'review' ? btn(t('Утвердить версию', 'Нұсқаны бекіту'), 'approve-script', true, 'check') : btn(t('Отправить на согласование', 'Келісуге жіберу'), 'review-script', true, 'arrow')}</div></div><div class='editor-note'>${t('Место сохранения указано в шапке. Язык интерфейса и язык сценария независимы. Изменение утверждённого текста вернёт сценарий в черновик.', 'Сақтау орны жоғарғы бөлікте көрсетілген. Интерфейс пен сценарий тілдері бөлек. Бекітілген мәтінді өзгерткенде сценарий жұмыс нұсқасына қайтады.')}</div>` : `<div class='empty'>${icon('script')}<h2>${t('Первая сцена — начало истории.', 'Алғашқы көрініс — оқиғаның бастауы.')}</h2><p>${t('Добавьте сцену и начните писать.', 'Көрініс қосып, жазуды бастаңыз.')}</p>${btn(t('Добавить сцену', 'Көрініс қосу'), 'add-scene', true, 'plus')}</div>`}</div></div>`;
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
function teamPage() {
  const p = project();
  const manage = canManageTeam();
  const accessName = member => !serverClient ? t('Локальная запись', 'Жергілікті жазба')
    : member.accessStatus === 'active' ? t('Доступ активен', 'Қолжетімділік белсенді')
      : member.accessStatus === 'revoked' ? t('Доступ отозван', 'Қолжетімділік қайтарылды')
        : t('Ключ не выпущен', 'Кілт берілмеген');
  return `<section class='team-space'>${pageHeading(t('Команда проекта', 'Жоба командасы'), t('Участники, роли и разделы рабочего пространства.', 'Жұмыс кеңістігінің қатысушылары, рөлдері және бөлімдері.'), manage ? btn(t('Добавить участника', 'Қатысушы қосу'), 'member', true, 'plus') : '')}
    ${p.members.length ? `<div class='team-members'>${p.members.map(member => `<article class='team-member'>
      <div class='member-info'><span class='avatar' aria-hidden='true'>${e(String(member.name || '').slice(0, 1))}</span><div><h2>${e(member.name)}</h2><p class='member-email'>${e(member.email || t('E-mail не указан', 'E-mail көрсетілмеген'))}</p></div></div>
      <dl class='member-access'><div><dt>${t('Роль', 'Рөлі')}</dt><dd>${e(roleName(member.role))}</dd></div><div><dt>${t('Статус доступа', 'Қолжетімділік мәртебесі')}</dt><dd>${e(accessName(member))}</dd></div><div class='member-sections'><dt>${t('Разделы', 'Бөлімдер')}</dt><dd>${(member.sections || []).map(id => `<span class='badge'>${e(sectionName(id))}</span>`).join('') || t('Разделы не выбраны', 'Бөлімдер таңдалмаған')}</dd></div></dl>
      ${manage && member.accessStatus !== 'revoked' ? `<div class='member-actions'><button class='btn' data-edit-member='${e(member.id)}'>${t('Изменить права', 'Құқықтарды өзгерту')}</button>${serverClient && member.keyId && !(member.keySource === 'external' && member.role === 'admin') ? `<button class='btn' data-revoke-member='${e(member.id)}'>${t('Отозвать доступ', 'Қолжетімділікті қайтару')}</button>` : ''}</div>` : ''}
    </article>`).join('')}</div>` : `<div class='empty'><h2>${t('В команде пока нет участников', 'Командада әзірге қатысушылар жоқ')}</h2><p>${manage ? t('Добавьте человека и выберите его роль и разделы.', 'Қатысушыны қосып, оның рөлі мен бөлімдерін таңдаңыз.') : t('Руководитель проекта добавит участников.', 'Жоба жетекшісі қатысушыларды қосады.')}</p></div>`}
    <p class='access-note'>${serverClient ? manage ? t('Ключ участника показывается один раз при добавлении. E-mail сохраняется для будущих приглашений.', 'Қатысушының кілті қосылған кезде бір рет көрсетіледі. E-mail кейінгі шақырулар үшін сақталады.') : t('Доступен просмотр команды. Продюсер или режиссёр управляет участниками и правами.', 'Команданы көре аласыз. Қатысушылар мен құқықтарды продюсер немесе режиссер басқарады.') : t('Локальная модель команды. Добавление участника не открывает доступ другому человеку. Для выдачи ключей подключите сервер.', 'Команданың жергілікті үлгісі. Қатысушыны қосу басқа адамға қолжетімділік бермейді. Кілт беру үшін серверге қосылыңыз.')}</p>
  </section>`;
}
const postInfo = () => ({ edit: [t('Монтаж', 'Монтаж'), t('Собрать утверждённые планы в последовательность фильма.', 'Бекітілген кадрларды фильмнің ретімен монтаждау.')], color: [t('Цвет', 'Түс'), t('Согласовать общий визуальный характер и цвет кадров.', 'Кадрлардың ортақ визуалды сипаты мен түсін келісу.')], sound: [t('Звук', 'Дыбыс'), t('Подготовить диалоги, атмосферу, музыку и финальный микс.', 'Диалогтарды, атмосфераны, музыканы және соңғы миксті дайындау.')], vfx: [t('VFX и графика', 'VFX және графика'), t('Проверить эффекты, титры и финальные правки.', 'Эффектілерді, титрлерді және соңғы түзетулерді тексеру.')] });
function postPage() { const p = project(); if (!p.post.length) p.post = ['edit', 'color', 'sound', 'vfx'].map(id => ({ id, done: false })); return `${pageHeading(t('План постпродакшена', 'Постпродакшн жоспары'), t('Список работ для завершения фильма.', 'Фильмді аяқтауға арналған жұмыстар тізімі.'), `<span class='badge'>${p.post.filter(v => v.done).length} / ${p.post.length}</span>`)}<div class='post-list'>${p.post.map(task => `<div class='post-task ${task.done ? 'completed' : ''}'><input id='post-${task.id}' data-post='${task.id}' type='checkbox' ${task.done ? 'checked' : ''}><label for='post-${task.id}'><h2>${postInfo()[task.id][0]}</h2><p>${postInfo()[task.id][1]}</p></label>${status(task.done ? 'approved' : 'draft')}</div>`).join('')}</div><div class='access-note'>${t('В этом разделе планируем работу. Монтажные инструменты, звук, цветокоррекция и экспорт мастер-файла пока не подключены.', 'Бұл бөлімде жұмысты жоспарлаймыз. Монтаж құралдары, дыбыс, түс түзету және мастер-файл экспорты әлі қосылмаған.')}</div>`; }
function ensureMapState() {
  if (mapState.client !== serverClient || mapState.slug !== state.activeId) {
    mapState = { client: serverClient, slug: state.activeId, snapshot: null, loading: false, ready: false, error: '', token: mapState.token + 1 };
    mapFilter = 'all'; mapCard = null;
  }
}
function awaitingSheet() {
  if (!serverClient || !project()) return '';
  ensureMapState();
  const map = mapState.snapshot?.map;
  const head = `<div class='group'><header><h2>${t('Ждёт меня', 'Мені күтеді')}</h2><span class='label'>${map ? `${map.awaitingMe.length} ${t('решений', 'шешім')}` : (mapState.error ? t('карта не загрузилась', 'карта жүктелмеді') : t('загружаю…', 'жүктелуде…'))}</span></header>`;
  if (!map) return `${head}</div>`;
  if (!map.awaitingMe.length) return `${head}<div class='sheet'><div class='row'><div class='t'>${t('Решений не ждёт. Всё, что сдали, вы уже разобрали.', 'Шешім күтпейді. Тапсырылғанның бәрін қарадыңыз.')}</div><div class='d'>${t('Новые появятся здесь, когда исполнители сдадут версии.', 'Орындаушылар нұсқа тапсырғанда жаңалары осында шығады.')}</div></div></div></div>`;
  const rows = map.awaitingMe.slice(0, 6).map(cell => `<a class='row action' href='#/studio/map' data-open-cell='${e(cell.id)}'><div class='t'>${e(productionObjectLabel(cell.object, project(), state.locale))} · ${e(productionStageName(cell.stage, state.locale))}</div><div class='d'>${cell.version ? `${t('версия', 'нұсқа')} ${e(cell.version)}` : ''}${cell.assignee?.name ? ` · ${e(cell.assignee.name)}` : ''}${cell.comment ? ` · ${e(cell.comment)}` : ''}</div><div class='c'><span class='badge awaiting'><span class='dot'></span>${t('ждёт решения', 'шешім күтеді')}</span></div></a>`).join('');
  return `${head}<div class='sheet'>${rows}${map.awaitingMe.length > 6 ? `<a class='row action' href='#/studio/map'><div class='t'>${t('Все на карте', 'Бәрі картада')} · ${map.awaitingMe.length}</div></a>` : ''}</div></div>`;
}
function productionMapPage() {
  ensureMapState();
  return renderProductionMap({
    map: mapState.snapshot?.map || null, project: project(), locale: state.locale, filter: mapFilter,
    activity: mapState.snapshot?.activity || [], approvals: mapState.snapshot?.approvals || [],
    loading: mapState.loading || Boolean(serverClient && !mapState.ready && !mapState.error), error: mapState.error, mode: paperMode()
  });
}
function mapErrorMessage(error) {
  if (error.status === 0) return t('Сервер недоступен. Обновите карту, когда связь появится.', 'Сервер қолжетімсіз. Байланыс қалпына келгенде картаны жаңартыңыз.');
  if (error.status === 401 || error.status === 403) return t('Сюда вам пока нельзя. Спросите у продюсера про права.', 'Қолжетімділік жоқ. Кілт пен құқықтарды жоба жетекшісінен тексеріңіз.');
  if (error.status === 409) return t('Проект изменился. Обновите карту и проверьте текущую версию.', 'Жоба өзгерді. Картаны жаңартып, ағымдағы нұсқаны тексеріңіз.');
  return `${t('Не удалось загрузить карту:', 'Картаны жүктеу мүмкін болмады:')} ${error.message || ''}`;
}
async function refreshProductionMap() {
  const client = serverClient, slug = state.activeId;
  if (!client || !project()) return false;
  const token = ++mapState.token;
  const current = () => client === serverClient && slug === state.activeId && token === mapState.token;
  mapState.loading = true; mapState.ready = false; mapState.error = ''; mapCard = null;
  render();
  try {
    if (!await flushDraft()) {
      if (current()) { mapState.snapshot = null; mapState.error = t('Сначала сохраните сценарий, потом откроем карту.', 'Алдымен ағымдағы сценарийді сақтаңыз. Карта жаңартылған жоқ.'); }
      return false;
    }
    if (!current()) return false;
    const api = new ProductionMapApi(client);
    // Titles and current participant rights must describe the same revision as
    // the map. Reload the ordinary workspace only when it has fallen behind.
    let snapshot, record;
    let isolatedClient = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      snapshot = await api.load(slug);
      if (!current()) return false;
      record = state.projects[slug];
      if (record?._revision !== snapshot.revision) {
        // A late background read must not overwrite the active client's save
        // baseline after navigation or an author's new edit.
        isolatedClient = new StudioServer({ url: client.url, key: client.key, fetchImpl: client.fetchImpl });
        record = await isolatedClient.loadProject(slug);
        if (!current()) return false;
      }
      if (record?._revision === snapshot.revision) break;
      if (attempt === 2) throw Object.assign(new Error('REVISION_CONFLICT'), { status: 409 });
    }
    if (!current()) return false;
    if (isolatedClient) client.known.set(slug, structuredClone(record));
    state.projects[slug] = record;
    mapState.snapshot = snapshot; mapState.ready = true;
    return true;
  } catch (error) {
    if (client === serverClient && slug === state.activeId && token === mapState.token) {
      mapState.snapshot = null; mapState.error = mapErrorMessage(error);
    }
    return false;
  } finally {
    if (client === serverClient && slug === state.activeId && token === mapState.token) {
      mapState.loading = false;
      if (route() === 'map' || route() === 'overview') render();
    }
  }
}
function showMapCardError(message, disable = false) {
  const error = dialog.querySelector('[data-map-error]');
  if (error) { error.textContent = message; error.hidden = false; }
  if (disable) dialog.querySelectorAll('#map-approval-form button[type="submit"]').forEach(button => { button.disabled = true; });
  toast(message);
}
async function mapCellDialog(id) {
  if (!serverClient || !project()) return;
  const client = serverClient, slug = state.activeId;
  if (!await flushDraft() || !await refreshProductionMap()) {
    if (dialog.classList.contains?.('map-dialog')) showMapCardError(mapState.error || t('Не удалось сохранить сценарий.', 'Сценарийді сақтау мүмкін болмады.'), true);
    return;
  }
  try {
    const snapshot = mapState.snapshot;
    const token = mapState.token;
    const cell = await new ProductionMapApi(client).cell(slug, id, snapshot.revision);
    if (client !== serverClient || slug !== state.activeId || route() !== 'map' || token !== mapState.token || snapshot !== mapState.snapshot) return;
    mapCard = { client, slug, cell: structuredClone(cell), revision: snapshot.revision, token: mapState.token };
    openDialog(`${dialogHead(e(productionObjectLabel(cell.object, project(), state.locale)), e(productionStageName(cell.stage, state.locale)))}${renderProductionCell({ cell, map: snapshot.map, project: project(), locale: state.locale, approvals: snapshot.approvals, canApprove: canApproveCell(cell, snapshot.map, project()) })}`);
    dialog.classList.add('map-dialog'); dialog.dataset.mapMode = paperMode();
  } catch (error) {
    mapCard = null;
    const message = mapErrorMessage(error);
    if (dialog.classList.contains?.('map-dialog')) showMapCardError(message, true);
    else toast(message);
  }
}
async function submitMapApproval(form, data, verdict) {
  const card = mapCard;
  if (!card || card.client !== serverClient || card.slug !== state.activeId || card.token !== mapState.token || form.dataset.cellId !== card.cell.id || !canApproveCell(card.cell, mapState.snapshot?.map, project())) {
    showMapCardError(t('Обновите карточку и проверьте права и версию.', 'Карточканы жаңартып, құқықтар мен нұсқаны тексеріңіз.'), true); return;
  }
  if (!['approved', 'returned'].includes(verdict)) return;
  const comment = String(data.get('comment') || '');
  if (verdict === 'returned' && !comment.trim()) {
    showMapCardError(t('Укажите, что нужно доработать.', 'Нені түзету керек екенін жазыңыз.'));
    dialog.querySelector('#map-approval-comment')?.focus(); return;
  }
  try {
    const result = await new ProductionMapApi(card.client).approve(card.slug, card.cell, verdict, comment, card.revision);
    // Only a baseline matching the submitted whole-project revision can be
    // advanced directly: the verdict changes no author material.
    const known = card.client.known.get(card.slug);
    if (known?._revision === card.revision && Number.isSafeInteger(result.revision)) known._revision = result.revision;
    if (project()?._revision === card.revision && Number.isSafeInteger(result.revision)) project()._revision = result.revision;
    mapCard = null; dialog.close();
    await refreshProductionMap();
    toast(verdict === 'approved' ? t('Версия принята.', 'Нұсқа қабылданды.') : t('Версия возвращена на доработку.', 'Нұсқа түзетуге қайтарылды.'));
  } catch (error) {
    // A failed POST can have reached storage before a network break. Require an
    // explicit read/review before any further verdict; never retry this POST.
    mapCard = null;
    const reason = error.code === 'DEPENDENCY_CONFLICT'
      ? t('Этап заблокирован: сначала примите предыдущие этапы.', 'Кезең бұғатталған: алдымен алдыңғы кезеңдерді қабылдаңыз.')
      : [401, 403].includes(error.status) ? t('Для этого решения нет доступа.', 'Бұл шешімге қолжетімділік жоқ.')
        : error.status === 409 ? t('Версия или права изменились.', 'Нұсқа немесе құқықтар өзгерді.')
          : error.status === 0 ? t('Сервер не подтвердил вердикт.', 'Сервер шешімді растаған жоқ.')
            : t('Вердикт не сохранён.', 'Шешім сақталмады.');
    showMapCardError(`${reason} ${t('Обновите карточку перед новым решением.', 'Жаңа шешім алдында карточканы жаңартыңыз.')}`, true);
  }
}
function cinemaPage(section) {
  if (cinemaState.client !== serverClient || cinemaState.slug !== state.activeId) {
    cinemaState = { client: serverClient, slug: state.activeId, snapshot: null, loading: false, ready: false, error: '', token: cinemaState.token + 1 };
    passportCard = null; importCard = null;
  }
  const ready = Boolean(serverClient && cinemaState.ready && !cinemaState.loading && !cinemaState.error);
  return renderBreakdownSection({ section, snapshot: cinemaState.snapshot, locale: state.locale, mode: paperMode(),
    connected: Boolean(serverClient), loading: cinemaState.loading || Boolean(serverClient && !cinemaState.ready && !cinemaState.error), error: cinemaState.error,
    canImport: ready && canWriteBreakdownSection(project(), 'breakdown'),
    canEdit: ready && canWriteBreakdownSection(project(), section) });
}
function cinemaError(error) {
  if ([401, 403].includes(error.status)) return t('Сюда вам пока нельзя. Спросите у продюсера про права.', 'Қолжетімділік жоқ. Кілт пен құқықтарды жоба жетекшісінен тексеріңіз.');
  if (error.status === 409) return t('Коллега только что внёс правку. Обновите раздел и продолжайте.', 'Жоба өзгерді. Жаңа түзету алдында бөлімді жаңартыңыз.');
  if (error.status === 404) return t('Этот раздел появится после обновления сервера. Администратор уже знает.', 'Серверде талдау бөлімі әлі жоқ: сервер ескі нұсқада. Әкімшіге — tools/server-deploy.sh іске қосу.');
  if (error.status === 0) return t('Связь прервалась на полпути. Обновите раздел и повторите.', 'Сервер нәтижені растаған жоқ. Әрекетті қайталамас бұрын бөлімді жаңартыңыз.');
  return error.message || t('Раздел не загрузился. Попробуйте обновить.', 'Бөлімді жүктеу мүмкін болмады.');
}
async function refreshCinema() {
  const client = serverClient, slug = state.activeId;
  if (!client || !project() || !cinemaPages.includes(route())) return false;
  cinemaState.client = client; cinemaState.slug = slug;
  const token = ++cinemaState.token;
  const current = () => client === serverClient && slug === state.activeId && token === cinemaState.token && cinemaPages.includes(route());
  cinemaState.loading = true; cinemaState.ready = false; cinemaState.error = ''; passportCard = null; importCard = null;
  render();
  try {
    if (!await flushDraft()) throw new Error(t('Сначала сохраните текущий сценарий.', 'Алдымен ағымдағы сценарийді сақтаңыз.'));
    if (!current()) return false;
    let snapshot, record, isolated;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      snapshot = await new BreakdownApi(client).load(slug);
      if (!current()) return false;
      record = state.projects[slug];
      if (record?._revision !== snapshot.revision || !client.known.has(slug)
          || snapshot.principal && JSON.stringify(record?._principal) !== JSON.stringify(snapshot.principal)) {
        isolated = new StudioServer({ url: client.url, key: client.key, fetchImpl: client.fetchImpl });
        record = await isolated.loadProject(slug);
        if (!current()) return false;
      }
      if (record?._revision === snapshot.revision) break;
      if (attempt === 2) throw Object.assign(new Error('REVISION_CONFLICT'), { status: 409 });
    }
    if (!current()) return false;
    if (isolated) client.known.set(slug, structuredClone(record));
    state.projects[slug] = record;
    cinemaState.snapshot = snapshot; cinemaState.ready = true;
    return true;
  } catch (error) {
    if (current()) { cinemaState.snapshot = null; cinemaState.error = cinemaError(error); }
    return false;
  } finally {
    if (current()) { cinemaState.loading = false; render(); }
  }
}
function showPassportError(message, disable = false) {
  const node = dialog.querySelector('[data-passport-error]');
  if (node) { node.textContent = message; node.hidden = false; }
  if (disable) dialog.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = true; });
  toast(message);
}
async function passportDialog(collection, id) {
  const section = collection === 'characters' ? 'heroes' : collection === 'locations' ? 'locations' : '';
  if (!serverClient || !section || route() !== section || !canWriteBreakdownSection(project(), section)) return;
  if (!await refreshCinema() || !canWriteBreakdownSection(project(), section) || route() !== section) return;
  const record = cinemaState.snapshot?.[collection]?.find(item => item.id === id);
  if (!record) return;
  openDialog(`${dialogHead(t('Паспорт', 'Паспорт'))}${renderPassportEditor({ record, collection, locale: state.locale })}`);
  dialog.classList.add('passport-dialog'); dialog.dataset.cinemaMode = paperMode();
  passportCard = { client: serverClient, slug: state.activeId, section, collection, record: structuredClone(record), revision: cinemaState.snapshot.revision, token: cinemaState.token };
}
function passportPatch(record, data) {
  const sceneValues = String(data.get('scenes') || '').trim().split(/[,;\s]+/).filter(Boolean);
  if (sceneValues.some(value => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 1000000)) {
    throw new Error(t('Укажите номера сцен целыми числами через запятую.', 'Көрініс нөмірлерін үтір арқылы бүтін сандармен жазыңыз.'));
  }
  const taboo = String(data.get('taboo') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (taboo.length > 10 || taboo.some(value => value.length > 500)) throw new Error(t('Допустимо до 10 табу-деталей, каждая до 500 символов.', 'Әрқайсысы 500 таңбадан аспайтын 10 тыйым салынған бөлшекке дейін рұқсат етіледі.'));
  const next = { name: String(data.get('name') || '').trim(), role: String(data.get('role') || ''), identity: String(data.get('identity') || ''),
    taboo, height: String(data.get('height') || ''), status: data.get('status'), scenes: [...new Set(sceneValues.map(Number))] };
  if (!next.name || !['draft', 'locked'].includes(next.status)) throw new Error(t('Укажите имя и статус паспорта.', 'Паспорт атауы мен мәртебесін көрсетіңіз.'));
  // PATCH only edited base fields; references and both translation objects stay
  // on the server, including fields that this editor does not expose.
  return Object.fromEntries(Object.entries(next).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(record[field] ?? (['taboo', 'scenes'].includes(field) ? [] : ''))));
}
function invalidateMap(client, slug) {
  if (mapState.client !== client || mapState.slug !== slug) return;
  mapState.token += 1; mapState.ready = false; mapState.loading = false; mapState.error = ''; mapCard = null;
}
async function submitPassport(form, data) {
  const card = passportCard;
  const current = () => card && passportCard === card && card.client === serverClient && card.slug === state.activeId && card.token === cinemaState.token && route() === card.section;
  if (!card || card.client !== serverClient || card.slug !== state.activeId || card.token !== cinemaState.token || route() !== card.section
      || form.dataset.passportId !== card.record.id || form.dataset.passportCollection !== card.collection
      || !canWriteBreakdownSection(project(), card.section)) {
    showPassportError(t('Обновите карточку и проверьте права.', 'Карточканы жаңартып, құқықтарды тексеріңіз.'), true); return;
  }
  try {
    const patch = passportPatch(card.record, data);
    if (!Object.keys(patch).length) { dialog.close(); return; }
    if (!await flushDraft() || project()?._revision !== card.revision) throw Object.assign(new Error('REVISION_CONFLICT'), { status: 409 });
    const result = await new BreakdownApi(card.client).patchPassport(card.slug, card.collection, card.record.id, patch, card.revision);
    const known = card.client.known.get(card.slug), record = state.projects[card.slug];
    if (known?._revision === card.revision) known._revision = result.revision;
    if (record?._revision === card.revision) record._revision = result.revision;
    invalidateMap(card.client, card.slug);
    if (!current()) return;
    passportCard = null; dialog.close();
    const refreshed = await refreshCinema();
    toast(refreshed ? t('Паспорт сохранён на сервере.', 'Паспорт серверде сақталды.') : t('Паспорт сохранён. Обновите раздел, чтобы увидеть результат.', 'Паспорт сақталды. Нәтижені көру үшін бөлімді жаңартыңыз.'));
  } catch (error) {
    if (!current()) return;
    // Keep the typed form on validation or write failure. Unknown write results
    // require explicit reload, never an automatic PATCH replay.
    const reload = [0, 401, 403, 409, 200].includes(error.status);
    if (reload) { passportCard = null; cinemaState.ready = false; cinemaState.error = cinemaError(error); }
    showPassportError(cinemaError(error), reload);
  }
}
async function breakdownImportDialog() {
  if (!serverClient || !canWriteBreakdownSection(project(), 'breakdown') || !cinemaPages.includes(route())) return;
  if (!await refreshCinema() || !canWriteBreakdownSection(project(), 'breakdown')) return;
  openDialog(`${dialogHead(t('Разобрать сценарий на сцены', 'Сценарий талдауын импорттау'))}<form id='breakdown-import-form'><label for='breakdown-file'>${t('Выберите файл разбивки (razbivka.json)', 'Талдау файлын таңдаңыз (razbivka.json)')}</label><input id='breakdown-file' name='file' type='file' accept='.json,application/json' required><p>${t('Выберите razbivka.json. Сцены и паспорта будут обновлены; заполненные замки и авторский текст сохранятся.', 'razbivka.json файлын таңдаңыз. Көріністер мен паспорттар жаңартылады; толтырылған бекітілген сипаттамалар мен автор мәтіні сақталады.')}</p><p data-passport-error role='alert' hidden></p>${dialogActions(t('Импортировать', 'Импорттау'))}</form>`);
  dialog.classList.add('passport-dialog'); dialog.dataset.cinemaMode = paperMode();
  importCard = { client: serverClient, slug: state.activeId, revision: cinemaState.snapshot.revision, token: cinemaState.token };
}
async function submitBreakdownImport(data) {
  const card = importCard;
  const current = () => card && card === importCard && card.client === serverClient && card.slug === state.activeId && card.token === cinemaState.token && cinemaPages.includes(route());
  if (!current() || !canWriteBreakdownSection(project(), 'breakdown')) { showPassportError(t('Обновите раздел и проверьте право импорта.', 'Бөлімді жаңартып, импорттау құқығын тексеріңіз.'), true); return; }
  let submitted = false;
  try {
    const file = data.get('file');
    if (!file || typeof file.text !== 'function' || !file.size) throw new Error(t('Выберите файл razbivka.json.', 'razbivka.json файлын таңдаңыз.'));
    if (file.size > 2 * 1024 * 1024) throw new Error(t('Файл больше 2 МиБ.', 'Файл 2 МиБ-тан үлкен.'));
    const source = await file.text();
    if (!current()) return;
    let payload;
    try { payload = JSON.parse(source.replace(/^\uFEFF/, '')); }
    catch { throw new Error(t('В файле некорректный JSON.', 'Файлдағы JSON дұрыс емес.')); }
    if (!await flushDraft() || !current()) return;
    if (!canWriteBreakdownSection(project(), 'breakdown') || project()?._revision !== card.revision) throw Object.assign(new Error('REVISION_CONFLICT'), { status: 409 });
    submitted = true;
    await new BreakdownApi(card.client).import(card.slug, payload, card.revision);
    // An import changes scene/shot data. Discard the old save baseline so that
    // a later save cannot derive an author draft from stale scene collections.
    card.client.known.delete(card.slug); invalidateMap(card.client, card.slug);
    if (!current()) return;
    importCard = null; dialog.close();
    const refreshed = await refreshCinema();
    toast(refreshed ? t('Разбивка импортирована на сервер.', 'Сценарий талдауы серверге импортталды.') : t('Разбивка импортирована. Обновите раздел, чтобы увидеть результат.', 'Сценарий талдауы импортталды. Нәтижені көру үшін бөлімді жаңартыңыз.'));
  } catch (error) {
    if (!current()) return;
    const reload = submitted && error.status !== 422 && error.status !== 413;
    if (reload) { importCard = null; cinemaState.ready = false; cinemaState.error = cinemaError(error); }
    showPassportError(cinemaError(error), reload);
  }
}
function workspace(page) {
  const p = project();
  const pages = { overview, map: productionMapPage, breakdown: () => cinemaPage('breakdown'), heroes: () => cinemaPage('heroes'), locations: () => cinemaPage('locations'), script: scriptPage, storyboard: () => shotsPage('storyboard'), animatic: animaticPage, shots: () => shotsPage('shots'), team: teamPage, post: postPage };
  if (!pages[page]) page = 'overview';
  const section = ['map', 'heroes', 'locations'].includes(page) ? 'overview' : page === 'breakdown' ? 'script' : ['storyboard', 'shots', 'animatic'].includes(page) ? 'shots' : page === 'team' ? 'team' : page === 'script' ? 'script' : page;
  const denied = !cinemaPages.includes(page) && p?._denied?.includes(section);
  const content = !p ? `<div class='empty'><h1>${t('Проектов пока нет', 'Қолжетімді жобалар жоқ')}</h1><p>${t('Создайте проект ключом администратора, режиссёра или продюсера. Для входа в существующий проект попросите руководителя выдать ключ участника.', 'Әкімші, режиссер немесе продюсер кілтімен жоба құрыңыз. Бар жобаға кіру үшін жетекшіден қатысушы кілтін сұраңыз.')}</p>${btn(t('Создать проект', 'Жоба құру'), 'create', true, 'plus')}</div>` : denied ? `<div class='empty'><h1>${t('Нет доступа к разделу', 'Бөлімге қолжетімділік жоқ')}</h1><p>${t('Сервер проверяет роль и разделы участника. Попросите руководителя изменить ваши права в разделе «Команда».', 'Сервер қатысушының рөлі мен бөлімдерін тексереді. Жетекшіден «Команда» бөлімінде құқықтарыңызды өзгертуді сұраңыз.')}</p></div>` : pages[page]();
  return `<div class='workspace ${page === 'map' ? 'map-workspace' : cinemaPages.includes(page) ? 'cinema-workspace' : ''}'><header class='work-header'><div class='row wrap'>${brand()}<span class='storage-label' data-storage-label role='status'>${e(storageLabel())}</span></div><div class='row work-controls'><select id='project-switch' aria-label='${t('Выбрать проект', 'Жобаны таңдау')}'>${Object.entries(state.projects).map(([id, record]) => `<option value='${e(id)}' ${id === state.activeId ? 'selected' : ''}>${e(local(record.title))}</option>`).join('')}</select>${langs()}${btn(t('Сервер', 'Сервер'), 'server')}<button class='btn small' data-action='create' aria-label='${t('Создать проект', 'Жоба құру')}'>${icon('plus')}</button></div></header><div class='work-grid'><aside class='sidebar'><div class='project-name'>${e(p ? local(p.title) : t('Проекты', 'Жобалар'))}<small>${t('Проект команды', 'Жұмыс кеңістігі')}</small></div><nav class='side-nav' aria-label='${t('Разделы проекта', 'Жоба бөлімдері')}'>${navItems().map(n => `${navGroupLabel(n.id)}<a href='#/studio/${n.id}' class='${page === n.id ? 'active' : ''}' ${page === n.id ? `aria-current='page'` : ''}>${icon(n.id)}${n.title}${n.id === 'map' && serverClient && meState.awaiting ? `<span class='n hot' data-nav-awaiting>${e(String(meState.awaiting))}</span>` : ''}</a>`).join('')}${p ? `<span class='glabel'>${t('Выпуск', 'Шығарылым')}</span><a href='../p/${e(state.activeId)}/' target='_blank' rel='noopener' title='${t('Страница проекта по коду: общий взгляд для продюсера и партнёров', 'Жоба беті код арқылы')}'>${icon('globe')}${t('Страница проекта ↗', 'Жоба беті ↗')}</a>` : ''}</nav>${accountMenu(p)}</aside><main class='work-main'>${slate(p, page)}<div class='prototype-note'>${t('Картинки и видео подключим после ваших «да» на кадры.', 'Прототип · сурет пен бейне генерациясы әлі қосылмаған.')}</div><p class='storage-error' data-storage-error role='alert' ${storageError ? '' : 'hidden'}>${e(storageError)}</p>${participantHint()}${content}</main></div>${helperStub(p)}${tabbar(page)}</div>`;
}

const meState = { awaiting: null, at: 0, loading: false, tokeny: null };
async function refreshMe() {
  if (!serverClient || meState.loading || Date.now() - meState.at < 30000) return;
  meState.loading = true;
  try {
    const me = await serverClient.request('GET', '/api/me');
    const slug = project()?.slug; const mine = (me?.data?.projects || []).find(item => item.slug === slug);
    const next = mine ? mine.awaitingMe : (me?.data?.awaitingMe ?? 0); const changed = next !== meState.awaiting; meState.awaiting = next; meState.at = Date.now();
    if (me?.data?.tokeny) { meState.tokeny = me.data.tokeny; for (const node of document.querySelectorAll('[data-tokeny]')) node.textContent = tokenyLabel(); }
    for (const node of document.querySelectorAll('[data-awaiting]')) node.textContent = String(meState.awaiting);
    if (changed && route() !== 'home' && !busy && !dialog.open) render();
  } catch { meState.at = Date.now(); }
  finally { meState.loading = false; }
}
function slate(p, page) {
  if (!p) return '';
  const section = navItems().find(n => n.id === page)?.title || '';
  const cell = (label, value) => `<div class='cell'><span>${label}</span><b>${e(String(value))}</b></div>`;
  return `<div class='slate' aria-label='${t('Где вы находитесь', 'Сіз қайдасыз')}'>${cell(t('Проект', 'Жоба'), local(p.title))}${cell(t('Раздел', 'Бөлім'), section)}${cell(t('Версия', 'Нұсқа'), 'v' + (p.version ?? 0))}${serverClient ? cell(t('Участник', 'Қатысушы'), roleName(p._principal?.role || 'viewer')) + `<div class='cell'><span>${t('Ждёт меня', 'Мені күтеді')}</span><b data-awaiting>${meState.awaiting == null ? '…' : e(String(meState.awaiting))}</b></div>` : cell(t('Хранение', 'Сақтау'), t('в браузере', 'браузерде'))}</div>`;
}
const tokenyLabel = () => { const w = meState.tokeny; if (!w) return t('остаток уточняю…', 'қалдықты тексеріп жатырмын…'); if (w.unlimited) return t('без лимита', 'шектеусіз'); return t(`осталось ${w.balance}`, `${w.balance} қалды`); };
const tokenyWord = n => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? 'токенов' : b === 1 ? 'токен' : b >= 2 && b <= 4 ? 'токена' : 'токенов'; };
async function tokenyDialog() {
  if (!serverClient) { toast(t('Токены считаются на сервере команды: подключите ключ.', 'Токендер команда серверінде есептеледі: кілтті қосыңыз.')); return; }
  let data;
  try { data = (await serverClient.request('GET', '/api/tokeny'))?.data; } catch (error) { toast(error?.message || t('Не удалось получить остаток.', 'Қалдықты алу мүмкін болмады.')); return; }
  meState.tokeny = { balance: data.balance, unlimited: data.unlimited, cena_voprosa: data.ceny?.vopros ?? 1 };
  const pakety = Array.isArray(data.pakety) ? data.pakety : [];
  const sposoby = Array.isArray(data.oplata?.sposoby) ? data.oplata.sposoby : [];
  const reasonName = r => ({ probnyy_paket: t('пробный пакет', 'сынақ пакеті'), vopros: t('вопрос помощнику', 'көмекшіге сұрақ'), popolnenie: t('пополнение', 'толтыру'), kartinka: t('картинка', 'сурет'), video: t('видео', 'бейне') })[r] || r;
  const history = (data.history || []).slice(-8).reverse();
  const open = (data.zayavki || []).filter(z => z.status === 'new');
  const balance = data.unlimited ? t('Без лимита', 'Шектеусіз') : `${data.balance} ${state.locale === 'kk' ? 'токен' : tokenyWord(data.balance)}`;
  openDialog(`${dialogHead(t('Токены', 'Токендер'), t(`Вопрос помощнику стоит ${data.ceny?.vopros ?? 1} ${tokenyWord(data.ceny?.vopros ?? 1)}. Картинки и видео подключим следующими.`, `Көмекшіге бір сұрақ — ${data.ceny?.vopros ?? 1} токен.`))}
    <div class='tokeny-balance'><span>${t('На счёте', 'Шотта')}</span><b>${e(balance)}</b></div>
    ${data.unlimited ? '' : `<form id='tokeny-form'>
      <label for='tokeny-amount'>${t('Сколько токенов докупить', 'Қанша токен сатып аласыз')}</label>
      ${pakety.length ? `<div class='tokeny-pakety'>${pakety.map(pk => `<button type='button' class='chip' data-tokeny-paket='${e(String(pk.tokeny))}'>${e(String(pk.tokeny))}${pk.cena ? ` · ${e(String(pk.cena))}` : ''}</button>`).join('')}</div>` : ''}
      <input id='tokeny-amount' name='tokeny' type='number' min='1' max='1000000' step='1' required value='${e(String(pakety[0]?.tokeny || 500))}' inputmode='numeric'>
      ${sposoby.length ? `<label for='tokeny-sposob'>${t('Как удобно оплатить', 'Қалай төлейсіз')}</label><select id='tokeny-sposob' name='sposob'>${sposoby.map(sp => `<option value='${e(sp.nazvanie)}'>${e(sp.nazvanie)}</option>`).join('')}</select>` : `<input type='hidden' name='sposob' value=''>`}
      <p class='access-note'>${sposoby.length ? sposoby.map(sp => `<b>${e(sp.nazvanie)}</b>${sp.rekvizity ? ` — ${e(sp.rekvizity)}` : ''}${sp.podskazka ? `. ${e(sp.podskazka)}` : ''}`).join('<br>') : t('Оставьте заявку: продюсер напишет вам на почту, как оплатить, и начислит токены сразу после оплаты.', 'Өтінім қалдырыңыз: продюсер поштаңызға қалай төлеу керектігін жазады да, төлемнен кейін бірден токен қосады.')}${data.oplata?.podskazka ? `<br>${e(data.oplata.podskazka)}` : ''}</p>
      ${data.oplata?.ssylka ? `<a class='btn' href='${e(data.oplata.ssylka)}' target='_blank' rel='noopener'>${t('Оплатить онлайн ↗', 'Онлайн төлеу ↗')}</a>` : ''}
      ${dialogActions(t('Оставить заявку', 'Өтінім қалдыру'))}
    </form>`}
    ${open.length ? `<p class='role-hint'>${t(`Ваша заявка на ${open[open.length - 1].tokeny} ${tokenyWord(open[open.length - 1].tokeny)} у продюсера. Токены появятся после оплаты.`, `Өтініміңіз продюсерде. Токендер төлемнен кейін қосылады.`)}</p>` : ''}
    ${history.length ? `<div class='tokeny-history'><div class='menu-group'>${t('Последние движения', 'Соңғы қозғалыстар')}</div>${history.map(h => `<div class='tokeny-row'><span>${e(reasonName(h.reason))}${h.note ? ` · ${e(h.note)}` : ''}</span><small>${e(String(h.at || '').slice(0, 10))}</small><b class='${h.delta > 0 ? 'plus' : ''}'>${h.delta > 0 ? '+' : ''}${e(String(h.delta))}</b></div>`).join('')}</div>` : ''}
    ${data.unlimited ? `<div class='dialog-actions'><button class='btn' data-close>${t('Готово', 'Дайын')}</button></div>` : ''}`);
  dialog.classList.add('tokeny-dialog');
  if (project()?._principal?.role === 'admin') await tokenyAdminBlock();
}
async function tokenyAdminBlock() {
  let data;
  try { data = (await serverClient.request('GET', '/api/tokeny/zayavki'))?.data; } catch { return; }
  const list = data?.zayavki || [];
  const block = document.createElement('div'); block.className = 'tokeny-admin';
  block.innerHTML = `<div class='menu-group'>${t('Заявки на пополнение', 'Толтыру өтінімдері')}${list.length ? ` · ${list.length}` : ''}</div>${list.length ? list.map(z => `<div class='tokeny-row'><span><b>${e(z.name || z.keyId)}</b> ${e(z.email || '')}<br><small>${e(String(z.tokeny))} ${tokenyWord(z.tokeny)}${z.sposob ? ` · ${e(z.sposob)}` : ''}${z.kommentariy ? ` · ${e(z.kommentariy)}` : ''}</small></span><button type='button' class='btn small primary' data-tokeny-grant='${e(z.id)}' data-key-id='${e(z.keyId)}' data-tokeny-sum='${e(String(z.tokeny))}'>${t('Начислить', 'Қосу')}</button><button type='button' class='btn small ghost' data-tokeny-decline='${e(z.id)}'>${t('Отклонить', 'Қабылдамау')}</button></div>`).join('') : `<p class='role-hint'>${t('Открытых заявок нет.', 'Ашық өтінімдер жоқ.')}</p>`}`;
  dialog.querySelector('.dialog-actions')?.before(block);
}
function accountMenu(p) {
  const principal = p?._principal; const who = principal ? (principal.name || principal.id || '') : t('Гость', 'Қонақ');
  const role = principal ? roleName(principal.role) : t('без ключа', 'кілтсіз');
  const initial = String(who || '·').trim().slice(0, 1).toUpperCase();
  return `<details class='menu'><summary><span class='ava' aria-hidden='true'>${e(initial)}</span><span class='who'><b>${e(who)}</b><small>${e(role)}</small></span></summary><div class='pop' role='menu'>
    ${Object.keys(state.projects).length > 1 ? `<div class='menu-group'>${t('Мои проекты', 'Менің жобаларым')}</div>${Object.entries(state.projects).slice(0, 6).map(([id, record]) => `<button type='button' role='menuitem' data-project='${e(id)}' ${id === state.activeId ? `aria-current='true'` : ''}>${icon('overview')}${e(local(record.title) || id)}</button>`).join('')}<hr>` : ''}
    <a href='../pomoshch/' role='menuitem'>${icon('script')}${t('Как это работает', 'Бұл қалай жұмыс істейді')}</a>
    ${serverClient ? `<button type='button' role='menuitem' data-action='tokeny'>${icon('post')}<span>${t('Токены и пополнение', 'Токендер мен толтыру')}<small class='sub' data-tokeny>${e(tokenyLabel())}</small></span></button>` : ''}
    <button type='button' role='menuitem' data-action='server'>${icon('team')}${t('Сервер и ключ', 'Сервер мен кілт')}</button>
    <button type='button' role='menuitem' data-action='create'>${icon('plus')}${t('Новый проект', 'Жаңа жоба')}</button>
    <a href='../' role='menuitem'>${icon('overview')}${t('На главную', 'Басты бетке')}</a>
  </div><div class='side-foot'>studio.neyra.vision</div></details>`;
}
function tabbar(page) {
  const items = [['overview', t('Обзор', 'Шолу')], ['script', t('Сценарий', 'Сценарий')], ['storyboard', t('Борды', 'Бордтар')], ['map', t('Карта', 'Карта')], ['team', t('Команда', 'Команда')]];
  return `<nav class='tabbar' aria-label='${t('Разделы', 'Бөлімдер')}'>${items.map(([id, title]) => `<a href='#/studio/${id}' ${page === id ? `aria-current='page'` : ''}>${icon(id)}<span>${title}</span></a>`).join('')}</nav>`;
}
const navGroups = () => ({ script: t('Девелопмент', 'Девелопмент'), heroes: t('Препродакшн', 'Препродакшн'), shots: t('Производство', 'Өндіріс'), team: t('Команда', 'Команда') });
function navGroupLabel(id) { const title = navGroups()[id]; return title ? `<span class='glabel'>${title}</span>` : ''; }
function helperStub(p) {
  if (!p) return '';
  const mic = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const micTitle = t('Голос недоступен в этом браузере', 'Бұл браузерде дауыс қолжетімсіз');
  return `<div class='helper-stub' aria-label='${t('Помощник проекта', 'Жоба көмекшісі')}'><div class='box'>${assistantThread()}<form id='voice-form' class='q' autocomplete='off'><button type='button' class='mic' data-action='voice' aria-label='${t('Сказать команду', 'Команда айту')}' ${mic ? '' : `disabled title='${micTitle}'`}>${icon('team')}</button><input name='q' id='voice-input' placeholder='${t('Скажите или напишите: «открой карту», «кто тормозит», «вернуть 12.2, свет не совпадает»', 'Команда немесе сұрақ: «картаны аш», «кім кешіктіреді»')}' aria-label='${t('Команда или вопрос', 'Команда немесе сұрақ')}'><button type='submit' class='send' aria-label='${t('Отправить', 'Жіберу')}'>${icon('arrow')}</button></form><div class='chips'>${[[t('кто тормозит', 'кім кешіктіреді'), t('кто тормозит', 'кім кешіктіреді')], [t('открой разбивку', 'талдауды аш'), t('открой разбивку', 'талдауды аш')], [t('покажи героев', 'кейіпкерлерді көрсет'), t('покажи героев', 'кейіпкерлерді көрсет')]].map(([label, cmd]) => `<button type='button' class='chip' data-cmd='${e(cmd)}'>${e(label)}</button>`).join('')}</div><div class='tc'><span>${e(local(p.title)).toUpperCase()} · v${e(String(p.version ?? ''))}</span><span data-voice-status>${t('помощник ответит, как только подключим модель', 'көмекші модель кілтінен кейін қосылады')}</span></div></div></div>`;
}
function participantHint() {
  return !settings.key && !serverClient ? `<div class='participant-hint' role='note'><p>${t('Чтобы открыть проект команды, введите свой ключ. Его выдаёт продюсер.', 'Команда жобасын ашу үшін қатысушы кілтін енгізіңіз.')}</p>${btn(t('Ввести ключ', 'Қатысушы кілтін енгізу'), 'server')}</div>` : '';
}
function openDialog(html) { if (!dialog.open) lastFocus = document.activeElement; delete dialog.dataset.memberKey; dialog.classList.remove('team-dialog', 'map-dialog', 'passport-dialog', 'server-dialog', 'assistant-dialog', 'tokeny-dialog'); dialog.innerHTML = html; dialog.showModal(); }
const dialogHead = (title, subtitle = '') => `<div class='dialog-header'><div><div class='eyebrow'>NEYRA.VISION / STUDIO</div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class='icon-btn' data-close aria-label='${t('Закрыть', 'Жабу')}'>${icon('close')}</button></div>`;
const dialogActions = label => `<div class='dialog-actions'><button type='button' class='btn' data-close>${t('Отмена', 'Бас тарту')}</button><button type='submit' class='btn primary'>${label}${icon('arrow')}</button></div>`;
function createDialog() { openDialog(`${dialogHead(t('Начнём новую историю.', 'Жаңа оқиғаны бастайық.'), t('Ваш текущий проект останется в списке проектов.', 'Қазіргі жобаңыз жобалар тізімінде сақталады.'))}<form id='create-form'>${serverClient ? `<label for='project-slug'>${t('Код проекта (латиница)', 'Жоба коды (латынша)')}</label><input id='project-slug' name='slug' maxlength='64'><small>${t('Необязательно. Этот код задаёт проект в правах ключа; пустое поле создаст новый код автоматически.', 'Міндетті емес. Бұл код кілт құқықтарындағы жобаны белгілейді; бос өріс жаңа кодты автоматты түрде жасайды.')}</small>` : ''}<label for='project-title'>${t('Название проекта', 'Жоба атауы')}</label><input id='project-title' name='title' required maxlength='120' placeholder='${t('Название вашего фильма', 'Фильміңіздің атауы')}'><label for='project-synopsis'>${t('О чём ваша история?', 'Оқиғаңыз не туралы?')}</label><textarea id='project-synopsis' name='synopsis' rows='3' maxlength='4000'></textarea>${dialogActions(t('Создать проект', 'Жоба құру'))}</form>`); }
function serverDialog() {
  openDialog(`${dialogHead(t('Сервер', 'Сервер'), t('Адрес и ключ остаются только на этом устройстве.', 'Мекенжай мен рөл кілті тек осы құрылғыда сақталады.'))}<form id='server-form'><label for='server-url'>${t('Сервер', 'Сервер')}</label><input id='server-url' name='url' type='url' required value='${e(settings.url)}'><label for='server-key'>${t('Ключ участника', 'Қатысушы кілті')}</label><input id='server-key' name='key' type='password' autocomplete='off' maxlength='512' placeholder='${t('Введите ключ участника', 'Қатысушы кілтін енгізіңіз')}' value='${e(settings.key)}'><p class='access-note'>${t('Ключ вам выдаёт продюсер или режиссёр в разделе «Команда». Без ключа окно работает в пробном режиме, только в этом браузере.', 'Жоба жетекшісінен алған кілтті енгізіңіз. Жетекші «Команда» бөлімінде қатысушыларды қосып, кілттер береді. Бос кілт жергілікті режимді қосады; жергілікті жобалар бөлек сақталады.')}</p>${dialogActions(t('Сохранить и подключиться', 'Сақтау және қосылу'))}</form>`);
  dialog.classList.add('server-dialog');
}
function memberDialog(id = '') {
  if (!canManageTeam()) return;
  const member = id ? project().members.find(item => item.id === id) : undefined;
  if (id && !member) return;
  const role = member?.role || 'writer';
  const external = serverClient && member?.keySource === 'external';
  const selected = member?.sections || defaultSections(role);
  const allowed = roleSections(role).filter(section => grantableSections().includes(section));
  const sections = teamSections();
  for (const section of selected) if (!sections.some(item => item.id === section)) sections.push({ id: section, title: sectionName(section) });
  const choices = roles();
  if (member && !Object.hasOwn(choices, role)) choices[role] = roleName(role);
  openDialog(`${dialogHead(member ? t('Изменить права', 'Құқықтарды өзгерту') : t('Добавить участника', 'Қатысушы қосу'), member ? e(member.name) : serverClient ? t('После сохранения появится ключ для входа. Передайте его участнику.', 'Сақтағаннан кейін кіру кілті пайда болады. Оны қатысушыға беріңіз.') : t('Пробный режим: участник появится только в этом браузере, без ключа.', 'Сынақ режимі: қатысушы тек осы браузерде көрінеді, кілтсіз.'))}
    <form id='member-form' ${member ? `data-id='${e(member.id)}'` : ''}>
      ${member ? `<p class='member-email'>${e(member.email || t('E-mail не указан', 'E-mail көрсетілмеген'))}</p>` : `<label for='member-name'>${t('Имя', 'Аты')}</label><input id='member-name' name='name' required maxlength='80' autocomplete='name'><label for='member-email'>E-mail</label><input id='member-email' name='email' type='email' ${serverClient ? 'required' : ''} maxlength='254' autocomplete='email'>`}
      <label for='member-role'>${t('Роль', 'Рөлі')}</label><select id='member-role' name='role' aria-describedby='member-role-hint' ${external ? 'disabled' : ''}>${Object.entries(choices).map(([value, title]) => `<option value='${e(value)}' ${role === value ? 'selected' : ''}>${e(title)}</option>`).join('')}</select>
      <p class='role-hint' id='member-role-hint'>${e(roleHint(role))}</p>
      ${external ? `<p class='role-hint'>${t('Роль этого участника задана в настройках сервера. Здесь можно открыть или закрыть разделы.', 'Бұл қатысушының рөлі сервер баптауларында берілген. Мұнда бөлімдерді ашуға немесе жабуға болады.')}</p>` : ''}
      <fieldset class='member-section-fields'><legend>${t('Разделы проекта', 'Жоба бөлімдері')}</legend><p>${t('Роль уже отметила нужные разделы. Хотите открыть больше — поставьте галочки.', 'Рөл қажетті бөлімдерді белгілеп қойды. Көбірек ашқыңыз келсе — белгі қойыңыз.')}</p>${sections.map(section => `<label class='field-check'><input type='checkbox' name='sections' value='${e(section.id)}' ${selected.includes(section.id) && allowed.includes(section.id) ? 'checked' : ''} ${allowed.includes(section.id) ? '' : 'disabled'}>${e(section.title)}</label>`).join('')}</fieldset>
      ${dialogActions(member ? t('Сохранить права', 'Құқықтарды сақтау') : t('Добавить участника', 'Қатысушы қосу'))}
    </form>`);
  dialog.classList.add('team-dialog');
}
function memberKeyDialog(key) {
  openDialog(`${dialogHead(t('Участник добавлен. Сохраните ключ.', 'Қатысушы қосылды. Кілтті сақтаңыз.'), t('Ключ показывается один раз. После закрытия его нельзя открыть снова.', 'Кілт бір рет көрсетіледі. Жапқаннан кейін оны қайта ашу мүмкін емес.'))}<div class='member-key-panel'><label for='issued-member-key'>${t('Ключ для входа', 'Кіру кілті')}</label><textarea id='issued-member-key' readonly rows='3' autocomplete='off' spellcheck='false'>${e(key)}</textarea><button class='btn primary' data-copy-member-key>${t('Скопировать', 'Көшіру')}${icon('download')}</button><p>${t('Отправьте ключ участнику лично. Письмо на почту подключим позже.', 'Кілтті қатысушыға жеке жіберіңіз. Поштаға хат жіберуді кейін қосамыз.')}</p></div><div class='dialog-actions'><button class='btn' data-close>${t('Готово', 'Дайын')}</button></div>`);
  dialog.dataset.memberKey = 'true';
  dialog.classList.add('team-dialog');
  document.querySelector('#issued-member-key')?.focus();
}
function memberRevokeDialog(id) {
  if (!serverClient || !canManageTeam()) return;
  const member = project().members.find(item => item.id === id);
  if (!member || member.accessStatus === 'revoked') return;
  openDialog(`${dialogHead(t('Отозвать доступ?', 'Қолжетімділікті қайтару керек пе?'), e(member.name))}<form id='member-revoke-form' data-id='${e(member.id)}'><p class='revoke-explanation'>${t('Ключ участника перестанет открывать этот проект. Материалы проекта останутся.', 'Қатысушының кілті бұл жобаны аша алмайды. Жоба материалдары қалады.')}</p>${dialogActions(t('Отозвать доступ', 'Қолжетімділікті қайтару'))}</form>`);
  dialog.classList.add('team-dialog');
}
function removeCurrentProject() {
  serverClient?.known.delete(state.activeId);
  delete state.projects[state.activeId];
  state.activeId = Object.keys(state.projects)[0] || '';
  selectedScene = null;
}
async function refreshOwnRights(member, p) {
  if (member.keyId !== p._principal?.id) return;
  // Hide management while the server re-evaluates the current key's rights.
  p._capabilities = { manageTeam: false };
  try { state.projects[state.activeId] = await serverClient.loadProject(state.activeId); }
  catch (error) { if ([401, 403, 404].includes(error.status)) removeCurrentProject(); else throw error; }
}

function shotDialog(id) {
  const shot = project().shots.find(s => s.id === id);
  if (!shot) return;
  const scene = project().scenes.find(s => s.id === shot.sceneId);
  const scriptPreview = scene ? `<section class='script-paper script-preview' aria-label='${t('Сценарий сцены', 'Көрініс сценарийі')}'><div class='paper-head'>${t('СЦЕНАРИЙ СЦЕНЫ', 'КӨРІНІС СЦЕНАРИЙІ')}</div><pre>${e(scene.title[state.scriptLang])}\n\n${e(scene.text[state.scriptLang])}</pre></section>` : '';
  openDialog(`${dialogHead(`${t('Кадр', 'Кадр')} ${e(shot.id)} / ${e(local(shot.title))}`)}<div class='dialog-preview'><img src='assets/hero.jpg' alt='${t('Демонстрационный референс', 'Демонстрациялық референс')}'></div>${scriptPreview}<form id='shot-form' data-id='${e(id)}'><label for='shot-title'>${t('Название кадра', 'Кадр атауы')}</label><input id='shot-title' name='title' value='${e(local(shot.title))}' required maxlength='140'><div class='form-row'><div><label for='shot-duration'>${t('Длительность, сек', 'Ұзақтығы, сек')}</label><input id='shot-duration' name='duration' type='number' min='1' max='60' step='1' value='${shot.duration}' required></div><div><label for='shot-status'>${t('Статус', 'Мәртебе')}</label><select id='shot-status' name='status'>${['draft', 'working', 'review', 'approved'].map(s => `<option value='${s}' ${s === shot.status ? 'selected' : ''}>${statusName(s)}</option>`).join('')}</select></div></div><div class='form-row'><div><label for='shot-owner'>${t('Ответственный', 'Жауапты')}</label><input id='shot-owner' name='owner' value='${e(shot.owner)}' maxlength='80'></div><div><label for='shot-lens'>${t('Объектив', 'Объектив')}</label><input id='shot-lens' name='lens' value='${e(shot.lens)}' maxlength='80'></div></div><label for='shot-description'>${t('Действие и композиция', 'Әрекет пен композиция')}</label><textarea id='shot-description' name='description' rows='2' maxlength='4000'>${e(local(shot.description))}</textarea><label for='shot-prompt'>${t('Промпт для следующего этапа', 'Келесі кезеңге арналған промпт')}</label><textarea id='shot-prompt' name='prompt' rows='3' maxlength='8000'>${e(local(shot.prompt))}</textarea>${dialogActions(t('Сохранить изменения', 'Өзгерістерді сақтау'))}</form><section class='comment-list'><h3>${t('Комментарии', 'Пікірлер')} / ${shot.comments.length}</h3><div id='comments'>${shot.comments.map(c => `<div class='comment'><strong>${e(c.author)}</strong><p>${e(c.text)}</p></div>`).join('')}</div><label for='comment-text'>${t('Ваш комментарий', 'Сіздің пікіріңіз')}</label><textarea id='comment-text' class='comment-input' rows='2' maxlength='2000'></textarea><button class='btn small' data-comment-shot='${e(id)}' style='margin-top:12px'>${t('Оставить комментарий', 'Пікір қалдыру')}${icon('plus')}</button></section>`);
}
function versionsDialog() { const p = project(); openDialog(`${dialogHead(t('История сценария', 'Сценарий тарихы'), t('Перед восстановлением откройте текст. Текущая редакция сохранится в истории.', 'Қалпына келтірмес бұрын мәтінді ашыңыз. Қазіргі мәтін тарихта сақталады.'))}<div>${p.snapshots.map((snapshot, index) => `<details class='version-entry'><summary>${t('Версия', 'Нұсқа')} ${snapshot.version} · ${new Date(snapshot.date).toLocaleString(state.locale === 'kk' ? 'kk-KZ' : 'ru-RU')} ${snapshot.kind === 'backup' ? `· ${t('Резервная копия', 'Сақтық көшірме')}` : ''}</summary><pre class='script-preview'>${e(serverClient ? snapshot.scriptTranslations?.[state.scriptLang] ?? snapshot.scriptText : snapshot.scenes.map(scene => `${scene.title[state.scriptLang]}\n\n${scene.text[state.scriptLang]}`).join('\n\n————————\n\n'))}</pre><button class='btn small' data-restore-version='${index}'>${t('Восстановить как новую версию', 'Жаңа нұсқа ретінде қалпына келтіру')}${icon('back')}</button></details>`).reverse().join('')}</div>`); }
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
function runCommand(text) {
  const cmd = parseCommand(text);
  const status = document.querySelector('[data-voice-status]');
  if (!cmd) return;
  const say = message => { if (status) status.textContent = message; toast(message); };
  if (cmd.kind === 'open' && cmd.section) { go(cmd.section); say(describeCommand(cmd, state.locale)); return; }
  if (cmd.kind === 'open' && cmd.target) { go('breakdown'); say(describeCommand(cmd, state.locale)); return; }
  if (cmd.kind === 'waiting') { mapFilter = 'awaiting'; go('map'); say(describeCommand(cmd, state.locale)); return; }
  if (cmd.kind === 'help') { location.href = '../pomoshch/'; return; }
  if (cmd.kind === 'ask') { void askAssistant(cmd.text); return; }
  if (['accept', 'return', 'review', 'take', 'done', 'note'].includes(cmd.kind)) { go('map'); say(describeCommand(cmd, state.locale) + ' · ' + t('выберите клетку на карте', 'картадан ұяшықты таңдаңыз')); return; }
  say(describeCommand(cmd, state.locale));
}
const assistantHistory = [];
let assistantPending = '';
let assistantCollapsed = false;
function assistantThread() {
  if (!assistantHistory.length && !assistantPending) return '';
  const items = assistantHistory.slice(-12).map(m => `<div class='assistant-msg ${m.role}'><span class='label'>${m.role === 'user' ? t('Вы', 'Сіз') : t('Помощник', 'Көмекші')}</span><p>${e(m.content).replace(/\n/g, '<br>')}</p></div>`).join('');
  const pending = assistantPending ? `<div class='assistant-msg assistant pending'><span class='label'>${t('Помощник', 'Көмекші')}</span><p>${e(assistantPending)}</p></div>` : '';
  return `<div class='thread ${assistantCollapsed ? 'collapsed' : ''}' data-assistant-thread><div class='thread-bar'><span>${t('Разговор с помощником', 'Көмекшімен әңгіме')} · ${assistantHistory.length}</span><button type='button' class='chip' data-thread='toggle'>${assistantCollapsed ? t('развернуть', 'ашу') : t('свернуть', 'жию')}</button><button type='button' class='chip' data-thread='clear'>${t('очистить', 'тазалау')}</button></div><div class='thread-log'>${items}${pending}</div></div>`;
}
function refreshThread() {
  const box = document.querySelector('.helper-stub .box');
  if (!box) return;
  const current = box.querySelector('[data-assistant-thread]');
  const html = assistantThread();
  if (current) current.outerHTML = html; else box.insertAdjacentHTML('afterbegin', html);
  const log = box.querySelector('.thread-log'); if (log) log.scrollTop = log.scrollHeight;
}
async function askAssistant(question) {
  if (!question.trim()) return;
  if (!serverClient || !project()) { toast(t('Сначала подключите проект команды: кнопка «Сервер» и ваш ключ.', 'Көмекші сервердегі жобамен жұмыс істейді: сервер мен кілтті қосыңыз.')); return; }
  assistantHistory.push({ role: 'user', content: question }); assistantCollapsed = false; assistantPending = t('думаю…', 'ойланып тұрмын…'); refreshThread();
  try {
    const page = route();
    const result = await serverClient.request('POST', `/api/projects/${encodeURIComponent(state.activeId)}/assistant`, { question, section: page === 'overview' ? '' : page, history: assistantHistory.slice(0, -1).slice(-10) });
    const answer = result?.data?.answer || t('Пустой ответ.', 'Бос жауап.');
    if (result?.data?.tokeny) { meState.tokeny = result.data.tokeny; for (const node of document.querySelectorAll('[data-tokeny]')) node.textContent = tokenyLabel(); }
    assistantHistory.push({ role: 'assistant', content: answer });
  } catch (error) {
    const message = error?.status === 402 ? t('Токены закончились. Откройте «Токены и пополнение» в меню слева внизу, и я продолжу.', 'Токендер бітті. Сол жақ төмендегі мәзірден «Токендер мен толтыру» бөлімін ашыңыз.') : error?.status === 503 ? t('Помощника ещё не подключили. Вопрос я записал и отвечу, как только он заработает.', 'Көмекші әлі қосылмаған: серверде модель кілті жоқ.') : (error?.message || t('Помощник не ответил.', 'Көмекші жауап бермеді.'));
    assistantHistory.push({ role: 'assistant', content: message });
  } finally { assistantPending = ''; refreshThread(); }
}
function listenVoice() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) { toast(t('Голос недоступен в этом браузере — напишите команду.', 'Бұл браузерде дауыс қолжетімсіз — команданы жазыңыз.')); return; }
  const rec = new Rec(); rec.lang = state.locale === 'kk' ? 'kk-KZ' : 'ru-RU'; rec.interimResults = false; rec.maxAlternatives = 1;
  const status = document.querySelector('[data-voice-status]'); const listening = t('слушаю…', 'тыңдап тұрмын…'); if (status) status.textContent = listening;
  rec.onresult = event => { const text = event.results[0][0].transcript; const input = document.querySelector('#voice-input'); if (input) input.value = text; runCommand(text); };
  rec.onerror = () => { if (status) status.textContent = t('не расслышал — повторите или напишите', 'естімедім — қайталаңыз немесе жазыңыз'); };
  rec.onend = () => { if (status && status.textContent === listening) status.textContent = t('тишина', 'тыныштық'); };
  try { rec.start(); } catch { toast(t('Микрофон занят или запрещён.', 'Микрофон бос емес немесе тыйым салынған.')); }
}
app.addEventListener('submit', event => {
  if (event.target?.id !== 'voice-form') return;
  event.preventDefault();
  const input = event.target.querySelector('#voice-input'); const text = input?.value || '';
  if (!text.trim()) return;
  runCommand(text); if (input) input.value = '';
});
app.addEventListener('click', async event => {
  if (busy || connecting) return;
  if (event.target.closest("[data-action='voice']")) { listenVoice(); return; }
  const threadBtn = event.target.closest('[data-thread]');
  if (threadBtn) { if (threadBtn.dataset.thread === 'clear') assistantHistory.length = 0; else assistantCollapsed = !assistantCollapsed; refreshThread(); return; }
  const chip = event.target.closest('[data-cmd]');
  if (chip) { runCommand(chip.dataset.cmd); return; }
  const pick = event.target.closest('[data-project]');
  if (pick) { const id = pick.dataset.project; await runOperation(async () => { if (!await flushDraft()) { render(); return; } if (serverClient) state.projects[id] = await serverClient.loadProject(id); state.activeId = id; selectedScene = null; sceneFilter = 'all'; playTime = 0; persistPreferences(); go('overview'); render(); }); return; }
  const waitRow = event.target.closest('[data-open-cell]');
  if (waitRow) { event.preventDefault(); mapFilter = 'awaiting'; go('map'); await runOperation(() => mapCellDialog(waitRow.dataset.openCell)); return; }
  const lang = event.target.closest('[data-lang]');
  if (lang) { state.locale = lang.dataset.lang; persistPreferences(); render(); return; }
  const filter = event.target.closest('[data-map-filter]');
  if (filter && ['all', 'mine', 'awaiting'].includes(filter.dataset.mapFilter)) {
    mapFilter = filter.dataset.mapFilter; render();
    document.querySelector(`[data-map-filter='${mapFilter}']`)?.focus({ preventScroll: true }); return;
  }
  const mapCell = event.target.closest('[data-map-cell]');
  if (mapCell) { await runOperation(() => mapCellDialog(mapCell.dataset.mapCell)); return; }
  const step = event.target.closest('[data-step]');
  if (step) { const y = window.scrollY; processStep = Number(step.dataset.step); render(); window.scrollTo(0, y); document.querySelector(`[data-step='${processStep}']`)?.focus({ preventScroll: true }); return; }
  const scene = event.target.closest('[data-select-scene], [data-scene]');
  if (scene) { selectedScene = scene.dataset.selectScene || scene.dataset.scene; if (scene.dataset.selectScene) render(); }
  const shot = event.target.closest('[data-shot]');
  if (shot) shotDialog(shot.dataset.shot);
  const editMember = event.target.closest('[data-edit-member]');
  if (editMember) { memberDialog(editMember.dataset.editMember); return; }
  const revokeMember = event.target.closest('[data-revoke-member]');
  if (revokeMember) { memberRevokeDialog(revokeMember.dataset.revokeMember); return; }
  const seek = event.target.closest('[data-seek-shot]');
  if (seek && project()) { playTime = project().shots.slice(0, Number(seek.dataset.seekShot)).reduce((n, s) => n + s.duration, 0); updatePlayer(); }
  const action = event.target.closest('[data-action]')?.dataset.action;
  const p = project();
  if (action === 'server') serverDialog();
  else if (action === 'tokeny') await runOperation(() => tokenyDialog());
  else if (action === 'refresh-map') await refreshProductionMap();
  else if (action === 'refresh-breakdown') await runOperation(() => refreshCinema());
  else if (action === 'import-breakdown') await runOperation(() => breakdownImportDialog());
  else if (action === 'edit-passport') {
    const control = event.target.closest('[data-action]');
    await runOperation(() => passportDialog(control.dataset.passportCollection, control.dataset.passportId));
  }
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
  if (event.target.id === 'script-paper-mode' || event.target.id === 'production-map-mode' || event.target.hasAttribute?.('data-cinema-mode')) {
    if (!['light', 'graphite'].includes(event.target.value)) return;
    paperPreference = event.target.value;
    applyPaperMode();
    try { localStorage.setItem(paperKey, paperPreference); }
    catch { toast(t('Режим бумаги изменён, но не сохранён на устройстве.', 'Қағаз режимі өзгертілді, бірақ құрылғыда сақталмады.')); }
    return;
  }
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
dialog.addEventListener('change', event => {
  if (event.target.id !== 'member-role') return;
  const role = event.target.value;
  const hint = document.querySelector('#member-role-hint');
  if (hint) hint.textContent = roleHint(role);
  const defaults = defaultSections(role);
  const allowed = roleSections(role).filter(section => grantableSections().includes(section));
  dialog.querySelectorAll("input[name='sections']").forEach(input => {
    input.disabled = !allowed.includes(input.value);
    input.checked = !input.disabled && defaults.includes(input.value);
  });
});
dialog.addEventListener('click', async event => {
  if (busy || connecting) return;
  if (event.target.closest('[data-close]')) dialog.close();
  const paket = event.target.closest('[data-tokeny-paket]');
  if (paket) { const input = dialog.querySelector('#tokeny-amount'); if (input) input.value = paket.dataset.tokenyPaket; return; }
  const grantBtn = event.target.closest('[data-tokeny-grant]');
  if (grantBtn) {
    await runOperation(async () => {
      try {
        await serverClient.request('POST', '/api/tokeny/nachislit', { keyId: grantBtn.dataset.keyId, tokeny: Number(grantBtn.dataset.tokenySum), zayavkaId: grantBtn.dataset.tokenyGrant });
        toast(t('Начислено. Участник увидит токены при следующем вопросе.', 'Қосылды.'));
      } catch (error) { toast(error?.message || t('Не получилось начислить.', 'Қосу мүмкін болмады.')); }
      await tokenyDialog();
    });
    return;
  }
  const declineBtn = event.target.closest('[data-tokeny-decline]');
  if (declineBtn) {
    await runOperation(async () => {
      try { await serverClient.request('POST', `/api/tokeny/zayavki/${encodeURIComponent(declineBtn.dataset.tokenyDecline)}/otklonit`, {}); }
      catch (error) { toast(error?.message || t('Не получилось отклонить.', 'Қабылдамау мүмкін болмады.')); }
      await tokenyDialog();
    });
    return;
  }
  const reopenMapCell = event.target.closest('[data-reopen-map-cell]');
  if (reopenMapCell) { await runOperation(() => mapCellDialog(reopenMapCell.dataset.reopenMapCell)); return; }
  if (event.target.closest('[data-copy-member-key]')) {
    const field = document.querySelector('#issued-member-key');
    if (!field) return;
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(field.value);
      toast(t('Ключ скопирован.', 'Кілт көшірілді.'));
    } catch {
      field.focus(); field.select();
      toast(t('Скопируйте выделенный ключ вручную.', 'Белгіленген кілтті қолмен көшіріңіз.'));
    }
    return;
  }
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
  if (form.id === 'passport-form') {
    await runOperation(() => submitPassport(form, data)); return;
  }
  if (form.id === 'breakdown-import-form') {
    await runOperation(() => submitBreakdownImport(data)); return;
  }
  if (form.id === 'map-approval-form') {
    await runOperation(() => submitMapApproval(form, data, event.submitter?.value || data.get('verdict'))); return;
  }
  await runOperation(async () => {
    if (form.id === 'tokeny-form') {
      const tokeny = Number(data.get('tokeny')); if (!Number.isInteger(tokeny) || tokeny < 1) return;
      try {
        await serverClient.request('POST', '/api/tokeny/zayavka', { tokeny, sposob: String(data.get('sposob') || '') });
        toast(t('Заявка у продюсера. Токены появятся сразу после оплаты.', 'Өтінім продюсерде. Токендер төлемнен кейін бірден қосылады.'));
        dialog.close();
      } catch (error) { toast(error?.message || t('Не получилось отправить заявку.', 'Өтінімді жіберу мүмкін болмады.')); }
      return;
    }
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
      const id = serverClient && String(data.get('slug') || '').trim() || crypto.randomUUID(); const p = makeDemo();
      Object.assign(p, { title: { ru: title, kk: title }, synopsis: { ru: data.get('synopsis').trim(), kk: data.get('synopsis').trim() }, scenes: [], shots: [], members: [{ id: 'owner', name: t('Вы', 'Сіз'), role: 'director', sections: stages().map(s => s.id) }], version: 1, scriptStatus: 'draft', snapshots: [{ version: 1, date: new Date().toISOString(), scenes: [] }] });
      if (serverClient) { p._language = state.scriptLang; state.projects[id] = await serverClient.createProject(id, p); }
      else state.projects[id] = p;
      state.activeId = id; selectedScene = null; sceneFilter = 'all'; playTime = 0;
      if (!serverClient && !await persist()) return;
      dialog.close(); go('script'); toast(t('Проект создан. Добавьте первую сцену.', 'Жоба құрылды. Алғашқы көріністі қосыңыз.'));
    } else if (form.id === 'member-form') {
      if (!canManageTeam()) return;
      const p = project(); const id = form.dataset.id;
      const sections = data.getAll('sections'); if (!sections.length) { toast(t('Выберите хотя бы один раздел.', 'Кемінде бір бөлімді таңдаңыз.')); return; }
      if (id) {
        const member = p.members.find(item => item.id === id); if (!member) return;
        const rights = { sections, ...(serverClient && member.keySource === 'external' ? {} : { role: data.get('role') || member.role }) };
        if (serverClient) { await serverClient.updateMember(state.activeId, id, rights, p); await refreshOwnRights(member, p); }
        else { Object.assign(member, rights); if (!await persist()) return; }
        storageError = ''; dialog.close(); render(); toast(t('Права участника сохранены.', 'Қатысушының құқықтары сақталды.'));
      } else {
        const name = String(data.get('name') || '').trim(); if (!name) return;
        const email = String(data.get('email') || '').trim();
        const rights = { role: data.get('role'), sections };
        if (serverClient) {
          const result = await serverClient.createMember(state.activeId, { name, email, ...rights }, p);
          storageError = ''; render();
          if (typeof result.key === 'string' && result.key) memberKeyDialog(result.key);
          else { dialog.close(); toast(t('Участник добавлен, но сервер не вернул ключ. Отзовите доступ и добавьте участника повторно.', 'Қатысушы қосылды, бірақ сервер кілтті қайтармады. Қолжетімділікті қайтарып, қатысушыны қайта қосыңыз.')); }
        } else {
          p.members.push({ id: crypto.randomUUID(), name, email, ...rights });
          if (!await persist()) return;
          dialog.close(); render(); toast(t('Участник добавлен в локальный прототип.', 'Қатысушы жергілікті прототипке қосылды.'));
        }
      }
    } else if (form.id === 'member-revoke-form') {
      if (!serverClient || !canManageTeam()) return;
      const member = project().members.find(item => item.id === form.dataset.id);
      if (!member || member.accessStatus === 'revoked') return;
      const own = member.keyId === project()._principal?.id;
      await serverClient.revokeMember(state.activeId, member.id, project());
      if (own) removeCurrentProject();
      storageError = ''; dialog.close(); render(); toast(t('Доступ участника отозван.', 'Қатысушының қолжетімділігі қайтарылды.'));
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
dialog.addEventListener('close', () => {
  // A close event can arrive after this native dialog has already reopened.
  if (dialog.open) return;
  mapCard = null; passportCard = null; importCard = null;
  const issued = Boolean(dialog.dataset.memberKey);
  if (issued) { dialog.innerHTML = ''; delete dialog.dataset.memberKey; }
  if (lastFocus?.isConnected) lastFocus.focus();
  else if (issued) document.querySelector("[data-action='member']")?.focus();
});
function render() {
  stopPlayback(); document.documentElement.lang = state.locale; document.title = t('neyra.vision — от истории к кадру', 'neyra.vision — оқиғадан кадрға');
  app.innerHTML = route() === 'home' ? landing() : workspace(route()); app.inert = busy || connecting;
  if (route() === 'animatic') updatePlayer();
  if (cinemaPages.includes(route()) && serverClient && project() && !connecting && !cinemaState.loading && !cinemaState.ready && !cinemaState.error) void refreshCinema();
  if ((route() === 'map' || route() === 'overview') && serverClient && project() && !connecting && !mapState.loading && !mapState.ready && !mapState.error) void refreshProductionMap();
  if (route() !== 'home' && serverClient && project() && !connecting) void refreshMe();
}
window.addEventListener('hashchange', () => {
  cinemaState.token += 1; cinemaState.loading = false; cinemaState.ready = false; cinemaState.error = ''; passportCard = null; importCard = null;
  if (route() === 'map') { mapState.ready = false; mapState.error = ''; }
  else { mapState.token += 1; mapState.loading = false; mapCard = null; }
  render(); const hash = location.hash; if (['#process', '#project', '#about'].includes(hash)) document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }); else window.scrollTo(0, 0);
});
applyPaperMode();
render();

window.addEventListener('beforeunload', event => { if (serverClient && (draftTimer || pendingWrites || storageError)) { event.preventDefault(); event.returnValue = ''; } });
if (settings.key) connectServer();
