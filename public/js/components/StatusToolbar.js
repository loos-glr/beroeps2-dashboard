import { html } from '../lib/vue.js';
import { dashboard, saveSettings } from '../store/dashboard.js';
import { selected } from '../store/contexts.js';
import { ui } from '../store/ui.js';
import { formatTime } from '../util/format.js';
import Icon from './ui/Icon.js';

const TTL_OPTIONS = [0, 5, 10, 30, 60];
const AUTH_LABEL = { env: 'server-token', header: 'lokaal token', anonymous: 'anoniem' };

export default {
  name: 'StatusToolbar',
  setup() {
    return () => {
      const ctx = selected.value;
      const gh = dashboard.github;
      const rl = gh?.rateLimit;
      const req = dashboard.requests;
      const total = dashboard.teams.length;
      const rlCls = rl ? (rl.remaining === 0 ? 'msg-bad' : rl.remaining < rl.limit * 0.1 ? 'msg-warn' : '') : '';
      const cacheTitle = req
        ? `${req.fromSnapshot} van ${total} teams uit opgeslagen data. ${req.made} requests gedaan (${req.notModified}× 304 Not Modified, telt niet mee voor de rate limit).`
        : '';
      return html`
        <div class="toolbar">
          <div class="meta">
            <span class=${rlCls}><${Icon} name="pulse" />${rl
              ? html`API (${AUTH_LABEL[gh.authMode] ?? gh.authMode}): <span class="mono">${rl.remaining}/${rl.limit}</span> · reset ${formatTime(rl.resetAt)}`
              : 'API: –'}</span>
            <span title=${cacheTitle}><${Icon} name="shield" />${req
              ? html`Cache: <span class="mono">${req.fromSnapshot}/${total}</span> teams · <span class="mono">${req.made}</span> requests (${req.notModified}× 304)`
              : 'Cache: –'}</span>
            <span>Update: ${formatTime(dashboard.generatedAt)}</span>
            <span>${total} ${total === 1 ? 'team' : 'teams'}</span>
          </div>
          <label class="switch">
            <input type="checkbox" checked=${ui.onlyAttention} onChange=${e => { ui.onlyAttention = e.target.checked; }} />
            <span class="track" aria-hidden="true"></span><span>Alleen aandacht</span>
          </label>
          ${ctx ? html`
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
