import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { frameAt, totalDuration } from './timeline.js';
import { makeDemo } from './data.js';

const shots = [{ duration: 4 }, { duration: 3 }, { duration: 5 }];
assert.equal(totalDuration(shots), 12);
assert.equal(frameAt(shots, 0), 0);
assert.equal(frameAt(shots, 3.9), 0);
assert.equal(frameAt(shots, 4), 1);
assert.equal(frameAt(shots, 7), 2);
assert.equal(frameAt(shots, 12), 2);
assert.equal(frameAt([], 0), 0);
const a = makeDemo();
const b = makeDemo();
a.scenes[0].text.ru = 'Авторская правка';
assert.notEqual(a.scenes[0].text.ru, b.scenes[0].text.ru);
assert.equal(a.scenes[0].text.kk, b.scenes[0].text.kk);
assert.ok(a.shots.every(shot => a.scenes.some(scene => scene.id === shot.sceneId)));
console.log('Timeline boundaries, independent project drafts and bilingual text: passed.');

// API double follows the public routes and persists native server objects. It has
// deliberately small pages and rejects stale revisions, secrets in bodies,
// invalid member references, and duplicate IDs like the actual server.
const clone = value => structuredClone(value);
const date = '2026-10-13T00:00:00Z';
const sections = ['overview', 'script', 'storyboard', 'shots', 'animatic', 'team', 'post'];
const secrets = { 'admin-secret': { id: 'admin-local', role: 'admin', sections }, 'writer-secret': { id: 'writer-local', role: 'writer', sections: ['overview', 'script'] } };
const baseProject = slug => ({
  slug, title: `Проект ${slug}`, synopsis: '', language: 'ru', createdAt: date, updatedAt: date, revision: 1,
  translations: { ru: { title: `Проект ${slug}`, synopsis: '' }, kk: { title: `Жоба ${slug}`, synopsis: '' } },
  script: { text: '', language: 'ru', status: 'draft', updatedAt: date, translations: { ru: '', kk: '' } },
  scenes: [], shots: [], versions: [], members: [], post: []
});
const metadata = p => Object.fromEntries(['slug', 'title', 'synopsis', 'language', 'createdAt', 'updatedAt', 'revision', 'translations'].filter(k => k in p).map(k => [k, clone(p[k])]));
const reply = (status, data, revision) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...(revision ? { ETag: `"${revision}"` } : {}) } });
const errorReply = (status, code) => reply(status, { error: { code, message: `Ошибка API: ${code}` } });

