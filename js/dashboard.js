import { state } from './state.js';
import { esc, icon, externalLink, formatAge, formatDate, formatHandles, getThresholdDays, sameText } from './utils.js';
import { getStudentAlias } from './aliases.js';
import { applyAliasMerges, evaluateStudentStatus } from './analysis.js';
import { REQUESTS_PER_TEAM } from './github.js';

/**
 * ============================================================================
 * DASHBOARD WEERGAVE
 * ============================================================================
 */

// Attributen voor elementen die de detailpagina van een student openen
const detailTrigger = (repo, username) =>
  `data-action="open-student-detail" data-repo="${esc(repo)}" data-gh="${esc(username)}"`;

export function renderStudentRow(student, status, repo) {
  const alias = getStudentAlias(student.username);
  const displayName = alias || student.username;
  const isMerged = student.handles.length > 1;
  const handleBadge = alias || isMerged
    ? `<span class="gh-handle">${formatHandles(student.handles)}</span>`
    : '';
  const mergedChip = isMerged
    ? `<span class="merged-badge" title="Samengevoegd uit ${student.handles.length} accounts">${icon('link')}${student.handles.length}</span>`
    : '';
  const editTitle = alias
    ? `Naam of gekoppelde accounts wijzigen (${alias})`
    : `Studentnaam koppelen of accounts samenvoegen voor @${student.username}`;
  const openDetail = detailTrigger(repo, student.username);
  const issuesByStudentUrl = `https://github.com/${repo}/issues?q=is%3Aissue+author%3A${encodeURIComponent(student.username)}`;

  return `
    <tr>
      <td>
        <div class="student">
          <img src="${esc(student.avatar)}" alt="" loading="lazy" width="28" height="28">
          <div class="student-info">
            <div class="student-name-row">
              <button type="button" class="primary-name-btn" ${openDetail} title="Open detailoverzicht voor ${esc(displayName)}">
                ${esc(displayName)}
              </button>
              ${handleBadge}
              ${mergedChip}
              <button type="button" class="edit-alias-btn" data-action="open-alias-modal" data-gh="${esc(student.username)}" data-repo="${esc(repo)}" title="${esc(editTitle)}" aria-label="${esc(editTitle)}">
                ${icon('edit')}
              </button>
            </div>
            <span class="pill ${status.level}">${icon(status.icon)}${esc(status.label)}</span>
          </div>
        </div>
      </td>
      <td class="num">
        <button type="button" class="metric-link" ${openDetail} title="Bekijk laatste commit & historie van ${esc(displayName)}">
          <span class="v ${student.commits === 0 ? 'zero bad' : ''}">${student.commits}</span>
        </button>
      </td>
      <td class="num">
        <button type="button" class="metric-link" ${openDetail} title="Bekijk Pull Requests van ${esc(displayName)}">
          <span class="v ${student.prsCreated === 0 ? 'zero warn' : ''}">${student.prsCreated}</span>
        </button>
        <small>${student.prsMerged} merged</small>
      </td>
      <td class="num">
        <div class="issue-pair">
          ${externalLink(issuesByStudentUrl, 'issue-badge', `<span class="lbl-mini">gemaakt</span> ${student.issuesCreated}`, `Issues aangemaakt door ${displayName}`)}
          <button type="button" class="issue-badge" ${openDetail} title="Klik voor uitsplitsing: ${student.issuesAssignedOpen} open, ${student.issuesAssignedClosed} closed">
            <span class="lbl-mini">assigned</span> ${student.issuesAssigned}
          </button>
        </div>
      </td>
      <td class="when">${formatDate(student.lastActive)}</td>
    </tr>
  `;
}

export function renderHealthBar(counts, total) {
  if (!total) return '';
  const segment = level => counts[level] ? `<i class="h-${level}" style="width:${(counts[level] / total) * 100}%"></i>` : '';
  return `<div class="health" role="img" aria-label="${counts.ok} op koers, ${counts.warn} gesprekspunt, ${counts.bad} direct bijsturen">${segment('ok')}${segment('warn')}${segment('bad')}</div>`;
}

export function renderTeamNameEditButton(repo, ariaLabel) {
  return `
    <button type="button" class="edit-alias-btn" data-action="open-team-name-modal" data-repo="${esc(repo)}" title="Teamnaam wijzigen" aria-label="${esc(ariaLabel)}">
      ${icon('edit')}
    </button>
  `;
}

