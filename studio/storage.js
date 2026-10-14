import { makeDemo } from './data.js';

const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const language = value => value === 'kk' ? 'kk' : 'ru';
const valueAt = (value, lang) => typeof value === 'string' ? value : value?.[lang] ?? '';
const projectPath = slug => `/api/projects/${encodeURIComponent(slug)}`;

export class StudioServerError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'StudioServerError';
    this.status = status;
    this.code = code;
  }
}

export function normalizeServerUrl(value = 'http://127.0.0.1:8770') {
  let url;
  try { url = new URL(String(value).trim()); } catch {
    throw new StudioServerError('Введите полный HTTP или HTTPS адрес сервера.', 422, 'INVALID_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    throw new StudioServerError('Адрес сервера должен использовать HTTP или HTTPS, без ключа, параметров и фрагмента.', 422, 'INVALID_URL');
  }
  return url.href.replace(/\/+$/, '');
}

// Plain API fields are authoritative in their primary language. Other languages
// come only from explicit translations; reading never invents a translation.
function translated(record, field, primary) {
  const result = { ru: record.translations?.ru?.[field] ?? '', kk: record.translations?.kk?.[field] ?? '' };
  result[primary] = record[field] ?? '';
  return result;
}

function translations(record, names) {
  return Object.fromEntries(['ru', 'kk'].map(lang => [lang,
    Object.fromEntries(names.map(name => [name, valueAt(record[name], lang)]))]));
}

function sceneModel(record, primary) {
  return { ...copy(record), title: translated(record, 'title', primary), text: translated(record, 'text', primary) };
}

function shotModel(record, primary) {
  return {
    ...copy(record),
    ...Object.fromEntries(['title', 'description', 'prompt', 'movement'].map(name => [name, translated(record, name, primary)])),
    comments: copy(record.comments || [])
  };
}

function snapshotModel(record, primary) {
  return {
    id: record.id, version: record.number, date: record.createdAt, kind: record.kind,
    scenes: record.scenes.map(scene => sceneModel(scene, primary)),
    scriptText: record.script.text,
    scriptLanguage: record.script.language,
    scriptTranslations: copy(record.script.translations || {})
  };
}

function emptyProject(metadata) {
  const primary = language(metadata.language);
  return Object.assign(makeDemo(), {
    slug: metadata.slug,
    title: translated(metadata, 'title', primary),
    synopsis: translated(metadata, 'synopsis', primary),
    scenes: [], shots: [], members: [], post: [], snapshots: [], version: 0,
    scriptStatus: 'draft',
    _server: true, _language: primary, _projectLanguage: primary,
    _revision: metadata.revision, _scriptText: '', _scriptTranslations: {}, _rawScriptTranslations: undefined, _denied: [],
    _capabilities: copy(metadata.capabilities || { manageTeam: false }),
    _principal: copy(metadata.principal || null),
    createdAt: metadata.createdAt, updatedAt: metadata.updatedAt
  });
}

function metadataPayload(p) {
  const primary = language(p._projectLanguage || p._language);
  return {
    title: valueAt(p.title, primary), synopsis: valueAt(p.synopsis, primary), language: primary,
    translations: translations(p, ['title', 'synopsis'])
  };
}

function scenePayload(scene, primary) {
  return {
    title: valueAt(scene.title, primary), text: valueAt(scene.text, primary),
    translations: translations(scene, ['title', 'text'])
  };
}

function shotPayload(shot, primary) {
  return {
    sceneId: shot.sceneId,
    ...Object.fromEntries(['title', 'description', 'prompt', 'movement'].map(name => [name, valueAt(shot[name], primary)])),
    duration: shot.duration, status: shot.status,
    owner: shot.owner || '', lens: shot.lens || '', imageUrl: shot.imageUrl || '', videoUrl: shot.videoUrl || '',
    translations: translations(shot, ['title', 'description', 'prompt', 'movement']),
    comments: copy(shot.comments || [])
  };
}

function memberPayload(member) {
  return { name: member.name, role: member.role, sections: copy(member.sections), keyId: member.keyId };
}

function changes(next, previous) {
  return Object.fromEntries(Object.entries(next).filter(([name, value]) => !same(value, previous[name])));
}

function scenesText(scenes, lang) {
  return scenes.map(scene => `${valueAt(scene.title, lang)}\n\n${valueAt(scene.text, lang)}`).join('\n\n');
}

export class StudioServer {
  constructor({ url = 'http://127.0.0.1:8770', key = '', fetchImpl = globalThis.fetch } = {}) {
    this.url = normalizeServerUrl(url);
    this.key = String(key).trim();
    this.fetchImpl = fetchImpl;
    // Only confirmed endpoint responses enter this baseline. A later failed
    // endpoint must not cause successful POSTs to be repeated on retry.
    this.known = new Map();
    this.memberIds = new Map();
  }

  async request(method, path, body, { revision, timeout = 4000 } = {}) {
    if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('#')) {
      throw new StudioServerError('Некорректный путь API.', 422, 'INVALID_PATH');
    }
    if (!this.key) throw new StudioServerError('Введите ключ роли.', 401, 'UNAUTHORIZED');
    const headers = { 'X-Key': this.key, Accept: 'application/json' };
    if (revision != null) headers['If-Match'] = `"${revision}"`;
    const options = { method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const controller = new AbortController();
    options.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    let payload;
    try {
      // Native browser fetch requires the global receiver, not this client.
      response = await this.fetchImpl.call(globalThis, `${this.url}${path}`, options);
      try { payload = await response.json(); } catch {
        throw new StudioServerError('Сервер вернул некорректный ответ.', response.status, 'INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof StudioServerError) throw error;
      throw new StudioServerError(controller.signal.aborted ? 'Сервер не ответил за 4 секунды.' : 'Сервер недоступен. Проверьте адрес и подключение.', 0, 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
    if (!response.ok) {
      throw new StudioServerError(payload?.error?.message || `Ошибка сервера (${response.status}).`, response.status, payload?.error?.code || 'SERVER_ERROR');
    }
    if (!payload || !Object.hasOwn(payload, 'data')) {
      throw new StudioServerError('В ответе сервера нет данных.', response.status, 'INVALID_RESPONSE');
    }
    const etag = response.headers?.get('ETag');
    const match = /^"(\d+)"$/.exec(etag || '');
    return { ...payload, revision: match ? Number(match[1]) : payload.data?.revision };
  }

  async list(path, expectedRevision) {
    const result = [];
    let offset = 0;
    while (true) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await this.request('GET', `${path}${separator}offset=${offset}&limit=200`);
      this.checkReadRevision(response, expectedRevision);
      if (!Array.isArray(response.data)) throw new StudioServerError('Сервер вернул некорректный список.', 200, 'INVALID_RESPONSE');
      result.push(...response.data);
      offset += response.data.length;
      const total = response.pagination?.total ?? offset;
      if (offset >= total) return result;
      if (!response.data.length) throw new StudioServerError('Список сервера изменился во время загрузки. Повторите подключение.', 409, 'REVISION_CONFLICT');
    }
  }

  checkReadRevision(response, expected) {
    if (expected != null && response.revision != null && response.revision !== expected) {
      throw new StudioServerError('Проект изменился во время загрузки. Повторите подключение.', 409, 'REVISION_CONFLICT');
    }
  }

  async loadProjects() {
    const projects = {};
    for (const metadata of await this.list('/api/projects')) {
      try { projects[metadata.slug] = await this.loadProject(metadata.slug); } catch (error) {
        // Access can be withdrawn, or a project removed, after the index read.
        if (![403, 404].includes(error.status)) throw error;
      }
    }
    return projects;
  }

  async loadProject(slug) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.readProject(slug); } catch (error) {
        if (error.code !== 'REVISION_CONFLICT' || attempt === 2) throw error;
      }
    }
  }

  async readProject(slug) {
    const path = projectPath(slug);
    const metadata = await this.request('GET', path);
    const p = emptyProject(metadata.data);
    p._revision = metadata.revision ?? metadata.data.revision;
    const primary = p._projectLanguage;
    const read = async (section, action) => {
      if (p._denied.includes(section)) return undefined;
      try { return await action(); } catch (error) {
        if (error.status !== 403) throw error;
        p._denied.push(section);
        return undefined;
      }
    };
    const single = async endpoint => {
      const response = await this.request('GET', `${path}/${endpoint}`);
      this.checkReadRevision(response, p._revision);
      return response.data;
    };
    const scenes = await read('script', () => this.list(`${path}/scenes`, p._revision));
    if (scenes) p.scenes = scenes.map(scene => sceneModel(scene, primary));
    const draft = await read('script', () => single('script'));
    if (draft) {
      p._language = language(draft.language);
      p._scriptText = draft.text;
      p._rawScriptTranslations = copy(draft.translations);
      p._scriptTranslations = copy(draft.translations || {});
      p._scriptTranslations[p._language] = draft.text;
      p.scriptStatus = draft.status;
    }
    const versions = await read('script', () => this.list(`${path}/versions`, p._revision));
    if (versions) {
      await read('script', async () => {
        for (const version of versions) {
          const full = await single(`versions/${encodeURIComponent(version.id)}`);
          p.snapshots.push(snapshotModel(full, primary));
        }
        p.version = Math.max(0, ...p.snapshots.map(version => version.version));
      });
    }
    const shots = await read('shots', () => this.list(`${path}/shots`, p._revision));
    if (shots) p.shots = shots.map(shot => shotModel(shot, primary));
    const members = await read('team', () => this.list(`${path}/members`, p._revision));
    if (members) p.members = copy(members);
    const post = await read('post', () => single('post'));
    if (post) p.post = copy(post.tasks);
    if (p._denied.includes('script')) {
      p.scenes = [];
      p.snapshots = [];
      p.version = 0;
      p._scriptText = '';
      p._scriptTranslations = {};
      p._rawScriptTranslations = undefined;
    }
    // Also compare a final metadata read: no accepted model mixes revisions.
    this.checkReadRevision(await this.request('GET', path), p._revision);
    this.known.set(slug, copy(p));
    return p;
  }

  async createProject(slug, p) {
    await this.request('POST', '/api/projects', { slug, ...metadataPayload(p) });
    // Creation intentionally leaves scenes, shots and history empty. Existing
    // local demo data is never implicitly copied to the server.
    return this.loadProject(slug);
  }

  async writeMember(slug, method, id, payload, p) {
    const known = this.known.get(slug);
    if (!known) throw new StudioServerError('Сначала загрузите проект с сервера.', 409, 'PROJECT_NOT_LOADED');
    const path = `${projectPath(slug)}/members${id ? `/${encodeURIComponent(id)}` : ''}`;
    const response = await this.request(method, path, payload, { revision: known._revision });
    const member = response.data;
    if (!member?.id) throw new StudioServerError('Сервер вернул некорректного участника.', 200, 'INVALID_RESPONSE');
    known._revision = response.revision ?? known._revision + 1;
    for (const record of new Set([known, p].filter(Boolean))) {
      record._revision = known._revision;
      const index = record.members.findIndex(item => item.id === member.id);
      // A legacy DELETE may return only {id, deleted:true}.
      if (member.deleted) {
        if (index >= 0) record.members.splice(index, 1);
      } else if (index >= 0) record.members[index] = copy(member);
      else record.members.push(copy(member));
    }
    // The key stays outside both the project and the confirmed baseline.
    return response;
  }

  async createMember(slug, payload, p) {
    const response = await this.writeMember(slug, 'POST', '', payload, p);
    return { member: response.data, key: response.key };
  }

  async updateMember(slug, id, payload, p) {
    return (await this.writeMember(slug, 'PATCH', id, payload, p)).data;
  }

  async revokeMember(slug, id, p) {
    return (await this.writeMember(slug, 'DELETE', id, undefined, p)).data;
  }

  async saveProject(slug, p, baseline) {
    let known = this.known.get(slug);
    if (!known && baseline) {
      known = copy(baseline);
      this.known.set(slug, known);
    }
    if (!known) throw new StudioServerError('Сначала загрузите проект с сервера.', 409, 'PROJECT_NOT_LOADED');
    const path = projectPath(slug);
    const primary = language(p._projectLanguage || p._language);
    p._revision = known._revision;
    const write = async (method, endpoint, body) => {
      const response = await this.request(method, endpoint, body, { revision: known._revision });
      known._revision = response.revision ?? known._revision + 1;
      p._revision = known._revision;
      return response.data;
    };
    const metadataChanges = changes(metadataPayload(p), metadataPayload(known));
    if (Object.keys(metadataChanges).length) {
      const result = await write('PATCH', path, metadataChanges);
      known.title = translated(result, 'title', primary);
      known.synopsis = translated(result, 'synopsis', primary);
      known._projectLanguage = language(result.language);
    }

    // The draft is derived only when scenes actually changed. A Fountain draft
    // read from the API survives unrelated shot/member/post edits verbatim.
    const comparableScenes = scenes => scenes.map(scene => ({ id: scene.id, ...scenePayload(scene, primary) }));
    const scenesChanged = !same(comparableScenes(p.scenes), comparableScenes(known.scenes));
    if (scenesChanged) {
      known._pendingScenesDraft = {
        texts: { ru: scenesText(p.scenes, 'ru'), kk: scenesText(p.scenes, 'kk') },
        sourceText: p._scriptText
      };
    }
    for (const scene of p.scenes) {
      const existing = known.scenes.find(item => item.id === scene.id);
      const payload = scenePayload(scene, primary);
      const patch = existing ? changes(payload, scenePayload(existing, primary)) : payload;
      if (!Object.keys(patch).length) continue;
      const result = await write(existing ? 'PATCH' : 'POST', existing ? `${path}/scenes/${encodeURIComponent(scene.id)}` : `${path}/scenes`, existing ? patch : { id: scene.id, ...payload });
      const model = sceneModel(result, primary);
      if (existing) known.scenes[known.scenes.indexOf(existing)] = model;
      else known.scenes.push(model);
      if (existing) {
        for (const shot of known.shots) if (shot.sceneId === scene.id) shot.needsReview = true;
        for (const shot of p.shots) if (shot.sceneId === scene.id) shot.needsReview = true;
      }
    }
    for (const shot of p.shots) {
      const existing = known.shots.find(item => item.id === shot.id);
      const payload = shotPayload(shot, primary);
      const patch = existing ? changes(payload, shotPayload(existing, primary)) : payload;
      // Re-approval is an explicit action even when the status was already
      // approved: the API clears its own needsReview flag via that PATCH.
      if (existing?.needsReview && shot.needsReview === false && shot.status === 'approved') patch.status = 'approved';
      if (!Object.keys(patch).length) continue;
      const result = await write(existing ? 'PATCH' : 'POST', existing ? `${path}/shots/${encodeURIComponent(shot.id)}` : `${path}/shots`, existing ? patch : { id: shot.id, ...payload });
      const model = shotModel(result, primary);
      if (existing) known.shots[known.shots.indexOf(existing)] = model;
      else known.shots.push(model);
      shot.needsReview = result.needsReview;
    }
    for (const member of p.members) {
      const temporaryId = member.id;
      const confirmedId = this.memberIds.get(`${slug}/${temporaryId}`) || temporaryId;
      const existing = known.members.find(item => item.id === confirmedId);
      if (existing) member.id = existing.id;
      if (!member.keyId) {
        if (existing && same(member, existing)) continue;
        throw new StudioServerError('Для участника укажите ID внешнего ключа роли.', 422, 'VALIDATION_ERROR');
      }
      const payload = memberPayload(member);
      const patch = existing ? changes(payload, memberPayload(existing)) : payload;
      if (!Object.keys(patch).length) continue;
      const result = await write(existing ? 'PATCH' : 'POST', existing ? `${path}/members/${encodeURIComponent(member.id)}` : `${path}/members`, patch);
      if (existing) known.members[known.members.indexOf(existing)] = copy(result);
      else {
        known.members.push(copy(result));
        this.memberIds.set(`${slug}/${temporaryId}`, result.id);
      }
      member.id = result.id;
    }
    if (!same(p.post, known.post)) {
      const result = await write('PUT', `${path}/post`, { tasks: copy(p.post) });
      known.post = copy(result.tasks);
    }
    if (!p._denied?.includes('script')) {
      const draftLanguage = language(p._language);
      const pendingScenesDraft = known._pendingScenesDraft;
      // A retry of the original snapshot still completes its derived draft.
      // A later whole-text edit takes priority once its scenes are confirmed.
      const explicitDraftChanged = pendingScenesDraft && !scenesChanged
        && p._scriptText !== pendingScenesDraft.sourceText
        && p._scriptText !== pendingScenesDraft.texts[draftLanguage];
      const usePendingDraft = pendingScenesDraft && !explicitDraftChanged;
      const draftText = usePendingDraft ? pendingScenesDraft.texts[draftLanguage] : p._scriptText ?? known._scriptText;
      const draftTranslations = usePendingDraft
        ? copy(pendingScenesDraft.texts)
        : copy(p._scriptTranslations || known._scriptTranslations || {});
      draftTranslations[draftLanguage] = draftText;
      const payload = { text: draftText, language: draftLanguage, status: p.scriptStatus, translations: draftTranslations };
      const previous = { text: known._scriptText, language: known._language, status: known.scriptStatus, translations: known._scriptTranslations };
      if (!same(payload, previous)) {
        const result = await write('PUT', `${path}/script`, payload);
        if (result.text !== known._scriptText || !same(result.translations, known._rawScriptTranslations)) {
          for (const shot of known.shots) shot.needsReview = true;
          for (const shot of p.shots) shot.needsReview = true;
        }
        known._scriptText = p._scriptText = result.text;
        known._language = p._language = language(result.language);
        known._rawScriptTranslations = p._rawScriptTranslations = copy(result.translations);
        known._scriptTranslations = p._scriptTranslations = copy(result.translations || {});
        known._scriptTranslations[known._language] = result.text;
        p._scriptTranslations[p._language] = result.text;
        known.scriptStatus = p.scriptStatus = result.status;
      }
      delete known._pendingScenesDraft;
    }
    return p;
  }

  async saveVersion(slug, p, baseline) {
    await this.saveProject(slug, p, baseline);
    const known = this.known.get(slug);
    const result = await this.request('POST', `${projectPath(slug)}/versions`, {}, { revision: known._revision });
    known._revision = p._revision = result.revision ?? known._revision + 1;
    return this.loadProject(slug);
  }

  async restoreVersion(slug, id) {
    const known = this.known.get(slug) || await this.loadProject(slug);
    const result = await this.request('POST', `${projectPath(slug)}/versions/${encodeURIComponent(id)}/restore`, {}, { revision: known._revision });
    known._revision = result.revision ?? known._revision + 1;
    return this.loadProject(slug);
  }
}