function nativeApi(slugs = ['film']) {
  const projects = new Map(slugs.map(slug => [slug, baseProject(slug)]));
  const calls = [];
  let sequence = 0;
  let fail = null;
  const allowed = (principal, p, section) => principal.sections.includes(section) && (principal.role === 'admin' || p.members.some(m => m.keyId === principal.id && m.sections.includes(section)));
  const paginate = (items, url) => {
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 2);
    return { data: clone(items.slice(offset, offset + limit)), pagination: { offset, limit, total: items.length } };
  };
  const snapshot = (p, kind, label = '', sourceVersionId) => {
    const result = { id: `v${++sequence}`, number: p.versions.length + 1, kind, label, script: clone(p.script), scenes: clone(p.scenes), createdAt: date, createdBy: 'admin-local' };
    if (sourceVersionId) result.sourceVersionId = sourceVersionId;
    p.versions.push(result);
    return result;
  };
  const checkFields = (body, names) => {
    assert.ok(body && !Array.isArray(body) && typeof body === 'object', 'API expects a JSON object');
    for (const name of Object.keys(body)) assert.ok(names.includes(name), `Unexpected API field: ${name}`);
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);
    const key = headers.get('X-Key');
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    const call = { path: url.pathname, search: url.search, method, body: clone(body), key, ifMatch: headers.get('If-Match'), committed: false };
    calls.push(call);
    assert.equal(url.origin, 'http://127.0.0.1:8770', 'Configured server address is used');
    assert.ok(!url.href.includes('secret'), 'Secret cannot be placed in URL');
    assert.ok(!options.body || !options.body.includes('secret'), 'Secret cannot be placed in JSON');
    if (body !== undefined) assert.match(headers.get('Content-Type'), /application\/json/);
    const principal = secrets[key];
    if (!principal) return errorReply(401, 'UNAUTHORIZED');
    if (fail?.(call)) { fail = null; return errorReply(500, 'STORAGE_WRITE_FAILED'); }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'projects') return errorReply(404, 'NOT_FOUND');
    if (parts.length === 2) {
      if (method === 'GET') return reply(200, paginate([...projects.values()].filter(p => allowed(principal, p, 'overview')).map(metadata), url));
      if (method !== 'POST') return errorReply(405, 'METHOD_NOT_ALLOWED');
      checkFields(body, ['slug', 'title', 'synopsis', 'language', 'translations']);
      assert.equal(typeof body.title, 'string');
      if (projects.has(body.slug)) return errorReply(409, 'ALREADY_EXISTS');
      const p = { ...baseProject(body.slug), ...clone(body) };
      p.post = ['edit', 'color', 'sound', 'vfx'].map(id => ({ id, done: false }));
      p.members.push({ id: `m${++sequence}`, name: 'Создатель проекта', role: principal.role, keyId: principal.id, sections: clone(principal.sections) });
      projects.set(p.slug, p);
      call.committed = true;
      return reply(201, { data: metadata(p) }, p.revision);
    }
    const p = projects.get(parts[2]);
    if (!p) return errorReply(404, 'NOT_FOUND');
    const collection = parts[3];
    const section = ({ scenes: 'script', versions: 'script', members: 'team' })[collection] || collection || 'overview';
    if (!allowed(principal, p, section)) return errorReply(403, 'FORBIDDEN');
    if (method !== 'GET') {
      call.beforeRevision = p.revision;
      if (call.ifMatch !== `"${p.revision}"`) return errorReply(409, 'REVISION_CONFLICT');
    }
    let data;
    let status = 200;
    if (!collection) {
      if (method === 'GET') return reply(200, { data: metadata(p) }, p.revision);
      checkFields(body, ['title', 'synopsis', 'language', 'translations']);
      Object.assign(p, clone(body));
      data = metadata(p);
    } else if (collection === 'script') {
      if (method === 'GET') return reply(200, { data: clone(p.script) }, p.revision);
      assert.equal(method, 'PUT');
      checkFields(body, ['text', 'language', 'status', 'translations']);
      assert.equal(typeof body.text, 'string');
      if (body.text !== p.script.text || JSON.stringify(body.translations) !== JSON.stringify(p.script.translations)) p.shots.forEach(s => { s.needsReview = true; });
      p.script = { ...clone(body), updatedAt: date };
      data = p.script;
    } else if (collection === 'post') {
      if (method === 'GET') return reply(200, { data: { tasks: clone(p.post) } }, p.revision);
      assert.equal(method, 'PUT');
      checkFields(body, ['tasks']);
      body.tasks.forEach(task => { checkFields(task, ['id', 'done']); assert.equal(typeof task.done, 'boolean'); });
      p.post = clone(body.tasks);
      data = { tasks: p.post };
    } else if (collection === 'versions') {
      const version = p.versions.find(v => v.id === parts[4]);
      if (method === 'GET') return reply(200, parts[4] ? { data: clone(version) } : paginate(p.versions.map(v => Object.fromEntries(Object.entries(v).filter(([k]) => !['script', 'scenes'].includes(k)))), url), p.revision);
      assert.equal(method, 'POST');
      if (parts[5] === 'restore') {
        assert.deepEqual(body, {}, 'Restore must send an explicit empty JSON object');
        if (!version) return errorReply(404, 'NOT_FOUND');
        const backup = snapshot(p, 'backup');
        p.script = { ...clone(version.script), status: 'draft', updatedAt: date };
        p.scenes = clone(version.scenes);
        p.shots.forEach(s => { s.needsReview = true; });
        const restored = snapshot(p, 'restored', '', version.id);
        data = { script: p.script, backupVersionId: backup.id, restoredVersionId: restored.id };
      } else {
        checkFields(body, ['label']);
        data = snapshot(p, 'saved', body.label);
      }
      status = 201;
    } else if (['scenes', 'shots', 'members'].includes(collection)) {
      const items = p[collection];
      const item = items.find(i => i.id === parts[4]);
      if (method === 'GET') return reply(200, parts[4] ? { data: clone(item) } : paginate(items, url), p.revision);
      if (method === 'DELETE') {
        if (collection === 'scenes' && p.shots.some(s => s.sceneId === item.id)) return errorReply(409, 'SCENE_IN_USE');
        items.splice(items.indexOf(item), 1);
        data = { id: item.id, deleted: true };
      } else {
        const names = collection === 'scenes' ? ['title', 'text', 'translations'] : collection === 'shots' ? ['sceneId', 'title', 'description', 'prompt', 'duration', 'status', 'owner', 'lens', 'movement', 'imageUrl', 'videoUrl', 'translations', 'comments'] : ['name', 'role', 'sections', 'keyId'];
        checkFields(body, method === 'POST' && collection !== 'members' ? ['id', ...names] : names);
        if (collection === 'members') {
          const target = Object.values(secrets).find(s => s.id === (body.keyId || item?.keyId));
          assert.ok(target, 'Members must reference an external keyId');
          assert.equal(body.role || item?.role, target.role);
          if (items.some(m => m !== item && m.keyId === body.keyId)) return errorReply(409, 'ALREADY_EXISTS');
        } else {
          if ('title' in body) assert.equal(typeof body.title, 'string');
          if (collection === 'shots' && body.sceneId) assert.ok(p.scenes.some(s => s.id === body.sceneId), 'Shot must link to a server scene');
        }
        if (method === 'POST') {
          const id = body.id || `${collection === 'members' ? 'm' : 'item'}${++sequence}`;
          if (items.some(i => i.id === id)) return errorReply(409, 'ALREADY_EXISTS');
          data = { ...clone(body), id, ...(collection === 'shots' ? { aspectRatio: '16:9', needsReview: false } : {}) };
          items.push(data);
          status = 201;
        } else {
          assert.ok(item, `Cannot update unknown ${collection} item`);
          Object.assign(item, clone(body));
          data = item;
          if (collection === 'scenes') p.shots.filter(s => s.sceneId === item.id).forEach(s => { s.needsReview = true; });
          if (collection === 'shots' && body.status === 'approved') item.needsReview = false;
        }
      }
    } else return errorReply(404, 'NOT_FOUND');
    p.revision += 1;
    call.committed = true;
    if (!collection) data = metadata(p);
    return reply(status, { data: clone(data) }, p.revision);
  };
  return { projects, calls, fetchImpl, failOnce: matcher => { fail = matcher; } };
}