export function renderTeamRefreshButton(repo) {
  const busy = state.loading || state.refreshingRepos.has(repo.toLowerCase());
  const spinning = state.refreshingRepos.has(repo.toLowerCase());
  return `
    <button type="button" class="edit-alias-btn card-refresh-btn ${spinning ? 'spin' : ''}" data-action="refresh-team" data-repo="${esc(repo)}" title="Ververs alleen dit team" aria-label="Ververs alleen dit team (${esc(repo)})" ${busy ? 'disabled' : ''}>
      ${icon('refresh')}
    </button>
  `;
}

// Badge: Live opgehaald / Uit cache (X min geleden)
export function renderCacheBadge(cache) {
  if (!cache) return '';
  const age = formatAge(Date.now() - cache.fetchedAt);
  if (cache.source === 'live') {
    const title = `${cache.made} requests, waarvan ${cache.notModified}× 304 Not Modified (telt niet mee voor de rate limit)`;
    return `<span class="pill ok cache-badge" title="${esc(title)}">${icon('pulse')}Live opgehaald</span>`;
  }
  if (cache.source === 'stale') {
    return `<span class="pill warn cache-badge" title="${esc(cache.error || 'Verversen mislukt')}">${icon('alert')}Uit cache (${age}) · verversen mislukt</span>`;
  }
  return `<span class="pill muted cache-badge" title="Geen netwerkrequests gedaan">${icon('shield')}Uit cache (${age})</span>`;
}

