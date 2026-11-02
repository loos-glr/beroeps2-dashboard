import { STORAGE_KEYS, readJson, hasToken } from './storage.js';

/**
 * ============================================================================
 * TWEELAAGSE CACHE (lokaal in de browser)
 * ============================================================================
 * Laag 1: geparseerde teamdata per repo, geldig zolang jonger dan de TTL.
 * Laag 2: per GitHub API-URL de laatste ETag + body, voor `If-None-Match`
 *         requests (een 304 telt niet mee voor de rate limit).
 *
 * Studentnamen en samengevoegde accounts worden NIET gecachet: die worden na
 * het laden altijd opnieuw toegepast op `rawMembers`.
 */

export const DEFAULT_CACHE_TTL_MIN = 10;
export const CACHE_TTL_OPTIONS = [0, 5, 10, 30, 60];

/* ===== TTL ===== */
export function getCacheTtlMinutes() {
  const raw = localStorage.getItem(STORAGE_KEYS.CACHE_TTL);
  const value = raw === null ? DEFAULT_CACHE_TTL_MIN : Number(raw);
  return CACHE_TTL_OPTIONS.includes(value) ? value : DEFAULT_CACHE_TTL_MIN;
}

export function setCacheTtlMinutes(minutes) {
  const value = Number(minutes);
  if (!CACHE_TTL_OPTIONS.includes(value)) return;
  safeSetItem(STORAGE_KEYS.CACHE_TTL, String(value));
}

/* ===== Veilig schrijven met opruimen bij een vol opslagquotum ===== */
function isQuotaError(e) {
  return e instanceof DOMException && (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 || e.code === 1014
  );
}

function getEtagKeysOldestFirst() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_KEYS.ETAG_PREFIX)) {
      keys.push({ key, storedAt: readJson(key, {}).storedAt || 0 });
    }
  }
  return keys.sort((a, b) => a.storedAt - b.storedAt).map(k => k.key);
}

// Verwijdert ~een kwart (minimaal 1) van de oudste ETag-entries; false als er niets meer is
function evictOldestEtags(exceptKey) {
  const keys = getEtagKeysOldestFirst().filter(k => k !== exceptKey);
  if (keys.length === 0) return false;
  keys.slice(0, Math.max(1, Math.ceil(keys.length / 4))).forEach(k => localStorage.removeItem(k));
  return true;
}

// Verwijdert het oudste team uit de teamcache; false als die leeg is
function evictOldestTeamEntry() {
  const cache = readJson(STORAGE_KEYS.TEAM_CACHE, {});
  const oldest = Object.keys(cache).sort((a, b) => cache[a].fetchedAt - cache[b].fetchedAt)[0];
  if (!oldest) return false;
  delete cache[oldest];
  try {
    localStorage.setItem(STORAGE_KEYS.TEAM_CACHE, JSON.stringify(cache));
  } catch (e) {
    localStorage.removeItem(STORAGE_KEYS.TEAM_CACHE);
  }
  return true;
}

/**
 * Schrijft naar localStorage. Bij ruimtegebrek worden eerst de oudste
 * ETag-entries en daarna de oudste teamcache-entries opgeruimd.
 * Geeft false terug als het uiteindelijk niet lukt; de app werkt dan gewoon
 * verder, alleen zonder (deze) cache.
 */
export function safeSetItem(key, value) {
  for (;;) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) return false;
      const freed = evictOldestEtags(key) || (key !== STORAGE_KEYS.TEAM_CACHE && evictOldestTeamEntry());
      if (!freed) return false;
    }
  }
}

/* ===== Laag 1: teamdata per repo ===== */
const repoKey = repo => String(repo).toLowerCase();

export function readTeamCache(repo) {
  return readJson(STORAGE_KEYS.TEAM_CACHE, {})[repoKey(repo)] || null;
}

export function isFresh(entry) {
  if (!entry || !entry.data || entry.auth !== hasToken()) return false;
  return Date.now() - entry.fetchedAt < getCacheTtlMinutes() * 60 * 1000;
}

// Bewaart alleen de ruwe, alias-onafhankelijke teamdata
export function writeTeamCache(repo, data, fetchedAt = Date.now()) {
  const { teamName, members, ...cacheable } = data;
  const cache = readJson(STORAGE_KEYS.TEAM_CACHE, {});
  cache[repoKey(repo)] = { fetchedAt, auth: hasToken(), data: cacheable };

  // Lukt het niet met alle teams, ruim dan oudere teams op en probeer opnieuw
  while (!safeSetItem(STORAGE_KEYS.TEAM_CACHE, JSON.stringify(cache))) {
    const others = Object.keys(cache).filter(k => k !== repoKey(repo));
    if (others.length === 0) return false;
    const oldest = others.sort((a, b) => cache[a].fetchedAt - cache[b].fetchedAt)[0];
    delete cache[oldest];
  }
  return true;
}

// Ruimt teams op die niet meer in de configuratie staan
export function pruneTeamCache(activeRepos) {
  const cache = readJson(STORAGE_KEYS.TEAM_CACHE, {});
  const keep = new Set(activeRepos.map(repoKey));
  const stale = Object.keys(cache).filter(k => !keep.has(k));
  if (stale.length === 0) return;
  stale.forEach(k => delete cache[k]);
  safeSetItem(STORAGE_KEYS.TEAM_CACHE, JSON.stringify(cache));
}

/* ===== Laag 2: ETag + body per API-URL ===== */
// Fallback voor als localStorage vol of niet beschikbaar is (geldt alleen deze sessie)
const memoryEtags = new Map();

export function readEtagEntry(url) {
  return memoryEtags.get(url) || readJson(STORAGE_KEYS.ETAG_PREFIX + url, null);
}

export function writeEtagEntry(url, etag, body) {
  const entry = { etag, body, storedAt: Date.now() };
  if (safeSetItem(STORAGE_KEYS.ETAG_PREFIX + url, JSON.stringify(entry))) {
    memoryEtags.delete(url);
  } else {
    memoryEtags.set(url, entry);
  }
}

/* ===== Alles legen ===== */
export function clearAllCaches() {
  memoryEtags.clear();
  localStorage.removeItem(STORAGE_KEYS.TEAM_CACHE);
  getEtagKeysOldestFirst().forEach(k => localStorage.removeItem(k));
}
