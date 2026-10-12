import { StudioServerError } from './storage.js';

const pathFor = slug => `/api/projects/${encodeURIComponent(slug)}`;
const list = value => Array.isArray(value) ? value : [];
const legacySections = {
  script: 'script', breakdown: 'script', heroes: 'storyboard', locations: 'storyboard',
  storyboard: 'storyboard', shots: 'shots', video: 'animatic', sound: 'post', edit: 'post'
};
const readonlySections = { writer: ['breakdown'], editor: ['sound'] };
const cinemaSection = stage => stage === 'video' ? 'animatic' : stage;
const sameObject = (a, b) => a?.type === b?.type && a?.id === b?.id;
const sameCell = (a, b) => Boolean(a?.id && a.id === b?.id && a.stage === b.stage
  && sameObject(a.object, b.object) && a.version === b.version && a.variant === b.variant);

function mapData(value, slug) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.project !== slug) {
    throw new StudioServerError('Сервер вернул некорректную карту.', 200, 'INVALID_RESPONSE');
  }
  return {
    ...value,
    ...Object.fromEntries(['stages', 'objects', 'grid', 'cells', 'myTasks', 'awaitingMe'].map(name => [name, list(value[name])]))
  };
}

function readRevision(response) {
  if (!Number.isSafeInteger(response?.revision) || response.revision < 0) {
    throw new StudioServerError('Сервер не указал ревизию карты.', 200, 'INVALID_RESPONSE');
  }
  return response.revision;
}

// The server's awaitingMe is authoritative. Local checks additionally keep a
// stale card or locally altered role from offering an approval action. Source
// comes from public team metadata: principal_info does not expose keySource.
export function canApproveCell(cell, map, project) {
  const principal = project?._principal || project?.principal;
  const slug = project?.slug;
  if (!principal?.id || !principal.role || principal.role === 'viewer' || !slug
      || map?.project !== slug || !Object.hasOwn(legacySections, cell?.stage || '')) return false;
  const current = list(map.cells).find(item => sameCell(item, cell));
  if (!current || current.status !== 'awaiting' || cell.status !== 'awaiting'
      || !(current.version || current.variant)
      || !list(map.awaitingMe).some(item => sameCell(item, current) && item.status === 'awaiting')) return false;
  if (![current.approverRole, 'admin', 'producer'].includes(principal.role)) return false;
  if (!list(principal.projects).some(scope => scope === '*' || scope === slug)) return false;
  const sections = list(principal.sections);
  if (!sections.includes('overview') || list(project._denied).includes('overview')) return false;

  const teamKnown = Array.isArray(project.members) && !list(project._denied).includes('team');
  const member = teamKnown ? project.members.find(item => item.keyId === principal.id) : undefined;
  if (principal.role !== 'admin' && teamKnown
      && (!member || member.role !== principal.role || member.revokedAt
        || ['revoked', 'unavailable'].includes(member.accessStatus))) return false;
  const effective = principal.role !== 'admin' && member
    ? sections.filter(section => list(member.sections).includes(section)) : sections;
  if (!effective.includes('overview')) return false;
  const stageSections = principal.role === 'admin' || member?.keySource === 'external'
    ? [legacySections[current.stage]]
    : member?.keySource === 'issued' ? [cinemaSection(current.stage)]
      : [cinemaSection(current.stage), legacySections[current.stage]];
  return stageSections.some(section => effective.includes(section)
    && !list(readonlySections[principal.role]).includes(section));
}

export class ProductionMapApi {
  constructor(client) { this.client = client; }

  async cell(slug, id, revision) {
    const response = await this.client.request('GET', `${pathFor(slug)}/cells/${encodeURIComponent(id)}`);
    this.client.checkReadRevision(response, revision);
    if (!response.data || typeof response.data !== 'object' || response.data.id !== id) {
      throw new StudioServerError('Сервер вернул некорректную клетку.', 200, 'INVALID_RESPONSE');
    }
    return response.data;
  }

  async load(slug) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const path = pathFor(slug);
        // /map is a complete snapshot and rejects pagination parameters.
        const first = await this.client.request('GET', `${path}/map`);
        const revision = readRevision(first);
        const map = mapData(first.data, slug);
        const [activity, approvals] = await Promise.all([
          this.client.list(`${path}/activity`, revision),
          this.client.list(`${path}/approvals`, revision)
        ]);
        const final = await this.client.request('GET', `${path}/map`);
        if (readRevision(final) !== revision) {
          throw new StudioServerError('Карта изменилась во время загрузки. Повторите обновление.', 409, 'REVISION_CONFLICT');
        }
        return { map, activity: list(activity), approvals: list(approvals), revision };
      } catch (error) {
        if (error.status !== 409 || attempt === 2) throw error;
      }
    }
  }

  async approve(slug, cell, verdict, comment, revision) {
    if (!['approved', 'returned'].includes(verdict) || !cell?.object || !cell?.stage) {
      throw new StudioServerError('Некорректный вердикт карты.', 422, 'VALIDATION_ERROR');
    }
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new StudioServerError('Сначала загрузите актуальную карту.', 409, 'PROJECT_NOT_LOADED');
    }
    const response = await this.client.request('POST', `${pathFor(slug)}/approvals`, {
      object: { type: cell.object.type, id: cell.object.id }, stage: cell.stage,
      version: cell.version ?? null, variant: cell.variant ?? null, verdict, comment: comment ?? ''
    }, { revision });
    // Never retry POST: a network failure may follow a successful write.
    return { approval: response.data, revision: response.revision };
  }
}
