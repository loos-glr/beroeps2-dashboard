import { html } from '../../lib/vue.js';
import { dashboard, setPeriod, startQueue } from '../../store/dashboard.js';
import { selected } from '../../store/contexts.js';
import { board, REFRESH_OPTIONS, setBoardPeriod, setShowMembers, setRefreshMinutes } from '../../store/board.js';
import { formatTime } from '../../util/format.js';
import { PERIODS } from '../../util/status.js';
import Icon from '../ui/Icon.js';

// Vandaag en Sprint staan vooraan
const ORDER = ['today', 'sprint', '7days', 'all'];
const PERIOD_BUTTONS = ORDER.map(k => PERIODS.find(p => p.key === k));

function seg(label, items, isOn, onPick) {
  return html`<div class="segmented" role="group" aria-label=${label}>
    ${items.map(i => html`<button key=${i.key} type="button" aria-pressed=${isOn(i.key) ? 'true' : 'false'} onClick=${() => onPick(i.key)}>${i.label}</button>`)}</div>`;
}

export default {
  name: 'BoardHeader',
  props: { now: { type: Number, required: true }, fullscreen: Boolean },
  emits: ['exit', 'toggleFullscreen'],
  setup(props, { emit }) {
    const indicator = () => {
      const q = dashboard.queue;
      if (q.running) return html`<span class="b-status is-busy" role="status"><${Icon} name="refresh" />Bijwerken… (${Math.min(q.done + 1, q.total)}/${q.total})</span>`;
      const updated = `Bijgewerkt om ${formatTime(dashboard.generatedAt)}`;
      let next = '';
      if (board.paused) next = ' · auto-verversen gepauzeerd (GitHub-limiet)';
      else if (board.refreshMinutes) {
        const min = Math.max(1, Math.ceil((board.lastRunAt + board.refreshMinutes * 60000 - props.now) / 60000));
        next = ` · volgende over ${min} min`;
      }
      return html`<span class="b-status" role="status">${updated}${next}
        <button type="button" class="b-link" disabled=${!dashboard.teams.length} onClick=${() => startQueue(dashboard.teams.map(t => t.id), { force: true, collaborators: false })}>Nu verversen</button></span>`;
    };

    return () => {
      const ctx = selected.value;
      return html`
        <header class="b-header">
          <div class="b-title">
            <h1>${ctx ? `Klas ${ctx.className}` : 'Klas'}</h1>
            ${ctx ? html`<p>${ctx.courseCode} · ${ctx.schoolYear}</p>` : null}
          </div>
          <div class="b-controls">
            ${seg('Periode', PERIOD_BUTTONS, k => k === board.period, k => { setBoardPeriod(k); setPeriod(k, { remember: false }); })}
            ${seg('Studentweergave', [{ key: 'teams', label: 'Alleen teams' }, { key: 'members', label: 'Teams + leden' }],
              k => (k === 'members') === board.showMembers, k => setShowMembers(k === 'members'))}
            ${seg('Auto-verversen', REFRESH_OPTIONS.map(n => ({ key: n, label: n ? `${n} min` : 'Uit' })), k => k === board.refreshMinutes, setRefreshMinutes)}
            <button type="button" class="btn btn-sm" onClick=${() => emit('toggleFullscreen')}>
              <${Icon} name=${props.fullscreen ? 'minimize' : 'maximize'} />${props.fullscreen ? 'Venster' : 'Volledig scherm'}</button>
            <button type="button" class="btn btn-sm" onClick=${() => emit('exit')}><${Icon} name="x" />Docentweergave</button>
          </div>
          ${indicator()}
        </header>`;
    };
  },
};