const { StudioServer } = await import('./storage.js');
const connect = (api, key = 'admin-secret') => new StudioServer({ url: 'http://127.0.0.1:8770/', key, fetchImpl: api.fetchImpl });

// A reload uses all server pages; it does not import the local demo or fabricate
// unavailable sections. The role needs a member binding before it can read.
{
  const api = nativeApi(['first', 'second', 'third']);
  const client = connect(api);
  const loaded = await client.loadProjects();
  assert.deepEqual(Object.keys(loaded), ['first', 'second', 'third']);
  assert.ok(api.calls.some(c => c.path === '/api/projects' && c.search.includes('offset=2')));
  assert.equal((await client.request('GET', '/api/projects/first')).revision, 1);
  assert.deepEqual(loaded.first.scenes, []);
  assert.deepEqual(loaded.first.shots, []);
  assert.deepEqual(loaded.first.post, []);
  const writer = connect(api, 'writer-secret');
  assert.deepEqual(await writer.loadProjects(), {});
  await assert.rejects(writer.loadProject('first'), err => err.status === 403 && err.code === 'FORBIDDEN');
  const p = loaded.first;
  p.members.push({ id: 'local-writer', name: 'Сценарист <script>', role: 'writer', sections: ['overview', 'script'], keyId: 'writer-local' });
  const saved = await client.saveProject('first', p);
  assert.notEqual(saved.members[0].id, 'local-writer', 'Use the member ID assigned by POST /members');
  assert.equal(api.projects.get('first').members[0].keyId, 'writer-local');
  const restricted = await writer.loadProject('first');
  assert.deepEqual(restricted._denied.sort(), ['post', 'shots', 'team']);
  for (const field of ['scenes', 'shots', 'members', 'post', 'snapshots']) assert.deepEqual(restricted[field], [], `Denied/empty ${field} must not disclose demo contents`);
  assert.ok(api.calls.filter(c => c.path.includes('/members') && c.method === 'POST').every(c => Object.hasOwn(c.body, 'keyId') && !Object.hasOwn(c.body, 'key')));
}
console.log('Server pagination, explicit member binding and restricted sections: passed.');

