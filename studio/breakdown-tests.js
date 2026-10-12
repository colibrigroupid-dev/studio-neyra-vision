import assert from 'node:assert/strict';
import { StudioServer } from './storage.js';
import { BreakdownApi, canWriteBreakdownSection } from './breakdown-api.js';
import { renderBreakdownSection, renderPassportEditor } from './breakdown.js';

const copy = value => structuredClone(value);
const allSections = ['overview', 'script', 'breakdown', 'heroes', 'locations', 'storyboard', 'team'];
const mutationRoles = {
  breakdown: ['admin', 'producer', 'director', 'assistant_director'],
  heroes: ['admin', 'producer', 'director', 'artist'],
  locations: ['admin', 'producer', 'director', 'artist']
};
const passport = (id, name = `Паспорт ${id}`) => ({
  id, name, role: 'Главная роль', identity: 'Согласованный замок', taboo: ['Без шрама'], height: 'Высокий',
  status: 'locked', scenes: [7, 41], refs: [{ path: 'visual/canon.jpg', role: 'identity' }],
  translations: { ru: { name: `Перевод ${id}` }, kk: { name: `Кейіпкер ${id}`, identity: 'Тұрақты келбет', taboo: ['Тыртықсыз'] } }
});
const projectFor = (role = 'artist', sectionList = allSections, keySource = 'issued') => ({
  slug: 'film', _principal: { id: 'person', role, projects: ['film'], sections: copy(sectionList) },
  members: [{ id: 'member', keyId: 'person', role, sections: copy(sectionList), accessStatus: 'active', keySource }],
  _denied: []
});
const response = (status, payload, revision) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json', ...(revision == null ? {} : { ETag: `"${revision}"` }) }
});
const errorResponse = (status, code) => response(status, { error: { code, message: code } });

// Exercise the real StudioServer transport/list implementation, including its
// headers and pagination. This double owns only in-memory data, never server/.
function transport({ denied = [], finalChanges = 0, mutate } = {}) {
  const records = {
    scenes: [41, 7, 90, 102, 205].map(n => ({ id: `scene-${n}`, n, title: `Сцена ${n}`, type: 'НАТ', location: 'Степь', time: 'ДЕНЬ', page_from: n, page_to: n + 1, chars: ['Герой'] })),
    characters: Array.from({ length: 5 }, (_, n) => passport(`character-${n}`)),
    locations: Array.from({ length: 5 }, (_, n) => passport(`location-${n}`))
  };
  const state = { revision: 4, metadataReads: 0, calls: [], records };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input), headers = new Headers(options.headers);
    const method = options.method || 'GET';
    const body = options.body == null ? undefined : JSON.parse(options.body);
    const call = { path: url.pathname, search: url.search, method, body: copy(body), ifMatch: headers.get('If-Match'), key: headers.get('X-Key') };
    state.calls.push(call);
    assert.equal(url.origin, 'https://api.test.invalid');
    assert.equal(call.key, 'participant-key');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.ok(!url.href.includes('participant-key'));
    if (body !== undefined) assert.equal(headers.get('Content-Type'), 'application/json');
    const intercepted = await mutate?.(call, state);
    if (intercepted) return intercepted;
    if (url.pathname === '/api/projects/film' && method === 'GET') {
      state.metadataReads += 1;
      if (state.metadataReads % 2 === 0 && finalChanges > 0) { finalChanges -= 1; state.revision += 1; }
      return response(200, { data: { slug: 'film', revision: state.revision } }, state.revision);
    }
    const match = /^\/api\/projects\/film\/(scenes|characters|locations)(?:\/([^/]+))?$/.exec(url.pathname);
    if (match && method === 'GET') {
      const [, collection] = match;
      if (denied.includes(collection)) return errorResponse(403, 'FORBIDDEN');
      const offset = Number(url.searchParams.get('offset') || 0);
      assert.equal(url.searchParams.get('limit'), '200');
      return response(200, { data: copy(records[collection].slice(offset, offset + 2)), pagination: { offset, limit: 2, total: records[collection].length } }, state.revision);
    }
    if (call.ifMatch !== `"${state.revision}"`) return errorResponse(409, 'REVISION_CONFLICT');
    if (match && method === 'PATCH') {
      const [, collection, id] = match;
      const item = records[collection].find(record => record.id === id);
      if (!item) return errorResponse(404, 'NOT_FOUND');
      Object.assign(item, copy(body)); state.revision += 1;
      return response(200, { data: copy(item) }, state.revision);
    }
    if (url.pathname === '/api/projects/film/breakdown' && method === 'POST') {
      state.revision += 1;
      const summary = Object.fromEntries(['scenes', 'characters', 'locations'].map(collection => [collection, { created: body[collection].length, updated: 0, unchanged: 0 }]));
      return response(200, { data: { summary, scenes: body.scenes.map(record => ({ id: `scene-${record.n}`, n: record.n })), characters: body.characters.map((record, n) => ({ id: `character-${n}`, name: record.name })), locations: body.locations.map((record, n) => ({ id: `location-${n}`, name: record.name })) } }, state.revision);
    }
    return errorResponse(404, 'NOT_FOUND');
  };
  const client = new StudioServer({ url: 'https://api.test.invalid/', key: 'participant-key', fetchImpl });
  return { state, client, api: new BreakdownApi(client) };
}

