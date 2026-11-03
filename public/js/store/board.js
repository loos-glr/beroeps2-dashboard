import { reactive, computed } from '../lib/vue.js';
import { dashboard, startQueue } from './dashboard.js';
import { contexts } from './contexts.js';
import { KEYS, read, write, readJson } from '../util/storage.js';
import { PERIODS } from '../util/status.js';

const REFRESH_CHOICES = [0, 3, 5];
const storedRefresh = read(KEYS.BOARD_REFRESH, '3');

/** Voorkeuren en lopende toestand van het digibord (klasweergave). Niets hiervan gaat naar de server. */
export const board = reactive({
  showMembers: read(KEYS.BOARD_MEMBERS) === 'members',
  refreshMinutes: REFRESH_CHOICES.includes(Number(storedRefresh)) ? Number(storedRefresh) : 3,
  period: PERIODS.some(p => p.key === read(KEYS.BOARD_PERIOD)) ? read(KEYS.BOARD_PERIOD) : 'today',
  goals: readJson(KEYS.BOARD_GOALS, {}) ?? {},   // { [contextId]: { [period]: { commits?, prs? } } } (alleen afwijkingen)
  lastRunAt: Date.now(),
  paused: false,                                 // auto-verversen wacht op de GitHub-limiet
});

export const REFRESH_OPTIONS = REFRESH_CHOICES;
const MIN_RATE_LIMIT = 250;
const HEARTBEAT_SLACK_MS = 30000;

export function setShowMembers(on) {
  board.showMembers = on;
  write(KEYS.BOARD_MEMBERS, on ? 'members' : 'teams');
}

export function setRefreshMinutes(n) {
  board.refreshMinutes = n;
  board.lastRunAt = Date.now();
  write(KEYS.BOARD_REFRESH, String(n));
}

export function setBoardPeriod(key) {
  board.period = key;
  write(KEYS.BOARD_PERIOD, key);
}

/* ===== Streefdoelen ===== */

/** Standaard streefgetal per team voor [commits, PR's]. */
const FACTORS = { today: [3, 1], '7days': [8, 2], sprint: [15, 4], all: [30, 8] };

export function defaultGoals(period, teamCount) {
  const n = Math.max(1, teamCount);
  const [c, p] = FACTORS[period] ?? FACTORS.all;
  return { commits: n * c, prs: n * p };
}

export function goalsFor(contextId, period, teamCount) {
  const base = defaultGoals(period, teamCount);
  const own = board.goals[contextId]?.[period] ?? {};
  return {
    commits: own.commits ?? base.commits,
    prs: own.prs ?? base.prs,
    custom: { commits: own.commits != null, prs: own.prs != null },
  };
}

function saveGoals() {
  write(KEYS.BOARD_GOALS, Object.keys(board.goals).length ? JSON.stringify(board.goals) : '');
}

export function setGoal(contextId, period, key, value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 9999) return;
  board.goals = { ...board.goals, [contextId]: { ...board.goals[contextId], [period]: { ...board.goals[contextId]?.[period], [key]: n } } };
  saveGoals();
}

export function resetGoals(contextId, period) {
  const { [period]: _drop, ...rest } = board.goals[contextId] ?? {};
  const { [contextId]: _ctx, ...others } = board.goals;
  board.goals = Object.keys(rest).length ? { ...others, [contextId]: rest } : others;
  saveGoals();
}

/* ===== Afgeleide cijfers (puur) ===== */

const pct = (v, max) => (max > 0 ? Math.min(100, Math.round((v / max) * 100)) : 0);
const firstName = name => String(name ?? '').trim().split(/\s+/)[0] || '?';

/** Cijfers voor één team-tegel; null als het team nog geen gegevens heeft. */
export function teamStats(team) {
  const tot = team.totals;
  if (!tot) return null;
  const closed = tot.issuesClosed ?? 0;
  const open = tot.openIssues ?? 0;

  let last = null;
  const members = [];
  for (const m of team.members) {
    const c = m.latestCommit;
    if (c && (!last || new Date(c.date) > new Date(last.date))) last = { title: c.title, date: c.date, author: firstName(m.displayName) };
    members.push({ key: m.key, firstName: firstName(m.displayName), avatar: m.avatar, active: m.totals.commits > 0 || m.totals.prsCreated > 0 });
  }
  members.sort((a, b) => a.firstName.localeCompare(b.firstName, 'nl'));

  return {
    issues: { open, closed, total: open + closed, pct: pct(closed, open + closed), closedInPeriod: tot.issuesClosedInPeriod ?? 0 },
    prs: { created: tot.prs, merged: tot.prsMerged ?? 0, pct: pct(tot.prsMerged ?? 0, tot.prs) },
    branches: tot.branches ?? 0,
    commits: tot.commits,
    lastCommit: last,
    members,
  };
}

/** Som over alle teams met gegevens, voor de klasdoelen. */
export const classStats = computed(() => {
  const k = { teams: 0, commits: 0, prs: 0, prsMerged: 0, issuesClosed: 0, issuesTotal: 0, issuesClosedInPeriod: 0 };
  for (const t of dashboard.teams) {
    const s = teamStats(t);
    if (!s) continue;
    k.teams++;
    k.commits += s.commits;
    k.prs += s.prs.created;
    k.prsMerged += s.prs.merged;
    k.issuesClosed += s.issues.closed;
    k.issuesTotal += s.issues.total;
    k.issuesClosedInPeriod += s.issues.closedInPeriod;
  }
  return k;
});

export const classGoals = computed(() => goalsFor(contexts.selectedId, dashboard.period, classStats.value.teams));

/* ===== Auto-verversen ===== */

/**
 * Eén hartslag: ververst teams waarvan de gegevens ouder zijn dan het interval. Doet niets in een verborgen tabblad,
 * tijdens een lopende sync of als de GitHub-limiet bijna op is. Collaborators worden niet opnieuw opgehaald
 * (de server doet dat maximaal elke 24 uur).
 */
export function autoRefreshTick(now = Date.now()) {
  const ms = board.refreshMinutes * 60000;
  board.paused = false;
  if (!ms || document.visibilityState !== 'visible') return;
  if (dashboard.queue.running || dashboard.loading || now - board.lastRunAt < ms) return;
  const remaining = dashboard.github?.graphql?.remaining;
  if (remaining != null && remaining < MIN_RATE_LIMIT) {
    board.paused = true;
    return;
  }
  const cutoff = now - (ms - HEARTBEAT_SLACK_MS);
  const ids = dashboard.teams.filter(t => !t.fetchedAt || new Date(t.fetchedAt).getTime() < cutoff).map(t => t.id);
  board.lastRunAt = now;
  if (ids.length) startQueue(ids, { force: true, collaborators: false });
}
