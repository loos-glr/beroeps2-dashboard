import { getToken, getTeacherUsername } from './storage.js';
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

export async function fetchTeamData(team) {
  const headers = getHeaders();
  const baseUrl = `https://api.github.com/repos/${team.repo}`;
  const teacherUsername = getTeacherUsername();

  // Haal commits, PR's, issues, branches én (indien token aanwezig) collaborators parallel op
  const [commitsRes, prsRes, issuesRes, branchesRes, collabRes] = await Promise.all([
    fetch(`${baseUrl}/commits?per_page=100`, { headers }),
    fetch(`${baseUrl}/pulls?state=all&per_page=100`, { headers }),
    fetch(`${baseUrl}/issues?state=all&per_page=100`, { headers }),
    fetch(`${baseUrl}/branches?per_page=100`, { headers }),
    fetch(`${baseUrl}/collaborators`, { headers })
  ]);

  if (!commitsRes.ok) {
    throw new Error(`Kan ${team.repo} niet ophalen (status ${commitsRes.status})`);
  }

  const commits = await commitsRes.json();
  const prs = prsRes.ok ? await prsRes.json() : [];
  const rawIssues = issuesRes.ok ? await issuesRes.json() : [];
  const branches = branchesRes.ok ? await branchesRes.json() : [];
  const collaborators = collabRes.ok ? await collabRes.json() : [];

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
    teamName: team.name,
    repo: team.repo,
    collaboratorsDetected: collabRes.ok,
    totalPRs: prs.length,
    totalIssues: pureIssues.length,
    openIssues: pureIssues.filter(i => i.state === 'open').length,
    totalBranches: branches.length,
    rawMembers,
    members: mergeRawTeamMembers(rawMembers)
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
