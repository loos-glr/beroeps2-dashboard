/**
 * Alles rond localStorage: sleutels, veilig lezen/schrijven en token/docent.
 *
 * PRIVACY: er staat géén hardcoded student, repo of token in deze code.
 */

export const STORAGE_KEYS = {
  TEAMS: 'glr_beroeps2_teams_v1',
  ALIASES: 'glr_beroeps2_student_aliases_v1',
  TOKEN: 'glr_gh_token',
  TEACHER: 'glr_gh_teacher_username',
  TEAM_CACHE: 'glr_beroeps2_team_cache_v1',
  CACHE_TTL: 'glr_beroeps2_cache_ttl_min',
  /** Prefix: per GitHub API-URL één key met { etag, body, storedAt }. */
  ETAG_PREFIX: 'glr_beroeps2_etag_v1:'
};

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

export function setOrRemoveStored(key, value) {
  if (value) {
    localStorage.setItem(key, value);
  } else {
    localStorage.removeItem(key);
  }
}

export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.TOKEN) || '';
}

export function hasToken() {
  return Boolean(getToken());
}

export function getTeacherUsername() {
  return (localStorage.getItem(STORAGE_KEYS.TEACHER) || '').trim().toLowerCase();
}
