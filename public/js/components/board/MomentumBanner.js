import { html, ref } from '../../lib/vue.js';
import { dashboard } from '../../store/dashboard.js';
import { contexts } from '../../store/contexts.js';
import { classStats, classGoals, setGoal, resetGoals } from '../../store/board.js';
import { periodLabel } from '../../util/status.js';
import Icon from '../ui/Icon.js';
import ProgressBar from '../ui/ProgressBar.js';

const pct = (v, max) => (max > 0 ? Math.round((v / max) * 100) : 0);

/** Drie gezamenlijke klasdoelen voor de gekozen periode, met subtiel instelbare streefgetallen. */
export default {
  name: 'MomentumBanner',
  setup() {
    const editing = ref(false);

    const goal = ({ key, title, value, max, line, sub }) => {
      const done = max > 0 && value >= max;
      return html`
        <section key=${key} class=${`b-goal ${done ? 'is-done' : ''}`} aria-label=${title}>
          <h3>${title}${done ? html` <span class="b-done"><${Icon} name="check" />Doel behaald</span>` : null}</h3>
          <p class="b-goal-value">${line}</p>
          <${ProgressBar} value=${value} max=${max} done=${done} label=${title} />
          <p class="b-goal-sub">${sub}</p>
        </section>`;
    };

    const editor = (ctxId, period, g) => {
      const field = (key, label) => html`
        <label class="field"><span>${label}</span>
          <input type="number" min="1" max="9999" value=${g[key]} onChange=${e => setGoal(ctxId, period, key, e.target.value)} /></label>`;
      return html`
        <div class="b-goal-edit">
          ${field('commits', 'Streefdoel commits')}${field('prs', "Streefdoel PR's")}
          <button type="button" class="btn btn-sm" onClick=${() => resetGoals(ctxId, period)}>Standaard herstellen</button>
          <button type="button" class="btn btn-sm btn-primary" onClick=${() => { editing.value = false; }}>Klaar</button>
        </div>`;
    };

    return () => {
      const k = classStats.value, g = classGoals.value;
      const period = dashboard.period, ctxId = contexts.selectedId;
      return html`
        <section class="b-momentum" aria-label=${`Klasdoelen: ${periodLabel(period)}`}>
          <div class="b-momentum-head">
            <h2>Klasdoelen · ${periodLabel(period)}</h2>
            ${period === 'sprint' && dashboard.periodInfo?.fallback ? html`<span class="b-muted">Sprintstart niet ingesteld: alle activiteit getoond</span>` : null}
            <button type="button" class="b-gear" title="Streefdoelen aanpassen" aria-label="Streefdoelen aanpassen"
              aria-expanded=${editing.value ? 'true' : 'false'} onClick=${() => { editing.value = !editing.value; }}><${Icon} name="settings" /></button>
          </div>
          ${editing.value ? editor(ctxId, period, g) : null}
          <div class="b-goals">
            ${goal({ key: 'commits', title: 'Commits', value: k.commits, max: g.commits,
              line: html`<b>${k.commits}</b> / ${g.commits} commits`, sub: g.custom.commits ? 'Eigen streefdoel' : 'Samen voor de hele klas' })}
            ${goal({ key: 'prs', title: "Pull requests", value: k.prs, max: g.prs,
              line: html`<b>${k.prs}</b> / ${g.prs} PR's`, sub: `waarvan ${k.prsMerged} gemerged` })}
            ${goal({ key: 'issues', title: 'Issues afgerond', value: k.issuesClosed, max: k.issuesTotal,
              line: k.issuesTotal ? html`<b>${k.issuesClosed}</b> / ${k.issuesTotal} issues afgerond · ${pct(k.issuesClosed, k.issuesTotal)}%` : html`Nog geen issues`,
              sub: `+${k.issuesClosedInPeriod} afgerond in deze periode` })}
          </div>
        </section>`;
    };
  },
};
