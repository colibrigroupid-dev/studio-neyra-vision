import { StudioServerError } from './storage.js';

const sections = {
  breakdown: ['admin', 'producer', 'director', 'assistant_director'],
  heroes: ['admin', 'producer', 'director', 'artist'],
  locations: ['admin', 'producer', 'director', 'artist']
};
const collections = ['scenes', 'characters', 'locations'];

// These are the passport/import rights, not the legacy production-map aliases.
// The server remains authoritative if membership changes after this read.
export function canWriteBreakdownSection(project, section) {
  const principal = project?._principal || project?.principal;
  if (!Object.hasOwn(sections, section) || typeof project?.slug !== 'string'
      || !principal || typeof principal.id !== 'string' || !principal.id
      || !sections[section]?.includes(principal.role)
      || !Array.isArray(principal.projects) || !Array.isArray(principal.sections)
      || !(principal.projects.includes('*') || principal.projects.includes(project.slug))
      || !(principal.sections.includes('*') || principal.sections.includes(section))) return false;

  const teamKnown = Array.isArray(project.members) && !project._denied?.includes('team');
  if (principal.role === 'admin' || !teamKnown) return true;
  const member = project.members.find(record => record.keyId === principal.id);
  return Boolean(member && member.role === principal.role && !member.revokedAt
    && !['revoked', 'unavailable'].includes(member.accessStatus)
    && Array.isArray(member.sections) && member.sections.includes(section));
}

function projectPath(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    throw new StudioServerError('Некорректный код проекта.', 422, 'VALIDATION_ERROR');
  }
  return `/api/projects/${encodeURIComponent(slug)}`;
}

function revisionOf(response) {
  const revision = response?.revision ?? response?.data?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new StudioServerError('Сервер не вернул ревизию проекта.', 200, 'INVALID_RESPONSE');
  }
  return revision;
}

function validateRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new StudioServerError('Сначала загрузите актуальную разбивку проекта.', 409, 'PROJECT_NOT_LOADED');
  }
}

function checkRevision(response, expected) {
  if (revisionOf(response) !== expected) {
    throw new StudioServerError('Проект изменился во время загрузки. Обновите разбивку.', 409, 'REVISION_CONFLICT');
  }
}

/**
 * Uses StudioServer's public transport with strict revisions on every page. Reads are a
 * coherent revision snapshot; denied collections are null, never empty lists.
 * Mutations are sent once with If-Match and do not change its project baseline.
 */
export class BreakdownApi {
  constructor(client) {
    this.client = client;
  }

  async list(path, revision) {
    const records = [];
    let offset = 0;
    while (true) {
      const response = await this.client.request('GET', `${path}?offset=${offset}&limit=200`);
      checkRevision(response, revision);
      if (!Array.isArray(response.data)) throw new StudioServerError('Сервер вернул некорректный список.', 200, 'INVALID_RESPONSE');
      records.push(...response.data);
      offset += response.data.length;
      if (offset >= (response.pagination?.total ?? offset)) return records;
      if (!response.data.length) throw new StudioServerError('Список изменился. Обновите раздел.', 409, 'REVISION_CONFLICT');
    }
  }

  async load(slug) {
    const path = projectPath(slug);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const before = await this.client.request('GET', path);
        const revision = revisionOf(before);
        const results = await Promise.all(collections.map(async collection => {
          try {
            const records = await this.list(`${path}/${collection}`, revision);
            if (!Array.isArray(records)) {
              throw new StudioServerError('Сервер вернул некорректный список.', 200, 'INVALID_RESPONSE');
            }
            return { collection, records, denied: false };
          } catch (error) {
            if (error.status !== 403) throw error;
            return { collection, records: null, denied: true };
          }
        }));
        const after = await this.client.request('GET', path);
        checkRevision(after, revision);
        if (JSON.stringify(before.data?.principal) !== JSON.stringify(after.data?.principal)) {
          throw new StudioServerError('Права изменились во время загрузки.', 409, 'REVISION_CONFLICT');
        }
        return {
          ...Object.fromEntries(results.map(result => [result.collection, result.records])),
          denied: results.filter(result => result.denied).map(result => result.collection),
          principal: before.data?.principal,
          revision
        };
      } catch (error) {
        if (error.code !== 'REVISION_CONFLICT' || attempt === 2) throw error;
      }
    }
  }

  async patchPassport(slug, collection, id, patch, revision) {
    const path = projectPath(slug);
    if (!['characters', 'locations'].includes(collection)
        || typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)
        || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new StudioServerError('Некорректный паспорт проекта.', 422, 'VALIDATION_ERROR');
    }
    validateRevision(revision);
    const response = await this.client.request('PATCH', `${path}/${collection}/${encodeURIComponent(id)}`, patch, { revision });
    if (!response.data || response.data.id !== id) {
      throw new StudioServerError('Сервер вернул некорректный паспорт.', 200, 'INVALID_RESPONSE');
    }
    return { passport: response.data, revision: revisionOf(response) };
  }

  async import(slug, payload, revision) {
    const path = projectPath(slug);
    validateRevision(revision);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || !collections.every(collection => Array.isArray(payload[collection]))) {
      throw new StudioServerError('В razbivka.json нужны списки scenes, characters и locations.', 422, 'VALIDATION_ERROR');
    }
    const response = await this.client.request('POST', `${path}/breakdown`, payload, { revision });
    const data = response.data;
    if (!data || !collections.every(collection => Array.isArray(data[collection])
        && ['created', 'updated', 'unchanged'].every(field => Number.isSafeInteger(data.summary?.[collection]?.[field])
          && data.summary[collection][field] >= 0))) {
      throw new StudioServerError('Сервер вернул некорректную сводку импорта.', 200, 'INVALID_RESPONSE');
    }
    return { ...data, revision: revisionOf(response) };
  }
}
