/** Server-niveaus (green/amber/red) → CSS-klasse en icoon. Icoon + tekst, zodat status niet alleen op kleur steunt. */
export const LEVELS = {
  green: { cls: 'ok', icon: 'check', short: 'Op koers' },
  amber: { cls: 'warn', icon: 'alert', short: 'Gesprekspunt' },
  red: { cls: 'bad', icon: 'x', short: 'Bijsturen' },
};

export const levelOf = level => LEVELS[level] ?? LEVELS.red;

/** cacheStatus van een team → badge-weergave. */
export const CACHE_BADGES = {
  fresh: { cls: 'muted', icon: 'shield', label: 'Uit cache' },
  refreshed: { cls: 'ok', icon: 'pulse', label: 'Live opgehaald' },
  'stale-error': { cls: 'warn', icon: 'alert', label: 'Verouderd · verversen mislukt' },
  error: { cls: 'bad', icon: 'x', label: 'Fout' },
};