const importData = () => ({
  scenes: [{ n: 7, heading: 'ИНТ. КОМНАТА — ДЕНЬ', type: 'ИНТ', location: 'КОМНАТА', time: 'ДЕНЬ', act: '', chars: ['ГЕРОЙ'], page_from: 1, page_to: 2 }],
  characters: [{ name: 'ГЕРОЙ', age: null, lines: 1, scenes: [7], first_scene: 7 }],
  locations: [{ name: 'КОМНАТА', parent: 'КОМНАТА', types: ['ИНТ'], times: ['ДЕНЬ'], scenes: [7] }],
  title: { Title: 'Авторский фильм' }, pages_est: 2, caps_mentions: []
});

export async function verifyBreakdownModules() {
  // A role alone or the legacy map aliases cannot grant these cinema writes.
  for (const role of ['admin', 'producer', 'director', 'assistant_director', 'writer', 'artist', 'cinematographer', 'editor', 'viewer', 'unknown']) {
    for (const source of ['external', 'issued']) {
      for (const section of Object.keys(mutationRoles)) {
        const p = projectFor(role, allSections, source);
        assert.equal(canWriteBreakdownSection(p, section), mutationRoles[section].includes(role), `${source} ${role} ${section}`);
        p._principal.sections = ['overview', 'script', 'storyboard'];
        assert.equal(canWriteBreakdownSection(p, section), false, 'Legacy script/storyboard scopes never alias passport/import rights');
        p._principal.sections = allSections;
        p._principal.projects = ['other-film'];
        assert.equal(canWriteBreakdownSection(p, section), false, 'Project restriction applies to every role, including admin');
      }
    }
  }
  for (const section of Object.keys(mutationRoles)) {
    const p = projectFor(section === 'breakdown' ? 'director' : 'artist');
    p._principal.projects = ['*'];
    assert.equal(canWriteBreakdownSection(p, section), true, 'Wildcard project scope remains valid');
    for (const edit of [
      member => { member.sections = ['overview']; }, member => { member.role = 'viewer'; },
      member => { member.keyId = 'other-person'; }, member => { member.revokedAt = '2026-10-13'; },
      member => { member.accessStatus = 'revoked'; }, member => { member.accessStatus = 'unavailable'; }
    ]) {
      const deniedProject = copy(p); edit(deniedProject.members[0]);
      assert.equal(canWriteBreakdownSection(deniedProject, section), false, 'Current membership restricts principal rights');
    }
    const noMember = copy(p); noMember.members = [];
    assert.equal(canWriteBreakdownSection(noMember, section), false);
    const admin = projectFor('admin'); admin.members = [];
    assert.equal(canWriteBreakdownSection(admin, section), true, 'Admin has the server membership exception');
  }
  for (const p of [null, {}, { slug: 'film' }, { ...projectFor(), _principal: null }, { ...projectFor(), _principal: { id: '', role: 'artist', projects: ['film'], sections: allSections } }]) {
    assert.equal(canWriteBreakdownSection(p, 'heroes'), false);
  }
  assert.equal(canWriteBreakdownSection(projectFor(), 'script'), false);

  const injected = `<img src=x onerror='alert(1)'> & " </textarea><script>alert(2)</script>`;
  const character = { ...passport('hero-1'), name: injected, role: injected, identity: injected, taboo: [injected], height: injected, scenes: [7, 41], translations: { kk: { name: 'Ә Ғ Қ Ң Ө Ұ Ү Һ І', role: 'Негізгі рөл', identity: 'Қазақша келбет', height: 'Ұзын', taboo: ['Қазақша тыйым'] } } };
  const snapshot = { revision: 4, denied: [], scenes: [
    { id: 'manual-scene', title: 'Ручная сцена', chars: [] },
    { id: 'scene-41', n: 41, type: 'НАТ', location: injected, time: injected, page_from: 12, page_to: 14, chars: [injected] },
    { id: 'scene-7', n: 7, type: 'ИНТ', location: 'Дом', time: 'НОЧЬ', page_from: 2, page_to: 2, chars: ['Герой'] }
  ], characters: [character], locations: [{ ...passport('place-1', 'Пещера'), translations: { kk: { name: 'Үңгір' } }, status: 'draft' }] };
  const before = copy(snapshot);
  for (const [locale, headings] of [['ru', ['Разбивка', 'Герои', 'Локации']], ['kk', ['Сценарийді талдау', 'Кейіпкерлер', 'Локациялар']]]) {
    for (const [index, section] of ['breakdown', 'heroes', 'locations'].entries()) {
      const html = renderBreakdownSection({ section, snapshot, locale, connected: true, canEdit: true, canImport: true, mode: 'light' });
      assert.ok(html.includes(`<h1>${headings[index]}</h1>`));
      assert.match(html, /data-cinema-mode='light'/);
      assert.ok(!html.includes('<script>') && !html.includes('<img src=x'), 'Untrusted passport and scene fields are escaped');
      if (section === 'breakdown') {
        assert.ok(html.indexOf("data-scene-id='scene-7'") < html.indexOf("data-scene-id='scene-41'"), 'Imported scene numbers determine ordering');
        assert.match(html, /<th scope='row'>41<\/th>/);
        assert.match(html, /12–14/);
        assert.match(html, /data-scene-id='manual-scene'><th scope='row'>—<\/th>/, 'No fabricated array-index number for a manual scene');
        assert.ok(!/<th scope='row'>[13]<\/th>/.test(html));
      } else {
        assert.match(html, /data-action='edit-passport'/);
        assert.match(html, /7, 41/);
        assert.match(html, section === 'heroes' ? /data-status='locked'/ : /data-status='draft'/);
      }
      const readOnly = renderBreakdownSection({ section, snapshot, locale, connected: true });
      assert.ok(!readOnly.includes("data-action='edit-passport'") && !readOnly.includes("data-action='import-breakdown'"));
      const empty = renderBreakdownSection({ section, snapshot: { scenes: [], characters: [], locations: [], denied: [] }, connected: true, canImport: true, locale });
      assert.match(empty, /razbivka\.json/);
      assert.match(empty, /data-action='import-breakdown'/);
      const collection = ({ breakdown: 'scenes', heroes: 'characters', locations: 'locations' })[section];
      const denied = renderBreakdownSection({ section, snapshot: { ...snapshot, denied: [collection] }, connected: true, locale });
      assert.ok(!denied.includes('passport-card') && !denied.includes('breakdown-table'));
      assert.ok(!denied.includes('razbivka.json'), 'Forbidden is not a false empty/import state');
    }
  }
  assert.deepEqual(snapshot, before, 'Renderers never mutate authoritative data');
  const kkCard = renderBreakdownSection({ section: 'heroes', snapshot, connected: true, locale: 'kk' });
  assert.ok(kkCard.includes('Ә Ғ Қ Ң Ө Ұ Ү Һ І') && kkCard.includes('Қазақша келбет') && kkCard.includes('Қазақша тыйым'));
  const errorHtml = renderBreakdownSection({ connected: true, error: injected });
  assert.match(errorHtml, /role='alert'/); assert.ok(!errorHtml.includes('<script>'));
  assert.ok(!errorHtml.includes('razbivka.json'));
  assert.match(renderBreakdownSection({ connected: false }), /Введите ключ участника/);
  assert.match(renderBreakdownSection({ connected: true, loading: true }), /aria-busy='true'/);
  const editor = renderPassportEditor({ record: character, collection: 'characters', locale: 'kk' });
  assert.ok(editor.includes('&lt;img src=x') && !editor.includes('<script>'));
  assert.ok(!editor.includes('Қазақша келбет'), 'Editor edits base fields even when cards show translations');
  assert.match(editor, /аудармалар бөлек сақталады/);
  assert.ok(!/name='(?:refs|translations)'/.test(editor), 'Hidden refs/translations are omitted from edit fields');
  assert.deepEqual(character.refs, [{ path: 'visual/canon.jpg', role: 'identity' }]);

  const live = transport();
  const loaded = await live.api.load('film');
  assert.equal(loaded.revision, 4);
  for (const collection of ['scenes', 'characters', 'locations']) {
    assert.equal(loaded[collection].length, 5, 'All pages are included');
    assert.deepEqual(live.state.calls.filter(call => call.path.endsWith(`/${collection}`)).map(call => new URLSearchParams(call.search).get('offset')), ['0', '2', '4']);
  }
  assert.deepEqual(loaded.denied, []);
  const denied = transport({ denied: ['scenes', 'locations'] });
  const partial = await denied.api.load('film');
  assert.equal(partial.scenes, null); assert.equal(partial.locations, null);
  assert.equal(partial.characters.length, 5);
  assert.deepEqual(partial.denied, ['scenes', 'locations']);
  const onceChanged = transport({ finalChanges: 1 });
  assert.equal((await onceChanged.api.load('film')).revision, 5);
  assert.equal(onceChanged.state.metadataReads, 4, 'Final metadata change causes a bounded coherent retry');
  const alwaysChanged = transport({ finalChanges: 3 });
  await assert.rejects(() => alwaysChanged.api.load('film'), error => error.code === 'REVISION_CONFLICT');
  assert.equal(alwaysChanged.state.metadataReads, 6, 'Read retries stop after three attempts');
  const badList = transport({ mutate: call => call.path.endsWith('/characters') ? response(200, { data: {} }, 4) : undefined });
  await assert.rejects(() => badList.api.load('film'), error => error.code === 'INVALID_RESPONSE');
  const noRevision = transport({ mutate: call => call.path === '/api/projects/film' ? response(200, { data: { slug: 'film' } }) : undefined });
  await assert.rejects(() => noRevision.api.load('film'), error => error.code === 'INVALID_RESPONSE');
  const noPageRevision = transport({ mutate: call => call.path.endsWith('/characters') ? response(200, { data: [], pagination: { offset: 0, limit: 2, total: 0 } }) : undefined });
  await assert.rejects(() => noPageRevision.api.load('film'), error => error.code === 'INVALID_RESPONSE');
  const pageChanged = transport({ mutate: call => call.path.endsWith('/scenes') && call.search.includes('offset=2') ? response(200, { data: [], pagination: { total: 5 } }, 8) : undefined });
  await assert.rejects(() => pageChanged.api.load('film'), error => error.code === 'REVISION_CONFLICT');

  const original = copy(live.state.records.characters[0]);
  live.client.known.set('film', { _revision: 4 });
  const patch = { identity: 'Новый замок', taboo: [], status: 'draft' };
  const saved = await live.api.patchPassport('film', 'characters', original.id, patch, 4);
  const patchCall = live.state.calls.find(call => call.method === 'PATCH');
  assert.equal(patchCall.ifMatch, '"4"'); assert.deepEqual(patchCall.body, patch);
  assert.deepEqual(saved.passport.refs, original.refs); assert.deepEqual(saved.passport.translations, original.translations);
  assert.deepEqual(saved.passport.scenes, original.scenes); assert.equal(saved.passport.name, original.name);
  assert.equal(saved.revision, 5);
  assert.equal(live.client.known.get('film')._revision, 4, 'Feature API does not silently advance an author-material baseline');
  const payload = importData();
  const imported = await live.api.import('film', payload, 5);
  const postCall = live.state.calls.find(call => call.method === 'POST');
  assert.equal(postCall.path, '/api/projects/film/breakdown'); assert.equal(postCall.ifMatch, '"5"');
  assert.deepEqual(postCall.body, payload, 'Direct parser payload passes without wrapper or invented fields');
  assert.equal(imported.revision, 6); assert.equal(imported.summary.scenes.created, 1);
  assert.deepEqual(payload, importData());

  for (const failure of ['conflict', 'offline', 'malformed']) {
    for (const operation of ['patch', 'import']) {
      const failing = transport({ mutate: call => {
        if (call.method === 'GET') return undefined;
        if (failure === 'conflict') return errorResponse(409, 'REVISION_CONFLICT');
        if (failure === 'offline') throw new TypeError('Connection closed');
        return response(200, { data: { id: 'wrong-id', summary: {} } }, 5);
      } });
      const perform = () => operation === 'patch'
        ? failing.api.patchPassport('film', 'characters', 'character-0', { height: 'Средний' }, 4)
        : failing.api.import('film', importData(), 4);
      await assert.rejects(perform, error => error.code === ({ conflict: 'REVISION_CONFLICT', offline: 'NETWORK_ERROR', malformed: 'INVALID_RESPONSE' })[failure]);
      assert.equal(failing.state.calls.length, 1, `${operation} ${failure} never retries a possibly committed mutation`);
      assert.equal(failing.state.revision, 4);
    }
  }
  const invalid = transport();
  for (const action of [
    () => invalid.api.load('../film'),
    () => invalid.api.patchPassport('film', 'scenes', 'scene-1', {}, 4),
    () => invalid.api.patchPassport('film', 'characters', '../id', {}, 4),
    () => invalid.api.patchPassport('film', 'characters', 'character-0', [], 4),
    () => invalid.api.patchPassport('film', 'characters', 'character-0', {}, undefined),
    () => invalid.api.import('film', [], 4),
    () => invalid.api.import('film', { scenes: [] }, 4),
    () => invalid.api.import('film', importData(), -1)
  ]) await assert.rejects(action);
  assert.equal(invalid.state.calls.length, 0, 'Invalid interface inputs never reach transport');
  console.log('Breakdown modules: RU/KK renders, escaping, imported metadata, empty/denied states, rights, paginated coherent reads and single revision-guarded mutations: passed.');
}
