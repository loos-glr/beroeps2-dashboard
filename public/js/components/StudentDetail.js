import { html, ref, computed, watch } from '../lib/vue.js';
import { dashboard, findMember } from '../store/dashboard.js';
import { levelOf } from '../util/status.js';
import { formatDate, formatDateTime, daysSince } from '../util/format.js';
import { repoUrl, profileUrl, issuesByAuthorUrl, issuesByAssigneeUrl, commitsByAuthorUrl, prsByAuthorUrl, labelUrl } from '../util/links.js';
import Modal from './ui/Modal.js';
import ConfirmDialog from './ui/ConfirmDialog.js';
import Icon from './ui/Icon.js';
import Pill from './ui/Pill.js';
import ExtLink from './ui/ExtLink.js';
import NotesEditor from './NotesEditor.js';
import IdentityModal from './IdentityModal.js';

const FALLBACK_AVATAR = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
const PR_PILL = { merged: ['purple', 'Merged'], open: ['ok', 'Open'], closed: ['muted', 'Closed'] };

const Panel = (head, items, empty) => html`
  <div class="detail-panel">
    <div class="detail-panel-head">${head}</div>
    <div class="detail-list">${items.length ? items : html`<div class="empty">${empty}</div>`}</div>
  </div>`;

const Item = (key, url, title, sub, aside) => html`
  <div key=${key} class="detail-item">
    <div class="detail-item-main">
      <${ExtLink} href=${url} cls="detail-item-title">${title}<//>
      <div class="detail-item-sub">${sub}</div>
    </div>
    ${aside}
  </div>`;

