import { html } from '../lib/vue.js';
import Icon from './ui/Icon.js';

export default {
  name: 'Legend',
  setup() {
    const item = (cls, icon, title, text) => html`<div><span class=${cls}><${Icon} name=${icon} /></span><span><strong>${title}</strong> — ${text}</span></div>`;
    return () => html`<section class="legend" aria-label="Uitleg indicatoren">
      ${item('ico-ok', 'check', 'Op koers', "actief, gebruikt PR's")}
      ${item('ico-warn', 'alert', 'Gesprekspunt', "commits, geen PR's")}
      ${item('ico-bad', 'x', 'Bijsturen', 'inactief of 0 bijdragen')}
      ${item('', 'link', 'Ontdubbelen', 'klik op het potloodje bij een student om 2 accounts samen te voegen')}
    </section>`;
  },
};