// Save author-created bilingual material, reopen it with a new client, then
// restore a version. The version preserves the current draft and shot assets.
{
  const api = nativeApi([]);
  const client = connect(api);
  const source = makeDemo();
  source.scenes[0].text.ru = 'Автор: <script>alert("тест")</script> & "кадр"\nНовая строка.';
  source.scenes[0].text.kk = 'Ә Ғ Қ Ң Ө Ұ Ү Һ І <script>мәтін</script>\nАвтор мәтіні.';
  source.shots[0].comments.push({ author: '<img onerror=alert(1)>', text: '<script>Комментарий</script>', date });
  source.shots[0].imageUrl = 'assets/hero.jpg';
  source.shots[0].videoUrl = 'https://example.test/shot.mp4';
  let p = await client.createProject('new-film', source);
  assert.deepEqual(p.scenes, [], 'Creating a project must not upload the local demo');
  assert.deepEqual(p.shots, []);
  p.scenes = clone(source.scenes);
  p.shots = clone(source.shots);
  p.post = clone(source.post);
  p.post[0].done = true;
  await client.saveProject('new-film', p);
  const reopenedClient = connect(api);
  p = await reopenedClient.loadProject('new-film');
  assert.deepEqual(p.title, source.title);
  assert.deepEqual(p.synopsis, source.synopsis);
  assert.deepEqual(p.scenes.map(s => ({ id: s.id, title: s.title, text: s.text })), source.scenes.map(s => ({ id: s.id, title: s.title, text: s.text })));
  for (const field of ['title', 'description', 'prompt', 'movement', 'comments', 'duration', 'status', 'owner', 'lens', 'imageUrl', 'videoUrl']) assert.deepEqual(p.shots[0][field], source.shots[0][field], `Shot field ${field} survives server reload`);
  assert.ok(api.projects.get('new-film').shots.every(s => s.aspectRatio === '16:9'));
  assert.equal(p.post[0].done, true);
  assert.ok(p._scriptText.includes(source.scenes[0].text.ru));
  assert.ok(p._scriptTranslations.kk.includes(source.scenes[0].text.kk));
  assert.ok(api.calls.some(c => c.path.endsWith('/scenes') && c.search.includes('offset=2')));
  assert.ok(api.calls.some(c => c.path.endsWith('/shots') && c.search.includes('offset=4')));
  p = await reopenedClient.saveVersion('new-film', p);
  const firstVersion = p.snapshots[0].id;
  const savedText = p._scriptText;
  const savedScenes = clone(p.scenes);
  p.scenes[0].text.ru = 'Следующая редакция, которую нужно сохранить в резервной версии.';
  p = await reopenedClient.saveVersion('new-film', p);
  const currentText = p._scriptText;
  p = await reopenedClient.restoreVersion('new-film', firstVersion);
  assert.equal(p._scriptText, savedText);
  assert.deepEqual(p.scenes.map(s => s.text), savedScenes.map(s => s.text));
  assert.equal(p.scriptStatus, 'draft');
  assert.equal(p.snapshots.length, 4, 'Restore adds both backup and restored versions');
  assert.equal(p.snapshots.find(v => v.kind === 'backup').scriptText, currentText);
  assert.equal(p.snapshots.find(v => v.kind === 'backup').scenes[0].text.ru, 'Следующая редакция, которую нужно сохранить в резервной версии.');
  assert.equal(p.shots[0].imageUrl, 'assets/hero.jpg');
  assert.equal(p.shots[0].videoUrl, 'https://example.test/shot.mp4');
  assert.ok(p.shots.every(s => s.needsReview));
  assert.equal(p.version, 4);
  assert.ok(api.calls.some(c => c.path.endsWith('/versions') && c.search.includes('offset=2')));
  assert.deepEqual(api.calls.find(c => c.path.endsWith('/restore')).body, {});
  for (const call of api.calls.filter(c => c.committed && c.beforeRevision)) assert.equal(call.ifMatch, `"${call.beforeRevision}"`, 'Each write advances the confirmed revision');
  assert.ok(api.calls.every(c => c.key === 'admin-secret'));
}
console.log('Bilingual API round trip, raw author text, draft, assets and version restore: passed.');

// An independently edited Fountain draft survives an unrelated post edit.
{
  const api = nativeApi();
  const native = api.projects.get('film');
  native.script.text = 'Title: Авторский Fountain\n\nINT. ROOM - DAY\n\n<script>Весь текст</script>';
  native.script.translations.ru = native.script.text;
  const client = connect(api);
  const p = await client.loadProject('film');
  p.post = [{ id: 'sound', done: true }];
  await client.saveProject('film', p);
  assert.equal(native.script.text, p._scriptText);
  assert.ok(!api.calls.some(c => c.method === 'PUT' && c.path.endsWith('/script')), 'Unrelated edits do not replace the Fountain draft with derived scenes');
  assert.deepEqual((await connect(api).loadProject('film')).post, [{ id: 'sound', done: true }]);
}

