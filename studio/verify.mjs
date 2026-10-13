import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { frameAt, totalDuration } from './timeline.js';
import { makeDemo, DEFAULT_SERVER_URL } from './data.js';
import { BreakdownApi, canWriteBreakdownSection } from './breakdown-api.js';
import { renderBreakdownSection, renderPassportEditor } from './breakdown.js';
import { renderGeroyWorkshop } from './geroy.js';
import { svgPaths as ikonki } from './ikonki.js';
import { verifyBreakdownModules } from './breakdown-tests.js';
import { ProductionMapApi, canApproveCell } from './production-map-api.js';
import { renderProductionMap, renderProductionCell, productionObjectLabel, productionStageName } from './production-map.js';

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
const sections = ['overview', 'script', 'breakdown', 'heroes', 'locations', 'world', 'storyboard', 'shots', 'continuity', 'sound', 'edit', 'plan', 'journal', 'animatic', 'team', 'post'];
const productionStages = ['script', 'breakdown', 'heroes', 'locations', 'storyboard', 'shots', 'video', 'sound', 'edit'];
const legacyStageSections = { script: 'script', breakdown: 'script', heroes: 'storyboard', locations: 'storyboard', storyboard: 'storyboard', shots: 'shots', video: 'animatic', sound: 'post', edit: 'post' };
const secrets = {
  'admin-secret': { id: 'admin-local', role: 'admin', sections },
  'writer-secret': { id: 'writer-local', role: 'writer', sections: ['overview', 'script'] },
  'producer-secret': { id: 'producer-local', role: 'producer', sections },
  'director-secret': { id: 'director-local', role: 'director', sections },
  'viewer-secret': { id: 'viewer-local', role: 'viewer', sections },
  'artist-secret': { id: 'artist-local', role: 'artist', sections: ['overview', 'heroes', 'locations', 'shots', 'team'] }
};
const baseProject = slug => ({
  slug, title: `Проект ${slug}`, synopsis: '', language: 'ru', createdAt: date, updatedAt: date, revision: 1,
  translations: { ru: { title: `Проект ${slug}`, synopsis: '' }, kk: { title: `Жоба ${slug}`, synopsis: '' } },
  script: { text: '', language: 'ru', status: 'draft', updatedAt: date, translations: { ru: '', kk: '' } },
  scenes: [], characters: [], locations: [], shots: [], versions: [], members: [], post: [], cells: [], approvals: [], activity: []
});
const metadata = p => Object.fromEntries(['slug', 'title', 'synopsis', 'language', 'createdAt', 'updatedAt', 'revision', 'translations'].filter(k => k in p).map(k => [k, clone(p[k])]));
const reply = (status, data, revision) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...(revision ? { ETag: `"${revision}"` } : {}) } });
const errorReply = (status, code) => reply(status, { error: { code, message: `Ошибка API: ${code}` } });

