import { reactive, watch } from '../lib/vue.js';
import { KEYS, read, write } from '../util/storage.js';

/** Toasts, voorkeuren en welke modal open staat. */
export const ui = reactive({
  toasts: [],
  onlyAttention: read(KEYS.ONLY_ATTENTION) === '1',
  /** { type: 'detail'|'identity'|'team'|'manage'|'token', ...props } of null */
  modal: null,
  /** Digibord-modus (klasweergave); volgt de URL-hash #digibord */
  board: typeof location !== 'undefined' && location.hash === '#digibord',
});

watch(() => ui.onlyAttention, v => write(KEYS.ONLY_ATTENTION, v ? '1' : ''));

let nextToastId = 1;

/** kind: 'info' | 'ok' | 'warn' | 'bad' */
export function toast(message, kind = 'info', ms = 5000) {
  const id = nextToastId++;
  ui.toasts.push({ id, message, kind });
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id) {
  const i = ui.toasts.findIndex(t => t.id === id);
  if (i !== -1) ui.toasts.splice(i, 1);
}

/** Op het digibord kan geen enkele modal (detail, logboek, beheer) open. */
export const openModal = (type, props = {}) => { if (!ui.board) ui.modal = { type, ...props }; };
export const closeModal = () => { ui.modal = null; };

export function enterBoard() {
  closeModal();
  ui.board = true;
  if (location.hash !== '#digibord') location.hash = 'digibord';
}

export function exitBoard() {
  ui.board = false;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (location.hash === '#digibord') history.pushState(null, '', location.pathname + location.search);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const on = location.hash === '#digibord';
    if (on) closeModal();
    ui.board = on;
  });
  window.addEventListener('popstate', () => { ui.board = location.hash === '#digibord'; });
}