// A partial save is visible as an error. Retrying uses confirmed server state,
// avoiding duplicate scenes/members and still completing the pending draft.
{
  const api = nativeApi();
  const client = connect(api);
  const p = await client.loadProject('film');
  p.scenes = clone(makeDemo().scenes.slice(0, 2));
  p.members.push({ id: 'pending-writer', name: 'Сценарист', role: 'writer', sections: ['overview', 'script'], keyId: 'writer-local' });
  const pendingCopy = clone(p);
  api.failOnce(c => c.method === 'PUT' && c.path.endsWith('/script'));
  await assert.rejects(client.saveProject('film', p), err => err.status === 500 && err.code === 'STORAGE_WRITE_FAILED');
  assert.equal(api.projects.get('film').scenes.length, 2);
  assert.equal(api.projects.get('film').members.length, 1);
  assert.equal(api.projects.get('film').script.text, '', 'Failed draft is not falsely confirmed');
  await client.saveProject('film', pendingCopy);
  const reopened = await connect(api).loadProject('film');
  assert.equal(reopened.scenes.length, 2);
  assert.equal(reopened.members.length, 1);
  assert.equal(pendingCopy.members[0].id, reopened.members[0].id, 'A retry from the original temporary member ID gets the confirmed server ID');
  assert.ok(reopened._scriptText.includes(p.scenes[0].text.ru));
  assert.equal(api.calls.filter(c => c.method === 'POST' && c.path.endsWith('/scenes')).length, 2, 'Retry must not recreate confirmed scenes');
  assert.equal(api.calls.filter(c => c.method === 'POST' && c.path.endsWith('/members')).length, 1, 'Retry must not recreate a confirmed member');
  for (const call of api.calls.filter(c => c.committed && c.beforeRevision)) assert.equal(call.ifMatch, `"${call.beforeRevision}"`);
}
console.log('Unrelated draft preservation, write failure and safe partial-save retry: passed.');