export function renderTeamCard(data, thresholdDays, onlyAttention, cache) {
  const evaluated = data.members.map(student => ({ student, status: evaluateStudentStatus(student, thresholdDays) }));
  const counts = { ok: 0, warn: 0, bad: 0 };
  evaluated.forEach(e => counts[e.status.level]++);

  const visible = onlyAttention ? evaluated.filter(e => e.status.level !== 'ok') : evaluated;
  if (onlyAttention && visible.length === 0) return '';

  const rowsHtml = visible.map(({ student, status }) => renderStudentRow(student, status, data.repo)).join('');
  const repoUrl = `https://github.com/${data.repo}`;

  const collabNote = data.collaboratorsDetected
    ? ''
    : `<div class="collab-note msg-warn">${icon('alert')}Alleen committers zichtbaar. Stel een token in voor studenten met 0 commits.</div>`;

  return `
    <article class="card ${counts.bad ? 'has-bad' : ''}" data-repo="${esc(data.repo)}">
      <div class="card-head">
        <div>
          <div class="card-title-row">
            <h2>${esc(data.teamName)}</h2>
            ${renderTeamNameEditButton(data.repo, `Teamnaam wijzigen voor ${data.teamName}`)}
            ${renderTeamRefreshButton(data.repo)}
          </div>
          ${externalLink(repoUrl, 'repo-link', `${esc(data.repo)} ${icon('ext')}`)}
          ${renderCacheBadge(cache)}
        </div>
        <div class="chips">
          <span class="chip"><b>${data.totalBranches}</b>branches</span>
          <span class="chip"><b>${data.totalPRs}</b>PR's</span>
          <span class="chip" title="${data.openIssues} open issues"><b>${data.totalIssues}</b>issues</span>
        </div>
      </div>
      ${renderHealthBar(counts, evaluated.length)}
      ${collabNote}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col" class="num">Commits</th>
              <th scope="col" class="num">PR's</th>
              <th scope="col" class="num">Issues</th>
              <th scope="col" class="num">Laatst actief</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="5" class="empty">Geen activiteit.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="card-foot">
        <span>Klik op een student voor detailpagina · Potloodje om accounts samen te voegen</span>
        <nav>
          ${externalLink(`${repoUrl}/issues`, '', `Issues ${icon('ext')}`)}
          ${externalLink(`${repoUrl}/pulls`, '', `PR's ${icon('ext')}`)}
          ${externalLink(`${repoUrl}/network`, '', `Branches ${icon('ext')}`)}
        </nav>
      </div>
    </article>
  `;
}

export function renderErrorCard(team, err) {
  return `
    <article class="card error" data-repo="${esc(team.repo)}">
      <div class="card-title-row">
        <h2>${esc(team.name)}</h2>
        ${renderTeamNameEditButton(team.repo, 'Teamnaam wijzigen')}
        ${renderTeamRefreshButton(team.repo)}
      </div>
      <p class="err">${icon('x')}<span>${esc(err.message)}</span></p>
    </article>
  `;
}

export function renderKpis(results, thresholdDays) {
  const totals = { students: 0, ok: 0, warn: 0, bad: 0 };
  results.forEach(r => {
    if (!r.data) return;
    r.data.members.forEach(m => {
      totals.students++;
      totals[evaluateStudentStatus(m, thresholdDays).level]++;
    });
  });
  const values = document.querySelectorAll('#kpis .kpi-value');
  [totals.students, totals.ok, totals.warn, totals.bad].forEach((v, i) => { values[i].textContent = v; });
}

const renderResultCard = (r, thresholdDays, onlyAttention) => r.data
  ? renderTeamCard(r.data, thresholdDays, onlyAttention, r.cache)
  : renderErrorCard(r.team, r.error);

// Statusbalk: hoeveel teams uit de cache kwamen en hoeveel requests gedaan/bespaard zijn
export function renderCacheStatus(results) {
  const el = document.getElementById('cacheStatus');
  if (!el) return;
  if (!Array.isArray(results) || results.length === 0) {
    el.innerHTML = `${icon('shield')}Cache: –`;
    return;
  }
  let cached = 0, made = 0, notModified = 0;
  results.forEach(r => {
    if (r.cache?.source === 'cache') cached++;
    else if (r.cache?.source === 'live') { made += r.cache.made; notModified += r.cache.notModified; }
  });
  const saved = cached * REQUESTS_PER_TEAM + notModified;
  el.title = `${cached} van ${results.length} teams uit lokale cache. ${made} requests gedaan (${notModified}× 304 Not Modified, telt niet mee voor de rate limit). ${saved} API-calls bespaard.`;
  el.innerHTML = `${icon('shield')}Cache: <span class="mono">${cached}/${results.length}</span> teams · <span class="mono">${made}</span> requests · <span class="mono">${saved}</span> bespaard`;
}

// Alleen de kaart van één team opnieuw renderen (+ KPI's en statusbalk)
export function renderSingleTeam(repo) {
  const result = state.lastResults?.find(r => sameText(r.team.repo, repo));
  const card = [...document.querySelectorAll('#teamsContainer article[data-repo]')]
    .find(el => sameText(el.dataset.repo, repo));
  if (!result || !card) return renderDashboard();

  applyAliasMerges([result]);
  const html = renderResultCard(result, getThresholdDays(), document.getElementById('onlyAttention').checked);
  if (!html) return renderDashboard();

  card.outerHTML = html;
  renderKpis(state.lastResults, getThresholdDays());
  renderCacheStatus(state.lastResults);
}

export function renderDashboard() {
  if (!state.lastResults) return;
  const container = document.getElementById('teamsContainer');
  const thresholdDays = getThresholdDays();
  const onlyAttention = document.getElementById('onlyAttention').checked;

  // Pas eventuele nieuwe alias-koppelingen direct toe
  applyAliasMerges(state.lastResults);
  renderKpis(state.lastResults, thresholdDays);
  renderCacheStatus(state.lastResults);

  const html = state.lastResults.map(r => renderResultCard(r, thresholdDays, onlyAttention)).join('');

  container.innerHTML = html || `
    <div class="placeholder">
      <h2>Geen aandachtspunten</h2>
      <p>Iedereen is op koers.</p>
    </div>`;
}

export function renderNoTeamsPlaceholder(container) {
  container.innerHTML = `
    <div class="placeholder">
      <h2>Nog geen teams</h2>
      <p>Voeg teams toe of haal ze op via GitHub. Alles blijft lokaal in je browser.</p>
      <div class="row">
        <button type="button" data-action="toggle-token-modal" class="btn">${icon('key')}Token instellen</button>
        <button type="button" data-action="toggle-teams-modal" class="btn btn-primary">${icon('plus')}Teams toevoegen</button>
      </div>
    </div>
  `;
}

export function setRefreshing(isRefreshing) {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.classList.toggle('spin', isRefreshing);
  refreshBtn.disabled = isRefreshing;
  document.querySelectorAll('.card-refresh-btn').forEach(btn => { btn.disabled = isRefreshing; });
}
