import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { frameAt, totalDuration } from './timeline.js';
import { makeDemo } from './data.js';
import { mapStages, cellPermissions, renderMapPage, renderCellCard } from './blocks/production-map/view.js';

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

// The production map uses real block renderers. Its fixtures deliberately
// contain different object levels and untrusted text from another client.
const stageIds = ['script', 'breakdown', 'heroes', 'locations', 'storyboard', 'shots', 'video', 'sound', 'edit'];
const mapProject = ({ role = 'writer', id = 'writer-local', sections: granted = ['overview', 'script'], source = 'external', accessStatus = 'active', projects = ['film'] } = {}) => ({
  slug: 'film', _server: true, _revision: 1,
  _principal: { id, role, sections: granted, projects },
  members: [{ id: 'member-one', keyId: id, name: 'Исполнитель', role, sections: granted, keySource: source, accessStatus }],
  scenes: [{ id: 's1', title: { ru: 'ИНТ. КОМНАТА — ДЕНЬ', kk: 'ІШКІ. ҮЙ — КҮН' }, text: { ru: '', kk: '' } }]
});
const mapCell = (overrides = {}) => ({
  id: 'cell-one', project: 'film', object: { type: 'scene', id: 's1' }, stage: 'script',
  assignee: { keyId: 'writer-local', name: 'Исполнитель' }, approverRole: 'producer',
  status: 'working', dueAt: '2026-10-15', comment: 'Рабочий комментарий', version: 'draft-2', variant: null,
  ...overrides
});
const mapData = (cells = [mapCell()]) => {
  const objects = [{ type: 'scene', id: 's1' }, { type: 'teaser', id: 'teaser-one' }, { type: 'shot', id: 'shot-only' }, { type: 'episode', id: 'episode-only' }];
  return {
    project: 'film', stages: [...stageIds], objects,
    grid: objects.map(object => ({ object, stages: Object.fromEntries(stageIds.map(stage => [stage, cells.find(cell => cell.stage === stage && cell.object.type === object.type && cell.object.id === object.id) || null])) })),
    cells, myTasks: cells.filter(cell => cell.assignee.keyId === 'writer-local'), awaitingMe: [],
    approvals: [], activity: [], _revision: 1, revision: 1
  };
};
const gridMarkup = html => /<table\b[\s\S]*?<\/table>/.exec(html)?.[0] || '';
const workButton = (html, intent) => new RegExp(`<button\\b[^>]*\\bvalue=['"]${intent}['"]`).test(html);
const verdictButton = (html, verdict) => new RegExp(`<button\\b[^>]*\\bdata-map-verdict=['"]${verdict}['"]`).test(html);