// A stale client must not overwrite another writer. Network and authentication
// failures are distinguishable from a successful request.
{
  const api = nativeApi();
  const client = connect(api);
  const p = await client.loadProject('film');
  api.projects.get('film').revision += 1;
  p.post = [{ id: 'edit', done: true }];
  await assert.rejects(client.saveProject('film', p), err => err.status === 409 && err.code === 'REVISION_CONFLICT');
  assert.deepEqual(api.projects.get('film').post, []);
  await assert.rejects(connect(api, '').loadProjects(), err => err.status === 401 && err.code === 'UNAUTHORIZED');
  const offline = new StudioServer({ key: 'admin-secret', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.loadProjects(), err => err.status === 0 && err.code === 'NETWORK_ERROR');
}
console.log('Revision conflict, missing key and typed network error: passed.');

// Data created by another client can have one language and an independent
// Fountain draft. Loading must use the primary fields without inventing text.
{
  const api = nativeApi();
  const native = api.projects.get('film');
  delete native.translations;
  native.language = 'kk';
  native.title = 'Әңгіме';
  native.synopsis = 'Ғ Қ Ң Ө Ұ Ү Һ І';
  native.scenes = [{ id: 'external-scene', title: 'ІШКІ. ҮЙ — ТҮН', text: 'Автор <script>мәтіні</script>' }];
  native.script = { text: 'Title: Әңгіме\n\nАвтордың толық мәтіні.', language: 'kk', status: 'review', updatedAt: date };
  const p = await connect(api).loadProject('film');
  assert.deepEqual(p.title, { ru: '', kk: native.title });
  assert.deepEqual(p.synopsis, { ru: '', kk: native.synopsis });
  assert.deepEqual(p.scenes[0].text, { ru: '', kk: native.scenes[0].text });
  assert.equal(p._scriptText, native.script.text);
  assert.equal(p._language, 'kk');
  assert.equal(p.scriptStatus, 'review');
}

// A project that changes halfway through loading is reread as one revision,
// avoiding a mixed model that could overwrite a newer editor's draft.
{
  const api = nativeApi();
  let concurrentEdit = true;
  const client = new StudioServer({ key: 'admin-secret', fetchImpl: async (url, options) => {
    const response = await api.fetchImpl(url, options);
    if (concurrentEdit && new URL(url).pathname.endsWith('/scenes')) {
      concurrentEdit = false;
      const native = api.projects.get('film');
      native.revision += 1;
      native.script.text = 'Черновик, изменённый во время чтения';
      native.script.translations.ru = native.script.text;
    }
    return response;
  } });
  const p = await client.loadProject('film');
  assert.equal(p._revision, 2);
  assert.equal(p._scriptText, 'Черновик, изменённый во время чтения');
}
console.log('External single-language draft and consistent concurrent reload: passed.');

// Execute the actual app with a tiny event surface. This verifies saving and
// rendering behavior without claiming browser layout or native DOM coverage.
const appSource = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
async function appHarness({ stored = new Map(), api, fetchImpl, hash = '#/studio/script', failStorage = false } = {}) {
  const timers = new Map();
  let timerId = 0;
  const handlers = new Map();
  const label = { textContent: '' };
  const storageErrorNode = { textContent: '', hidden: true };
  const element = () => ({
    listeners: new Map(), innerHTML: '', textContent: '', value: '', dataset: {}, inert: false, open: false,
    classList: { add() {}, remove() {}, toggle() {} }, style: {}, isConnected: true,
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    showModal() { this.open = true; }, close() { this.open = false; this.listeners.get('close')?.({}); },
    focus() {}, click() {}, setAttribute() {}, querySelector() { return null; }
  });
  const app = element(), dialog = element(), toast = element(), draft = element();
  let markup = '';
  Object.defineProperty(app, 'innerHTML', { get: () => markup, set: value => {
    markup = value;
    label.textContent = /data-storage-label[^>]*>([^<]*)/.exec(value)?.[1] || '';
  } });
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { if (failStorage) throw new Error('Quota exceeded'); stored.set(key, value); } };
  class TestServer extends StudioServer { constructor(settings) { super({ ...settings, fetchImpl: fetchImpl || api?.fetchImpl || (async () => { throw new TypeError('Offline'); }) }); } }
  const document = {
    documentElement: {}, activeElement: null, title: '',
    querySelector(selector) { return ({ '#app': app, '#dialog': dialog, '#toast': toast, '#draft-text': draft })[selector] || (selector.startsWith('.') ? element() : null); },
    querySelectorAll(selector) { return selector === '[data-storage-label]' ? [label] : selector === '[data-storage-error]' ? [storageErrorNode] : []; }
  };
  const window = { scrollY: 0, scrollTo() {}, addEventListener: (name, handler) => handlers.set(name, handler) };
  const context = vm.createContext({
    makeDemo, frameAt, totalDuration, StudioServer: TestServer, structuredClone, localStorage, document, window,
    location: { hash }, crypto: globalThis.crypto, console, URL, Blob, performance,
    FormData: class { constructor(form) { this.fields = form.fields; } get(name) { return this.fields[name] ?? null; } getAll(name) { const v = this.fields[name]; return Array.isArray(v) ? v : v == null ? [] : [v]; } },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: () => ++timerId, clearInterval() {}
  });
  vm.runInContext(appSource, context, { filename: 'studio/app.js' });
  const settle = async () => {
    for (let i = 0; i < 300 && vm.runInContext('connecting || pendingWrites || busy', context); i += 1) await Promise.resolve();
    assert.equal(vm.runInContext('connecting || pendingWrites || busy', context), false, 'App asynchronous operation must finish');
  };
  const dispatch = async (surface, type, target) => surface.listeners.get(type)?.({ target, preventDefault() {} });
  const click = action => dispatch(app, 'click', { closest: selector => selector === '[data-action]' ? { dataset: { action } } : null });
  const input = (id, value) => dispatch(app, 'input', { id, value });
  const submit = (id, fields, dataset = {}) => dispatch(dialog, 'submit', { id, fields, dataset });
  const flushInput = async () => { for (const [id, timer] of [...timers]) if (timer.delay === 350) { timers.delete(id); timer.callback(); } await settle(); };
  await settle();
  return { app, dialog, toast, label, storageErrorNode, stored, context, click, input, submit, flushInput, settle, timers,
    navigate: async page => { context.location.hash = `#/studio/${page}`; await handlers.get('hashchange')?.(); },
    setStorageFailure: value => { failStorage = value; }
  };
}
const localState = p => ({ locale: 'ru', scriptLang: 'ru', activeId: 'existing', projects: { existing: p } });
const workspaceKey = 'neyra-vision-prototype-v1';
const settingsStorageKey = 'neyra-vision-server-settings-v1';

{
  const p = makeDemo();
  p.title.ru = '<script>Название</script>';
  const stored = new Map([[workspaceKey, JSON.stringify(localState(p))]]);
  const ui = await appHarness({ stored });
  assert.equal(ui.label.textContent, 'только в этом браузере');
  assert.ok(ui.app.innerHTML.includes('&lt;script&gt;Название&lt;/script&gt;'));
  assert.ok(!ui.app.innerHTML.includes('<script>Название'));
  await ui.click('server');
  assert.ok(ui.dialog.innerHTML.includes("value='http://127.0.0.1:8770'"));
  assert.ok(ui.dialog.innerHTML.includes("type='password'"));
  const raw = '<script>Авторский текст</script> & "реплика"';
  await ui.input('scene-text', raw);
  assert.equal(JSON.parse(stored.get(workspaceKey)).projects.existing.scenes[0].text.ru, raw);
  const restarted = await appHarness({ stored });
  assert.ok(restarted.app.innerHTML.includes('&lt;script&gt;Авторский текст&lt;/script&gt; &amp; &quot;реплика&quot;'));
  await restarted.click('save-script');
  assert.equal(restarted.toast.textContent, 'Версия сценария сохранена.');
  assert.equal(JSON.parse(stored.get(workspaceKey)).projects.existing.version, 2);
  restarted.setStorageFailure(true);
  await restarted.input('scene-text', 'Невозможно записать');
  assert.ok(restarted.toast.textContent.includes('Не удалось сохранить в браузере'));
  await restarted.click('save-script');
  assert.ok(!restarted.toast.textContent.includes('Версия сценария сохранена'), 'Quota failure must not claim a successful version');
}
console.log('Actual app local startup, default settings, escaping, persistence and quota failure: passed.');

