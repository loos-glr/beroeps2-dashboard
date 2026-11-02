import { reactive } from '../lib/vue.js';

/** Toasts en (later) de modal-stack. */
export const ui = reactive({
  toasts: [],
});

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