{
  const p = mapProject();
  const cells = ['empty', 'working', 'done', 'awaiting', 'approved', 'returned'].map((status, index) => mapCell({ id: `cell-${index}`, stage: stageIds[index], status }));
  const data = mapData(cells);
  const ru = renderMapPage({ p, data, locale: 'ru' });
  const grid = gridMarkup(ru);
  assert.ok(grid, 'The production grid is a semantic table');
  assert.equal((grid.match(/<tr\b/g) || []).length, 3, 'Film scale contains one scene and one teaser plus the header');
  assert.equal((grid.match(/data-map-stage=/g) || []).length, 18, 'Two film objects have all nine clickable stages');
  assert.ok(!grid.includes('shot-only') && !grid.includes('episode-only'), 'Shot and episode rows belong to later scales');
  for (const title of ['Сценарий', 'Разбивка', 'Герои', 'Локации', 'Раскадровка', 'Кадры', 'Видео', 'Звук', 'Монтаж']) assert.ok(grid.includes(title), `Russian grid labels ${title}`);
  for (const symbol of ['○', '●', '✓', '◆']) assert.ok(grid.includes(symbol), `Status symbol ${symbol} has a visible rendering`);
  assert.ok(grid.includes('Исполнитель'), 'A working cell identifies its assignee');
  assert.ok(ru.includes('Мои задачи') && ru.includes('Ждёт меня'));
  assert.ok(ru.includes('map-grid-scroll'), 'Only the production table opts into horizontal scrolling');
  assert.deepEqual(mapStages('ru').map(stage => stage.id), stageIds);
  const kk = renderMapPage({ p, data, locale: 'kk' });
  assert.ok(gridMarkup(kk).includes('ІШКІ. ҮЙ — КҮН'), 'The scene title follows the interface locale');
  assert.deepEqual(mapStages('kk').map(stage => stage.id), stageIds);
  assert.ok(mapStages('kk').some(stage => /[ӘҒҚҢӨҰҮҺІәғқңөұүһі]/.test(stage.title)), 'Kazakh stage labels are real translations');
  assert.ok(!kk.includes('Мои задачи') && !kk.includes('Ждёт меня'), 'Personal lists are translated');

  const filtered = gridMarkup(renderMapPage({ p, data, locale: 'ru', stage: 'storyboard' }));
  assert.equal((filtered.match(/data-map-stage=/g) || []).length, 2, 'Stage filtering retains the rows and one stage');
  assert.ok(filtered.includes('Раскадровка') && !filtered.includes('Монтаж'));
  const art = gridMarkup(renderMapPage({ p, data, locale: 'kk', department: 'art' }));
  assert.equal((art.match(/data-map-stage=/g) || []).length, 4, 'The art department contains heroes and locations');
  assert.ok(!art.includes("data-map-stage='script'"));

  for (const locale of ['ru', 'kk']) {
    const unavailable = renderMapPage({ p: { ...p, _server: false }, data: null, locale });
    assert.equal(gridMarkup(unavailable), '', 'No server produces an explanatory empty state rather than demo cells');
    assert.match(unavailable, locale === 'ru' ? /сервер/ : /сервер/);
    assert.ok(!unavailable.includes('data-map-stage='), 'Offline map exposes no cell actions');
  }
}
console.log('Production map film rows, nine stages, symbols, filters, bilingual labels and offline empty state: passed.');