{
  const api = nativeApi();
  const native = api.projects.get('film');
  native.scenes = [{ id: 's1', title: 'ИНТ. КОМНАТА — ДЕНЬ', text: 'Начало', translations: { ru: { title: 'ИНТ. КОМНАТА — ДЕНЬ', text: 'Начало' }, kk: { title: 'ІШКІ. ҮЙ — КҮН', text: 'Басы' } } }];
  native.script = { text: 'ИНТ. КОМНАТА — ДЕНЬ\n\nНачало', language: 'ru', status: 'draft', updatedAt: date, translations: { ru: 'ИНТ. КОМНАТА — ДЕНЬ\n\nНачало', kk: 'ІШКІ. ҮЙ — КҮН\n\nБасы' } };
  const originalLocal = JSON.stringify(localState(makeDemo()));
  const stored = new Map([[workspaceKey, originalLocal], [settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]);
  const ui = await appHarness({ stored, api });
  assert.equal(ui.label.textContent, 'сохранено на сервере');
  assert.equal(stored.get(workspaceKey), originalLocal, 'Connecting retains the independent browser workspace');
  await ui.click('add-scene');
  assert.ok(native.script.text.includes('НОВАЯ СЦЕНА'));
  await ui.click('save-script');
  assert.ok(native.versions.at(-1).script.text.includes('НОВАЯ СЦЕНА'), 'A follow-up save must retain the draft derived by add-scene');
  api.failOnce(c => c.method === 'PATCH' && c.path.includes('/scenes/'));
  await ui.input('scene-text', 'Правка с ошибкой сохранения');
  await ui.flushInput();
  assert.equal(ui.label.textContent, 'ошибка сохранения');
  assert.ok(!ui.toast.textContent.includes('Версия сценария сохранена'));
  await ui.click('save-script');
  assert.ok(native.versions.at(-1).script.text.includes('Правка с ошибкой сохранения'), 'Explicit save retries a failed draft');
  assert.equal(ui.label.textContent, 'сохранено на сервере');
}
console.log('Actual app server label, derived draft follow-up, failed-save label and explicit retry: passed.');

{
  const api = nativeApi();
  const native = api.projects.get('film');
  native.scenes = [{ id: 's1', title: 'Сцена', text: 'Начало', translations: { ru: { title: 'Сцена', text: 'Начало' }, kk: { title: 'Көрініс', text: 'Басы' } } }];
  let hold = false, release, started = false, holdPath = 'script';
  const fetchImpl = async (url, options) => {
    if (hold && ['PUT', 'POST'].includes(options.method) && new URL(url).pathname.endsWith(`/${holdPath}`)) {
      hold = false; started = true;
      await new Promise(resolve => { release = resolve; });
    }
    return api.fetchImpl(url, options);
  };
  const stored = new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]);
  const ui = await appHarness({ stored, api, fetchImpl });
  hold = true;
  await ui.input('scene-text', 'Первая правка');
  for (const [id, timer] of [...ui.timers]) if (timer.delay === 350) { ui.timers.delete(id); timer.callback(); }
  for (let i = 0; i < 100 && !started; i += 1) await Promise.resolve();
  assert.ok(started, 'Delayed write reached the server boundary');
  assert.equal(ui.label.textContent, 'сохраняется на сервере…');
  await ui.input('scene-text', 'Следующая правка во время сохранения');
  release(); await ui.settle();
  assert.equal(ui.label.textContent, 'сохраняется на сервере…', 'A newer unsent draft keeps the pending label');
  await ui.flushInput();
  assert.ok(native.script.text.includes('Следующая правка во время сохранения'), 'An earlier response cannot overwrite a newer author input');
  api.failOnce(c => c.method === 'PUT' && c.path.endsWith('/script'));
  await ui.input('scene-text', 'Сцены успели сохраниться, черновик — нет');
  await ui.flushInput();
  await ui.input('draft-text', 'Title: Новый полный авторский текст после ошибки\n\n<script>Сохрани дословно</script>');
  await ui.flushInput();
  assert.equal(native.script.text, 'Title: Новый полный авторский текст после ошибки\n\n<script>Сохрани дословно</script>', 'A pending derived draft cannot replace a newer explicit full draft');
  hold = true; holdPath = 'versions'; started = false;
  const savingVersion = ui.click('save-script');
  for (let i = 0; i < 100 && !started; i += 1) await Promise.resolve();
  assert.ok(started);
  assert.equal(ui.label.textContent, 'сохраняется на сервере…', 'A version is pending until its POST response confirms persistence');
  assert.equal(ui.app.inert, true);
  assert.equal(ui.dialog.inert, true);
  release(); await savingVersion;
  assert.equal(ui.label.textContent, 'сохранено на сервере');
  assert.equal(ui.app.inert, false);
}
console.log('Actual app in-flight author edits and full-draft retry after partial failure: passed.');

