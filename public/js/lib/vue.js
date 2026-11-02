// Enige importpunt voor Vue en htm. Geen importmap nodig (die zou een CSP-hash eisen).
import { h } from '../vendor/vue.runtime.esm-browser.prod.js';
import htm from '../vendor/htm.module.js';

export * from '../vendor/vue.runtime.esm-browser.prod.js';

/** JSX-achtige tagged template: html`<div class=${cls}>${text}</div>` → h()-calls, zonder eval. */
export const html = htm.bind(h);
