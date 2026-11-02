/** Datum- en tijdhelpers (nl-NL). */

export function daysSince(dateString) {
  if (!dateString) return Infinity;
  return Math.floor((Date.now() - new Date(dateString).getTime()) / 86400000);
}

export function formatDate(dateString) {
  if (!dateString) return 'Geen activiteit';
  return new Date(dateString).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(dateString) {
  if (!dateString) return 'Geen datum';
  return new Date(dateString).toLocaleString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(dateString) {
  if (!dateString) return '–';
  return new Date(dateString).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

export function formatAge(dateString) {
  if (!dateString) return '';
  const minutes = Math.floor((Date.now() - new Date(dateString).getTime()) / 60000);
  if (minutes < 1) return 'zojuist';
  if (minutes < 60) return `${minutes} min geleden`;
  return `${Math.floor(minutes / 60)} u geleden`;
}

/** Huidig schooljaar: vanaf augustus start het nieuwe jaar. */
export function currentSchoolYear(now = new Date()) {
  const y = now.getFullYear();
  const start = now.getMonth() >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}
