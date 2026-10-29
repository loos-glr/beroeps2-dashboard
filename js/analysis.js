import { FALLBACK_AVATAR, sameText, daysSince } from './utils.js';
import { getStudentAlias } from './aliases.js';

/**
 * ============================================================================
 * STUDENT-PROFIELEN OPBOUWEN & SAMENVOEGEN (analyse)
 * ============================================================================
 * Alle totalen worden uit de (ontdubbelde) lijsten berekend, zodat ze altijd
 * kloppen na het samenvoegen van meerdere accounts van dezelfde student.
 */

export function createEmptyMember(username, avatar) {
  return {
    username,
    handles: [username],
    avatar: avatar || FALLBACK_AVATAR,
    commitList: [],
    prList: [],
    createdIssueList: [],
    assignedIssueList: [],
    lastActive: null
  };
}

export function updateLastActive(member, dateStr) {
  if (!dateStr) return;
  if (!member.lastActive || new Date(dateStr) > new Date(member.lastActive)) {
    member.lastActive = dateStr;
  }
}

// Voegt items toe die nog niet in de lijst staan; items zonder sleutel worden altijd toegevoegd
export function addUnique(list, items, keyOf) {
  items.forEach(item => {
    const key = keyOf(item);
    if (!key || !list.some(existing => keyOf(existing) === key)) list.push(item);
  });
}

export const byNewest = dateOf => (a, b) => new Date(dateOf(b) || 0) - new Date(dateOf(a) || 0);

// Totalen worden altijd vanuit de (ontdubbelde) lijsten berekend
export function withTotals(member) {
  member.commitList.sort(byNewest(c => c.date));
  member.prList.sort(byNewest(pr => pr.updatedAt || pr.createdAt));

  member.commits = member.commitList.length;
  member.prsCreated = member.prList.length;
  member.prsMerged = member.prList.filter(pr => pr.state === 'merged').length;
  member.issuesCreated = member.createdIssueList.length;
  member.issuesAssigned = member.assignedIssueList.length;
  member.issuesAssignedOpen = member.assignedIssueList.filter(i => i.state === 'open').length;
  member.issuesAssignedClosed = member.assignedIssueList.filter(i => i.state === 'closed').length;
  return member;
}

/**
 * Voegt ruwe GitHub-accounts binnen een team samen wanneer ze via `aliases`
 * aan dezelfde studentnaam zijn gekoppeld.
 */
export function mergeRawTeamMembers(rawMembers) {
  const groups = {};

  rawMembers.forEach(m => {
    const alias = getStudentAlias(m.username).trim();
    const groupKey = alias ? `alias:${alias.toLowerCase()}` : `raw:${m.username.toLowerCase()}`;

    let target = groups[groupKey];
    if (!target) {
      target = groups[groupKey] = createEmptyMember(m.username, m.avatar);
    } else {
      if (!target.handles.some(h => sameText(h, m.username))) {
        target.handles.push(m.username);
      }
      // Gebruik een echte GitHub avatar als het eerste account een fallback-icoon had
      if (target.avatar.includes('GitHub-Mark') && m.avatar && !m.avatar.includes('GitHub-Mark')) {
        target.avatar = m.avatar;
      }
    }

    addUnique(target.commitList, m.commitList, c => c.sha);
    addUnique(target.prList, m.prList, pr => pr.number);
    addUnique(target.createdIssueList, m.createdIssueList, issue => issue.number);
    addUnique(target.assignedIssueList, m.assignedIssueList, issue => issue.number);
    updateLastActive(target, m.lastActive);
  });

  return Object.values(groups).map(withTotals).sort((a, b) => a.commits - b.commits);
}

export function applyAliasMerges(results) {
  results.forEach(r => {
    if (r.data) r.data.members = mergeRawTeamMembers(r.data.rawMembers);
  });
}

/* ===== GitHub-payloads omzetten naar compacte samenvattingen ===== */
export function toCommitSummary(c, authorHandle) {
  const [firstLine, ...restLines] = (c.commit?.message || '(Geen commit message)').split('\n');
  return {
    sha: c.sha,
    shortSha: c.sha ? c.sha.substring(0, 7) : '–',
    authorHandle,
    title: firstLine.trim(),
    body: restLines.join('\n').trim(),
    date: c.commit?.author?.date,
    url: c.html_url
  };
}

export function toPrSummary(pr) {
  return {
    number: pr.number,
    title: pr.title,
    authorHandle: pr.user.login,
    state: pr.merged_at ? 'merged' : pr.state,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    mergedAt: pr.merged_at,
    url: pr.html_url,
    headRef: pr.head?.ref || '',
    baseRef: pr.base?.ref || ''
  };
}

export function toIssueSummary(issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    labels: Array.isArray(issue.labels)
      ? issue.labels.map(l => (typeof l === 'string' ? l : l.name)).filter(Boolean)
      : [],
    url: issue.html_url
  };
}

export function getIssueAssignees(issue) {
  if (Array.isArray(issue.assignees) && issue.assignees.length > 0) return issue.assignees;
  return issue.assignee ? [issue.assignee] : [];
}

// level: 'ok' | 'warn' | 'bad' — icoon + tekst naast kleur, zodat status niet alleen op kleur steunt
export function evaluateStudentStatus(student, thresholdDays) {
  const inactiveDays = daysSince(student.lastActive);

  if (student.commits === 0 && student.prsCreated === 0) {
    return { level: 'bad', icon: 'x', label: '0 code-bijdragen' };
  }
  if (inactiveDays > thresholdDays) {
    return { level: 'bad', icon: 'x', label: `${inactiveDays} dagen stil` };
  }
  if (student.commits > 2 && student.prsCreated === 0) {
    return { level: 'warn', icon: 'alert', label: "Geen PR's" };
  }
  return { level: 'ok', icon: 'check', label: 'Op koers' };
}
