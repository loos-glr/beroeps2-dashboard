import { html } from '../lib/vue.js';
import { kpis } from '../store/dashboard.js';
import Icon from './ui/Icon.js';

export default {
  name: 'KpiStrip',
  setup() {
    return () => {
      const k = kpis.value;
      const tile = (cls, label, value, icon) => html`<div class=${`kpi ${cls}`}><div class="kpi-label">${icon ? html`<${Icon} name=${icon} />` : null}${label}</div><div class="kpi-value">${value}</div></div>`;
      return html`<section class="kpis" aria-label="Samenvatting">
        ${tile('', 'Studenten', k.students)}${tile('ok', 'Op koers', k.green, 'check')}${tile('warn', 'Gesprekspunt', k.amber, 'alert')}${tile('bad', 'Bijsturen', k.red, 'x')}
      </section>`;
    };
  },
};