function nativeApi(slugs = ['film']) {
  const projects = new Map(slugs.map(slug => [slug, baseProject(slug)]));
  const issuedKeys = new Map();
  const calls = [];
  let sequence = 0;
  let fail = null;
  const manageTeam = (principal, p) => ['admin', 'producer', 'director'].includes(principal.role) && (principal.role === 'admin' || p.members.some(m => (principal.memberId ? m.id === principal.memberId : m.keyId === principal.id) && m.accessStatus !== 'revoked'));
  const allowed = (principal, p, section) => principal.sections.includes(section) && (principal.role === 'admin' || p.members.some(m => (principal.memberId ? m.id === principal.memberId && principal.slug === p.slug : m.keyId === principal.id) && m.accessStatus !== 'revoked' && m.sections.includes(section)));
  const approvalAllowed = (principal, p, cell) => {
    const section = principal.memberId ? cell.stage === 'video' ? 'animatic' : cell.stage : legacyStageSections[cell.stage];
    return principal.role !== 'viewer' && allowed(principal, p, 'overview') && allowed(principal, p, section)
      && !({ writer: ['breakdown'], editor: ['sound'] })[principal.role]?.includes(section)
      && ['admin', 'producer', cell.approverRole].includes(principal.role);
  };
  const productionMap = (p, principal) => {
    const objects = [...p.scenes.map(s => ({ type: 'scene', id: s.id })), ...p.shots.map(s => ({ type: 'shot', id: s.id }))];
    for (const cell of p.cells) if (!objects.some(o => o.type === cell.object.type && o.id === cell.object.id)) objects.push(clone(cell.object));
    return { project: p.slug, stages: productionStages, objects, cells: p.cells,
      grid: objects.map(object => ({ object, stages: Object.fromEntries(productionStages.map(stage => [stage, p.cells.find(c => c.stage === stage && c.object.type === object.type && c.object.id === object.id) || null])) })),
      myTasks: p.cells.filter(c => c.assignee.keyId === principal.id), awaitingMe: p.cells.filter(c => c.status === 'awaiting' && approvalAllowed(principal, p, c)) };
  };
  const publicMember = member => ({ ...clone(member), keySource: member.keyId?.startsWith('member-') ? 'issued' : 'external', accessStatus: member.accessStatus || (member.keyId ? 'active' : 'unavailable') });
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
    const issued = issuedKeys.get(key);
    const issuedMember = issued && projects.get(issued.slug)?.members.find(m => m.id === issued.memberId && m.accessStatus === 'active');
    const principal = secrets[key] || (issuedMember && { id: issuedMember.keyId, memberId: issuedMember.id, slug: issued.slug, role: issuedMember.role, sections: issuedMember.sections });
    if (!principal) return errorReply(401, 'UNAUTHORIZED');
    if (fail?.matcher(call)) { const failure = fail; fail = null; return errorReply(failure.status, failure.code); }
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
    const section = ['characters', 'locations'].includes(collection) ? method === 'GET' ? 'overview' : collection === 'characters' ? 'heroes' : 'locations'
      : ({ scenes: 'script', versions: 'script', members: 'team', map: 'overview', cells: 'overview', approvals: 'overview', activity: 'overview' })[collection] || collection || 'overview';
    if (!allowed(principal, p, section) && !(collection === 'members' && manageTeam(principal, p))) return errorReply(403, 'FORBIDDEN');
    if (collection === 'members' && method !== 'GET' && !manageTeam(principal, p)) return errorReply(403, 'FORBIDDEN');
    if (method !== 'GET' && ['characters', 'locations', 'breakdown'].includes(collection)
      && !(collection === 'breakdown' ? ['admin', 'producer', 'director', 'assistant_director'] : ['admin', 'producer', 'director', 'artist']).includes(principal.role)) return errorReply(403, 'FORBIDDEN');
    if (method !== 'GET') {
      call.beforeRevision = p.revision;
      if (call.ifMatch !== `"${p.revision}"`) return errorReply(409, 'REVISION_CONFLICT');
    }
    let data;
    let status = 200;
    if (!collection) {
      if (method === 'GET') return reply(200, { data: { ...metadata(p), capabilities: { manageTeam: manageTeam(principal, p) }, principal: { id: principal.id, role: principal.role, projects: principal.slug ? [principal.slug] : ['*'], sections: clone(principal.sections) } } }, p.revision);
      checkFields(body, ['title', 'synopsis', 'language', 'translations']);
      Object.assign(p, clone(body));
      data = metadata(p);
    } else if (['characters', 'locations'].includes(collection)) {
      if (method === 'GET') {
        const item = parts[4] && p[collection].find(item => item.id === parts[4]);
        if (parts[4] && !item) return errorReply(404, 'NOT_FOUND');
        return reply(200, parts[4] ? { data: clone(item) } : paginate(p[collection], url), p.revision);
      }
      assert.equal(method, 'PATCH');
      checkFields(body, ['name', 'role', 'identity', 'taboo', 'height', 'status', 'scenes', 'refs', 'translations', 'aliases']);
      const item = p[collection].find(item => item.id === parts[4]);
      if (!item) return errorReply(404, 'NOT_FOUND');
      Object.assign(item, clone(body));
      data = item;
    } else if (collection === 'breakdown') {
      assert.equal(method, 'POST');
      checkFields(body, ['scenes', 'characters', 'locations']);
      const normalize = name => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
      data = { summary: {}, scenes: [], characters: [], locations: [] };
      for (const group of ['scenes', 'characters', 'locations']) {
        data.summary[group] = { created: 0, updated: 0, unchanged: 0 };
        for (const incoming of body[group]) {
          let item = p[group].find(item => group === 'scenes' ? item.n === incoming.n : normalize(item.name) === normalize(incoming.name));
          const created = !item;
          if (created) {
            item = group === 'scenes' ? { id: `scene-${++sequence}`, text: '', translations: {} }
              : { id: `${group}-${++sequence}`, name: incoming.name, role: '', identity: '', taboo: [], height: '', refs: [], status: 'draft', scenes: [], translations: {} };
            p[group].push(item);
          }
          if (group === 'scenes') {
            const { heading, ...fields } = incoming;
            Object.assign(item, clone(fields), { title: heading });
            p.shots.filter(shot => shot.sceneId === item.id).forEach(shot => { shot.needsReview = true; });
          } else Object.assign(item, clone(Object.fromEntries(Object.entries(incoming).filter(([field]) => field !== 'name'))));
          data.summary[group][created ? 'created' : 'updated'] += 1;
          data[group].push(group === 'scenes' ? { id: item.id, n: item.n } : { id: item.id, name: item.name });
        }
      }
    } else if (collection === 'map') {
      assert.equal(method, 'GET');
      assert.equal(url.search, '', '/map does not accept pagination parameters');
      return reply(200, { data: clone(productionMap(p, principal)) }, p.revision);
    } else if (collection === 'cells') {
      assert.equal(method, 'GET');
      return reply(200, parts[4] ? { data: clone(p.cells.find(c => c.id === parts[4])) } : paginate(p.cells, url), p.revision);
    } else if (collection === 'activity') {
      assert.equal(method, 'GET');
      return reply(200, paginate(p.activity, url), p.revision);
    } else if (collection === 'approvals') {
      if (method === 'GET') return reply(200, paginate(p.approvals, url), p.revision);
      assert.equal(method, 'POST');
      checkFields(body, ['object', 'stage', 'version', 'variant', 'verdict', 'comment']);
      const cell = p.cells.find(c => c.stage === body.stage && c.object.type === body.object.type && c.object.id === body.object.id);
      if (!cell) return errorReply(404, 'NOT_FOUND');
      if (!approvalAllowed(principal, p, cell)) return errorReply(403, 'FORBIDDEN');
      if (body.version !== cell.version || body.variant !== cell.variant) return errorReply(409, 'APPROVAL_CONFLICT');
      if (cell.status !== 'awaiting') return errorReply(409, 'CELL_NOT_AWAITING');
      assert.ok(['approved', 'returned'].includes(body.verdict));
      assert.ok(body.version || body.variant);
      data = { ...clone(body), id: `approval-${++sequence}`, project: p.slug, cellId: cell.id, keyId: principal.id, createdAt: date };
      p.approvals.push(data);
      Object.assign(cell, { status: body.verdict, comment: body.comment, updatedAt: date });
      p.activity.push({ id: `activity-${sequence}`, sequence: p.activity.length + 1, action: `approval.${body.verdict}`, object: clone(body.object), stage: body.stage, cellId: cell.id, version: body.version, variant: body.variant, status: body.verdict, approvalId: data.id, keyId: principal.id, name: principal.id, createdAt: date });
      status = 201;
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
    } else if (collection === 'members') {
      const member = p.members.find(m => m.id === parts[4]);
      if (method === 'GET') return reply(200, parts[4] ? { data: publicMember(member) } : paginate(p.members.map(publicMember), url), p.revision);
      let issuedKey;
      if (method === 'DELETE') {
        assert.ok(member, 'Cannot revoke an unknown member');
        member.accessStatus = 'revoked';
        data = publicMember(member);
        for (const [token, binding] of issuedKeys) if (binding.slug === p.slug && binding.memberId === member.id) issuedKeys.delete(token);
      } else {
        checkFields(body, ['name', 'email', 'role', 'sections', 'keyId']);
        if (body.keyId || (member?.keyId && !member.keyId.startsWith('member-'))) {
          const target = Object.values(secrets).find(s => s.id === (body.keyId || member.keyId));
          assert.ok(target, 'Legacy members must reference an external keyId');
          assert.equal(body.role || member?.role, target.role);
          if (p.members.some(m => m !== member && m.keyId === body.keyId)) return errorReply(409, 'ALREADY_EXISTS');
        }
        if (method === 'POST') {
          data = { ...clone(body), id: `m${++sequence}`, accessStatus: 'active' };
          if (!body.keyId) {
            assert.equal(typeof body.email, 'string', 'Minting requires the participant email');
            data.keyId = `member-${data.id}`;
            issuedKey = `issued-member-${sequence}-secret`;
            issuedKeys.set(issuedKey, { slug: p.slug, memberId: data.id });
          }
          p.members.push(data);
          status = 201;
        } else {
          assert.equal(method, 'PATCH');
          assert.ok(member, 'Cannot change unknown member rights');
          Object.assign(member, clone(body));
          data = publicMember(member);
        }
      }
      p.revision += 1;
      call.committed = true;
      return reply(status, { data: publicMember(data), ...(issuedKey ? { key: issuedKey } : {}) }, p.revision);
    } else if (['scenes', 'shots'].includes(collection)) {
      const items = p[collection];
      const item = items.find(i => i.id === parts[4]);
      if (method === 'GET') return reply(200, parts[4] ? { data: clone(item) } : paginate(items, url), p.revision);
      if (method === 'DELETE') {
        if (collection === 'scenes' && p.shots.some(s => s.sceneId === item.id)) return errorReply(409, 'SCENE_IN_USE');
        items.splice(items.indexOf(item), 1);
        data = { id: item.id, deleted: true };
      } else {
        const names = collection === 'scenes' ? ['title', 'text', 'translations'] : ['sceneId', 'title', 'description', 'prompt', 'duration', 'status', 'owner', 'lens', 'movement', 'imageUrl', 'videoUrl', 'translations', 'comments'];
        checkFields(body, method === 'POST' ? ['id', ...names] : names);
        if ('title' in body) assert.equal(typeof body.title, 'string');
        if (collection === 'shots' && body.sceneId) assert.ok(p.scenes.some(s => s.id === body.sceneId), 'Shot must link to a server scene');
        if (method === 'POST') {
          const id = body.id || `item${++sequence}`;
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
  return { projects, calls, fetchImpl, failOnce: (matcher, status = 500, code = 'STORAGE_WRITE_FAILED') => { fail = { matcher, status, code }; } };
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
async function appHarness({ stored = new Map(), api, fetchImpl, useDefaultFetch = false, hash = '#/studio/script', failStorage = false, systemDark = false, queuedDialogClose = false } = {}) {
  const timers = new Map();
  let timerId = 0;
  const handlers = new Map();
  const downloads = [];
  const clipboard = [];
  const label = { textContent: '' };
  const storageErrorNode = { textContent: '', hidden: true };
  const element = () => ({
    listeners: new Map(), innerHTML: '', textContent: '', value: '', dataset: {}, inert: false, open: false,
    classList: { values: new Set(), add(...names) { names.forEach(name => this.values.add(name)); }, remove(...names) { names.forEach(name => this.values.delete(name)); }, toggle(name, force) { const enabled = force ?? !this.values.has(name); enabled ? this.values.add(name) : this.values.delete(name); return enabled; }, contains(name) { return this.values.has(name); } }, style: {}, isConnected: true,
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    showModal() { this.open = true; }, close() { this.open = false; this.listeners.get('close')?.({}); },
    focus() {}, select() {}, click() {}, setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    insertAdjacentHTML(position, html) { this.innerHTML = position === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html; }
  });
  const app = element(), dialog = element(), toast = element(), draft = element(), paperControl = element(), mapControl = element(), mapSurface = element(), mapErrorNode = element(), cinemaControl = element(), cinemaSurface = element(), passportErrorNode = element();
  if (queuedDialogClose) dialog.close = function () { this.open = false; queueMicrotask(() => this.listeners.get('close')?.({})); };
  const memberRoleHint = element(), issuedMemberKey = element();
  let memberSections = [];
  let mapSubmitButtons = [];
  dialog.querySelector = selector => selector === '[data-map-error]' ? mapErrorNode : selector === '[data-passport-error]' ? passportErrorNode : null;
  dialog.querySelectorAll = selector => selector === "input[name='sections']" ? memberSections : selector === '#map-approval-form button[type="submit"]' ? mapSubmitButtons : [];
  let dialogMarkup = '';
  Object.defineProperty(dialog, 'innerHTML', { get: () => dialogMarkup, set: value => {
    dialogMarkup = value;
    issuedMemberKey.value = /<textarea\b[^>]*id=['"]issued-member-key['"][^>]*>([\s\S]*?)<\/textarea>/.exec(value)?.[1] || '';
    memberRoleHint.textContent = /id=['"]member-role-hint['"][^>]*>([^<]*)/.exec(value)?.[1] || '';
    memberSections = [...value.matchAll(/<input\b[^>]*name=['"]sections['"][^>]*>/g)].map(([tag]) => ({ value: /value=['"]([^'"]*)['"]/.exec(tag)?.[1] || '', checked: /\bchecked\b/.test(tag), disabled: /\bdisabled\b/.test(tag) }));
    mapSubmitButtons = [...value.matchAll(/<button\b[^>]*type=['"]submit['"][^>]*name=['"]verdict['"][^>]*>/g)].map(([tag]) => ({ value: /value=['"]([^'"]*)['"]/.exec(tag)?.[1] || '', disabled: /\bdisabled\b/.test(tag) }));
    mapErrorNode.textContent = ''; mapErrorNode.hidden = true; passportErrorNode.textContent = ''; passportErrorNode.hidden = true;
  } });
  paperControl.id = 'script-paper-mode'; paperControl.dataset.paperMode = '';
  let markup = '', markupWrites = 0;
  Object.defineProperty(app, 'innerHTML', { get: () => markup, set: value => {
    markup = value; markupWrites += 1;
    label.textContent = /data-storage-label[^>]*>([^<]*)/.exec(value)?.[1] || '';
    const options = /<select\b[^>]*id=['"]script-paper-mode['"][^>]*>([\s\S]*?)<\/select>/.exec(value)?.[1];
    paperControl.value = options ? /<option\b[^>]*value=['"]([^'"]+)['"][^>]*\bselected\b/.exec(options)?.[1] || 'light' : '';
    const mapOptions = /<select\b[^>]*id=['"]production-map-mode['"][^>]*>([\s\S]*?)<\/select>/.exec(value)?.[1];
    mapControl.value = mapOptions ? /<option\b[^>]*value=['"]([^'"]+)['"][^>]*\bselected\b/.exec(mapOptions)?.[1] || 'graphite' : '';
    mapSurface.dataset.mapMode = /<section\b[^>]*class=['"]production-map['"][^>]*data-map-mode=['"]([^'"]*)['"]/.exec(value)?.[1] || '';
    const cinemaOptions = /<select\b[^>]*id=['"]cinema-mode['"][^>]*>([\s\S]*?)<\/select>/.exec(value)?.[1];
    cinemaControl.value = cinemaOptions ? /<option\b[^>]*value=['"]([^'"]+)['"][^>]*\bselected\b/.exec(cinemaOptions)?.[1] || 'graphite' : '';
    cinemaSurface.dataset.cinemaMode = /<section\b[^>]*class=['"]cinema-section['"][^>]*[^>]*data-cinema-mode=['"]([^'"]*)['"]/.exec(value)?.[1] || '';
  } });
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { if (failStorage) throw new Error('Quota exceeded'); stored.set(key, value); } };
  class TestServer extends StudioServer { constructor(settings) { super({ ...settings, fetchImpl: fetchImpl || api?.fetchImpl || (async () => { throw new TypeError('Offline'); }) }); } }
  const document = {
    documentElement: { dataset: {} }, activeElement: null, title: '',
    querySelector(selector) { return ({ '#app': app, '#dialog': dialog, '#toast': toast, '#draft-text': draft, '#script-paper-mode': paperControl.value ? paperControl : null, '#production-map-mode': mapControl.value ? mapControl : null, '#member-role-hint': memberRoleHint, '#issued-member-key': issuedMemberKey })[selector] || (selector.startsWith('.') ? element() : null); },
    querySelectorAll(selector) { return selector === '[data-storage-label]' ? [label] : selector === '[data-storage-error]' ? [storageErrorNode] : selector === '[data-cinema-mode]' ? cinemaControl.value ? [cinemaControl] : [] : selector === '.cinema-section, .passport-dialog' ? [...(cinemaControl.value ? [cinemaSurface] : []), ...(dialog.classList.contains('passport-dialog') ? [dialog] : [])] : selector === '[data-paper-mode]' && paperControl.value ? [paperControl] : selector === '.production-map, .map-dialog' ? [...(mapControl.value ? [mapSurface] : []), ...(dialog.classList.contains('map-dialog') ? [dialog] : [])] : []; },
    createElement() { return element(); }
  };
  const schemeListeners = new Set();
  const scheme = { media: '(prefers-color-scheme: dark)', matches: systemDark, addEventListener(type, handler) { if (type === 'change') schemeListeners.add(handler); } };
  const window = { scrollY: 0, scrollTo() {}, addEventListener: (name, handler) => handlers.set(name, handler), matchMedia: () => scheme };
  const context = vm.createContext({
    makeDemo, DEFAULT_SERVER_URL, BreakdownApi, canWriteBreakdownSection, renderBreakdownSection, renderPassportEditor, renderGeroyWorkshop, ikonki, frameAt, totalDuration, ProductionMapApi, canApproveCell, renderProductionMap, renderProductionCell, productionObjectLabel, productionStageName,
    StudioServer: useDefaultFetch ? StudioServer : TestServer, structuredClone, localStorage, document, window,
    location: { hash }, crypto: globalThis.crypto, console, navigator: { clipboard: { writeText: async text => { clipboard.push(text); } } }, URL: class extends URL { static createObjectURL(blob) { downloads.push(blob); return 'blob:test-download'; } static revokeObjectURL() {} }, Blob, performance,
    FormData: class { constructor(form) { this.fields = form.fields; } get(name) { return this.fields[name] ?? null; } getAll(name) { const v = this.fields[name]; return Array.isArray(v) ? v : v == null ? [] : [v]; } },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: () => ++timerId, clearInterval() {}
  });
  vm.runInContext(appSource, context, { filename: 'studio/app.js' });
  const settle = async () => {
    const pending = 'connecting || pendingWrites || busy || mapState.loading || cinemaState.loading';
    for (let i = 0; i < 300 && vm.runInContext(pending, context); i += 1) await Promise.resolve();
    assert.equal(Boolean(vm.runInContext(pending, context)), false, 'App asynchronous operation must finish');
  };
  const dispatch = async (surface, type, target, extra = {}) => surface.listeners.get(type)?.({ target, preventDefault() {}, ...extra });
  const dataAttribute = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const click = action => dispatch(app, 'click', { closest: selector => selector === '[data-action]' ? { dataset: { action } } : null });
  const clickData = (attribute, value) => dispatch(app, 'click', { closest: selector => selector === `[data-${attribute}]` ? { dataset: { [dataAttribute(attribute)]: value } } : null });
  const dialogClickData = (attribute, value = '') => dispatch(dialog, 'click', { closest: selector => selector === `[data-${attribute}]` ? { dataset: { [dataAttribute(attribute)]: value } } : null });
  const dialogChange = (id, value) => dispatch(dialog, 'change', { id, value });
  const input = (id, value) => dispatch(app, 'input', { id, value });
  const change = (id, value) => dispatch(app, 'change', { id, value, dataset: id === paperControl.id ? paperControl.dataset : {}, hasAttribute: name => id === 'cinema-mode' && name === 'data-cinema-mode' });
  const submit = (id, fields, dataset = {}, submitterValue) => dispatch(dialog, 'submit', { id, fields, dataset }, submitterValue ? { submitter: { value: submitterValue } } : {});
  const flushInput = async () => { for (const [id, timer] of [...timers]) if (timer.delay === 350) { timers.delete(id); timer.callback(); } await settle(); };
  await settle();
  return { app, dialog, toast, label, storageErrorNode, stored, context, document, paperControl, mapControl, mapSurface, mapErrorNode, cinemaControl, cinemaSurface, passportErrorNode, memberRoleHint, issuedMemberKey, clipboard, click, clickData, dialogClickData, dialogChange, input, change, submit, flushInput, settle, timers, downloads,
    clickPassport: (collection, id) => dispatch(app, 'click', { closest: selector => selector === '[data-action]' ? { dataset: { action: 'edit-passport', passportCollection: collection, passportId: id } } : null }),
    get mapSubmitButtons() { return mapSubmitButtons; },
    get markupWrites() { return markupWrites; },
    navigate: async page => { context.location.hash = `#/studio/${page}`; await handlers.get('hashchange')?.(); },
    setSystemDark: async value => { scheme.matches = value; for (const listener of schemeListeners) await listener({ matches: value, media: scheme.media }); },
    setStorageFailure: value => { failStorage = value; }
  };
}
const localState = p => ({ locale: 'ru', scriptLang: 'ru', activeId: 'existing', projects: { existing: p } });
const workspaceKey = 'neyra-vision-prototype-v1';
const settingsStorageKey = 'neyra-vision-server-settings-v1';
const paperStorageKey = 'neyra-vision-script-paper-v1';

// Paper belongs to this device: it follows the system until an explicit choice,
// survives reload and never rewrites the editor or changes author/server data.
{
  for (const systemDark of [false, true]) {
    const expected = systemDark ? 'graphite' : 'light';
    const defaults = await appHarness({ systemDark });
    assert.equal(defaults.document.documentElement.dataset.scriptPaper, expected);
    assert.equal(defaults.paperControl.value, expected);
    const invalid = await appHarness({ systemDark, stored: new Map([[paperStorageKey, 'unknown']]) });
    assert.equal(invalid.document.documentElement.dataset.scriptPaper, expected, 'An invalid preference falls back to the system');
    const savedMode = systemDark ? 'light' : 'graphite';
    const saved = await appHarness({ systemDark, stored: new Map([[paperStorageKey, savedMode]]) });
    assert.equal(saved.document.documentElement.dataset.scriptPaper, savedMode, 'A saved choice overrides the system');
  }

  const p = makeDemo();
  const author = '<script>Автор & Ә Ғ Қ Ң Ө Ұ Ү Һ І</script>\n\n"Реплика"';
  p.scenes[0].text.ru = author;
  p.snapshots = [{ version: p.version, date, scenes: clone(p.scenes) }];
  const originalWorkspace = JSON.stringify(localState(p));
  const stored = new Map([[workspaceKey, originalWorkspace]]);
  const api = nativeApi();
  const ui = await appHarness({ stored, api, systemDark: true });
  assert.match(ui.app.innerHTML, /for='script-paper-mode'>Бумага:/);
  assert.match(ui.app.innerHTML, /value='light'[^>]*>светлая<\/option>/);
  assert.match(ui.app.innerHTML, /value='graphite'[^>]*>графит<\/option>/);
  await ui.setSystemDark(false);
  assert.equal(ui.document.documentElement.dataset.scriptPaper, 'light');
  assert.equal(ui.paperControl.value, 'light', 'The control follows a system change before a manual choice');
  await ui.setSystemDark(true);
  assert.equal(ui.document.documentElement.dataset.scriptPaper, 'graphite');
  const beforeChange = ui.markupWrites;
  const originalModel = vm.runInContext('JSON.stringify(state)', ui.context);
  await ui.change('script-paper-mode', 'light');
  assert.equal(ui.document.documentElement.dataset.scriptPaper, 'light');
  assert.equal(ui.paperControl.value, 'light');
  assert.equal(ui.markupWrites, beforeChange, 'Changing paper preserves the current editor DOM and cursor');
  assert.equal(vm.runInContext('JSON.stringify(state)', ui.context), originalModel, 'The author model is unchanged');
  assert.equal(stored.get(workspaceKey), originalWorkspace);
  assert.equal(stored.get(settingsStorageKey), undefined);
  assert.equal(stored.get(paperStorageKey), 'light');
  assert.equal(api.calls.length, 0);
  await ui.setSystemDark(false); await ui.setSystemDark(true);
  assert.equal(ui.document.documentElement.dataset.scriptPaper, 'light', 'System changes preserve the manual choice');
  const reloaded = await appHarness({ stored, systemDark: true });
  assert.equal(reloaded.document.documentElement.dataset.scriptPaper, 'light', 'The device choice survives a reload');

  // Both read-only script surfaces retain escaped author text and use the same
  // themed paper class. The UI language does not choose the script language.
  await ui.clickData('shot', p.shots[0].id);
  const scenePreview = /<section class='script-paper script-preview'[\s\S]*?<\/section>/.exec(ui.dialog.innerHTML)?.[0];
  assert.ok(scenePreview?.includes('&lt;script&gt;Автор &amp; Ә Ғ Қ Ң Ө Ұ Ү Һ І&lt;/script&gt;'));
  assert.ok(!scenePreview.includes('<textarea'), 'The shot shows a read-only linked scene');
  ui.dialog.close();
  await ui.click('versions');
  assert.match(ui.dialog.innerHTML, /<pre class='script-preview'>/);
  assert.ok(ui.dialog.innerHTML.includes('&lt;script&gt;Автор &amp; Ә Ғ Қ Ң Ө Ұ Ү Һ І&lt;/script&gt;'));
  ui.dialog.close();

  ui.setStorageFailure(true);
  await ui.change('script-paper-mode', 'graphite');
  assert.equal(ui.document.documentElement.dataset.scriptPaper, 'graphite', 'A failed device write still applies the current choice');
  assert.equal(stored.get(paperStorageKey), 'light');
  assert.match(ui.toast.textContent, /не сохранён/);
  ui.setStorageFailure(false);
  await ui.clickData('lang', 'kk');
  assert.match(ui.app.innerHTML, /for='script-paper-mode'>Қағаз:/);
  assert.match(ui.app.innerHTML, /value='light'[^>]*>ашық<\/option>/);
  assert.match(ui.app.innerHTML, /value='graphite'[^>]*>графит<\/option>/);
  assert.equal(vm.runInContext('project().scenes[0].text.ru', ui.context), author);
  ui.setStorageFailure(true);
  await ui.change('script-paper-mode', 'light');
  assert.match(ui.toast.textContent, /сақталмады/);
  ui.setStorageFailure(false);
  await ui.change('script-paper-mode', 'graphite');

  const localBeforeConnect = stored.get(workspaceKey);
  await ui.click('server');
  await ui.submit('server-form', { url: 'http://127.0.0.1:8770', key: 'admin-secret' });
  assert.equal(ui.document.documentElement.dataset.scriptPaper, 'graphite', 'Connecting retains the device paper choice');
  assert.equal(ui.paperControl.value, 'graphite');
  const callsBeforePaper = api.calls.length;
  const serverBeforePaper = JSON.stringify(api.projects.get('film'));
  await ui.change('script-paper-mode', 'light');
  assert.equal(api.calls.length, callsBeforePaper, 'Changing paper does not write project data to the API');
  assert.equal(JSON.stringify(api.projects.get('film')), serverBeforePaper);
  assert.equal(stored.get(workspaceKey), localBeforeConnect);
  assert.deepEqual(JSON.parse(stored.get(settingsStorageKey)), { url: 'http://127.0.0.1:8770', key: 'admin-secret' });
}
console.log('Actual app device paper preference, system changes, editor preservation, RU/KZ and script previews: passed.');

// Browser fetch requires its global receiver. Use the real client constructor
// and its default fetch, rather than TestServer's injected arrow function.
{
  const api = nativeApi();
  api.projects.get('film').script.text = 'Серверный черновик после перезагрузки';
  const originalLocal = JSON.stringify(localState(makeDemo()));
  const stored = new Map([[workspaceKey, originalLocal]]);
  const originalFetch = globalThis.fetch;
  const receivers = [];
  globalThis.fetch = async function (input, options) {
    receivers.push(this);
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return api.fetchImpl(input, options);
  };
  try {
    const first = await appHarness({ stored, useDefaultFetch: true });
    assert.equal(first.label.textContent, 'только в этом браузере');
    assert.equal(receivers.length, 0, 'No connection without a saved role key');
    await first.click('server');
    await first.submit('server-form', { url: 'http://127.0.0.1:8770', key: 'admin-secret' });
    assert.equal(first.label.textContent, 'всё сохранено', 'The first submit must connect without a retry');
    assert.equal(first.storageErrorNode.textContent, '');
    assert.deepEqual(JSON.parse(stored.get(settingsStorageKey)), { url: 'http://127.0.0.1:8770', key: 'admin-secret' });
    assert.equal(api.calls.filter(c => c.path === '/api/projects').length, 1);

    const callsBeforeReload = api.calls.length;
    const reloaded = await appHarness({ stored, useDefaultFetch: true });
    assert.equal(reloaded.label.textContent, 'всё сохранено', 'Saved settings must reconnect on startup without clicks');
    assert.equal(reloaded.storageErrorNode.textContent, '');
    assert.equal(vm.runInContext('serverClient instanceof StudioServer', reloaded.context), true);
    assert.equal(vm.runInContext('state.activeId', reloaded.context), 'film');
    assert.equal(vm.runInContext('Object.keys(state.projects).join(",")', reloaded.context), 'film');
    assert.equal(vm.runInContext('project()._scriptText', reloaded.context), api.projects.get('film').script.text);
    const reloadCalls = api.calls.slice(callsBeforeReload);
    assert.equal(reloadCalls.filter(c => c.path === '/api/projects').length, 1, 'Startup connects once');
    assert.ok(reloadCalls.length > 1, 'Startup also loads server project contents');
    assert.ok(api.calls.every(c => c.method === 'GET' && c.key === 'admin-secret'));
    assert.equal(stored.get(workspaceKey), originalLocal, 'Connecting and reload retain the separate local workspace');
    assert.ok(receivers.length > 0 && receivers.every(receiver => receiver === globalThis));
  } finally {
    globalThis.fetch = originalFetch;
  }
}
console.log('Native-like default fetch receiver, first connection and automatic reconnect with saved settings: passed.');

{
  const p = makeDemo();
  p.title.ru = '<script>Название</script>';
  const stored = new Map([[workspaceKey, JSON.stringify(localState(p))]]);
  const ui = await appHarness({ stored });
  assert.equal(ui.label.textContent, 'только в этом браузере');
  assert.ok(ui.app.innerHTML.includes('&lt;script&gt;Название&lt;/script&gt;'));
  assert.ok(!ui.app.innerHTML.includes('<script>Название'));
  await ui.click('server');
  assert.ok(ui.dialog.innerHTML.includes("value='https://api.studio.neyra.vision'"));
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
  assert.equal(ui.label.textContent, 'всё сохранено');
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
  assert.equal(ui.label.textContent, 'всё сохранено');
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
  assert.equal(ui.label.textContent, 'всё сохранено');
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

{
  const api = nativeApi();
  const native = api.projects.get('film');
  const independent = 'Title: Независимый Fountain\n\n<script>Авторский текст вне списка сцен</script>';
  native.script.text = independent;
  native.script.translations.ru = independent;
  native.scenes = [{ id: 's1', title: 'Первоначальная сцена', text: 'Сценический текст' }];
  const stored = new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]);
  const ui = await appHarness({ stored, api });
  await ui.click('add-scene');
  assert.ok(native.scenes.some(s => s.text === independent), 'Adding a scene preserves an independent Fountain draft as a recovery scene');
  assert.ok(native.script.text.includes(independent));
  const newest = 'Title: Самая свежая авторская правка\n\n<script>Экспорт до подтверждения</script>';
  await ui.input('draft-text', newest);
  await ui.click('download');
  assert.equal(await ui.downloads.at(-1).text(), newest, 'Export includes the current full draft before the server acknowledges it');
  assert.notEqual(native.script.text, newest, 'The export was tested before the delayed save');
  await ui.flushInput();
  await ui.input('scene-text', 'Новая правка выбранной сцены');
  await ui.flushInput();
  assert.ok(native.scenes.some(s => s.text === newest), 'Editing a scene preserves the independent full draft before deriving new text');
  assert.ok(native.script.text.includes(newest));
}
console.log('Actual app preserves independent Fountain before scene edits and exports newest text before acknowledgement: passed.');

// A direct participant operation updates the confirmed project and revision.
// The issued credential is a separate, transient return value, never member data.
{
  const api = nativeApi();
  const client = connect(api);
  const p = await client.loadProject('film');
  assert.equal(p._capabilities.manageTeam, true);
  const payload = { name: 'Айгерім <script>мәтін</script>', email: 'writer@example.test', role: 'writer', sections: ['overview', 'script', 'breakdown'] };
  const issued = await client.createMember('film', payload, p);
  assert.ok(issued.key, 'Creating a participant returns its newly issued key');
  assert.equal(issued.member.accessStatus, 'active');
  assert.deepEqual(api.calls.find(c => c.method === 'POST' && c.path.endsWith('/members')).body, payload);
  assert.equal(p.members.find(m => m.id === issued.member.id).email, payload.email);
  assert.equal(p._revision, api.projects.get('film').revision);
  for (const storedModel of [p, [...client.known.values()], await client.loadProject('film')]) assert.ok(!JSON.stringify(storedModel).includes(issued.key), 'Issued credential cannot enter a stored project/baseline or later GET');

  const participant = connect(api, issued.key);
  assert.equal((await participant.loadProject('film'))._capabilities.manageTeam, false);
  await assert.rejects(participant.createMember('film', payload), err => err.status === 403, 'A non-manager cannot issue credentials');
  const rights = { role: 'viewer', sections: ['overview', 'team', 'journal', 'future-department'] };
  await client.updateMember('film', issued.member.id, rights, p);
  assert.deepEqual(api.calls.find(c => c.method === 'PATCH' && c.path.includes('/members/')).body, rights);
  assert.equal(p.members.find(m => m.id === issued.member.id).role, 'viewer');
  const restricted = await participant.loadProject('film');
  assert.ok(restricted._denied.includes('script'), 'Rights changes apply to the existing issued key');
  assert.equal(restricted.members.find(m => m.id === issued.member.id).email, payload.email);
  const revoked = await client.revokeMember('film', issued.member.id, p);
  assert.equal(revoked.accessStatus, 'revoked');
  assert.equal(p.members.find(m => m.id === issued.member.id).accessStatus, 'revoked', 'Revocation keeps the participant history');
  await assert.rejects(participant.loadProject('film'), err => err.status === 401, 'Revoked credentials no longer authenticate');
  assert.equal(p._revision, api.projects.get('film').revision);
  for (const call of api.calls.filter(c => c.committed && c.beforeRevision)) assert.equal(call.ifMatch, `"${call.beforeRevision}"`, 'Member operations advance the confirmed revision');
}
console.log('Participant API client issuance, transient credentials, rights changes and revoked status: passed.');

// Use the actual app event handlers for managing a server team. Fixtures include
// hostile data from another client; rendering must treat every value as text.
{
  const api = nativeApi();
  const native = api.projects.get('film');
  native.members.push({ id: 'hostile-member', name: '<img src=x onerror=alert(1)>', email: '" onclick="alert(1)@example.test', role: 'unknown<script>', sections: ['overview', '<script>department</script>'], accessStatus: 'unavailable' });
  const local = JSON.stringify(localState(makeDemo()));
  const stored = new Map([[workspaceKey, local], [settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]);
  const ui = await appHarness({ stored, api, hash: '#/studio/team', queuedDialogClose: true });
  assert.match(ui.app.innerHTML, /Команда проекта/);
  assert.match(ui.app.innerHTML, /data-action='member'/);
  for (const escaped of ['&lt;img src=x onerror=alert(1)&gt;', '&quot; onclick=&quot;alert(1)@example.test', 'unknown&lt;script&gt;', '&lt;script&gt;department&lt;/script&gt;']) assert.ok(ui.app.innerHTML.includes(escaped), `The team list escapes ${escaped}`);
  assert.ok(!ui.app.innerHTML.includes('<img src=x onerror=alert(1)>'));

  await ui.click('member');
  assert.match(ui.dialog.innerHTML, /name='email'[^>]*type='email'|type='email'[^>]*name='email'/);
  assert.ok(!ui.dialog.innerHTML.includes('keyId'), 'The producer need not configure an external key');
  for (const role of ['producer', 'director', 'writer', 'cinematographer', 'artist', 'editor', 'viewer']) assert.ok(ui.dialog.innerHTML.includes(`value='${role}'`), `Form offers the ${role} film role`);
  for (const section of ['overview', 'script', 'breakdown', 'heroes', 'locations', 'world', 'storyboard', 'shots', 'continuity', 'sound', 'edit', 'plan', 'journal']) assert.ok(ui.dialog.innerHTML.includes(`value='${section}'`), `Form offers the ${section} department`);
  assert.match(ui.dialog.innerHTML, /id='member-role-hint'/);
  const firstHint = ui.memberRoleHint.textContent;
  await ui.dialogChange('member-role', 'director');
  assert.ok(ui.memberRoleHint.textContent && ui.memberRoleHint.textContent !== firstHint, 'Changing a role updates what the participant sees');
  await ui.dialogChange('member-role', 'writer');
  assert.deepEqual(ui.dialog.querySelectorAll("input[name='sections']").filter(input => input.checked).map(input => input.value), ['overview', 'script', 'breakdown'], 'Writer role offers its script and read-only breakdown departments');
  const payload = { name: 'Сценарист <script>текст</script>', email: 'writer@example.test', role: 'writer', sections: ['overview', 'script', 'breakdown'] };
  await ui.submit('member-form', payload);
  const member = native.members.find(m => m.email === payload.email);
  assert.ok(member, 'The producer creates a server participant');
  assert.equal(member.accessStatus, 'active');
  const key = ui.issuedMemberKey.value;
  assert.ok(key, 'The first create response displays the issued key');
  assert.equal(ui.dialog.open, true);
  ui.dialog.listeners.get('close')?.({});
  assert.equal(ui.issuedMemberKey.value, key, 'A delayed close event from the former form cannot clear an open key dialog');
  assert.match(ui.dialog.innerHTML, /Отправьте ключ участнику лично/);
  for (const persisted of [vm.runInContext('JSON.stringify(state)', ui.context), vm.runInContext('JSON.stringify([...serverClient.known])', ui.context), ...stored.values()]) assert.ok(!persisted.includes(key), 'The issued key is absent from state, client baseline and device storage');
  assert.equal(stored.get(workspaceKey), local);
  await ui.dialogClickData('copy-member-key');
  assert.equal(ui.clipboard.at(-1), key, 'Copy writes the key displayed in the one-time dialog');
  ui.dialog.close();
  await Promise.resolve();
  assert.ok(!ui.dialog.innerHTML.includes(key), 'Dismissing the key removes its DOM value');
  await ui.clickData('edit-member', member.id);
  assert.ok(!ui.dialog.innerHTML.includes(key), 'Reopening rights cannot recover a key');
  assert.match(ui.dialog.innerHTML, /Изменить права/);
  const updates = { name: payload.name, email: payload.email, role: 'viewer', sections: ['overview', 'team', 'journal'] };
  await ui.submit('member-form', updates, { id: member.id });
  assert.equal(native.members.find(m => m.id === member.id).role, 'viewer');
  assert.deepEqual(native.members.find(m => m.id === member.id).sections, updates.sections);
  await ui.clickData('revoke-member', member.id);
  assert.match(ui.dialog.innerHTML, /member-revoke-form/);
  await ui.submit('member-revoke-form', {}, { id: member.id });
  assert.equal(native.members.find(m => m.id === member.id).accessStatus, 'revoked');
  assert.match(ui.app.innerHTML, /отозван|Отозван/);
  assert.ok(!ui.app.innerHTML.includes(key));
  await ui.clickData('lang', 'kk');
  assert.match(ui.app.innerHTML, /Жоба командасы/);
  await ui.click('member');
  assert.match(ui.dialog.innerHTML, /Қатысушы қосу/);
  assert.match(ui.memberRoleHint.textContent, /[ӘҒҚҢӨҰҮҺІәғқңөұүһі]/);
}
console.log('Actual app team form, escaped data, role hints, one-time key copy, rights, revoke and RU/KK: passed.');

// The server capability is authoritative. A participant who can see the team
// has no mutation controls, including forced clicks/submissions through the DOM.
{
  for (const key of ['producer-secret', 'director-secret', 'viewer-secret']) {
    const api = nativeApi();
    const principal = secrets[key];
    api.projects.get('film').members.push({ id: `${principal.role}-member`, name: principal.role, email: `${principal.role}@example.test`, role: principal.role, keyId: principal.id, sections });
    const stored = new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key })]]);
    const ui = await appHarness({ stored, api, hash: '#/studio/team' });
    if (['producer', 'director'].includes(principal.role)) {
      assert.match(ui.app.innerHTML, /data-action='member'/, `${principal.role} can manage the team`);
      await ui.click('member');
      assert.match(ui.dialog.innerHTML, /member-form/);
    } else {
      assert.match(ui.app.innerHTML, /viewer@example.test/, 'An ordinary participant can inspect the team');
      for (const forbidden of ['data-action=\'member\'', 'data-edit-member=', 'data-revoke-member=']) assert.ok(!ui.app.innerHTML.includes(forbidden), 'Read-only team has no management controls');
      const before = JSON.stringify(api.projects.get('film'));
      await ui.click('member');
      assert.equal(ui.dialog.open, false, 'A forced add action cannot open a restricted form');
      await ui.submit('member-form', { name: 'Нельзя', email: 'no@example.test', role: 'writer', sections: ['overview'] });
      assert.equal(JSON.stringify(api.projects.get('film')), before, 'A forced form submit cannot mutate a read-only team');
      assert.ok(!api.calls.some(c => c.method !== 'GET'), 'No mutation request is sent by a non-manager');
    }
  }
}
console.log('Actual app producer/director management and read-only participant controls: passed.');

// A manager who changes their own role must immediately adopt the new server
// capability. Cached controls cannot keep the former right to manage a team.
{
  const api = nativeApi();
  const admin = connect(api);
  const p = await admin.loadProject('film');
  const issued = await admin.createMember('film', { name: 'Режиссёр', email: 'director@example.test', role: 'director', sections }, p);
  const stored = new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: issued.key })]]);
  const ui = await appHarness({ stored, api, hash: '#/studio/team' });
  assert.match(ui.app.innerHTML, /data-action='member'/);
  await ui.clickData('edit-member', issued.member.id);
  await ui.submit('member-form', { role: 'viewer', sections: ['overview', 'team'] }, { id: issued.member.id });
  assert.equal(vm.runInContext('project()._capabilities.manageTeam', ui.context), false, 'Self downgrade refreshes the effective capability');
  assert.match(ui.app.innerHTML, /director@example.test/);
  for (const forbidden of ['data-action=\'member\'', 'data-edit-member=', 'data-revoke-member=']) assert.ok(!ui.app.innerHTML.includes(forbidden), 'Self downgrade removes all former team controls');
  const before = api.calls.filter(c => c.method !== 'GET').length;
  await ui.click('member');
  await ui.submit('member-form', { name: 'Нельзя', email: 'no@example.test', role: 'writer', sections: ['overview'] });
  assert.equal(api.calls.filter(c => c.method !== 'GET').length, before, 'Cached management actions do not survive a self downgrade');
}
console.log('Actual app self role change immediately refreshes server rights and removes management controls: passed.');

function productionFixture() {
  const cell = (id, object, stage, status, extra = {}) => ({ id, project: 'film', object, stage, status,
    assignee: { keyId: 'director-local', name: 'Режиссёр <img src=x onerror=alert(1)>' }, approverRole: 'director',
    dueAt: '2026-10-16', version: 'draft-2', variant: null, comment: '<script>Замечание</script> & "текст"', createdAt: date, updatedAt: date, ...extra });
  const objects = [{ type: 'scene', id: 'scene-1' }, { type: 'scene', id: 'scene-2' }, { type: 'shot', id: 'shot-1' }, { type: 'teaser', id: 'teaser-1' }, { type: 'episode', id: 'episode-1' }, { type: 'scene', id: 'restored-scene' }];
  const cells = ['empty', 'working', 'done', 'awaiting', 'approved', 'returned'].map((status, i) => cell(`cell-${status}`, objects[0], productionStages[i], status));
  cells.push(cell('cell-variant', objects[2], 'video', 'awaiting', { version: null, variant: 'Ә нұсқа <b>2</b>' }));
  cells.push(cell('cell-teaser', objects[3], 'sound', 'done', { assignee: { keyId: null, name: 'Режиссёр <img src=x onerror=alert(1)>' } }));
  cells.push(cell('cell-episode', objects[4], 'edit', 'working'));
  cells.push(cell('cell-restored', objects[5], 'script', 'empty'));
  const project = { slug: 'film', scenes: [
    { id: 'scene-1', title: { ru: 'Аул <script>Название</script>', kk: 'Ә Ғ Қ Ң Ө Ұ Ү Һ І ауылы' } },
    { id: 'scene-2', title: { ru: 'Не начатая сцена', kk: 'Басталмаған көрініс' } }
  ], shots: [{ id: 'shot-1', sceneId: 'scene-1', title: { ru: 'Кадр & "1"', kk: 'Кадр Ә' } }],
    _principal: { id: 'director-local', role: 'director', projects: ['film'], sections: ['overview', 'storyboard', 'animatic', 'script', 'post'] },
    members: [{ id: 'director', keyId: 'director-local', role: 'director', name: 'Режиссёр', sections: ['overview', 'storyboard', 'animatic', 'script', 'post'], keySource: 'external', accessStatus: 'active' }], _denied: [] };
  const map = { project: 'film', stages: productionStages, objects, cells,
    grid: objects.map(object => ({ object, stages: Object.fromEntries(productionStages.map(stage => [stage, cells.find(c => c.stage === stage && c.object.type === object.type && c.object.id === object.id) || null])) })),
    myTasks: [cells[1], cells[5]], awaitingMe: [cells[3], cells[6]] };
  const approvals = [{ id: 'old-approval', cellId: cells[3].id, object: cells[3].object, stage: cells[3].stage, version: 'draft-1', variant: null, verdict: 'returned', comment: '<svg onload=alert(1)>Правка</svg>', keyId: 'director-local', createdAt: date }];
  const activity = [{ id: 'event-1', sequence: 1, action: 'approval.returned', object: cells[3].object, stage: cells[3].stage, cellId: cells[3].id, version: 'draft-1', variant: null, status: 'returned', name: '<script>Автор</script>', createdAt: date }];
  return { map, project, approvals, activity };
}

// A full native /map snapshot includes shots, teasers, episodes and scenes that
// remain only in the map after restoring a script. Missing cells are not tasks.
{
  const fixture = productionFixture();
  const html = renderProductionMap(fixture);
  assert.match(html, /<table\b/);
  assert.match(html, /production-map-scroll/);
  assert.match(html, /role=['"]region['"]/);
  assert.match(html, /tabindex=['"]0['"]/);
  assert.ok(html.includes('Не начатая сцена'), 'Objects with entirely null stages are visible');
  for (const id of ['cell-empty', 'cell-working', 'cell-done', 'cell-awaiting', 'cell-approved', 'cell-returned', 'cell-variant', 'cell-teaser', 'cell-episode', 'cell-restored']) assert.match(html, new RegExp(`data-map-cell=['"]${id}['"]`), `${id} opens its real server cell`);
  assert.equal([...html.matchAll(/data-map-cell=['"][^'"]+['"]/g)].length, fixture.map.cells.length, 'Null intersections cannot open an invented cell');
  for (const text of ['Аул &lt;script&gt;Название&lt;/script&gt;', 'Режиссёр &lt;img src=x onerror=alert(1)&gt;', '&lt;script&gt;Автор&lt;/script&gt;']) assert.ok(html.includes(text), `Escaped server text: ${text}`);
  assert.ok(!/<script>|<img\s+src=x|<svg\s+onload/.test(html));
  const clockChanged = renderProductionMap({ ...fixture, activity: [
    { ...fixture.activity[0], name: 'Earlier operation', sequence: 1, createdAt: '2026-10-14T00:00:00Z' },
    { ...fixture.activity[0], name: 'Latest operation', sequence: 2, createdAt: '2026-10-13T00:00:00Z' }
  ] });
  assert.ok(clockChanged.indexOf('Latest operation') < clockChanged.indexOf('Earlier operation'), 'Activity follows server append order even after a clock change');
  const kk = renderProductionMap({ ...fixture, locale: 'kk', mode: 'light' });
  assert.ok(kk.includes('Ә Ғ Қ Ң Ө Ұ Ү Һ І ауылы'));
  assert.ok(kk.includes('Басталмаған көрініс'));
  assert.notEqual(kk, html, 'Kazakh interface and titles are rendered independently');
  assert.match(kk, /data-map-mode=['"]light['"]/);
  const mine = renderProductionMap({ ...fixture, filter: 'mine' });
  assert.match(mine, /data-map-cell=['"]cell-working['"]/);
  assert.match(mine, /data-map-cell=['"]cell-returned['"]/);
  assert.ok(!/data-map-cell=['"]cell-teaser['"]/.test(mine), 'Matching displayed names never make an unassigned cell mine');
  const awaiting = renderProductionMap({ ...fixture, filter: 'awaiting' });
  assert.match(awaiting, /data-map-cell=['"]cell-awaiting['"]/);
  assert.match(awaiting, /data-map-cell=['"]cell-variant['"]/);
  assert.ok(!/data-map-cell=['"]cell-working['"]/.test(awaiting));
  const idsOnly = renderProductionMap({ ...fixture, map: { ...fixture.map, myTasks: ['cell-returned'], awaitingMe: ['cell-variant'] }, filter: 'mine' });
  assert.match(idsOnly, /data-map-cell=['"]cell-returned['"]/);
  assert.ok(!/data-map-cell=['"]cell-working['"]/.test(idsOnly));
  const stale = renderProductionMap({ ...fixture, map: { ...fixture.map, myTasks: ['absent'] }, filter: 'mine' });
  assert.equal([...stale.matchAll(/data-map-cell=['"][^'"]+['"]/g)].length, 0, 'Unknown personal-list IDs cannot fabricate cells');
  for (const status of ['empty', 'working', 'done', 'awaiting', 'approved', 'returned']) {
    const cell = fixture.map.cells.find(c => c.status === status);
    const card = renderProductionCell({ ...fixture, cell, canApprove: true });
    assert.match(card, new RegExp(`data-status=['"]${status}['"]`));
    assert.ok(card.includes('&lt;script&gt;Замечание&lt;/script&gt; &amp; &quot;текст&quot;'));
    assert.equal(/map-approval-form/.test(card), status === 'awaiting', `Only awaiting result exposes verdicts: ${status}`);
  }
  const cell = fixture.map.cells[3];
  const readonly = renderProductionCell({ ...fixture, cell, canApprove: false });
  assert.ok(!/map-approval-form/.test(readonly));
  assert.ok(readonly.includes('&lt;svg onload=alert(1)&gt;Правка&lt;/svg&gt;'), 'Earlier verdict and comment remain visible');
  const actionable = renderProductionCell({ ...fixture, cell, canApprove: true });
  assert.match(actionable, /data-cell-id=['"]cell-awaiting['"]/);
  assert.match(actionable, /name=['"]comment['"]/);
  assert.match(actionable, /value=['"]approved['"]/);
  assert.match(actionable, /value=['"]returned['"]/);
  assert.ok(!/map-approval-form/.test(renderProductionCell({ ...fixture, cell: { ...cell, version: null, variant: null }, canApprove: true })), 'A result must identify a version or variant');
  assert.match(renderProductionMap({ map: null, project: fixture.project }), /сервер|Сервер/);
  assert.ok(!/data-map-cell=/.test(renderProductionMap({ map: null, project: fixture.project })), 'Disconnected screen never creates demo production cells');
  assert.ok(renderProductionMap({ ...fixture, error: '<img src=x onerror=alert(1)>' }).includes('&lt;img src=x onerror=alert(1)&gt;'));
}
console.log('Production map matrix, server ID filters, null cells, safe cards/history and RU/KK: passed.');

// awaitingMe is a server hint, not a substitute for role, section, scope and
// member checks. Explicit issued keys use cinema sections; external keys retain
// the №31 scopes. Writer breakdown and editor sound are read-only sections.
{
  const { map, project } = productionFixture();
  const cell = map.cells[3];
  assert.equal(canApproveCell(cell, map, project), true);
  const check = (expected, changes, label, changedCell = cell, changedMap = map) => assert.equal(canApproveCell(changedCell, changedMap, { ...clone(project), ...changes }), expected, label);
  check(false, { _principal: { ...project._principal, role: 'viewer' } }, 'Viewer cannot approve even when maliciously inserted in awaitingMe');
  check(false, { _principal: { ...project._principal, projects: ['another-film'] } }, 'Different project scope');
  check(false, { _principal: { ...project._principal, sections: ['storyboard'] } }, 'Map overview scope is also required');
  check(false, { _principal: { ...project._principal, sections: ['overview'] } }, 'Role alone does not grant stage scope');
  check(false, { members: [] }, 'Known team has no principal binding');
  check(false, { members: [{ ...project.members[0], accessStatus: 'revoked' }] }, 'Revoked membership');
  check(false, { members: [{ ...project.members[0], revokedAt: date }] }, 'Server revokedAt also denies');
  check(false, { members: [{ ...project.members[0], role: 'viewer' }] }, 'Principal and member roles must agree');
  check(false, { members: [{ ...project.members[0], sections: ['overview'] }] }, 'Effective scope intersects membership');
  check(false, { _denied: ['overview'] }, 'Denied overview');
  check(false, {}, 'Wrong presented version cannot be approved', { ...cell, version: 'draft-3' });
  check(false, {}, 'Wrong stage cannot borrow awaiting identity', { ...cell, stage: 'heroes' });
  check(false, {}, 'Missing waiting hint', cell, { ...map, awaitingMe: [] });
  check(false, {}, 'Done is distinct from submitted and accepted', { ...cell, status: 'done' });
  for (const [keySource, allowedSection, rejectedSection] of [['issued', 'locations', 'storyboard'], ['external', 'storyboard', 'locations']]) {
    const member = { ...project.members[0], keySource, sections: ['overview', allowedSection] };
    check(true, { members: [member], _principal: { ...project._principal, sections: ['overview', allowedSection] } }, `${keySource} uses ${allowedSection}`);
    check(false, { members: [{ ...member, sections: ['overview', rejectedSection] }], _principal: { ...project._principal, sections: ['overview', rejectedSection] } }, `${keySource} cannot borrow ${rejectedSection}`);
  }
  for (const [role, stage, section] of [['writer', 'breakdown', 'breakdown'], ['editor', 'sound', 'sound']]) {
    const restrictedCell = { ...cell, stage, approverRole: role };
    const restrictedMap = { ...map, cells: [restrictedCell], awaitingMe: [restrictedCell] };
    check(false, { _principal: { id: 'member-restricted', role, projects: ['film'], sections: ['overview', section] }, members: [{ keyId: 'member-restricted', role, keySource: 'issued', sections: ['overview', section], accessStatus: 'active' }] }, `${role} cannot write ${section}`, restrictedCell, restrictedMap);
  }
  check(true, { _principal: { ...project._principal, id: 'producer-local', role: 'producer' }, members: [{ ...project.members[0], keyId: 'producer-local', role: 'producer' }] }, 'Producer can approve instead of assigned role with stage rights');
  check(true, { _principal: { ...project._principal, id: 'admin-local', role: 'admin' }, members: [] }, 'Admin retains membership exemption with stage rights');
  check(true, { members: [], _denied: ['team'] }, 'Hidden team relies on authoritative waiting hint with role and scopes');
  assert.equal(canApproveCell(map.cells[6], map, project), true, 'A variant without a version is an identified result');
}
console.log('Production approval roles, issued/external scopes, membership, read-only and stale-card guards: passed.');

// The map has no paging, while both append-only histories must load every page.
// A verdict submits the exact presented identity once and uses the snapshot's
// revision. The server remains responsible for changing state and writing logs.
{
  const api = nativeApi();
  const fixture = productionFixture();
  const p = api.projects.get('film');
  p.cells = clone(fixture.map.cells);
  p.activity = Array.from({ length: 55 }, (_, i) => ({ ...clone(fixture.activity[0]), id: `event-${i}`, sequence: i + 1 }));
  p.approvals = Array.from({ length: 55 }, (_, i) => ({ ...clone(fixture.approvals[0]), id: `approval-old-${i}` }));
  const client = connect(api);
  const service = new ProductionMapApi(client);
  const loaded = await service.load('film');
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.map.cells.length, p.cells.length);
  assert.equal(loaded.activity.length, 55);
  assert.equal(loaded.approvals.length, 55);
  assert.equal(loaded.activity.at(-1).id, 'event-54');
  assert.equal(loaded.approvals.at(-1).id, 'approval-old-54');
  assert.ok(api.calls.some(c => c.path.endsWith('/activity') && c.search.includes('offset=54')));
  assert.ok(api.calls.some(c => c.path.endsWith('/approvals') && c.search.includes('offset=54')));
  assert.ok(api.calls.filter(c => c.path.endsWith('/map')).every(c => c.search === ''));
  const cell = loaded.map.cells.find(c => c.id === 'cell-awaiting');
  assert.deepEqual(await service.cell('film', cell.id, loaded.revision), cell);
  const comment = '<script>Причина</script> & Ә Ғ Қ Ң Ө Ұ Ү Һ І';
  const result = await service.approve('film', cell, 'returned', comment, loaded.revision);
  assert.equal(result.revision, 2);
  assert.equal(result.approval.cellId, cell.id);
  assert.equal(result.approval.comment, comment);
  const verdicts = api.calls.filter(c => c.path.endsWith('/approvals') && c.method === 'POST');
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].ifMatch, '"1"');
  assert.deepEqual(verdicts[0].body, { object: cell.object, stage: cell.stage, version: 'draft-2', variant: null, verdict: 'returned', comment });
  assert.equal(p.cells.find(c => c.id === cell.id).status, 'returned');
  assert.equal(p.approvals.length, 56);
  assert.equal(p.activity.at(-1).status, 'returned');
  const refreshed = await service.load('film');
  assert.equal(refreshed.revision, 2);
  assert.ok(!refreshed.map.awaitingMe.some(c => c.id === cell.id));
  assert.equal(refreshed.approvals.at(-1).comment, comment);
  await assert.rejects(service.approve('film', cell, 'approved', '', refreshed.revision), error => error.code === 'CELL_NOT_AWAITING');
  assert.equal(p.approvals.length, 56, 'Repeated verdict cannot append another history record');
  const variantCell = refreshed.map.cells.find(c => c.id === 'cell-variant');
  await service.approve('film', variantCell, 'approved', '', refreshed.revision);
  assert.deepEqual(api.calls.filter(c => c.method === 'POST').at(-1).body, { object: variantCell.object, stage: 'video', version: null, variant: variantCell.variant, verdict: 'approved', comment: '' });
}
console.log('Production API whole-map snapshot, >50 history records, native verdict identity/revision and server refresh: passed.');

{
  const api = nativeApi();
  const p = api.projects.get('film');
  p.cells = clone(productionFixture().map.cells);
  let changed = false;
  const client = new StudioServer({ url: 'http://127.0.0.1:8770', key: 'admin-secret', fetchImpl: async (url, options) => {
    const response = await api.fetchImpl(url, options);
    if (!changed && new URL(url).pathname.endsWith('/approvals')) { changed = true; p.revision += 1; }
    return response;
  } });
  const loaded = await new ProductionMapApi(client).load('film');
  assert.equal(loaded.revision, 2, 'Loading retries a read snapshot changed during history pagination');
  assert.ok(api.calls.filter(c => c.path.endsWith('/map')).length >= 4);
  assert.ok(api.calls.every(c => c.method === 'GET'), 'Read conflicts never write');
  const perpetualApi = nativeApi();
  perpetualApi.projects.get('film').cells = clone(p.cells);
  const unstableClient = new StudioServer({ url: 'http://127.0.0.1:8770', key: 'admin-secret', fetchImpl: async (url, options) => {
    const response = await perpetualApi.fetchImpl(url, options);
    if (new URL(url).pathname.endsWith('/map')) perpetualApi.projects.get('film').revision += 1;
    return response;
  } });
  await assert.rejects(new ProductionMapApi(unstableClient).load('film'), error => error.code === 'REVISION_CONFLICT');
  assert.ok(perpetualApi.calls.filter(c => c.path.endsWith('/map')).length <= 6, 'Unstable snapshot retry is bounded');
  const service = new ProductionMapApi(connect(api));
  const cell = clone(p.cells.find(c => c.status === 'awaiting'));
  const original = JSON.stringify(p);
  api.failOnce(c => c.path.endsWith('/approvals') && c.method === 'POST');
  await assert.rejects(service.approve('film', cell, 'approved', '', p.revision), error => error.code === 'STORAGE_WRITE_FAILED');
  assert.equal(JSON.stringify(p), original, 'Failed storage never changes a production state or journal');
  assert.equal(api.calls.filter(c => c.method === 'POST').length, 1, 'POST failure is never retried automatically');
  await assert.rejects(service.cell('film', cell.id, p.revision - 1), error => error.code === 'REVISION_CONFLICT');
  await assert.rejects(service.approve('film', cell, 'approved', '', p.revision - 1), error => error.code === 'REVISION_CONFLICT');
  p.cells.find(c => c.id === cell.id).version = 'draft-new';
  await assert.rejects(service.approve('film', cell, 'approved', '', p.revision), error => error.code === 'APPROVAL_CONFLICT');
  assert.equal(p.approvals.length, 0, 'Stale version and revision failures never invent verdicts');
  api.failOnce(c => c.path.endsWith('/activity'));
  await assert.rejects(service.load('film'), error => error.code === 'STORAGE_WRITE_FAILED');
}
console.log('Production API consistent-read retry, bounded conflicts, failed storage and stale version/card protection: passed.');

{
  const api = nativeApi();
  const p = api.projects.get('film');
  p.cells = clone(productionFixture().map.cells);
  const client = new StudioServer({ url: 'http://127.0.0.1:8770', key: 'admin-secret', fetchImpl: async (url, options) => {
    const response = await api.fetchImpl(url, options);
    if (options?.method === 'POST') throw new TypeError('Response lost after server write');
    return response;
  } });
  const service = new ProductionMapApi(client);
  const loaded = await service.load('film');
  await assert.rejects(service.approve('film', loaded.map.cells.find(c => c.status === 'awaiting'), 'approved', '', loaded.revision), error => error.code === 'NETWORK_ERROR');
  assert.equal(api.calls.filter(c => c.method === 'POST').length, 1, 'Lost response cannot replay a committed verdict');
  assert.equal(p.approvals.length, 1);
  assert.equal((await service.load('film')).approvals.length, 1, 'Explicit reread recovers the server truth after uncertain response');
}
console.log('Production verdict lost-response recovery without automatic replay: passed.');

function seedProduction(api, slug = 'film') {
  const fixture = productionFixture();
  const p = api.projects.get(slug);
  p.cells = clone(fixture.map.cells).map(c => ({ ...c, project: slug }));
  p.cells[1].assignee.keyId = 'admin-local'; p.cells[5].assignee.keyId = 'admin-local';
  p.scenes = fixture.project.scenes.map(s => ({ id: s.id, title: s.title.ru, text: '', translations: { ru: { title: s.title.ru, text: '' }, kk: { title: s.title.kk, text: '' } } }));
  p.shots = [{ id: 'shot-1', sceneId: 'scene-1', title: 'Кадр & "1"', description: '', prompt: '', duration: 4, status: 'draft', owner: '', lens: '', movement: '', imageUrl: '', videoUrl: '', comments: [] }];
  p.activity = clone(fixture.activity);
  p.approvals = clone(fixture.approvals);
  return p;
}

// Drive the real app route and controls, rather than testing a parallel model
// of how the screen ought to work. No map state is written into local drafts.
{
  const api = nativeApi();
  const p = seedProduction(api);
  const stored = new Map();
  const local = await appHarness({ api, hash: '#/studio/map', stored, systemDark: true });
  assert.match(local.app.innerHTML, /Подключите сервер проекта/);
  assert.ok(!/data-map-cell=/.test(local.app.innerHTML));
  assert.equal(api.calls.length, 0);
  await local.click('server');
  await local.submit('server-form', { url: 'http://127.0.0.1:8770', key: 'admin-secret' });
  await local.settle();
  assert.match(local.app.innerHTML, /href=['"]#\/studio\/map['"]/);
  assert.match(local.app.innerHTML, /Карта производства/);
  assert.match(local.app.innerHTML, /data-map-cell=['"]cell-awaiting['"]/);
  assert.ok(api.calls.some(c => c.path === '/api/projects/film/map' && c.search === ''));
  assert.ok(api.calls.some(c => c.path === '/api/projects/film/activity'));
  const reads = api.calls.length;
  await local.clickData('map-filter', 'mine');
  assert.match(local.app.innerHTML, /data-map-cell=['"]cell-working['"]/);
  assert.ok(!/data-map-cell=['"]cell-variant['"]/.test(local.app.innerHTML));
  await local.clickData('map-filter', 'awaiting');
  assert.match(local.app.innerHTML, /data-map-cell=['"]cell-variant['"]/);
  assert.ok(!/data-map-cell=['"]cell-working['"]/.test(local.app.innerHTML));
  assert.equal(api.calls.length, reads, 'Personal filters are client read views of the same server snapshot');
  await local.clickData('lang', 'kk');
  assert.match(local.app.innerHTML, /Өндіріс картасы/);
  assert.ok(local.app.innerHTML.includes('Ә Ғ Қ Ң Ө Ұ Ү Һ І ауылы'));
  assert.equal(local.mapControl.value, 'graphite');
  await local.change('production-map-mode', 'light');
  assert.equal(local.document.documentElement.dataset.scriptPaper, 'light');
  assert.equal(local.mapSurface.dataset.mapMode, 'light');
  assert.equal(local.mapControl.value, 'light');
  assert.equal(stored.get(paperStorageKey), 'light');
  assert.equal(api.calls.length, reads, 'Device paper choice does not write production or project records');
  await local.navigate('script');
  await local.settle();
  assert.equal(local.paperControl.value, 'light', 'Production mode is the shared script paper preference');
  await local.navigate('map');
  await local.settle();
  assert.equal(local.mapControl.value, 'light');
  await local.clickData('lang', 'ru');
  await local.clickData('map-cell', 'cell-awaiting');
  assert.equal(local.dialog.open, true);
  assert.match(local.dialog.innerHTML, /map-approval-form/);
  assert.match(local.dialog.innerHTML, /draft-2/);
  assert.ok(api.calls.some(c => c.path.endsWith('/cells/cell-awaiting')));
  assert.equal(local.dialog.dataset.mapMode, 'light');
  const beforeVerdicts = api.calls.filter(c => c.method === 'POST').length;
  await local.submit('map-approval-form', { comment: '   ' }, { cellId: 'cell-awaiting' }, 'returned');
  assert.equal(api.calls.filter(c => c.method === 'POST').length, beforeVerdicts, 'Returning requires a human reason before API mutation');
  assert.match(local.mapErrorNode.textContent, /Укажите/);
  const comment = 'Свет не совпадает <script>автор</script> & Ә';
  await local.submit('map-approval-form', { comment }, { cellId: 'cell-awaiting' }, 'returned');
  await local.settle();
  assert.equal(local.dialog.open, false);
  assert.match(local.toast.textContent, /возвращена/);
  assert.equal(p.cells.find(c => c.id === 'cell-awaiting').status, 'returned');
  assert.equal(p.approvals.at(-1).comment, comment);
  assert.ok(!/data-map-cell=['"]cell-awaiting['"]/.test(local.app.innerHTML), 'Waiting filter removes a server-confirmed verdict');
  assert.match(local.app.innerHTML, /Вернул на доработку/);
  assert.equal(vm.runInContext('project()._revision', local.context), p.revision);
  assert.ok(!JSON.stringify([...stored.values()]).includes('cell-awaiting'), 'Production records never enter device workspace persistence');
  await local.clickData('map-filter', 'all');
  await local.clickData('map-cell', 'cell-variant');
  await local.submit('map-approval-form', { comment: '' }, { cellId: 'cell-variant' }, 'approved');
  await local.settle();
  assert.equal(p.cells.find(c => c.id === 'cell-variant').status, 'approved');
  assert.match(local.toast.textContent, /принята/);
  const verdict = api.calls.filter(c => c.path.endsWith('/approvals') && c.method === 'POST').at(-1);
  assert.equal(verdict.body.version, null);
  assert.equal(verdict.body.variant, 'Ә нұсқа <b>2</b>');
  assert.equal(verdict.ifMatch, '"2"');
}
console.log('Actual app production route, automatic server reads, filters, shared paper, RU/KK and confirmed verdict refresh: passed.');

{
  const api = nativeApi();
  const p = seedProduction(api);
  const ui = await appHarness({ api, hash: '#/studio/map', stored: new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]) });
  await ui.clickData('map-cell', 'cell-awaiting');
  const oldRevision = p.revision;
  p.revision += 1; p.cells.find(c => c.id === 'cell-awaiting').version = 'draft-3';
  const before = p.approvals.length;
  await ui.submit('map-approval-form', { comment: 'Принимаю' }, { cellId: 'cell-awaiting' }, 'approved');
  assert.equal(p.approvals.length, before);
  assert.match(ui.mapErrorNode.textContent, /изменились/);
  assert.ok(ui.mapSubmitButtons.every(button => button.disabled));
  assert.match(ui.dialog.innerHTML, /draft-2/, 'A failed verdict preserves the reviewed card and entered form surface');
  const postCount = api.calls.filter(c => c.method === 'POST').length;
  await ui.submit('map-approval-form', { comment: 'Повтор' }, { cellId: 'cell-awaiting' }, 'approved');
  assert.equal(api.calls.filter(c => c.method === 'POST').length, postCount, 'Failed card cannot silently replay a verdict');
  await ui.dialogClickData('reopen-map-cell', 'cell-awaiting');
  assert.match(ui.dialog.innerHTML, /draft-3/);
  assert.ok(ui.mapSubmitButtons.every(button => !button.disabled));
  await ui.submit('map-approval-form', { comment: 'Теперь принимаю' }, { cellId: 'cell-awaiting' }, 'approved');
  await ui.settle();
  assert.equal(p.approvals.length, before + 1);
  assert.equal(p.approvals.at(-1).version, 'draft-3');
  assert.equal(api.calls.filter(c => c.method === 'POST').at(-1).ifMatch, `"${oldRevision + 1}"`);
  await ui.clickData('map-cell', 'cell-variant');
  const stateBefore = JSON.stringify(p);
  api.failOnce(c => c.path.endsWith('/approvals') && c.method === 'POST');
  await ui.submit('map-approval-form', { comment: '' }, { cellId: 'cell-variant' }, 'approved');
  assert.equal(JSON.stringify(p), stateBefore);
  assert.match(ui.mapErrorNode.textContent, /не сохранён/);
  assert.ok(ui.mapSubmitButtons.every(button => button.disabled));
  assert.ok(!/принята/.test(ui.toast.textContent), 'Storage failure is never shown as approval success');
  api.failOnce(c => c.path.endsWith('/activity'));
  await ui.click('refresh-map');
  await ui.settle();
  assert.match(ui.app.innerHTML, /Не удалось загрузить карту/);
  assert.ok(!/data-map-cell=/.test(ui.app.innerHTML), 'Failed reload cannot keep actionable stale cells');
}
console.log('Actual app production stale-card conflict, explicit reopen, save/load failure and no verdict replay: passed.');

{
  const api = nativeApi();
  const p = seedProduction(api);
  p.members = [{ id: 'viewer', keyId: 'viewer-local', name: 'Наблюдатель', role: 'viewer', sections }];
  const ui = await appHarness({ api, hash: '#/studio/map', stored: new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'viewer-secret' })]]) });
  assert.match(ui.app.innerHTML, /data-map-cell=['"]cell-awaiting['"]/);
  await ui.clickData('map-cell', 'cell-awaiting');
  assert.equal(ui.dialog.open, true);
  assert.ok(!/map-approval-form/.test(ui.dialog.innerHTML));
  assert.match(ui.dialog.innerHTML, /просмотр этой задачи/);
  const calls = api.calls.length;
  await ui.submit('map-approval-form', { comment: 'Поддельная форма' }, { cellId: 'cell-awaiting' }, 'approved');
  assert.equal(api.calls.length, calls, 'Read-only role cannot bypass action guards with a forged submit event');
  assert.equal(p.approvals.length, 1);
}
console.log('Actual app production read-only viewer and forged form guard: passed.');

{
  const api = nativeApi();
  const p = seedProduction(api);
  const ui = await appHarness({ api, stored: new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]) });
  const author = 'Новый несохранённый сценарий Ә Ғ Қ Ң Ө Ұ Ү Һ І';
  await ui.input('draft-text', author);
  p.revision += 1;
  await ui.navigate('map');
  await ui.settle();
  assert.equal(vm.runInContext('project()._scriptText', ui.context), author, 'Remote revision during map entry preserves pending author text after save conflict');
  assert.equal(p.script.text, '');
  assert.match(ui.app.innerHTML, /Сначала сохраните сценарий/);
  assert.ok(!/data-map-cell=/.test(ui.app.innerHTML));
}
console.log('Actual app map entry preserves pending screenplay across a remote revision conflict: passed.');

{
  const api = nativeApi();
  seedProduction(api);
  let releaseCell, cellReadStarted = false;
  const gate = new Promise(resolve => { releaseCell = resolve; });
  const ui = await appHarness({ api, hash: '#/studio/map', stored: new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]), fetchImpl: async (url, options) => {
    const response = await api.fetchImpl(url, options);
    if (new URL(url).pathname.endsWith('/cells/cell-awaiting') && !cellReadStarted) { cellReadStarted = true; await gate; }
    return response;
  } });
  const oldCardRead = ui.clickData('map-cell', 'cell-awaiting');
  for (let i = 0; i < 300 && !cellReadStarted; i += 1) await Promise.resolve();
  assert.equal(cellReadStarted, true);
  await ui.navigate('script');
  await ui.navigate('map');
  for (let i = 0; i < 300 && vm.runInContext('mapState.loading', ui.context); i += 1) await Promise.resolve();
  assert.equal(vm.runInContext('mapState.ready', ui.context), true);
  releaseCell();
  await oldCardRead;
  await ui.settle();
  assert.equal(ui.dialog.open, false, 'Late card reply from a previous map visit must not open over the new visit');
  assert.equal(vm.runInContext('mapCard === null', ui.context), true);
  assert.ok(api.calls.every(c => c.method === 'GET'));
}
console.log('Actual app production late card response cannot cross navigation snapshots: passed.');

{
  const api = nativeApi();
  const p = seedProduction(api);
  const ui = await appHarness({ api, hash: '#/studio/map', stored: new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: 'admin-secret' })]]) });
  await ui.clickData('map-cell', 'cell-variant');
  const before = JSON.stringify(p);
  api.failOnce(c => c.path.endsWith('/approvals') && c.method === 'POST', 409, 'DEPENDENCY_CONFLICT');
  await ui.submit('map-approval-form', { comment: '' }, { cellId: 'cell-variant' }, 'approved');
  assert.equal(JSON.stringify(p), before);
  assert.match(ui.mapErrorNode.textContent, /сначала примите предыдущие этапы/);
  assert.ok(!/Версия или права изменились/.test(ui.mapErrorNode.textContent), 'Dependency failure gives the film-process reason');
  assert.ok(ui.mapSubmitButtons.every(button => button.disabled));
}
console.log('Actual app production blocked dependency gives a truthful reason without mutation: passed.');

// №21.b / №55: exercise real app event handlers and shared save baselines.
const cinemaSettings = (key = 'admin-secret') => new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key })]]);
const passportFields = record => ({ name: record.name, role: record.role, identity: record.identity, taboo: record.taboo.join('\n'), height: record.height, status: record.status, scenes: record.scenes.join(', ') });
const fileFor = source => ({ size: new TextEncoder().encode(source).length, text: async () => source });
function seedBreakdown(api, slug = 'film') {
  const p = api.projects.get(slug);
  p.script.text = '.ИНТ. КОМНАТА — ДЕНЬ\n\nАвторский Fountain дословно.\n\nГЕРОЙ\nРеплика.';
  p.script.translations = { ru: p.script.text, kk: 'Қазақша автор мәтіні.' };
  p.scenes = [{ id: 'scene-1', title: 'ИНТ. КОМНАТА — ДЕНЬ', text: 'Автор сцены', translations: {}, n: 1, type: 'ИНТ', location: 'КОМНАТА', time: 'ДЕНЬ', page_from: 1, page_to: 3, chars: ['ГЕРОЙ'] }];
  p.characters = [{ id: 'hero-1', name: 'ГЕРОЙ', role: 'Главный герой', identity: 'Шрам на левой щеке', taboo: ['Без бороды'], height: '180 см', status: 'locked', scenes: [1], refs: [{ path: 'https://example.test/hero.jpg', role: 'identity' }], translations: { kk: { name: 'КЕЙІПКЕР', identity: 'Сол жақ бетінде тыртық' } } }];
  p.locations = [{ id: 'location-1', name: 'КОМНАТА', role: 'Дом героя', identity: 'Деревянные стены', taboo: ['Без неона'], height: 'Потолок 3 м', status: 'draft', scenes: [1], refs: [], translations: {} }];
  return p;
}
const importFixture = () => ({
  scenes: [{ n: 1, heading: 'ИНТ. КОМНАТА — НОЧЬ', type: 'ИНТ', location: 'КОМНАТА', time: 'НОЧЬ', act: 1, chars: ['ГЕРОЙ'], page_from: 2, page_to: 4 }, { n: 7, heading: 'НАТ. УЛИЦА — ДЕНЬ', type: 'НАТ', location: 'УЛИЦА', time: 'ДЕНЬ', act: 1, chars: ['ГЕРОЙ'], page_from: 5, page_to: 5 }],
  characters: [{ name: ' герой ', age: null, lines: 2, scenes: [1, 7], first_scene: 1 }],
  locations: [{ name: 'КОМНАТА', parent: 'КОМНАТА', types: ['ИНТ'], times: ['НОЧЬ'], scenes: [1] }, { name: 'УЛИЦА', parent: 'УЛИЦА', types: ['НАТ'], times: ['ДЕНЬ'], scenes: [7] }]
});

// №58.2: five render assertions plus real route/save/assistant behavior.
{
  const html = renderGeroyWorkshop({ connected: true, record: { id: 'hero-1', name: 'Герой <имя>', status: 'locked', role: 'Ведёт историю', scenes: [1], refs: [] } });
  assert.match(html, /<h1>Герой &lt;имя&gt;<\/h1>/, 'Hero name is shown safely');
  assert.match(html, /href='#\/studio\/heroes'>← В кабинет/, 'Return opens the cabinet list');
  assert.equal((html.match(/class='geroy-portrait-frame'/g) || []).length, 5, 'Five portrait angles are ready');
  assert.match(renderGeroyWorkshop({ connected: true, record: { name: 'Герой', role: '', identity: '', taboo: [] } }), /Паспорт пока пустой/, 'Empty passport invites the next step');
  assert.match(renderGeroyWorkshop({ connected: true, locale: 'kk' }), /Паспорт әзірге бос/, 'Empty state is translated');
}
{
  const api = nativeApi(), p = seedBreakdown(api), questions = [];
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname.endsWith('/assistant')) {
      questions.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ data: { answer: 'Роль: ведёт историю. Характер: смелый.' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return api.fetchImpl(url, options);
  };
  const ui = await appHarness({ api, fetchImpl, stored: cinemaSettings(), hash: '#/studio/heroes' });
  assert.match(ui.app.innerHTML, /href='#\/studio\/heroes\/hero-1'>Открыть/);
  await ui.navigate('heroes/hero-1'); await ui.settle();
  assert.match(ui.app.innerHTML, /class='workspace cex'/, 'Nested hero route opens the workshop');
  assert.doesNotMatch(ui.app.innerHTML, /class='sidebar'|class='tabbar'|class='slate'/, 'Workshop uses the whole work-main');
  assert.match(ui.app.innerHTML, /<h1>ГЕРОЙ<\/h1>/);
  assert.match(ui.app.innerHTML, /geroy-helper/);
  assert.match(ui.app.innerHTML, /src='https:\/\/example.test\/hero.jpg'/);
  assert.ok(api.calls.some(call => call.method === 'GET' && call.path.endsWith('/characters/hero-1')), 'Route reads the individual server passport');
  const beforeAssistant = JSON.stringify(p.characters);
  await ui.click('fill-hero-passport');
  assert.equal(questions[0].section, 'heroes');
  assert.equal(questions[0].question, 'Составь паспорт героя ГЕРОЙ по сценарию: роль, характер, внешность (лицо, волосы, телосложение, одежда), табу. Ответь коротко по пунктам');
  assert.match(vm.runInContext('assistantThread()', ui.context), /Характер: смелый/);
  assert.equal(JSON.stringify(p.characters), beforeAssistant, 'Assistant suggestions do not fill or save passport fields');
  await ui.clickPassport('characters', 'hero-1');
  const revision = p.revision;
  await ui.submit('passport-form', { ...passportFields(p.characters[0]), role: 'Роль после обсуждения', status: 'draft' }, { passportId: 'hero-1', passportCollection: 'characters' });
  const patch = api.calls.find(call => call.method === 'PATCH' && call.path.endsWith('/characters/hero-1'));
  assert.equal(patch.ifMatch, `"${revision}"`);
  assert.match(ui.app.innerHTML, /Роль после обсуждения/);
  assert.match(ui.app.innerHTML, /замок открыт/);
  await ui.clickData('lang', 'kk');
  assert.match(ui.app.innerHTML, /<h1>КЕЙІПКЕР<\/h1>/);
  assert.match(ui.app.innerHTML, /← Кабинетке/);
  await ui.navigate('heroes'); await ui.settle();
  assert.match(ui.app.innerHTML, /class='sidebar'/, 'Return restores the project cabinet');
}
console.log('Hero workshop render, nested route, single-passport GET, If-Match save and assistant suggestions: passed.');
{
  const api = nativeApi(), p = seedBreakdown(api);
  p.characters.push({ ...clone(p.characters[0]), id: 'hero-2', name: 'ВТОРОЙ', translations: {} });
  let release, held = false;
  const barrier = new Promise(resolve => { release = resolve; });
  const fetchImpl = async (url, options) => {
    if (!held && new URL(url).pathname.endsWith('/characters/hero-1') && options.method === 'GET') { held = true; await barrier; }
    return api.fetchImpl(url, options);
  };
  const ui = await appHarness({ api, fetchImpl, stored: cinemaSettings(), hash: '#/studio/heroes' });
  await ui.navigate('heroes/hero-1');
  for (let i = 0; i < 100 && !held; i += 1) await Promise.resolve();
  assert.ok(held, 'First hero read is pending');
  await ui.navigate('heroes/hero-2'); await ui.settle();
  release(); for (let i = 0; i < 100; i += 1) await Promise.resolve();
  assert.match(ui.app.innerHTML, /<h1>ВТОРОЙ<\/h1>/, 'Late passport cannot overwrite another hero');
  await ui.navigate('heroes/missing'); await ui.settle();
  assert.match(ui.app.innerHTML, /Героя здесь уже нет/);
  assert.doesNotMatch(ui.app.innerHTML, /data-action='edit-passport'/);
}
{
  const api = nativeApi(), p = seedBreakdown(api);
  p.members.push({ id: 'viewer-member', keyId: 'viewer-local', role: 'viewer', sections: ['overview'], accessStatus: 'active' });
  const ui = await appHarness({ api, stored: cinemaSettings('viewer-secret'), hash: '#/studio/heroes/hero-1' });
  assert.doesNotMatch(ui.app.innerHTML, /data-action='edit-passport'/);
  await ui.clickPassport('characters', 'hero-1');
  assert.equal(ui.dialog.open, false, 'Viewer cannot edit the hero');
  api.failOnce(call => call.method === 'GET' && call.path.endsWith('/characters/hero-1'), 403, 'FORBIDDEN');
  await ui.click('refresh-breakdown');
  assert.match(ui.app.innerHTML, /Спросите у продюсера/);
  assert.doesNotMatch(ui.app.innerHTML, /Паспорт пока пустой/);
  assert.ok(api.calls.every(call => call.method === 'GET'));
}
{
  const api = nativeApi(), p = seedBreakdown(api);
  const ui = await appHarness({ api, stored: cinemaSettings(), hash: '#/studio/heroes/hero-1' });
  await ui.clickPassport('characters', 'hero-1');
  p.revision += 1;
  await ui.submit('passport-form', { ...passportFields(p.characters[0]), identity: 'Нельзя перезаписать' }, { passportId: 'hero-1', passportCollection: 'characters' });
  assert.match(ui.passportErrorNode.textContent, /Коллега только что внёс правку/);
  await ui.submit('passport-form', { ...passportFields(p.characters[0]), identity: 'Нельзя повторять' }, { passportId: 'hero-1', passportCollection: 'characters' });
  assert.equal(api.calls.filter(call => call.method === 'PATCH').length, 1, 'Conflicting save is not replayed');
  assert.equal(p.characters[0].identity, 'Шрам на левой щеке');
}
console.log('Hero workshop late-read isolation, missing/denied passports, viewer rights and conflict without replay: passed.');
{
  const ui = await appHarness({ hash: '#/studio/breakdown' });
  assert.match(ui.app.innerHTML, /введите свой ключ/);
  assert.doesNotMatch(ui.app.innerHTML, /data-scene-id=/, 'Local demo is not presented as server breakdown');
  await ui.click('server');
  assert.match(ui.dialog.innerHTML, /value='https:\/\/api\.studio\.neyra\.vision'/);
  const local = await appHarness({ stored: new Map([[settingsStorageKey, JSON.stringify({ url: 'http://127.0.0.1:8770', key: '' })]]) });
  await local.click('server');
  assert.match(local.dialog.innerHTML, /value='http:\/\/127\.0\.0\.1:8770'/, 'Saved explicit local server stays selectable');
  const api = nativeApi(); seedBreakdown(api);
  const server = await appHarness({ api, stored: cinemaSettings(), hash: '#/studio/breakdown' });
  assert.doesNotMatch(server.app.innerHTML, /class='participant-hint'/);
  assert.match(server.app.innerHTML, /data-scene-id='scene-1'/);
  assert.match(server.app.innerHTML, /1–3/);
  assert.match(server.app.innerHTML, /data-dep-tab='heroes'/, 'Art tabs: heroes');
  assert.match(server.app.innerHTML, /data-dep-tab='locations'/, 'Art tabs: locations');
  await server.navigate('heroes'); await server.settle();
  assert.match(server.app.innerHTML, /Шрам на левой щеке/);
  assert.match(server.app.innerHTML, /locked/);
  assert.match(server.app.innerHTML, /data-action='edit-passport'/);
  await server.change('cinema-mode', 'graphite');
  assert.equal(server.cinemaSurface.dataset.cinemaMode, 'graphite');
  await server.clickData('lang', 'kk');
  assert.match(server.app.innerHTML, /КЕЙІПКЕР/);
  assert.match(server.app.innerHTML, /Кейіпкерлер/);
  await server.navigate('locations'); await server.settle();
  assert.match(server.app.innerHTML, /Деревянные стены/);
  assert.equal(server.cinemaSurface.dataset.cinemaMode, 'graphite');
  await server.change('cinema-mode', 'light');
  assert.equal(server.cinemaSurface.dataset.cinemaMode, 'light');
  assert.equal(server.stored.get(paperStorageKey), 'light');
  assert.ok(!server.stored.get(workspaceKey)?.includes('hero-1'), 'Server passports are transient, not browser workspace data');
}
console.log('Actual app cinema routes, server default/entry hint, RU/KK and shared graphite/paper: passed.');
{
  const api = nativeApi(); const p = seedBreakdown(api);
  const ui = await appHarness({ api, stored: cinemaSettings(), hash: '#/studio/heroes' });
  const author = p.script.text;
  const preserved = clone({ refs: p.characters[0].refs, translations: p.characters[0].translations });
  await ui.clickPassport('characters', 'hero-1');
  assert.match(ui.dialog.innerHTML, /id='passport-form'/);
  assert.match(ui.dialog.innerHTML, /Шрам на левой щеке/);
  await ui.submit('passport-form', { ...passportFields(p.characters[0]), identity: 'Авторский замок & <текст>', taboo: 'Без бороды\nБез очков', scenes: '1, 7', height: '181 см' }, { passportId: 'hero-1', passportCollection: 'characters' });
  const calls = api.calls.filter(c => c.method === 'PATCH' && c.path.endsWith('/characters/hero-1'));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { identity: 'Авторский замок & <текст>', taboo: ['Без бороды', 'Без очков'], height: '181 см', scenes: [1, 7] });
  assert.deepEqual({ refs: p.characters[0].refs, translations: p.characters[0].translations }, preserved);
  assert.match(ui.app.innerHTML, /Авторский замок &amp; &lt;текст&gt;/);
  assert.equal(vm.runInContext('serverClient.known.get("film")._revision', ui.context), p.revision);
  assert.equal(p.script.text, author);
  await ui.navigate('script'); await ui.input('draft-text', author + '\nПродолжение'); await ui.flushInput();
  assert.equal(p.script.text, author + '\nПродолжение', 'Next screenplay save uses the passport revision');

  const artistApi = nativeApi(); const film = seedBreakdown(artistApi);
  film.members.push({ id: 'artist-member', keyId: 'artist-local', role: 'artist', sections: ['overview', 'heroes', 'team'], accessStatus: 'active' });
  const artist = await appHarness({ api: artistApi, stored: cinemaSettings('artist-secret'), hash: '#/studio/heroes' });
  assert.match(artist.app.innerHTML, /data-action='edit-passport'/);
  await artist.clickPassport('characters', 'hero-1');
  await artist.submit('passport-form', { ...passportFields(film.characters[0]), role: 'Обновлено художником' }, { passportId: 'hero-1', passportCollection: 'characters' });
  assert.equal(film.characters[0].role, 'Обновлено художником');
  await artist.navigate('locations'); await artist.settle();
  assert.doesNotMatch(artist.app.innerHTML, /data-action='edit-passport'/, 'Member sections limit the principal sections');
  assert.match(artist.app.innerHTML, /открыт просмотр/);
  await artist.navigate('breakdown'); await artist.settle();
  assert.match(artist.app.innerHTML, /пока нельзя/);
  assert.doesNotMatch(artist.app.innerHTML, /data-scene-id=/);
}
console.log('Actual app passport PATCH, untouched translations/refs, shared revision and artist section permissions: passed.');
{
  for (const key of ['writer-secret', 'viewer-secret']) {
    const api = nativeApi(); const p = seedBreakdown(api); const principal = secrets[key];
    p.members.push({ id: 'member', keyId: principal.id, role: principal.role, sections: principal.sections, accessStatus: 'active' });
    const ui = await appHarness({ api, stored: cinemaSettings(key), hash: '#/studio/heroes' });
    assert.match(ui.app.innerHTML, /Шрам на левой щеке/);
    assert.doesNotMatch(ui.app.innerHTML, /data-action='edit-passport'/);
    assert.doesNotMatch(ui.app.innerHTML, /data-action='import-breakdown'/);
    const before = api.calls.filter(c => c.method !== 'GET').length;
    await ui.clickPassport('characters', 'hero-1');
    await ui.submit('passport-form', { ...passportFields(p.characters[0]), name: 'Подмена' }, { passportId: 'hero-1', passportCollection: 'characters' });
    await ui.click('import-breakdown');
    await ui.submit('breakdown-import-form', { file: fileFor(JSON.stringify(importFixture())) });
    assert.equal(api.calls.filter(c => c.method !== 'GET').length, before, 'Forged forms cannot send a write for read-only roles');
    assert.equal(p.characters[0].name, 'ГЕРОЙ');
  }
}
console.log('Actual app writer/viewer read-only passports, import denial and forged-form guards: passed.');
{
  const api = nativeApi(); const p = seedBreakdown(api);
  const ui = await appHarness({ api, stored: cinemaSettings(), hash: '#/studio/script' });
  const author = p.script.text + '\n\nОжидающая правка автора.';
  await ui.input('draft-text', author);
  await ui.navigate('breakdown'); await ui.settle();
  assert.equal(p.script.text, author, 'Entering breakdown flushes the pending author draft');
  const preserved = clone(p.characters[0]);
  await ui.click('import-breakdown');
  assert.match(ui.dialog.innerHTML, /type='file'/);
  const previous = p.revision;
  await ui.submit('breakdown-import-form', { file: fileFor('\uFEFF' + JSON.stringify(importFixture())) });
  const imports = api.calls.filter(c => c.path.endsWith('/breakdown') && c.method === 'POST');
  assert.equal(imports.length, 1);
  assert.equal(imports[0].ifMatch, `"${previous}"`);
  assert.equal(p.script.text, author);
  assert.equal(p.scenes[0].text, 'Автор сцены');
  assert.equal(p.characters.length, 1, 'Normalized repeat name does not duplicate the passport');
  for (const field of ['name', 'role', 'identity', 'taboo', 'height', 'status', 'refs', 'translations']) assert.deepEqual(p.characters[0][field], preserved[field]);
  assert.deepEqual(p.characters[0].scenes, [1, 7]);
  assert.match(ui.app.innerHTML, /НОЧЬ/);
  assert.match(ui.app.innerHTML, /2–4/);
  assert.equal(vm.runInContext('project().scenes.length', ui.context), 2);
  assert.equal(vm.runInContext('serverClient.known.get("film").scenes.length', ui.context), 2);
  await ui.navigate('script'); await ui.input('draft-text', author + '\nПосле импорта'); await ui.flushInput();
  assert.equal(p.script.text, author + '\nПосле импорта', 'Reloaded baseline never rebuilds author draft from imported empty scene text');
  await ui.navigate('breakdown'); await ui.settle(); await ui.click('import-breakdown');
  await ui.submit('breakdown-import-form', { file: fileFor(JSON.stringify(importFixture())) });
  assert.equal(p.characters.length, 1);
  assert.equal(p.scenes.length, 2);
}
console.log('Actual app file breakdown import, normalized passports, pending author preservation and following save baseline: passed.');
{
  const api = nativeApi(); const p = seedBreakdown(api);
  const ui = await appHarness({ api, stored: cinemaSettings(), hash: '#/studio/heroes' });
  await ui.clickPassport('characters', 'hero-1');
  p.revision += 1;
  await ui.submit('passport-form', { ...passportFields(p.characters[0]), identity: 'Не сохранять' }, { passportId: 'hero-1', passportCollection: 'characters' });
  assert.equal(ui.dialog.open, true);
  assert.match(ui.passportErrorNode.textContent, /Коллега только что внёс правку/);
  assert.equal(p.characters[0].identity, 'Шрам на левой щеке');
  await ui.submit('passport-form', { ...passportFields(p.characters[0]), identity: 'Повтор' }, { passportId: 'hero-1', passportCollection: 'characters' });
  assert.equal(api.calls.filter(c => c.method === 'PATCH' && c.path.endsWith('/hero-1')).length, 1, 'Conflict requires opening a fresh card');
  ui.dialog.close(); await ui.click('refresh-breakdown'); await ui.click('import-breakdown');
  await ui.submit('breakdown-import-form', { file: fileFor('{bad json') });
  assert.equal(api.calls.filter(c => c.method === 'POST' && c.path.endsWith('/breakdown')).length, 0);
  assert.match(ui.passportErrorNode.textContent, /некорректный JSON/);
  api.failOnce(c => c.method === 'POST' && c.path.endsWith('/breakdown'), 403, 'FORBIDDEN');
  await ui.submit('breakdown-import-form', { file: fileFor(JSON.stringify(importFixture())) });
  assert.match(ui.passportErrorNode.textContent, /Сюда вам пока нельзя/);
  await ui.submit('breakdown-import-form', { file: fileFor(JSON.stringify(importFixture())) });
  assert.equal(api.calls.filter(c => c.method === 'POST' && c.path.endsWith('/breakdown')).length, 1, 'Rejected import is not replayed');
}
console.log('Actual app passport conflict, retained form, malformed file and import denial without replay: passed.');
{
  const api = nativeApi(); const p = seedBreakdown(api);
  let loseResponse = true;
  const fetchImpl = async (...args) => {
    const response = await api.fetchImpl(...args);
    if (loseResponse && args[1]?.method === 'POST' && new URL(args[0]).pathname.endsWith('/breakdown')) { loseResponse = false; throw new TypeError('Lost committed import response'); }
    return response;
  };
  const ui = await appHarness({ api, fetchImpl, stored: cinemaSettings(), hash: '#/studio/breakdown' });
  await ui.click('import-breakdown');
  await ui.submit('breakdown-import-form', { file: fileFor(JSON.stringify(importFixture())) });
  assert.equal(p.scenes.length, 2, 'Server committed before losing the response');
  assert.match(ui.passportErrorNode.textContent, /Связь прервалась/);
  await ui.submit('breakdown-import-form', { file: fileFor(JSON.stringify(importFixture())) });
  assert.equal(api.calls.filter(c => c.method === 'POST' && c.path.endsWith('/breakdown')).length, 1);
  ui.dialog.close(); await ui.click('refresh-breakdown');
  assert.match(ui.app.innerHTML, /data-scene-id='scene-/);
  assert.equal(vm.runInContext('serverClient.known.get("film")._revision', ui.context), p.revision);

  await ui.click('import-breakdown');
  let release;
  const reading = new Promise(resolve => { release = resolve; });
  const work = ui.submit('breakdown-import-form', { file: { size: 50, text: () => reading } });
  await Promise.resolve(); await ui.navigate('overview'); release(JSON.stringify(importFixture())); await work; await ui.settle();
  assert.equal(api.calls.filter(c => c.method === 'POST' && c.path.endsWith('/breakdown')).length, 1, 'Late file read cannot import into another visit');
}
console.log('Actual app committed import lost-response recovery and late file-read navigation protection: passed.');
await verifyBreakdownModules();

// №45: грамматика голосовых и текстовых команд (studio/golos.js) — разбор без исполнения.
{
  const { parseCommand, parseNumber, parseSection, describeCommand } = await import('./golos.js');
  assert.equal(parseNumber('принять 12.3'), '12.3');
  assert.equal(parseNumber('вернуть 12-3, свет не совпадает'), '12.3');
  assert.equal(parseNumber('принять двенадцать три'), '12.3');
  assert.equal(parseNumber('открой сцену четыре'), '4');
  assert.equal(parseNumber('двадцать один два'), '21.2');
  assert.equal(parseNumber('он екі үш'), '12.3');
  assert.equal(parseSection('открой карту производства'), 'map');
  assert.equal(parseSection('покажи героев'), 'heroes');
  assert.equal(parseCommand('принять 12.3').kind, 'accept');
  assert.equal(parseCommand('принять 12.3').confirm, 'show');
  const back = parseCommand('вернуть 12.2, свет не совпадает');
  assert.equal(back.kind, 'return'); assert.equal(back.target, '12.2'); assert.equal(back.tail, 'свет не совпадает');
  assert.equal(parseCommand('открой карту').section, 'map');
  assert.equal(parseCommand('открой сцену 4').target, '4');
  assert.equal(parseCommand('ещё четыре 12.3').confirm, 'price');
  assert.equal(parseCommand('видео 12.3').confirm, 'price');
  assert.equal(parseCommand('кто тормозит').kind, 'waiting');
  assert.equal(parseCommand('қабылдау 12.3').kind, 'accept');
  assert.equal(parseCommand('почему сцена три скучная').kind, 'ask');
  assert.equal(parseCommand(''), null);
  assert.ok(describeCommand(parseCommand('вернуть 12.2, свет не совпадает')).includes('свет не совпадает'));
  assert.ok(describeCommand(parseCommand('видео 12.3')).includes('«да»'));
  console.log('Voice/text command grammar: numbers, sections, verbs, confirmations and questions: passed.');
}

// №52 р.3 / №36: каркас окна в новом дизайне — хлопушка, группы цехов, меню аккаунта, подсказки-команды,
// лист «Ждёт меня» на Обзоре из клеток awaiting карты; клик по строке ведёт на карту.
{
  const api = nativeApi(); const p = seedBreakdown(api);
  const date = '2026-10-13T00:00:00+05:00';
  p.cells.push({ id: 'cell-wait', object: { type: 'scene', id: 'scene-1' }, stage: 'script', status: 'awaiting', assignee: { keyId: null, name: 'Лена <b>x</b>' }, approverRole: 'producer', dueAt: null, version: 'draft-01', variant: null, comment: '', createdAt: date, updatedAt: date });
  const ui = await appHarness({ api, stored: cinemaSettings(), hash: '#/studio/overview' }); await ui.settle();
  assert.match(ui.app.innerHTML, /class='slate'/, 'Slate header is rendered');
  for (const dep of ['Writer', 'Art', 'Director', 'Production']) assert.match(ui.app.innerHTML, new RegExp(`class='dep-name'>${dep}<`), `Sidebar lists department ${dep}`);
  assert.equal((ui.app.innerHTML.match(/class='dep /g) || []).length, 5, 'Sidebar nav is exactly Проект + four departments');
  assert.match(ui.app.innerHTML, /class='menu'/, 'Account menu lives in the sidebar');
  assert.match(ui.app.innerHTML, /data-helper-toggle/, 'Helper is collapsed to one line by default');
  assert.doesNotMatch(ui.app.innerHTML, /data-cmd='кто тормозит'/, 'Chips hidden while helper is collapsed');
  await ui.clickData('helper-toggle', ''); await ui.settle();
  assert.match(ui.app.innerHTML, /data-cmd='кто тормозит'/, 'Command chips are offered once the helper is open');
  assert.match(ui.app.innerHTML, /data-open-cell='cell-wait'/, 'Awaiting cell is listed on the overview');
  assert.match(ui.app.innerHTML, /Лена &lt;b&gt;x&lt;\/b&gt;/, 'Assignee name is escaped');
  assert.match(ui.app.innerHTML, /class='tabbar'/, 'Mobile tab bar is rendered');
  assert.ok(api.calls.some(c => c.path.endsWith('/map')), 'Overview loads the production map for the waiting list');
}
console.log('Actual app new shell: slate, four departments, account menu, collapsible helper and overview waiting list: passed.');
