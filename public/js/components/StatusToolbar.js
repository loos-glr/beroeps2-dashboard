import { html } from '../lib/vue.js';
import { dashboard, saveSettings, setPeriod, refreshAll } from '../store/dashboard.js';
import { coaching, queue } from '../store/coaching.js';
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
      const q = dashboard.queue;
      const gqlCls = gql ? (gql.remaining === 0 ? 'msg-bad' : gql.remaining < gql.limit * 0.1 ? 'msg-warn' : '') : '';
      const syncTitle = sync
        ? `${sync.synced} van ${total} teams zijn nu gesynchroniseerd, ${sync.fromDb} komen uit de database${sync.failed ? `, ${sync.failed} mislukt` : ''}. Van periode wisselen betaalt GitHub niets.`
        : '';
      return html`
        <div class="toolbar">
          <div class="meta">
            ${q.running ? html`<span class="sync-progress" role="status"><${Icon} name="refresh" />Achtergrond-sync: team ${Math.min(q.done + 1, q.total)} van ${q.total} bijwerken${q.currentName ? ` (${q.currentName})` : ''}…</span>` : null}
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
          <div class="segmented" role="group" aria-label="Periode">
            ${PERIODS.map(p => html`<button key=${p.key} type="button" aria-pressed=${p.key === dashboard.period ? 'true' : 'false'}
              onClick=${() => setPeriod(p.key)}>${p.label}</button>`)}
          </div>
          <button type="button" class=${`btn btn-sm ${q.running ? 'spin' : ''}`} disabled=${q.running || dashboard.loading || !total}
            title="Haalt alle teams een voor een opnieuw op bij GitHub (ETag-revalidatie; 304-antwoorden tellen niet mee voor de rate limit)"
            onClick=${refreshAll}><${Icon} name="refresh" />Ververs alles</button>
          <button type="button" class=${`btn btn-sm ${coaching.panelOpen ? 'btn-primary' : ''}`} aria-expanded=${coaching.panelOpen ? 'true' : 'false'}
            aria-controls="visitQueue" disabled=${!total} onClick=${() => { coaching.panelOpen = !coaching.panelOpen; }}>
            <${Icon} name="users" />Lesronde / Wachtrij (${queue.value.openCount})</button>
          ${ctx ? html`
            <div class=${`field ${dashboard.period === 'sprint' ? 'highlight' : ''}`}>
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