{
  const api = nativeApi();
  const native = api.projects.get('film');
  native.script.text = 'Title: Независимый текущий Fountain\n\nПолный текст вне списка сцен.';
  native.script.translations.ru = native.script.text;
  native.versions.push({ id: 'historic', number: 1, kind: 'saved', label: '', createdAt: date, createdBy: 'admin-local', scenes: [], script: { ...clone(native.script), text: 'Title: Исторический Fountain\n\nИсторический текст вне сцен.', translations: { ru: 'Title: Исторический Fountain\n\nИсторический текст вне сцен.' } } });
  let offline = false;
  const fetchImpl = async (url, options) => { if (offline) throw new TypeError('Disconnected'); return api.fetchImpl(url, options); };
  const original = localState(makeDemo());
  original.projects.existing.snapshots = [{ version: 1, date, scenes: clone(original.projects.existing.scenes) }];
  const stored = new Map([[workspaceKey, JSON.stringify(original)], [settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]);
  const ui = await appHarness({ stored, api, fetchImpl });
  offline = true;
  const current = 'Title: Несохранённый полный Fountain\n\n<script>Последняя авторская правка</script>';
  await ui.input('draft-text', current);
  await ui.flushInput();
  assert.equal(ui.label.textContent, 'только в этом браузере');
  const local = JSON.parse(stored.get(workspaceKey));
  assert.deepEqual(local.projects.existing, original.projects.existing, 'Offline fallback retains original browser projects');
  assert.ok(local.projects.film.scenes.some(s => s.text.ru.includes(current)), 'Offline recovery includes the independent current Fountain draft');
  assert.ok(local.projects.film.snapshots.some(v => v.scenes.some(s => s.text.ru.includes('Исторический текст вне сцен.'))), 'Offline recovery retains independent historical version text');
  assert.ok(ui.toast.textContent.includes('локальной копией'));
  offline = false;
  const failedStored = new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]);
  const quotaUi = await appHarness({ stored: failedStored, api, fetchImpl });
  quotaUi.setStorageFailure(true); offline = true;
  await quotaUi.input('draft-text', 'Черновик при заполненном localStorage');
  await quotaUi.flushInput();
  assert.ok(!quotaUi.toast.textContent.includes('сохранён локальной копией'), 'A failed fallback write cannot claim local persistence');
  assert.ok(quotaUi.toast.textContent.includes('Не удалось сохранить в браузере'));
}
console.log('Actual app offline recovery of current and historical drafts, including local quota failure: passed.');

{
  const api = nativeApi();
  const client = connect(api);
  let p = await client.loadProject('film');
  p.scenes = clone(makeDemo().scenes);
  p.shots = clone(makeDemo().shots);
  await client.saveProject('film', p);
  p = await client.loadProject('film');
  for (const shot of p.shots) { shot.status = 'approved'; shot.needsReview = false; }
  await client.saveProject('film', p);
  assert.ok(p.shots.every(s => !s.needsReview));
  assert.ok(api.projects.get('film').shots.every(s => !s.needsReview), 'Reapproving an already approved shot must clear the server review flag too');
  const oldPrimaryDraft = p._scriptText;
  p.scenes[0].text.kk += '\nҚазақша авторлық түзету.';
  await client.saveProject('film', p);
  assert.equal(p._scriptText, oldPrimaryDraft, 'A Kazakh edit preserves the primary Russian draft');
  assert.ok(p.shots.every(s => s.needsReview), 'A translated draft change marks every shot for review');
  assert.ok(api.projects.get('film').shots.every(s => s.needsReview));
}
console.log('Translated draft change preserves Russian text and marks all shot materials for review: passed.');
