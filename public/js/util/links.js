/** Externe links: alleen https://github.com/ is toegestaan. */
export function safeGithubUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com' ? u.href : null;
  } catch {
    return null;
  }
}

const q = encodeURIComponent;
export const repoUrl = repo => `https://github.com/${repo}`;
export const profileUrl = handle => `https://github.com/${q(handle)}`;
export const issuesByAuthorUrl = (repo, handle) => `${repoUrl(repo)}/issues?q=is%3Aissue+author%3A${q(handle)}`;
export const issuesByAssigneeUrl = (repo, handle) => `${repoUrl(repo)}/issues?q=is%3Aissue+assignee%3A${q(handle)}`;
export const commitsByAuthorUrl = (repo, handle) => `${repoUrl(repo)}/commits?author=${q(handle)}`;
export const prsByAuthorUrl = (repo, handle) => `${repoUrl(repo)}/pulls?q=is%3Apr+author%3A${q(handle)}`;
export const labelUrl = (repo, label) => `${repoUrl(repo)}/issues?q=${q(`label:"${label}"`)}`;

export const cleanRepoPath = input => input.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
export const parseHandleList = text => text.split(',').map(h => h.trim().replace(/^@/, '')).filter(Boolean);
