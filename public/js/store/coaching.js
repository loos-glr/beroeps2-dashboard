import { reactive, computed, watch } from '../lib/vue.js';
import { api } from '../api.js';
import { contexts } from './contexts.js';
import { dashboard } from './dashboard.js';
import { toast } from './ui.js';

const EMPTY = Object.freeze({ visitedToday: false, openFollowUps: 0, dueFollowUps: 0, logCount: 0 });

/** Logboek van de gekozen klas (GET /contexts/{id}/coaching-logs) en de staat van het lesronde-paneel. */
export const coaching = reactive({ logs: [], loaded: false, panelOpen: false });

/** Vandaag als YYYY-MM-DD in de tijdzone van de school (zelfde dagwisseling als de server). */
export const todayLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });

export function reset() {
  Object.assign(coaching, { logs: [], loaded: false, panelOpen: false });
}

export async function loadLogs() {
  const id = contexts.selectedId;
  if (!id) return reset();
  try {
    const { logs } = await api.coaching.list(id);
    if (id !== contexts.selectedId) return;
    Object.assign(coaching, { logs, loaded: true });
  } catch (err) {
    toast(`Logboek laden mislukt: ${err.message}`, 'bad');
  }
}

watch(() => contexts.selectedId, id => { coaching.logs = []; coaching.loaded = false; if (id) loadLogs(); });

/**
 * Zet de server-samenvattingen op teams en leden. Is er net een student aangemaakt of gekoppeld (alleen een
 * githubIdentifier opgegeven), dan krijgt het lid eerst dat studentrecord, zodat badge en wachtrij meteen kloppen.
 */
export function applySummaries(summaries, { student = null, githubIdentifier = null } = {}) {
  const handle = githubIdentifier ? String(githubIdentifier).toLowerCase() : null;
  for (const team of dashboard.teams) {
    team.coaching = summaries.teams[team.id] ?? EMPTY;
    for (const m of team.members) {
      if (student && !m.student && handle && m.handles.some(h => h.toLowerCase() === handle)) {
        m.student = { id: student.id, fullName: student.fullName, studentNumber: student.studentNumber, notes: student.notes };
      }
      m.coaching = m.student ? summaries.students[m.student.id] ?? EMPTY : EMPTY;
    }
  }
}

export async function createLog(payload) {
  const res = await api.coaching.create(contexts.selectedId, payload);
  coaching.logs.unshift(res.log);
  for (const l of coaching.logs) if (res.resolvedIds.includes(l.id)) l.isResolved = true;
  applySummaries(res.summaries, { student: res.student, githubIdentifier: payload.githubIdentifier });
  return res;
}

export async function updateLog(id, body) {
  const res = await api.coaching.update(id, body);
  const i = coaching.logs.findIndex(l => l.id === id);
  if (i !== -1) coaching.logs[i] = res.log;
  applySummaries(res.summaries);
  return res;
}

export async function deleteLog(id) {
  const res = await api.coaching.remove(id);
  coaching.logs = coaching.logs.filter(l => l.id !== id);
  applySummaries(res.summaries);
}

/** Verwijzing naar een lid voor een logregel: studentId als die er is, anders de GitHub-handle (maakt de student aan). */
export const memberRef = (team, m) => ({
  teamId: team.id,
  ...(m.student ? { studentId: m.student.id } : { githubIdentifier: m.username, fullName: m.displayName }),
});

/**
 * Geprioriteerde bezoek-wachtrij. Elke student/elk team staat in maximaal één lijst (hoogste categorie):
 * due (open afspraak, datum <= vandaag) > red > amber > unvisited (team nog niet bezocht). Wie vandaag al
 * besproken is en geen verlopen afspraak meer heeft, staat in done.
 */
export const queue = computed(() => {
  const today = todayLocal();
  const out = { due: [], red: [], amber: [], unvisited: [], done: [] };
  const teamDue = new Set(coaching.logs
    .filter(l => l.studentId === null && l.teamId !== null && !l.isResolved && l.followUpDate && l.followUpDate <= today)
    .map(l => l.teamId));

  for (const team of dashboard.teams) {
    for (const m of team.members) {
      const c = m.coaching ?? EMPTY;
      const item = { kind: 'student', id: `s:${team.id}:${m.key}`, team, member: m, name: m.displayName, ref: memberRef(team, m) };
      if (c.dueFollowUps > 0) out.due.push(item);
      else if (c.visitedToday) out.done.push(item);
      else if (m.status.level === 'red') out.red.push(item);
      else if (m.status.level === 'amber') out.amber.push(item);
    }
    const item = { kind: 'team', id: `t:${team.id}`, team, member: null, name: team.teamName, ref: { teamId: team.id } };
    if (teamDue.has(team.id)) out.due.push(item);
    else if (team.coaching?.visitedToday) out.done.push(item);
    else out.unvisited.push(item);
  }
  out.openCount = out.due.length + out.red.length + out.amber.length + out.unvisited.length;
  return out;
});
