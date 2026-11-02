import { reactive, computed, watch } from '../lib/vue.js';
import { api, ApiError } from '../api.js';
import { contexts, selected, update as updateContext, setTeamCount } from './contexts.js';
import { toast } from './ui.js';
import { KEYS, read, write } from '../util/storage.js';
import { PERIODS } from '../util/status.js';

/** Dashboarddata van de gekozen klas (GET /contexts/{id}/dashboard). */
export const dashboard = reactive({
  teams: [],
  generatedAt: null,
  period: PERIODS.some(p => p.key === read(KEYS.PERIOD)) ? read(KEYS.PERIOD) : 'all',
  periodInfo: null,   // { key, from, fallback, sprintStartDate } uit de laatste respons
  sync: null,         // { synced, fromDb, failed, cost }
  github: null,       // { authMode, rateLimit, graphql }
  loaded: false,
  loading: false,
  error: '',
  refreshingIds: [],  // team-id's met een lopende per-team verversing
  queue: { running: false, done: 0, total: 0, currentName: '', failed: 0 },   // achtergrond-sync
});

let controller = null;
let queueController = null;

export const kpis = computed(() => {
  const k = { students: 0, green: 0, amber: 0, red: 0 };
  for (const t of dashboard.teams) {
    k.students += t.members.length;
    for (const m of t.members) k[m.status.level]++;
  }
  return k;
});

export function clear() {
  controller?.abort();
  queueController?.abort();
  Object.assign(dashboard, { teams: [], generatedAt: null, sync: null, periodInfo: null, github: null, loaded: false, loading: false, error: '', refreshingIds: [],
    queue: { running: false, done: 0, total: 0, currentName: '', failed: 0 } });
}

/**
 * Leest het dashboard altijd direct uit de database; teams met `needsSync` worden daarna één voor één op de
 * achtergrond ververst (startQueue). Alleen force/sync=true laat de server zelf synchroon synchroniseren.
 */
export async function load({ force = false, sync = false } = {}) {
  const id = contexts.selectedId;
  if (!id) return clear();
  controller?.abort();
  const mine = (controller = new AbortController());
  dashboard.loading = true;
  dashboard.error = '';
  try {
    const data = await api.contexts.dashboard(id, { force, sync: sync || force, period: dashboard.period, signal: mine.signal });
    if (mine.signal.aborted) return;
    Object.assign(dashboard, { teams: data.teams, generatedAt: data.generatedAt, sync: data.sync, periodInfo: data.period, github: data.github, loaded: true });
    setTeamCount(id, data.teams.length);
    if (!data.github?.graphql) loadRateLimit();
    if (!sync && !force) startQueue(data.teams.filter(t => t.needsSync).map(t => t.id));
  } catch (err) {
    if (err.name === 'AbortError') return;
    dashboard.error = err instanceof ApiError ? err.message : 'Dashboard laden mislukt';
  } finally {
    if (controller === mine) dashboard.loading = false;
  }
}

/** Rate limit ophalen als er niet gesynct is (GET /rate_limit telt niet mee voor de limiet). */
export async function loadRateLimit() {
  try {
    const { authMode, core, graphql } = await api.github.rateLimit();
    dashboard.github = { authMode, rateLimit: core, graphql };
  } catch { /* statusbalk toont dan "niet beschikbaar" */ }
}

/**
 * Ververst teams sequentieel op de achtergrond (een request per team), zodat kaarten één voor één binnenstromen.
 * Een nieuwe queue, klaswissel of clear() breekt de lopende queue af.
 */
