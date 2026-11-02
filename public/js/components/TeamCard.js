import { html } from '../lib/vue.js';
import { dashboard, refreshTeam } from '../store/dashboard.js';
import { ui, openModal } from '../store/ui.js';
import { repoUrl } from '../util/links.js';
import StudentRow from './StudentRow.js';
import CacheBadge from './CacheBadge.js';
import Icon from './ui/Icon.js';
import ExtLink from './ui/ExtLink.js';

const ENDPOINT_LABELS = { commits: 'commits', pulls: "pull requests", issues: 'issues', branches: 'branches' };

function HealthBar(counts, total) {
  if (!total) return null;
  const seg = (key, cls) => counts[key] ? html`<i class=${cls} style=${{ width: `${(counts[key] / total) * 100}%` }}></i>` : null;
  return html`<div class="health" role="img" aria-label=${`${counts.green} op koers, ${counts.amber} gesprekspunt, ${counts.red} direct bijsturen`}>
    ${seg('green', 'h-ok')}${seg('amber', 'h-warn')}${seg('red', 'h-bad')}</div>`;
}

export default {
  name: 'TeamCard',
  props: { team: { type: Object, required: true } },
  setup(props) {
    return () => {
      const t = props.team;
      const busy = dashboard.loading || dashboard.refreshingIds.includes(t.id);
      const spinning = dashboard.refreshingIds.includes(t.id);
      const failed = t.cacheStatus === 'error' && !t.totals;

      const head = html`
        <div class="card-title-row">
          <h2>${t.teamName}</h2>
          <button type="button" class="edit-alias-btn" title="Team wijzigen" aria-label=${`Team wijzigen: ${t.teamName}`}
            onClick=${() => openModal('team', { teamId: t.id })}><${Icon} name="edit" /></button>
          <button type="button" class=${`edit-alias-btn card-refresh-btn ${spinning ? 'spin' : ''}`} title="Ververs alleen dit team"
            aria-label=${`Ververs alleen dit team (${t.repo})`} disabled=${busy} onClick=${() => refreshTeam(t.id)}><${Icon} name="refresh" /></button>
        </div>`;

      if (failed) {
        return html`<article class="card error">${head}<p class="err"><${Icon} name="x" /><span>${t.error || 'Team kon niet worden opgehaald'}</span></p></article>`;
      }

      const members = ui.onlyAttention ? t.members.filter(m => m.status.level !== 'green') : t.members;
      if (ui.onlyAttention && members.length === 0) return null;

      const trunc = Object.entries(t.truncated ?? {}).filter(([, v]) => v).map(([k]) => ENDPOINT_LABELS[k] ?? k);
      const notes = [];
      if (t.collaboratorsDetected === false) notes.push('Alleen committers zichtbaar; er is geen token met collaborator-rechten (studenten met 0 commits ontbreken).');
      if (trunc.length) notes.push(`Meer dan 100 ${trunc.join(', ')}: alleen de nieuwste 100 zijn geteld.`);
      (t.warnings ?? []).forEach(w => notes.push(`Kon ${ENDPOINT_LABELS[w.endpoint] ?? w.endpoint} niet ophalen (status ${w.status}).`));

      const url = repoUrl(t.repo);
      const tot = t.totals ?? {};
      return html`
        <article class=${`card ${t.statusCounts.red ? 'has-bad' : ''}`}>
          <div class="card-head">
            <div>
              ${head}
              <${ExtLink} href=${url} cls="repo-link">${t.repo} <${Icon} name="ext" /><//>
              <${CacheBadge} team=${t} />
            </div>
            <div class="chips">
              <span class="chip"><b>${tot.branches ?? 0}</b>branches</span>
              <span class="chip"><b>${tot.prs ?? 0}</b>PR's</span>
              <span class="chip" title=${`${tot.openIssues ?? 0} open issues`}><b>${tot.issues ?? 0}</b>issues</span>
            </div>
          </div>
          ${HealthBar(t.statusCounts, t.members.length)}
          ${notes.map(n => html`<div key=${n} class="collab-note msg-warn"><${Icon} name="alert" />${n}</div>`)}
          <div class="table-scroll">
            <table>
              <thead><tr>
                <th scope="col">Student</th><th scope="col" class="num">Commits</th><th scope="col" class="num">PR's</th>
                <th scope="col" class="num">Issues</th><th scope="col" class="num">Laatst actief</th>
              </tr></thead>
              <tbody>
                ${members.length
                  ? members.map(m => html`<${StudentRow} key=${m.key} member=${m} team=${t} />`)
                  : html`<tr><td colspan="5" class="empty">Geen activiteit.</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="card-foot">
            <span>Klik op een student voor de detailpagina · potloodje om accounts samen te voegen</span>
            <nav>
              <${ExtLink} href=${`${url}/issues`}>Issues <${Icon} name="ext" /><//>
              <${ExtLink} href=${`${url}/pulls`}>PR's <${Icon} name="ext" /><//>
              <${ExtLink} href=${`${url}/network`}>Branches <${Icon} name="ext" /><//>
            </nav>
          </div>
        </article>
      `;
    };
  },
};
