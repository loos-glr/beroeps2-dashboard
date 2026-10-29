import { getToken, getTeacherUsername } from './storage.js';
import { readEtagEntry, writeEtagEntry } from './cache.js';
import { esc, icon } from './utils.js';
import { addTeamIfNew, findStoredTeam, getStoredTeams } from './teams.js';
import {
  createEmptyMember,
  getIssueAssignees,
  mergeRawTeamMembers,
  toCommitSummary,
  toIssueSummary,
  toPrSummary,
  updateLastActive
} from './analysis.js';

/**
 * ============================================================================
 * GITHUB API & FORMATIEVE ANALYSE LOGICA
 * ============================================================================
 */

export function getHeaders() {
  const token = getToken();
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function checkRateLimit() {
  const el = document.getElementById('rateLimitStatus');
  try {
    const res = await fetch('https://api.github.com/rate_limit', { headers: getHeaders() });
    if (!res.ok) return;
    const { remaining, limit } = (await res.json()).rate;
    const mode = getToken() ? 'token' : 'anoniem';
    el.innerHTML = `${icon('pulse')}API (${mode}): <span class="mono">${remaining}/${limit}</span>`;
  } catch (e) {
    el.innerHTML = `${icon('pulse')}API: niet beschikbaar`;
  }
}

/**
 * Laag 2: conditionele GitHub-request. Bewaart per URL de laatste ETag + body
 * en stuurt die als `If-None-Match` mee. Een 304 telt niet mee voor de rate limit.
 * `slim` kan de body verkleinen vóór het opslaan (bespaart opslagruimte).
 * Retourneert { ok, status, data, notModified }.
 */
export async function cachedGithubFetch(url, options = {}) {
  const { slim, headers: extraHeaders, ...fetchOptions } = options;
  const headers = { ...getHeaders(), ...extraHeaders };
  const entry = readEtagEntry(url);
  if (entry?.etag) headers['If-None-Match'] = entry.etag;

  const res = await fetch(url, { ...fetchOptions, headers });

  if (res.status === 304 && entry) {
    return { ok: true, status: 304, data: entry.body, notModified: true };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, data: null, notModified: false };
  }

  const raw = await res.json();
  const data = slim && Array.isArray(raw) ? raw.map(slim) : raw;
  const etag = res.headers.get('ETag');
  if (etag) writeEtagEntry(url, etag, data);
  return { ok: true, status: res.status, data, notModified: false };
}

// Houdt de originele veldnamen, zodat de to*Summary-functies ongewijzigd werken
const pickUser = u => (u ? { login: u.login, avatar_url: u.avatar_url } : u);
const slimCommit = c => ({
  sha: c.sha,
  html_url: c.html_url,
  author: pickUser(c.author),
  commit: c.commit && { message: c.commit.message, author: c.commit.author && { name: c.commit.author.name, date: c.commit.author.date } }
});
const slimPr = pr => ({
  number: pr.number, title: pr.title, state: pr.state, merged_at: pr.merged_at,
  created_at: pr.created_at, updated_at: pr.updated_at, html_url: pr.html_url,
  user: pickUser(pr.user), head: { ref: pr.head?.ref }, base: { ref: pr.base?.ref }
});
const slimIssue = i => ({
  number: i.number, title: i.title, state: i.state, created_at: i.created_at,
  updated_at: i.updated_at, closed_at: i.closed_at, html_url: i.html_url,
  labels: Array.isArray(i.labels) ? i.labels.map(l => (typeof l === 'string' ? l : l.name)).filter(Boolean) : [],
  user: pickUser(i.user), assignee: pickUser(i.assignee),
  assignees: Array.isArray(i.assignees) ? i.assignees.map(pickUser) : [],
  pull_request: i.pull_request ? {} : undefined
});

const TEAM_ENDPOINTS = [
  { path: 'commits?per_page=100', slim: slimCommit },
  { path: 'pulls?state=all&per_page=100', slim: slimPr },
  { path: 'issues?state=all&per_page=100', slim: slimIssue },
  { path: 'branches?per_page=100', slim: b => ({ name: b.name }) },
  { path: 'collaborators', slim: pickUser }
];

/** Aantal GitHub-requests dat één volledige teamload kost. */
export const REQUESTS_PER_TEAM = TEAM_ENDPOINTS.length;

