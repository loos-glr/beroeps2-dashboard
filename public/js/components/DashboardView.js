import { html } from '../lib/vue.js';
import { dashboard } from '../store/dashboard.js';
import { ui } from '../store/ui.js';
import StatusToolbar from './StatusToolbar.js';
import KpiStrip from './KpiStrip.js';
import Legend from './Legend.js';
import TeamCard from './TeamCard.js';
import EmptyState from './EmptyState.js';

export default {
  name: 'DashboardView',
  setup() {
    return () => {
      let body;
      if (!dashboard.loaded && dashboard.loading) {
        body = html`<div class="loading" role="status">Ophalen…</div>`;
      } else if (dashboard.error && !dashboard.loaded) {
        body = html`<div class="placeholder"><h2>Dashboard laden mislukt</h2><p>${dashboard.error}</p></div>`;
      } else if (dashboard.loaded && dashboard.teams.length === 0) {
        body = html`<${EmptyState} variant="no-teams" />`;
      } else {
        const cards = dashboard.teams.map(t => html`<${TeamCard} key=${t.id} team=${t} />`);
        const anyShown = !ui.onlyAttention || dashboard.teams.some(t => t.members.some(m => m.status.level !== 'green') || (t.cacheStatus === 'error' && !t.totals));
        body = anyShown ? cards : html`<${EmptyState} variant="no-attention" />`;
      }
      return html`
        <div class="wrap" aria-busy=${dashboard.loading ? 'true' : 'false'}>
          <${StatusToolbar} />
          <${KpiStrip} />
          <${Legend} />
          ${dashboard.error && dashboard.loaded ? html`<p class="msg-bad" role="alert">${dashboard.error}</p>` : null}
          <main class="teams">${body}</main>
        </div>`;
    };
  },
};
