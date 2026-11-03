import { html } from '../../lib/vue.js';
import { board, teamStats } from '../../store/board.js';
import { formatRelative } from '../../util/format.js';
import Icon from '../ui/Icon.js';
import ProgressBar from '../ui/ProgressBar.js';

const FALLBACK_AVATAR = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';

/** Activiteit-chip: positief of neutraal, nooit alarmerend. */
function activity(last, now) {
  if (!last) return { cls: '', text: 'Nog geen commits' };
  const minutes = Math.floor((now - new Date(last.date).getTime()) / 60000);
  if (minutes < 60) return { cls: 'is-live', text: `Laatste commit: ${formatRelative(last.date, now)}` };
  const a = new Date(last.date), b = new Date(now);
  if (a.toDateString() === b.toDateString()) return { cls: 'is-live', text: 'Vandaag actief' };
  return { cls: '', text: `Laatste commit: ${formatRelative(last.date, now)}` };
}

/** Teamtegel voor het digibord: alleen teamcijfers, geen status, notities of handles. */
export default {
  name: 'BoardTeamTile',
  props: { team: { type: Object, required: true }, now: { type: Number, required: true } },
  setup(props) {
    return () => {
      const t = props.team;
      const s = teamStats(t);
      const head = chip => html`<div class="b-tile-head"><div><h2>${t.teamName}</h2><p class="b-repo">${t.repo}</p></div>${chip}</div>`;
      if (!s) {
        return html`<article class="b-tile">${head(null)}<p class="b-muted">Gegevens volgen bij de volgende sync.</p></article>`;
      }
      const act = activity(s.lastCommit, props.now);
      const { issues, prs } = s;
      return html`
        <article class="b-tile">
          ${head(html`<span class=${`b-chip ${act.cls}`}><${Icon} name="pulse" />${act.text}</span>`)}

          <section class="b-block" aria-label="Issue-voortgang">
            ${issues.total
              ? html`<p class="b-line"><b>${issues.closed} / ${issues.total}</b> issues afgerond <span class="b-pct">(${issues.pct}%)</span></p>`
              : html`<p class="b-line b-muted">Nog geen issues aangemaakt</p>`}
            <${ProgressBar} value=${issues.closed} max=${issues.total} done=${issues.total > 0 && issues.closed === issues.total} label="Afgeronde issues" />
            <p class="b-counts"><span><b>${issues.open}</b> open</span><span><b>${issues.closed}</b> afgerond</span></p>
          </section>

          <section class="b-block" aria-label="GitHub Flow">
            ${prs.created
              ? html`<p class="b-line"><b>${prs.merged}</b> gemerged van <b>${prs.created}</b> PR's</p>`
              : html`<p class="b-line b-muted">Nog geen PR's in deze periode</p>`}
            <${ProgressBar} value=${prs.merged} max=${prs.created} done=${prs.created > 0 && prs.merged === prs.created} label="Gemergde pull requests" />
            <p class="b-counts"><span><b>${s.branches}</b> branches</span><span><b>${s.commits}</b> commits</span></p>
          </section>

          ${s.lastCommit ? html`
            <p class="b-last"><${Icon} name="commit" /><span class="b-last-title">${s.lastCommit.title}</span>
              <span class="b-last-meta">${board.showMembers ? ` · ${s.lastCommit.author}` : ''} · ${formatRelative(s.lastCommit.date, props.now)}</span></p>` : null}

          ${board.showMembers && s.members.length ? html`
            <ul class="b-members" aria-label="Teamleden">
              ${s.members.map(m => html`<li key=${m.key} class=${`b-member ${m.active ? 'is-active' : ''}`}>
                <span class="b-avatar" title=${m.active ? 'Actief in flow' : null}>
                  <img src=${m.avatar || FALLBACK_AVATAR} alt="" width="40" height="40" loading="lazy" />
                  ${m.active ? html`<span class="b-flow" role="img" aria-label="actief in deze periode"><${Icon} name="check" /></span>` : null}
                </span>
                <span class="b-member-name">${m.firstName}</span></li>`)}
            </ul>` : null}
        </article>`;
    };
  },
};
