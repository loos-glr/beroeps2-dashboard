import { reactive, computed, watch } from '../lib/vue.js';
import { api, ApiError } from '../api.js';
import { contexts, selected, update as updateContext, setTeamCount } from './contexts.js';
import { toast } from './ui.js';

/** Dashboarddata van de gekozen klas (GET /contexts/{id}/dashboard). */
export const dashboard = reactive({
  teams: [],
  generatedAt: null,
  requests: null,
  github: null,       // { authMode, rateLimit }
  loaded: false,
  loading: false,
  error: '',
  refreshingIds: [],  // team-id's met een lopende per-team verversing
});

let controller = null;

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
  Object.assign(dashboard, { teams: [], generatedAt: null, requests: null, github: null, loaded: false, loading: false, error: '', refreshingIds: [] });
}

export async function load({ force = false } = {}) {
  const id = contexts.selectedId;
  if (!id) return clear();
  controller?.abort();
  const mine = (controller = new AbortController());
  dashboard.loading = true;
  dashboard.error = '';
  try {
    const data = await api.contexts.dashboard(id, { force, signal: mine.signal });
    if (mine.signal.aborted) return;
    Object.assign(dashboard, { teams: data.teams, generatedAt: data.generatedAt, requests: data.requests, github: data.github, loaded: true });
    setTeamCount(id, data.teams.length);
    if (!data.github?.rateLimit) loadRateLimit();
  } catch (err) {
    if (err.name === 'AbortError') return;
    dashboard.error = err instanceof ApiError ? err.message : 'Dashboard laden mislukt';
  } finally {
    if (controller === mine) dashboard.loading = false;
  }
}

/** Rate limit ophalen als alles uit snapshots kwam (GET /rate_limit telt niet mee voor de limiet). */
export async function loadRateLimit() {
  try {
    const { authMode, core } = await api.github.rateLimit();
    dashboard.github = { authMode, rateLimit: core };
  } catch { /* statusbalk toont dan "niet beschikbaar" */ }
}

export async function refreshTeam(teamId) {
  if (dashboard.loading || dashboard.refreshingIds.includes(teamId)) return;
  dashboard.refreshingIds.push(teamId);
  try {
    const res = await api.teams.refresh(teamId);
    replaceTeam(res.team);
    if (res.github) dashboard.github = res.github;
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

let settingsTimer = null;
let pendingPatch = {};
let pendingReload = false;
/** Drempel/TTL: direct lokaal tonen, na 600 ms opslaan en (voor de drempel) opnieuw laden. */
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
      if (doReload) await load();
      else toast('Instelling opgeslagen.', 'ok', 2500);
    } catch (err) {
      toast(`Opslaan mislukt: ${err.message}`, 'bad');
    }
  }, 600);
}

// Nieuwe klas gekozen → dashboard van die klas laden
watch(() => contexts.selectedId, id => (id ? load() : clear()));
