import { state, findTeamData } from './state.js';
import {
  esc, icon, sameText, setModal, externalLink, emptyListItem,
  formatDate, formatDateTime, daysSince, formatHandles, getThresholdDays,
  numberedTitle, authorNote
} from './utils.js';
import { getStudentAlias } from './aliases.js';
import { evaluateStudentStatus } from './analysis.js';

/**
 * ============================================================================
 * STUDENT DETAIL WEERGAVE (DRILL-DOWN MODAL)
 * ============================================================================
 */

export function openStudentDetailModal(repo, username) {
  if (!repo || !username) return;
  state.activeStudentDetail = { repo, username };
  renderStudentDetailModalContent();
  setModal('studentDetailModal', true);
}

export function closeStudentDetailModal() {
  setModal('studentDetailModal', false);
  state.activeStudentDetail = null;
}

export function findStudent(members, username) {
  return members.find(m => m.handles.some(h => sameText(h, username)));
}

export function renderLatestCommit(commit, fallbackHandle) {
  if (!commit) {
    return `
      <div class="latest-commit-box empty-box">
        <div class="commit-msg-title" style="color:var(--bad)">Geen commits gevonden voor deze student</div>
        <p class="help" style="margin:0">Deze student heeft nog geen commits gepusht in de laatste 100 commits van deze repository.</p>
      </div>
    `;
  }
  return `
    <div class="latest-commit-box">
      <div class="latest-commit-meta">
        <span>${icon('commit')}<strong>Laatste commit</strong> (${esc('@' + (commit.authorHandle || fallbackHandle))}) · ${esc(formatDateTime(commit.date))} (${daysSince(commit.date)}d geleden)</span>
        ${externalLink(commit.url, 'sha-badge', `${esc(commit.shortSha)} ${icon('ext')}`, 'Open commit op GitHub')}
      </div>
      <div class="commit-msg-title">${esc(commit.title)}</div>
      ${commit.body ? `<div class="commit-msg-body">${esc(commit.body)}</div>` : ''}
    </div>
  `;
}

export function renderDetailItem(url, title, subHtml, asideHtml) {
  return `
    <div class="detail-item">
      <div class="detail-item-main">
        ${externalLink(url, 'detail-item-title', title)}
        <div class="detail-item-sub">${subHtml}</div>
      </div>
      ${asideHtml}
    </div>
  `;
}

export function renderIssueItem(issue) {
  const stateBadge = issue.state === 'open'
    ? `<span class="pill warn">Open</span>`
    : `<span class="pill ok">Closed</span>`;
  const sub = `
    <span>Aangemaakt: ${esc(formatDate(issue.createdAt))}</span>
    ${issue.closedAt ? `<span>· Gesloten: ${esc(formatDate(issue.closedAt))}</span>` : ''}
    ${issue.labels.map(l => `<span class="gh-label">${esc(l)}</span>`).join('')}
  `;
  return renderDetailItem(issue.url, numberedTitle(issue.number, issue.title), sub, stateBadge);
}

export function renderCommitItem(commit, showAuthor) {
  const sub = `
    <span>${esc(formatDateTime(commit.date))}</span>
    ${authorNote(showAuthor, commit.authorHandle)}
  `;
  return renderDetailItem(commit.url, esc(commit.title), sub, externalLink(commit.url, 'sha-badge', esc(commit.shortSha)));
}

const PR_STATE_BADGES = {
  merged: `<span class="pill purple">Merged</span>`,
  open: `<span class="pill ok">Open</span>`,
  closed: `<span class="pill muted">Closed</span>`
};

export function renderPrItem(pr, showAuthor) {
  const sub = `
    ${pr.headRef && pr.baseRef ? `<span class="mono">${esc(pr.headRef)} → ${esc(pr.baseRef)}</span>` : ''}
    <span>· ${esc(formatDate(pr.updatedAt || pr.createdAt))}</span>
    ${authorNote(showAuthor, pr.authorHandle)}
  `;
  return renderDetailItem(pr.url, numberedTitle(pr.number, pr.title), sub, PR_STATE_BADGES[pr.state] || PR_STATE_BADGES.closed);
}

export function renderDetailPanel(headHtml, itemsHtml, emptyText) {
  return `
    <div class="detail-panel">
      <div class="detail-panel-head">${headHtml}</div>
      <div class="detail-list">${itemsHtml || emptyListItem(emptyText)}</div>
    </div>
  `;
}

