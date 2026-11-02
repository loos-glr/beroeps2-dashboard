import { html } from '../lib/vue.js';
import { levelOf } from '../util/status.js';
import { formatDate } from '../util/format.js';
import { issuesByAuthorUrl } from '../util/links.js';
import { openModal } from '../store/ui.js';
import Icon from './ui/Icon.js';
import Pill from './ui/Pill.js';
import ExtLink from './ui/ExtLink.js';

const FALLBACK_AVATAR = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';

/** Badge achter de naam: rood bij verlopen afspraak, oranje bij open afspraak, grijs bij alleen logboeknotities. */
function coachingBadge(c) {
  if (!c) return null;
  if (c.dueFollowUps > 0) return html`<${Pill} cls="bad" icon="alert" title=${`${c.dueFollowUps} afspraak(en) om vandaag of eerder op te volgen`}>Opvolgen<//>`;
  if (c.openFollowUps > 0) return html`<${Pill} cls="warn" icon="note" title=${`${c.openFollowUps} openstaande afspraak(en)`}>Afspraak<//>`;
  if (c.logCount > 0) return html`<span class="note-flag" title=${`${c.logCount} logboekregel(s)`}><${Icon} name="note" /></span>`;
  return null;
}

export default {
  name: 'StudentRow',
  props: { member: { type: Object, required: true }, team: { type: Object, required: true } },
  setup(props) {
    return () => {
      const m = props.member, t = props.team, tot = m.totals;
      const lv = levelOf(m.status.level);
      const open = () => openModal('detail', { teamId: t.id, handle: m.username });
      const editLabel = m.student ? `Naam of gekoppelde accounts wijzigen (${m.displayName})` : `Studentnaam koppelen of accounts samenvoegen voor @${m.username}`;
      const showHandles = m.student || m.isMerged;
      return html`
        <tr>
          <td>
            <div class="student">
              <img src=${m.avatar || FALLBACK_AVATAR} alt="" loading="lazy" width="28" height="28" />
              <div class="student-info">
                <div class="student-name-row">
                  <button type="button" class="primary-name-btn" title=${`Open detailoverzicht voor ${m.displayName}`} onClick=${open}>${m.displayName}</button>
                  ${showHandles ? html`<span class="gh-handle">${m.handles.map(h => `@${h}`).join(' + ')}</span>` : null}
                  ${m.isMerged ? html`<span class="merged-badge" title=${`Samengevoegd uit ${m.handles.length} accounts`}><${Icon} name="link" />${m.handles.length}</span>` : null}
                  ${coachingBadge(m.coaching)}
                  ${m.student?.notes ? html`<span class="note-flag" title="Heeft docentnotities"><${Icon} name="note" /></span>` : null}
                  <button type="button" class="edit-alias-btn" title=${editLabel} aria-label=${editLabel}
                    onClick=${() => openModal('identity', { teamId: t.id, handle: m.username })}><${Icon} name="edit" /></button>
                </div>
                <${Pill} cls=${lv.cls} icon=${lv.icon}>${m.status.label}<//>
                ${m.isExpectedOnly ? html` <${Pill} cls="muted">verwacht lid, nog geen activiteit<//>` : null}
              </div>
            </div>
          </td>
          <td class="num">
            <button type="button" class="metric-link" title="Bekijk laatste commit & historie" onClick=${open}>
              <span class=${`v ${tot.commits === 0 ? 'zero bad' : ''}`}>${tot.commits}</span>
            </button>
          </td>
          <td class="num">
            <button type="button" class="metric-link" title="Bekijk Pull Requests" onClick=${open}>
              <span class=${`v ${tot.prsCreated === 0 ? 'zero warn' : ''}`}>${tot.prsCreated}</span>
            </button>
            <small>${tot.prsMerged} merged</small>
          </td>
          <td class="num">
            <div class="issue-pair">
              <${ExtLink} href=${issuesByAuthorUrl(t.repo, m.username)} cls="issue-badge" title=${`Issues aangemaakt door ${m.displayName}`}><span class="lbl-mini">gemaakt</span> ${tot.issuesCreated}<//>
              <button type="button" class="issue-badge" title=${`Uitsplitsing: ${tot.issuesAssignedOpen} open, ${tot.issuesAssignedClosed} closed`} onClick=${open}>
                <span class="lbl-mini">assigned</span> ${tot.issuesAssigned}
              </button>
            </div>
          </td>
          <td class="when">${formatDate(m.lastActive)}</td>
        </tr>
      `;
    };
  },
};