export async function startQueue(ids, { force = false } = {}) {
  queueController?.abort();
  const contextId = contexts.selectedId;
  const period = dashboard.period;
  const mine = (queueController = new AbortController());
  Object.assign(dashboard.queue, { running: ids.length > 0, done: 0, total: ids.length, currentName: '', failed: 0 });
  if (!ids.length) return;
  if (force) dashboard.sync = { synced: 0, fromDb: dashboard.teams.length, failed: 0, cost: 0 };

  const stale = () => mine.signal.aborted || contexts.selectedId !== contextId;
  try {
    for (const id of ids) {
      if (stale()) return;
      const team = dashboard.teams.find(t => t.id === id);
      if (!team || dashboard.refreshingIds.includes(id)) {
        dashboard.queue.done++;
        continue;
      }
      dashboard.queue.currentName = team.teamName;
      dashboard.refreshingIds.push(id);
      try {
        const res = await api.teams.refresh(id, period, { force, signal: mine.signal });
        if (stale()) return;
        replaceTeam(res.team);
        if (res.github) dashboard.github = res.github;
        dashboard.generatedAt = new Date().toISOString();
        const sync = dashboard.sync ?? { synced: 0, fromDb: 0, failed: 0, cost: 0 };
        const ok = res.team.cacheStatus !== 'error' && res.team.cacheStatus !== 'stale-error';
        dashboard.sync = {
          synced: sync.synced + (ok ? 1 : 0),
          fromDb: Math.max(0, sync.fromDb - 1),
          failed: sync.failed + (ok ? 0 : 1),
          cost: sync.cost + (res.sync?.cost ?? 0),
        };
        if (!ok) dashboard.queue.failed++;
      } catch (err) {
        if (err.name === 'AbortError' || stale()) return;
        dashboard.queue.failed++;
      } finally {
        dashboard.refreshingIds = dashboard.refreshingIds.filter(x => x !== id);
      }
      dashboard.queue.done++;
    }
    if (dashboard.queue.failed > 0) toast(`${dashboard.queue.failed} team(s) konden niet worden ververst.`, 'warn');
  } finally {
    if (queueController === mine) {
      dashboard.queue.running = false;
      dashboard.queue.currentName = '';
    }
  }
}

/** "Ververs alles": forceert alle teams van de klas, een voor een. */
export function refreshAll() {
  return startQueue(dashboard.teams.map(t => t.id), { force: true });
}

export async function refreshTeam(teamId) {
  if (dashboard.loading || dashboard.refreshingIds.includes(teamId)) return;
  dashboard.refreshingIds.push(teamId);
  try {
    const res = await api.teams.refresh(teamId, dashboard.period);
    replaceTeam(res.team);
    if (res.github) dashboard.github = res.github;
    if (res.sync) dashboard.sync = res.sync;
  } catch (err) {
    toast(`Verversen mislukt: ${err.message}`, 'bad');
  } finally {
    dashboard.refreshingIds = dashboard.refreshingIds.filter(x => x !== teamId);
  }
}

export function replaceTeam(team) {
  const i = dashboard.teams.findIndex(t => t.id === team.id);
  if (i === -1) {
    dashboard.teams.push(team);
    dashboard.teams.sort((a, b) => a.teamName.localeCompare(b.teamName, 'nl'));
  } else {
    dashboard.teams[i] = team;
  }
  if (contexts.selectedId) setTeamCount(contexts.selectedId, dashboard.teams.length);
}

export function removeTeam(teamId) {
  dashboard.teams = dashboard.teams.filter(t => t.id !== teamId);
  if (contexts.selectedId) setTeamCount(contexts.selectedId, dashboard.teams.length);
}

/** Werkt een student overal lokaal bij (naam, notities, studentnummer) zonder nieuwe GitHub-calls. */
export function applyStudentUpdate(student) {
  for (const team of dashboard.teams) {
    for (const m of team.members) {
      if (m.student?.id !== student.id) continue;
      m.student = { id: student.id, fullName: student.fullName, studentNumber: student.studentNumber, notes: student.notes };
      m.displayName = student.fullName;
    }
  }
}

/** Periode wisselen: alleen herberekenen uit de database, dit kost geen GitHub-calls. */
export function setPeriod(key) {
  if (dashboard.period === key) return;
  dashboard.period = key;
  write(KEYS.PERIOD, key);
  load({ sync: false });
}

let settingsTimer = null;
let pendingPatch = {};
let pendingReload = false;
/** Drempel/TTL/sprintstart: direct lokaal tonen, na 600 ms opslaan en (indien nodig) opnieuw uit de database laden. */
export function saveSettings(patch, { reload = false } = {}) {
  const ctx = selected.value;
  if (!ctx) return;
  Object.assign(ctx, patch);
  Object.assign(pendingPatch, patch);
  pendingReload ||= reload;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const body = pendingPatch, doReload = pendingReload;
    pendingPatch = {};
    pendingReload = false;
    try {
      await updateContext(ctx.id, body);
      if (doReload) await load({ sync: false });
      else toast('Instelling opgeslagen.', 'ok', 2500);
    } catch (err) {
      toast(`Opslaan mislukt: ${err.message}`, 'bad');
    }
  }, 600);
}

// Nieuwe klas gekozen → dashboard van die klas laden
watch(() => contexts.selectedId, id => (id ? load() : clear()));

/** Zoekt een team en het lid dat deze handle bevat (key verandert na samenvoegen, handles niet). */
export function findMember(teamId, handle) {
  const team = dashboard.teams.find(t => t.id === teamId) ?? null;
  const h = String(handle).toLowerCase();
  const member = team?.members.find(m => m.handles.some(x => x.toLowerCase() === h)) ?? null;
  return { team, member };
}