export function renderStudentDetailModalContent() {
  const container = document.getElementById('studentDetailContent');
  if (!container || !state.activeStudentDetail) return;

  const teamData = findTeamData(state.activeStudentDetail.repo);
  if (!teamData) return;
  const student = findStudent(teamData.members, state.activeStudentDetail.username);
  if (!student) return;

  const status = evaluateStudentStatus(student, getThresholdDays());
  const displayName = getStudentAlias(student.username) || student.username;
  const isMerged = student.handles.length > 1;
  const encodedUser = encodeURIComponent(student.username);
  const repoUrl = `https://github.com/${teamData.repo}`;

  const openAssigned = student.assignedIssueList.filter(i => i.state === 'open');
  const closedAssigned = student.assignedIssueList.filter(i => i.state === 'closed');
  const totalAssigned = student.assignedIssueList.length;
  const pctOf = count => (count / totalAssigned) * 100;

  const prCountByState = stateName => student.prList.filter(p => p.state === stateName).length;

  container.innerHTML = `
    <div class="modal-head">
      <div class="detail-header-profile">
        <img src="${esc(student.avatar)}" alt="" width="48" height="48">
        <div>
          <div class="detail-title-row">
            <h2 id="studentDetailTitle">${esc(displayName)}</h2>
            <span class="gh-handle">${formatHandles(student.handles)}</span>
            ${isMerged ? `<span class="merged-badge">${icon('link')}${student.handles.length} accounts samengevoegd</span>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-action="open-alias-modal" data-gh="${esc(student.username)}" data-repo="${esc(teamData.repo)}" title="Naam of gekoppelde accounts aanpassen">
              ${icon('edit')}Naam / Accounts
            </button>
            <span class="pill ${status.level}">${icon(status.icon)}${esc(status.label)}</span>
          </div>
          <p>
            Team: <strong>${esc(teamData.teamName)}</strong> ·
            ${externalLink(repoUrl, 'repo-link', `${esc(teamData.repo)} ${icon('ext')}`)}
          </p>
        </div>
      </div>
      <button type="button" data-action="close-student-detail" class="btn btn-ghost btn-sm" aria-label="Sluiten">${icon('x')}</button>
    </div>

    <div class="modal-body">
      <div class="detail-kpis">
        <div class="detail-kpi">
          <span class="lbl">Commits (laatste 100)</span>
          <span class="val">${student.commits}</span>
          <span class="sub">Laatst actief: ${esc(formatDate(student.lastActive))}</span>
        </div>
        <div class="detail-kpi">
          <span class="lbl">Pull Requests</span>
          <span class="val">${student.prsCreated}</span>
          <span class="sub">${prCountByState('merged')} merged · ${prCountByState('open')} open · ${prCountByState('closed')} closed</span>
        </div>
        <div class="detail-kpi">
          <span class="lbl">Assigned Issues</span>
          <span class="val">${totalAssigned}</span>
          <span class="sub">${openAssigned.length} open · ${closedAssigned.length} afgerond (closed)</span>
        </div>
        <div class="detail-kpi">
          <span class="lbl">Aangemaakte Issues</span>
          <span class="val">${student.issuesCreated}</span>
          <span class="sub">Door deze student gerapporteerd</span>
        </div>
      </div>

      <div>
        ${renderLatestCommit(student.commitList[0], student.username)}
      </div>

      <div>
        <div class="section-title">
          <span>Assigned Issues uitgesplitst per status (${totalAssigned} totaal)</span>
          ${externalLink(`${repoUrl}/issues?q=is%3Aissue+assignee%3A${encodedUser}`, 'repo-link', `Bekijk op GitHub ${icon('ext')}`)}
        </div>
        ${totalAssigned > 0 ? `
          <div class="status-progress" title="${openAssigned.length} Open, ${closedAssigned.length} Closed">
            ${openAssigned.length ? `<div class="bar-open" style="width:${pctOf(openAssigned.length)}%"></div>` : ''}
            ${closedAssigned.length ? `<div class="bar-closed" style="width:${pctOf(closedAssigned.length)}%"></div>` : ''}
          </div>
        ` : ''}
        <div class="split-grid">
          ${renderDetailPanel(
            `<span>Openstaand / In uitvoering</span><span class="pill warn">${openAssigned.length} Open</span>`,
            openAssigned.map(renderIssueItem).join(''),
            'Geen openstaande issues toegewezen.'
          )}
          ${renderDetailPanel(
            `<span>Afgerond</span><span class="pill ok">${closedAssigned.length} Closed</span>`,
            closedAssigned.map(renderIssueItem).join(''),
            'Nog geen afgeronde issues.'
          )}
        </div>
      </div>

      <div class="split-grid">
        ${renderDetailPanel(
          `<span>Recente Commits (${student.commitList.length})</span>${externalLink(`${repoUrl}/commits?author=${encodedUser}`, 'repo-link', `Alle commits ${icon('ext')}`)}`,
          student.commitList.slice(0, 15).map(c => renderCommitItem(c, isMerged)).join(''),
          'Geen commits gevonden.'
        )}
        ${renderDetailPanel(
          `<span>Pull Requests (${student.prList.length})</span>${externalLink(`${repoUrl}/pulls?q=is%3Apr+author%3A${encodedUser}`, 'repo-link', `Alle PR's ${icon('ext')}`)}`,
          student.prList.map(pr => renderPrItem(pr, isMerged)).join(''),
          'Geen Pull Requests aangemaakt.'
        )}
      </div>
    </div>

    <div class="modal-foot">
      <div class="group">
        ${externalLink(`https://github.com/${encodedUser}`, 'btn btn-sm', `GitHub Profiel (@${esc(student.username)}) ${icon('ext')}`)}
        ${externalLink(`${repoUrl}/issues?q=is%3Aissue+author%3A${encodedUser}`, 'btn btn-sm', `Door student aangemaakte issues (${student.issuesCreated}) ${icon('ext')}`)}
      </div>
      <button type="button" data-action="close-student-detail" class="btn btn-primary">Sluiten</button>
    </div>
  `;
}