export default {
  name: 'StudentDetail',
  props: { teamId: Number, handle: String },
  emits: ['close'],
  setup(props, { emit }) {
    const found = computed(() => findMember(props.teamId, props.handle));
    const dirty = ref(false);
    const confirmClose = ref(false);
    const identityOpen = ref(false);
    watch(found, f => { if (!f.member && dashboard.loaded) emit('close'); });

    const tryClose = () => (dirty.value ? (confirmClose.value = true) : emit('close'));

    return () => {
      const { team, member: m } = found.value;
      if (!m) return null;
      const lv = levelOf(m.status.level), tot = m.totals, url = repoUrl(team.repo);
      const open = m.assignedIssues.open, closed = m.assignedIssues.closed, assigned = open.length + closed.length;
      const pct = n => `${(n / assigned) * 100}%`;
      const lc = m.latestCommit;
      const issue = i => Item(`i${i.number}`, i.url, html`<span class="mono msg-muted">#${i.number}</span> ${i.title}`,
        html`<span>Aangemaakt: ${formatDate(i.createdAt)}</span>${i.closedAt ? html`<span>· Gesloten: ${formatDate(i.closedAt)}</span>` : null}
          ${i.labels.map(l => html`<${ExtLink} key=${l} href=${labelUrl(team.repo, l)} cls="gh-label">${l}<//>`)}`,
        html`<${Pill} cls=${i.state === 'open' ? 'warn' : 'ok'}>${i.state === 'open' ? 'Open' : 'Closed'}<//>`);
      const author = h => (m.isMerged && h ? html`<span class="mono">· @${h}</span>` : null);

      return html`
        <${Modal} size="wide" titleId="detailTitle" onClose=${tryClose} title=${m.displayName}
          subtitle=${`Team: ${team.teamName} · ${team.repo}`}>
          <div class="modal-body">
            <div class="detail-header-profile">
              <img src=${m.avatar || FALLBACK_AVATAR} alt="" width="48" height="48" />
              <div class="detail-title-row">
                <span class="gh-handle">${m.handles.map(h => `@${h}`).join(' + ')}</span>
                ${m.isMerged ? html`<span class="merged-badge"><${Icon} name="link" />${m.handles.length} accounts samengevoegd</span>` : null}
                <${Pill} cls=${lv.cls} icon=${lv.icon}>${m.status.label}<//>
                <button type="button" class="btn btn-ghost btn-sm" onClick=${() => { identityOpen.value = true; }}><${Icon} name="edit" />Naam / Accounts</button>
              </div>
            </div>

            <${NotesEditor} member=${m} onDirty=${v => { dirty.value = v; }} />

            <div class="detail-kpis">
              <div class="detail-kpi"><span class="lbl">Commits (laatste 100)</span><span class="val">${tot.commits}</span><span class="sub">Laatst actief: ${formatDate(m.lastActive)}</span></div>
              <div class="detail-kpi"><span class="lbl">Pull Requests</span><span class="val">${tot.prsCreated}</span><span class="sub">${tot.prsMerged} merged · ${tot.prsOpen} open</span></div>
              <div class="detail-kpi"><span class="lbl">Assigned Issues</span><span class="val">${tot.issuesAssigned}</span><span class="sub">${tot.issuesAssignedOpen} open · ${tot.issuesAssignedClosed} afgerond</span></div>
              <div class="detail-kpi"><span class="lbl">Aangemaakte Issues</span><span class="val">${tot.issuesCreated}</span><span class="sub">Door deze student gerapporteerd</span></div>
            </div>

            ${lc ? html`
              <div class="latest-commit-box">
                <div class="latest-commit-meta">
                  <span><${Icon} name="commit" /><strong>Laatste commit</strong> (@${lc.authorHandle}) · ${formatDateTime(lc.date)} (${daysSince(lc.date)}d geleden)</span>
                  <${ExtLink} href=${lc.url} cls="sha-badge" title="Open commit op GitHub">${lc.shortSha} <${Icon} name="ext" /><//>
                </div>
                <div class="commit-msg-title">${lc.title}</div>
                ${lc.body ? html`<div class="commit-msg-body">${lc.body}</div>` : null}
              </div>` : html`
              <div class="latest-commit-box empty-box">
                <div class="commit-msg-title msg-bad">Geen commits gevonden voor deze student</div>
                <p class="help">Niet in de laatste 100 commits van deze repository.</p>
              </div>`}

            <div>
              <div class="section-title"><span>Assigned Issues per status (${assigned} totaal)</span>
                <${ExtLink} href=${issuesByAssigneeUrl(team.repo, m.username)} cls="repo-link">Bekijk op GitHub <${Icon} name="ext" /><//></div>
              ${assigned ? html`<div class="status-progress" title=${`${open.length} Open, ${closed.length} Closed`}>
                ${open.length ? html`<div class="bar-open" style=${{ width: pct(open.length) }}></div>` : null}
                ${closed.length ? html`<div class="bar-closed" style=${{ width: pct(closed.length) }}></div>` : null}</div>` : null}
              <div class="split-grid">
                ${Panel(html`<span>Openstaand / In uitvoering</span><${Pill} cls="warn">${open.length} Open<//>`, open.map(issue), 'Geen openstaande issues toegewezen.')}
                ${Panel(html`<span>Afgerond</span><${Pill} cls="ok">${closed.length} Closed<//>`, closed.map(issue), 'Nog geen afgeronde issues.')}
              </div>
            </div>

            <div class="split-grid">
              ${Panel(html`<span>Recente Commits (${m.commits.length})</span><${ExtLink} href=${commitsByAuthorUrl(team.repo, m.username)} cls="repo-link">Alle commits <${Icon} name="ext" /><//>`,
                m.commits.slice(0, 15).map(c => Item(c.sha || c.date, c.url, c.title, html`<span>${formatDateTime(c.date)}</span>${author(c.authorHandle)}`,
                  html`<${ExtLink} href=${c.url} cls="sha-badge">${c.shortSha}<//>`)), 'Geen commits gevonden.')}
              ${Panel(html`<span>Pull Requests (${m.pullRequests.length})</span><${ExtLink} href=${prsByAuthorUrl(team.repo, m.username)} cls="repo-link">Alle PR's <${Icon} name="ext" /><//>`,
                m.pullRequests.map(pr => { const [cls, label] = PR_PILL[pr.state] ?? PR_PILL.closed;
                  return Item(`p${pr.number}`, pr.url, html`<span class="mono msg-muted">#${pr.number}</span> ${pr.title}`,
                    html`${pr.headRef && pr.baseRef ? html`<span class="mono">${pr.headRef} → ${pr.baseRef}</span>` : null}<span>· ${formatDate(pr.updatedAt || pr.createdAt)}</span>${author(pr.authorHandle)}`,
                    html`<${Pill} cls=${cls}>${label}<//>`); }), 'Geen Pull Requests aangemaakt.')}
            </div>
          </div>
          <div class="modal-foot">
            <div class="group">
              <${ExtLink} href=${profileUrl(m.username)} cls="btn btn-sm">GitHub Profiel (@${m.username}) <${Icon} name="ext" /><//>
              <${ExtLink} href=${issuesByAuthorUrl(team.repo, m.username)} cls="btn btn-sm">Door student aangemaakte issues (${tot.issuesCreated}) <${Icon} name="ext" /><//>
            </div>
            <button type="button" class="btn btn-primary" onClick=${tryClose}>Sluiten</button>
          </div>
          ${confirmClose.value ? html`<${ConfirmDialog} title="Niet-opgeslagen wijzigingen" confirmLabel="Sluiten zonder opslaan" danger=${true}
            message="Je notities of studentnummer zijn nog niet opgeslagen."
            onConfirm=${() => emit('close')} onCancel=${() => { confirmClose.value = false; }} />` : null}
          ${identityOpen.value ? html`<${IdentityModal} teamId=${team.id} handle=${m.username} onClose=${() => { identityOpen.value = false; }} />` : null}
        <//>`;
    };
  },
};
