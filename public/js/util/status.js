/** Server-niveaus (green/amber/red) → CSS-klasse en icoon. Icoon + tekst, zodat status niet alleen op kleur steunt. */
export const LEVELS = {
  green: { cls: 'ok', icon: 'check', short: 'Op koers' },
  amber: { cls: 'warn', icon: 'alert', short: 'Gesprekspunt' },
  red: { cls: 'bad', icon: 'x', short: 'Bijsturen' },
};

export const levelOf = level => LEVELS[level] ?? LEVELS.red;

/** Periode-filter van het dashboard (zelfde sleutels als ?period= van de API). */
export const PERIODS = [
  { key: 'all', label: 'Alles', short: 'Alles' },
  { key: 'sprint', label: 'Huidige sprint', short: 'Sprint' },
  { key: '7days', label: '7 dagen', short: '7 dagen' },
  { key: 'today', label: 'Vandaag / deze les', short: 'Vandaag' },
];

/** Korte naam voor koppen, bv. "Commits (Vandaag)". */
export const periodLabel = key => PERIODS.find(p => p.key === key)?.short ?? 'Alles';

/** cacheStatus van een team → badge-weergave. */
export const CACHE_BADGES = {
  fresh: { cls: 'muted', icon: 'shield', label: 'Uit cache' },
  refreshed: { cls: 'ok', icon: 'pulse', label: 'Live opgehaald' },
  'stale-error': { cls: 'warn', icon: 'alert', label: 'Verouderd · verversen mislukt' },
  error: { cls: 'bad', icon: 'x', label: 'Fout' },
};
