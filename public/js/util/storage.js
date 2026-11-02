/** Veilige localStorage-toegang: kan leeg zijn of een exception gooien (privévenster, geblokkeerd). */

export const KEYS = {
  GH_TOKEN: 'glr_gh_token',
  CONTEXT_ID: 'glr_b2_context_id',
  ONLY_ATTENTION: 'glr_b2_only_attention',
  POC_TEAMS: 'glr_beroeps2_teams_v1',
  POC_ALIASES: 'glr_beroeps2_student_aliases_v1',
};

export function read(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    if (value === '' || value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* opslag niet beschikbaar: voorkeur gaat verloren, app werkt door */ }
}

export function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** Verwijdert de grote POC-cache (GitHub-ETags en teamdata); die is nu server-side. */
export function purgeLegacyCache() {
  try {
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('glr_beroeps2_etag_v1:') || key === 'glr_beroeps2_team_cache_v1')) stale.push(key);
    }
    stale.forEach(key => localStorage.removeItem(key));
  } catch { /* negeren */ }
}
