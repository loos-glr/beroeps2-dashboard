import { KEYS, read } from './util/storage.js';

/**
 * Centrale API-client. Alle requests gaan hierlangs: cookies, CSRF, optioneel
 * GitHub-fallbacktoken en gecentraliseerde 401-afhandeling.
 */

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

const BASE = new URL('api/', document.baseURI);
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

let csrfToken = '';
const unauthorizedListeners = new Set();

export const setCsrfToken = token => { csrfToken = token || ''; };

/** Registreert een callback voor elke 401 (behalve bij inloggen). Geeft een afmeldfunctie terug. */
export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

function buildUrl(path, query) {
  const url = new URL(path.replace(/^\//, ''), BASE);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function send(path, { method, body, query, signal }) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const ghToken = read(KEYS.GH_TOKEN).trim();
  if (ghToken) headers['X-GitHub-Token'] = ghToken;

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'API niet bereikbaar');
  }

  let data = null;
  try {
    data = await res.json();
  } catch { /* lege of niet-JSON body */ }

  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Onbekende fout (status ${res.status})`, data);
  return data;
}

export async function request(path, { method = 'GET', body, query, signal } = {}) {
  const opts = { method, body, query, signal };
  try {
    return await send(path, opts);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;

    // Verlopen CSRF-token: één keer opnieuw ophalen en herhalen
    if (err.status === 403 && /csrf/i.test(err.message) && path !== 'auth/me') {
      const me = await send('auth/me', { method: 'GET' });
      if (me?.authenticated) {
        setCsrfToken(me.csrfToken);
        return send(path, opts);
      }
    }
    if (err.status === 401 && path !== 'auth/login') {
      unauthorizedListeners.forEach(fn => fn(err));
    }
    throw err;
  }
}

const get = (path, query, signal) => request(path, { query, signal });
const post = (path, body, query) => request(path, { method: 'POST', body: body ?? {}, query });
const patch = (path, body) => request(path, { method: 'PATCH', body });
const del = path => request(path, { method: 'DELETE' });

export const api = {
  auth: {
    me: () => get('auth/me'),
    login: (email, password) => post('auth/login', email ? { email, password } : { password }),
    logout: () => post('auth/logout'),
  },
  contexts: {
    list: () => get('contexts'),
    create: body => post('contexts', body),
    update: (id, body) => patch(`contexts/${id}`, body),
    dashboard: (id, { force = false, period = 'all', sync = true, signal } = {}) =>
      get(`contexts/${id}/dashboard`, { force: force ? 1 : 0, period, sync: sync ? 1 : 0 }, signal),
    importJson: (id, payload, dryRun) => post(`contexts/${id}/import-json`, payload, { dryRun: dryRun ? 1 : 0 }),
  },
  teams: {
    create: body => post('teams', body),
    update: (id, body) => patch(`teams/${id}`, body),
    remove: id => del(`teams/${id}`),
    refresh: (id, period = 'all') => post(`teams/${id}/refresh`, {}, { period }),
  },
  students: {
    list: (q = '') => get('students', { q }),
    saveIdentity: body => post('students/identity', body),
    remove: id => del(`students/${id}`),
  },
  github: {
    rateLimit: () => get('github/rate-limit'),
    collaboratorRepos: contextId => get('github/collaborator-repos', { contextId }),
  },
};