/** Retourneert { data, requests: { made, notModified } }. */
export async function fetchTeamData(team) {
  const baseUrl = `https://api.github.com/repos/${team.repo}`;
  const teacherUsername = getTeacherUsername();

  // Haal commits, PR's, issues, branches én (indien token aanwezig) collaborators parallel op
  const [commitsRes, prsRes, issuesRes, branchesRes, collabRes] = await Promise.all(
    TEAM_ENDPOINTS.map(e => cachedGithubFetch(`${baseUrl}/${e.path}`, { slim: e.slim }))
  );
  const requests = {
    made: REQUESTS_PER_TEAM,
    notModified: [commitsRes, prsRes, issuesRes, branchesRes, collabRes].filter(r => r.notModified).length
  };

  if (!commitsRes.ok) {
    throw new Error(`Kan ${team.repo} niet ophalen (status ${commitsRes.status})`);
  }

  const commits = commitsRes.data;
  const prs = prsRes.ok ? prsRes.data : [];
  const rawIssues = issuesRes.ok ? issuesRes.data : [];
  const branches = branchesRes.ok ? branchesRes.data : [];
  const collaborators = collabRes.ok ? collabRes.data : [];

  // GitHub's /issues endpoint levert ook Pull Requests terug (herkenbaar aan .pull_request)
  const pureIssues = Array.isArray(rawIssues)
    ? rawIssues.filter(item => item && !item.pull_request)
    : [];

  const membersMap = {};
  // Geeft het (nieuwe of bestaande) profiel terug, of null voor de docent
  const memberFor = (login, avatar) => {
    const key = login.toLowerCase();
    if (key === teacherUsername) return null;
    return membersMap[key] ??= createEmptyMember(login, avatar);
  };

  // Collaborators eerst, zodat ook studenten met 0 bijdragen zichtbaar zijn
  if (Array.isArray(collaborators)) {
    collaborators.forEach(user => {
      if (user && user.login) memberFor(user.login, user.avatar_url);
    });
  }

  commits.forEach(c => {
    const login = c.author ? c.author.login : (c.commit?.author?.name || 'Onbekend');
    const member = memberFor(login, c.author ? c.author.avatar_url : null);
    if (!member) return;
    const summary = toCommitSummary(c, login);
    member.commitList.push(summary);
    updateLastActive(member, summary.date);
  });

  prs.forEach(pr => {
    if (!pr.user) return;
    const member = memberFor(pr.user.login, pr.user.avatar_url);
    if (!member) return;
    member.prList.push(toPrSummary(pr));
    updateLastActive(member, pr.updated_at || pr.created_at);
  });

  pureIssues.forEach(issue => {
    const summary = toIssueSummary(issue);

    const creator = issue.user && issue.user.login ? memberFor(issue.user.login, issue.user.avatar_url) : null;
    if (creator) {
      creator.createdIssueList.push(summary);
      updateLastActive(creator, issue.created_at || issue.updated_at);
    }

    getIssueAssignees(issue).forEach(assignee => {
      if (!assignee || !assignee.login) return;
      const member = memberFor(assignee.login, assignee.avatar_url);
      if (member) member.assignedIssueList.push(summary);
    });
  });

  const rawMembers = Object.values(membersMap);
  return {
    data: {
      teamName: team.name,
      repo: team.repo,
      collaboratorsDetected: collabRes.ok,
      totalPRs: prs.length,
      totalIssues: pureIssues.length,
      openIssues: pureIssues.filter(i => i.state === 'open').length,
      totalBranches: branches.length,
      rawMembers,
      members: mergeRawTeamMembers(rawMembers)
    },
    requests
  };
}

// Automatisch repo's ontdekken waar de docent collaborator op is
export async function discoverCollaboratorRepos() {
  const container = document.getElementById('discoveredReposContainer');
  container.classList.remove('hidden');

  if (!getToken()) {
    container.innerHTML = `<p class="msg-warn">Stel eerst een token in.</p>`;
    return;
  }

  container.innerHTML = `<p class="msg-muted">Ophalen…</p>`;

  try {
    const res = await fetch('https://api.github.com/user/repos?affiliation=collaborator&sort=updated&per_page=100', {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error(`GitHub API gaf status ${res.status}`);
    const repos = await res.json();
    const currentTeams = getStoredTeams();

    if (repos.length === 0) {
      container.innerHTML = `<p class="msg-muted">Geen repo's gevonden.</p>`;
      return;
    }

    container.innerHTML = repos.map(r => `
      <div class="row">
        <div>
          <strong>${esc(r.name)}</strong>
          <span class="mono msg-muted" style="margin-left:6px;font-size:11.5px">${esc(r.full_name)}</span>
        </div>
        ${findStoredTeam(currentTeams, r.full_name)
          ? `<span class="pill ok">${icon('check')}Toegevoegd</span>`
          : `<button type="button" data-action="quick-add-repo" data-name="${esc(r.name)}" data-full="${esc(r.full_name)}" class="btn btn-sm">${icon('plus')}Toevoegen</button>`
        }
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="msg-bad">Fout: ${esc(err.message)}</p>`;
  }
}

export function quickAddDiscoveredRepo(name, fullName) {
  addTeamIfNew(name, fullName);
  discoverCollaboratorRepos();
}
