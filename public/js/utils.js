/**
 * Generieke, pure helpers: tekst, iconen, datums en kleine DOM-hulpmiddelen.
 * Bevat géén applicatiestate en géén kennis van het dashboard-model.
 */

export const DEFAULT_INACTIVITY_DAYS = 7;
export const FALLBACK_AVATAR = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';

/** Icoon uit de externe sprite (assets/icons.svg). */
export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="assets/icons.svg#i-${name}"/></svg>`;

/** HTML-escape voor elke waarde die in een template terechtkomt. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export const sameText = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export const normalizeHandle = handle => handle.trim().replace(/^@/, '');
export const parseHandleList = text => text.split(',').map(normalizeHandle).filter(Boolean);

export function showInlineFeedback(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

/* ===== Modals ===== */
export function setModal(id, open) {
  document.getElementById(id).classList.toggle('open', open);
}

export function isOpen(id) {
  return document.getElementById(id).classList.contains('open');
}

/* ===== Filters & tellers ===== */
export function getThresholdDays() {
  return parseInt(document.getElementById('inactivityThreshold').value, 10) || DEFAULT_INACTIVITY_DAYS;
}

export function updateTeamCountBadge(count) {
  document.getElementById('teamCountBadge').textContent = `${count} ${count === 1 ? 'team' : 'teams'}`;
}

/* ===== Datums ===== */
export function daysSince(dateString) {
  if (!dateString) return Infinity;
  return Math.floor((new Date() - new Date(dateString)) / (1000 * 60 * 60 * 24));
}

export function formatDate(dateString) {
  if (!dateString) return 'Geen activiteit';
  return new Date(dateString).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(dateString) {
  if (!dateString) return 'Geen datum';
  return new Date(dateString).toLocaleString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatAge(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'zojuist';
  if (minutes < 60) return `${minutes} min geleden`;
  return `${Math.floor(minutes / 60)} u geleden`;
}

/* ===== Herbruikbare template-fragmenten ===== */
export function formatHandles(handles) {
  return handles.map(h => `@${esc(h)}`).join(' + ');
}

export const externalLink = (href, cls, content, title = '') =>
  `<a href="${esc(href)}" target="_blank" rel="noopener"${cls ? ` class="${cls}"` : ''}${title ? ` title="${esc(title)}"` : ''}>${content}</a>`;

export const emptyListItem = text => `<div class="empty">${text}</div>`;
export const numberedTitle = (number, title) => `<span class="mono msg-muted">#${number}</span> ${esc(title)}`;
export const authorNote = (show, handle) => show && handle ? `<span class="mono">· @${esc(handle)}</span>` : '';
