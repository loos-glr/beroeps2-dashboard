import { reactive, computed } from '../lib/vue.js';
import { api } from '../api.js';
import { KEYS, read, write } from '../util/storage.js';

/** Klassen (academic_contexts) en de gekozen klas. */
export const contexts = reactive({
  list: [],
  loaded: false,
  selectedId: null,
});

export const selected = computed(() => contexts.list.find(c => c.id === contexts.selectedId) ?? null);
export const years = computed(() => [...new Set(contexts.list.map(c => c.schoolYear))]);

export const coursesOf = year => [...new Set(contexts.list.filter(c => c.schoolYear === year).map(c => c.courseCode))];
export const classesOf = (year, course) => contexts.list.filter(c => c.schoolYear === year && c.courseCode === course);

export function select(id) {
  contexts.selectedId = id;
  write(KEYS.CONTEXT_ID, id ?? '');
}

/** Wisselt van jaar/vak: kies de eerste klas binnen die combinatie. */
export function selectYear(year) {
  const course = coursesOf(year)[0];
  select(classesOf(year, course)[0]?.id ?? null);
}

export function selectCourse(year, course) {
  select(classesOf(year, course)[0]?.id ?? null);
}

export async function load() {
  const { contexts: list } = await api.contexts.list();
  contexts.list = list;
  contexts.loaded = true;
  const remembered = Number(read(KEYS.CONTEXT_ID));
  const keep = list.find(c => c.id === contexts.selectedId) ?? list.find(c => c.id === remembered) ?? list[0];
  select(keep?.id ?? null);
}

export async function create(body) {
  const { context } = await api.contexts.create(body);
  contexts.list = [...contexts.list, context].sort((a, b) =>
    b.schoolYear.localeCompare(a.schoolYear) || a.courseCode.localeCompare(b.courseCode) || a.className.localeCompare(b.className));
  select(context.id);
  return context;
}

export async function update(id, body) {
  const { context } = await api.contexts.update(id, body);
  const i = contexts.list.findIndex(c => c.id === id);
  if (i !== -1) contexts.list[i] = { ...contexts.list[i], ...context, teamCount: contexts.list[i].teamCount };
  return context;
}

/** Past het aantal teams van de gekozen klas lokaal aan (voor de hint in de selector). */
export function setTeamCount(id, count) {
  const c = contexts.list.find(x => x.id === id);
  if (c) c.teamCount = count;
}

export function reset() {
  contexts.list = [];
  contexts.loaded = false;
  contexts.selectedId = null;
}
