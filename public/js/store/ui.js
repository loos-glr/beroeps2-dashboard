import { reactive, watch } from '../lib/vue.js';
import { KEYS, read, write } from '../util/storage.js';

/** Toasts, voorkeuren en welke modal open staat. */
export const ui = reactive({
  toasts: [],
  onlyAttention: read(KEYS.ONLY_ATTENTION) === '1',
  /** { type: 'detail'|'identity'|'team'|'manage'|'token', ...props } of null */
  modal: null,
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

export const openModal = (type, props = {}) => { ui.modal = { type, ...props }; };
export const closeModal = () => { ui.modal = null; };
