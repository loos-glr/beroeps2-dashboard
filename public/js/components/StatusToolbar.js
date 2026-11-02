import { html } from '../lib/vue.js';
import { dashboard, saveSettings, setPeriod } from '../store/dashboard.js';
import { selected } from '../store/contexts.js';
import { ui } from '../store/ui.js';
import { formatTime } from '../util/format.js';
import { PERIODS } from '../util/status.js';
import Icon from './ui/Icon.js';

const TTL_OPTIONS = [0, 5, 10, 30, 60];
const AUTH_LABEL = { env: 'server-token', header: 'lokaal token', anonymous: 'anoniem' };

export default {
  name: 'StatusToolbar',
  setup() {
    return () => {
      const ctx = selected.value;
      const gh = dashboard.github;
      const gql = gh?.graphql;
      const sync = dashboard.sync;
      const total = dashboard.teams.length;
      const gqlCls = gql ? (gql.remaining === 0 ? 'msg-bad' : gql.remaining < gql.limit * 0.1 ? 'msg-warn' : '') : '';
      const syncTitle = sync
        ? `${sync.synced} van ${total} teams zijn nu gesynchroniseerd, ${sync.fromDb} komen uit de database${sync.failed ? `, ${sync.failed} mislukt` : ''}. Van periode wisselen betaalt GitHub niets.`
        : '';
      return html`
        <div class="toolbar">
          <div class="meta">
            <span class=${gqlCls}><${Icon} name="pulse" />${gql
              ? html`GraphQL (${AUTH_LABEL[gh.authMode] ?? gh.authMode}): <span class="mono">${gql.remaining}/${gql.limit}</span> · reset ${formatTime(gql.resetAt)}`
              : 'GraphQL: –'}</span>
            <span title=${syncTitle}><${Icon} name="shield" />${sync
              ? html`Sync: <span class="mono">${sync.synced}/${total}</span> teams · <span class="mono">${sync.cost}</span> ${sync.cost === 1 ? 'punt' : 'punten'}${sync.failed ? html` · <span class="msg-bad">${sync.failed} mislukt</span>` : null}`
              : 'Sync: –'}</span>
            <span>Update: ${formatTime(dashboard.generatedAt)}</span>
            <span>${total} ${total === 1 ? 'team' : 'teams'}</span>
          </div>
          <label class="switch">
            <input type="checkbox" checked=${ui.onlyAttention} onChange=${e => { ui.onlyAttention = e.target.checked; }} />
            <span class="track" aria-hidden="true"></span><span>Alleen aandacht</span>
          </label>
          <div class="field">
            <label for="period">Periode</label>
            <select id="period" value=${dashboard.period} onChange=${e => setPeriod(e.target.value)}>
              ${PERIODS.map(p => html`<option key=${p.key} value=${p.key} selected=${p.key === dashboard.period}>${p.label}</option>`)}
            </select>
          </div>
          ${ctx ? html`
            <div class="field">
              <label for="sprintStart">Sprint start</label>
              <input id="sprintStart" type="date" value=${ctx.sprintStartDate ?? ''}
                onChange=${e => saveSettings({ sprintStartDate: e.target.value || null }, { reload: dashboard.period === 'sprint' })} />
              ${dashboard.period === 'sprint' && dashboard.periodInfo?.fallback ? html`<span class="msg-warn">niet ingesteld: alles getoond</span>` : null}
            </div>
            <div class="field">
              <label for="cacheTtl">Cache</label>
              <select id="cacheTtl" value=${ctx.cacheTtlMinutes} onChange=${e => saveSettings({ cacheTtlMinutes: Number(e.target.value) })}>
                ${TTL_OPTIONS.map(v => html`<option key=${v} value=${v} selected=${v === ctx.cacheTtlMinutes}>${v === 0 ? '0 (Altijd live)' : `${v} min`}</option>`)}
              </select>
            </div>
            <div class="field">
              <label for="inactivity">Inactief na</label>
              <input id="inactivity" type="number" min="1" max="365" value=${ctx.inactivityThresholdDays}
                onInput=${e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 365) saveSettings({ inactivityThresholdDays: n }, { reload: true }); }} />
              <span>dagen</span>
            </div>` : null}
        </div>`;
    };
  },
};