{
  const cell = mapCell();
  const card = p => renderCellCard({ p, data: mapData([cell]), object: cell.object, stage: cell.stage, locale: 'ru' });
  const own = mapProject();
  assert.deepEqual(cellPermissions(cell, own), { manage: false, work: true, approve: false });
  assert.ok(workButton(card(own), 'done'), 'The assigned executor can finish their cell');
  assert.ok(workButton(card(own), 'awaiting'), 'The executor can request approval separately from done');
  assert.ok(!verdictButton(card(own), 'approved'), 'Finishing a task cannot approve it');

  for (const role of ['admin', 'director', 'producer']) {
    const manager = mapProject({ role, id: `${role}-local`, sections: ['overview', 'script'] });
    if (role === 'admin') manager.members = [];
    assert.equal(cellPermissions(cell, manager).manage, true, `${role} can create and assign a cell`);
    assert.equal(cellPermissions(cell, manager).work, false, 'Management does not impersonate an assigned executor');
    assert.ok(!workButton(card(manager), 'done'));
    const empty = renderCellCard({ p: manager, data: mapData([]), object: cell.object, stage: cell.stage, locale: 'ru' });
    assert.ok(workButton(empty, 'save'), `${role} can create an empty stage assignment`);
  }

  const awaiting = mapCell({ status: 'awaiting', approverRole: 'director' });
  for (const role of ['director', 'admin', 'producer']) {
    const p = mapProject({ role, id: `${role}-local`, sections: ['overview', 'script'] });
    if (role === 'admin') p.members = [];
    assert.equal(cellPermissions(awaiting, p).approve, true, `${role} can issue the awaited verdict`);
    const html = renderCellCard({ p, data: mapData([awaiting]), object: awaiting.object, stage: awaiting.stage, locale: 'ru' });
    assert.ok(verdictButton(html, 'approved') && verdictButton(html, 'returned'));
    const done = renderCellCard({ p, data: mapData([{ ...awaiting, status: 'done' }]), object: awaiting.object, stage: awaiting.stage, locale: 'ru' });
    assert.ok(!verdictButton(done, 'approved'), 'Ready is distinct from awaiting approval');
    const unversioned = renderCellCard({ p, data: mapData([{ ...awaiting, version: null, variant: null }]), object: awaiting.object, stage: awaiting.stage, locale: 'ru' });
    assert.ok(!verdictButton(unversioned, 'approved'), 'A verdict needs the presented version or variant');
  }

  for (const p of [
    mapProject({ role: 'viewer', sections: ['overview', 'script'] }),
    mapProject({ id: 'unassigned-local' }),
    mapProject({ sections: ['overview'] }),
    mapProject({ accessStatus: 'revoked' }),
    mapProject({ projects: ['another-film'] }),
    { ...mapProject(), _server: false },
    { ...mapProject(), members: [] },
    { ...mapProject(), members: [{ ...mapProject().members[0], role: 'viewer' }] }
  ]) {
    assert.equal(cellPermissions(cell, p).work, false, 'A wrong key, scope, section, revoked membership or role cannot work');
    const html = card(p);
    assert.ok(!workButton(html, 'done') && !workButton(html, 'awaiting'), 'Unavailable rights expose no executor controls');
    assert.ok(!verdictButton(html, 'approved') && !verdictButton(html, 'returned'), 'Unavailable rights expose no verdict controls');
  }

  const breakdown = mapCell({ stage: 'breakdown' });
  const externalWriter = mapProject({ sections: ['overview', 'script'], source: 'external' });
  assert.equal(cellPermissions(breakdown, externalWriter).work, true, 'Legacy external keys write breakdown through script');
  const issuedWriter = mapProject({ id: 'member-writer', sections: ['overview', 'script', 'breakdown'], source: 'issued' });
  assert.equal(cellPermissions({ ...breakdown, assignee: { keyId: 'member-writer', name: 'Сценарист' } }, issuedWriter).work, false, 'Issued writer has read-only breakdown even when the section is granted');
  const issuedArtist = mapProject({ role: 'artist', id: 'member-artist', sections: ['overview', 'heroes'], source: 'issued' });
  assert.equal(cellPermissions(mapCell({ stage: 'heroes', assignee: { keyId: 'member-artist', name: 'Художник' } }), issuedArtist).work, true, 'Issued artist can work heroes without storyboard');
  const externalArtist = mapProject({ role: 'artist', sections: ['overview', 'heroes'], source: 'external' });
  assert.equal(cellPermissions(mapCell({ stage: 'heroes' }), externalArtist).work, false, 'Legacy heroes rights require storyboard rather than the issued-key stage section');
  const issuedEditor = mapProject({ role: 'editor', id: 'member-editor', sections: ['overview', 'sound', 'edit'], source: 'issued' });
  assert.equal(cellPermissions(mapCell({ stage: 'sound', assignee: { keyId: 'member-editor', name: 'Монтажёр' } }), issuedEditor).work, false, 'Issued editor sees sound but cannot perform it');
  assert.equal(cellPermissions(mapCell({ stage: 'edit', assignee: { keyId: 'member-editor', name: 'Монтажёр' } }), issuedEditor).work, true);
}
console.log('Production cell executor, creator, approver, viewer, revoked scopes and issued/external department rights: passed.');

// API double follows the public routes and persists native server objects. It has
// deliberately small pages and rejects stale revisions, secrets in bodies,
// invalid member references, and duplicate IDs like the actual server.
const clone = value => structuredClone(value);
const date = '2026-10-13T00:00:00Z';
const sections = ['overview', 'script', 'breakdown', 'heroes', 'locations', 'world', 'storyboard', 'shots', 'continuity', 'sound', 'edit', 'plan', 'journal', 'animatic', 'team', 'post'];
const secrets = {
  'admin-secret': { id: 'admin-local', role: 'admin', sections },
  'writer-secret': { id: 'writer-local', role: 'writer', sections: ['overview', 'script'] },
  'producer-secret': { id: 'producer-local', role: 'producer', sections },
  'director-secret': { id: 'director-local', role: 'director', sections },
  'viewer-secret': { id: 'viewer-local', role: 'viewer', sections }
};
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
  const issuedKeys = new Map();
  const calls = [];
  let sequence = 0;
  let fail = null;
  const manageTeam = (principal, p) => ['admin', 'producer', 'director'].includes(principal.role) && (principal.role === 'admin' || p.members.some(m => (principal.memberId ? m.id === principal.memberId : m.keyId === principal.id) && m.accessStatus !== 'revoked'));
  const allowed = (principal, p, section) => principal.sections.includes(section) && (principal.role === 'admin' || p.members.some(m => (principal.memberId ? m.id === principal.memberId && principal.slug === p.slug : m.keyId === principal.id) && m.accessStatus !== 'revoked' && m.sections.includes(section)));
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
    if (!allowed(principal, p, section) && !(collection === 'members' && manageTeam(principal, p))) return errorReply(403, 'FORBIDDEN');
    if (collection === 'members' && method !== 'GET' && !manageTeam(principal, p)) return errorReply(403, 'FORBIDDEN');
    if (method !== 'GET') {
      call.beforeRevision = p.revision;
      if (call.ifMatch !== `"${p.revision}"`) return errorReply(409, 'REVISION_CONFLICT');
    }
    let data;
    let status = 200;
    if (!collection) {
      if (method === 'GET') return reply(200, { data: { ...metadata(p), capabilities: { manageTeam: manageTeam(principal, p) }, principal: { id: principal.id, role: principal.role, sections: clone(principal.sections) } } }, p.revision);
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
    classList: { add() {}, remove() {}, toggle() {} }, style: {}, isConnected: true,
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    showModal() { this.open = true; }, close() { this.open = false; this.listeners.get('close')?.({}); },
    focus() {}, select() {}, click() {}, setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  });
  const app = element(), dialog = element(), toast = element(), draft = element(), paperControl = element();
  if (queuedDialogClose) dialog.close = function () { this.open = false; queueMicrotask(() => this.listeners.get('close')?.({})); };
  const memberRoleHint = element(), issuedMemberKey = element();
  let memberSections = [];
  dialog.querySelectorAll = selector => selector === "input[name='sections']" ? memberSections : [];
  let dialogMarkup = '';
  Object.defineProperty(dialog, 'innerHTML', { get: () => dialogMarkup, set: value => {
    dialogMarkup = value;
    issuedMemberKey.value = /<textarea\b[^>]*id=['"]issued-member-key['"][^>]*>([\s\S]*?)<\/textarea>/.exec(value)?.[1] || '';
    memberRoleHint.textContent = /id=['"]member-role-hint['"][^>]*>([^<]*)/.exec(value)?.[1] || '';
    memberSections = [...value.matchAll(/<input\b[^>]*name=['"]sections['"][^>]*>/g)].map(([tag]) => ({ value: /value=['"]([^'"]*)['"]/.exec(tag)?.[1] || '', checked: /\bchecked\b/.test(tag), disabled: /\bdisabled\b/.test(tag) }));
  } });
  paperControl.id = 'script-paper-mode'; paperControl.dataset.paperMode = '';
  let markup = '', markupWrites = 0;
  Object.defineProperty(app, 'innerHTML', { get: () => markup, set: value => {
    markup = value; markupWrites += 1;
    label.textContent = /data-storage-label[^>]*>([^<]*)/.exec(value)?.[1] || '';
    const options = /<select\b[^>]*id=['"]script-paper-mode['"][^>]*>([\s\S]*?)<\/select>/.exec(value)?.[1];
    paperControl.value = options ? /<option\b[^>]*value=['"]([^'"]+)['"][^>]*\bselected\b/.exec(options)?.[1] || 'light' : '';
  } });
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { if (failStorage) throw new Error('Quota exceeded'); stored.set(key, value); } };
  class TestServer extends StudioServer { constructor(settings) { super({ ...settings, fetchImpl: fetchImpl || api?.fetchImpl || (async () => { throw new TypeError('Offline'); }) }); } }
  const document = {
    documentElement: { dataset: {} }, activeElement: null, title: '',
    querySelector(selector) { return ({ '#app': app, '#dialog': dialog, '#toast': toast, '#draft-text': draft, '#script-paper-mode': paperControl.value ? paperControl : null, '#member-role-hint': memberRoleHint, '#issued-member-key': issuedMemberKey })[selector] || (selector.startsWith('.') ? element() : null); },
    querySelectorAll(selector) { return selector === '[data-storage-label]' ? [label] : selector === '[data-storage-error]' ? [storageErrorNode] : selector === '[data-paper-mode]' && paperControl.value ? [paperControl] : []; },
    createElement() { return element(); }
  };
  const schemeListeners = new Set();
  const scheme = { media: '(prefers-color-scheme: dark)', matches: systemDark, addEventListener(type, handler) { if (type === 'change') schemeListeners.add(handler); } };
  const window = { scrollY: 0, scrollTo() {}, addEventListener: (name, handler) => handlers.set(name, handler), matchMedia: () => scheme };
  const context = vm.createContext({
    makeDemo, frameAt, totalDuration, mapStages, cellPermissions, renderMapPage, renderCellCard, StudioServer: useDefaultFetch ? StudioServer : TestServer, structuredClone, localStorage, document, window,
    location: { hash }, crypto: globalThis.crypto, console, navigator: { clipboard: { writeText: async text => { clipboard.push(text); } } }, URL: class extends URL { static createObjectURL(blob) { downloads.push(blob); return 'blob:test-download'; } static revokeObjectURL() {} }, Blob, performance,
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
  const dataAttribute = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const click = action => dispatch(app, 'click', { closest: selector => selector === '[data-action]' ? { dataset: { action } } : null });
  const clickData = (attribute, value) => dispatch(app, 'click', { closest: selector => selector === `[data-${attribute}]` ? { dataset: { [dataAttribute(attribute)]: value } } : null });
  const dialogClickData = (attribute, value = '') => dispatch(dialog, 'click', { closest: selector => selector === `[data-${attribute}]` ? { dataset: { [dataAttribute(attribute)]: value } } : null });
  const dialogChange = (id, value) => dispatch(dialog, 'change', { id, value });
  const input = (id, value) => dispatch(app, 'input', { id, value });
  const change = (id, value) => dispatch(app, 'change', { id, value, dataset: id === paperControl.id ? paperControl.dataset : {} });
  const submit = (id, fields, dataset = {}) => dispatch(dialog, 'submit', { id, fields, dataset });
  const flushInput = async () => { for (const [id, timer] of [...timers]) if (timer.delay === 350) { timers.delete(id); timer.callback(); } await settle(); };
  await settle();
  return { app, dialog, toast, label, storageErrorNode, stored, context, document, paperControl, memberRoleHint, issuedMemberKey, clipboard, click, clickData, dialogClickData, dialogChange, input, change, submit, flushInput, settle, timers, downloads,
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
    assert.equal(first.label.textContent, 'сохранено на сервере', 'The first submit must connect without a retry');
    assert.equal(first.storageErrorNode.textContent, '');
    assert.deepEqual(JSON.parse(stored.get(settingsStorageKey)), { url: 'http://127.0.0.1:8770', key: 'admin-secret' });
    assert.equal(api.calls.filter(c => c.path === '/api/projects').length, 1);

    const callsBeforeReload = api.calls.length;
    const reloaded = await appHarness({ stored, useDefaultFetch: true });
    assert.equal(reloaded.label.textContent, 'сохранено на сервере', 'Saved settings must reconnect on startup without clicks');
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
  assert.match(ui.dialog.innerHTML, /Передайте ключ лично; письмо на e-mail подключим позже/);
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
