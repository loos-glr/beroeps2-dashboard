import { reactive } from '../lib/vue.js';
import { api, onUnauthorized, setCsrfToken, ApiError } from '../api.js';
import { toast } from './ui.js';

/** status: 'booting' | 'anonymous' | 'authenticated' | 'offline' */
export const session = reactive({
  status: 'booting',
  user: null,
  error: '',
  submitting: false,
});

/** Callbacks die na (her)inloggen draaien, bijv. klassen en dashboard laden. */
const afterLoginHooks = [];
const onLogoutHooks = [];
export const onAuthenticated = fn => afterLoginHooks.push(fn);
export const onSignedOut = fn => onLogoutHooks.push(fn);

async function enter(user, csrfToken) {
  setCsrfToken(csrfToken);
  session.user = user;
  session.error = '';
  session.status = 'authenticated';
  for (const fn of afterLoginHooks) await fn();
}

function leave() {
  setCsrfToken('');
  session.user = null;
  session.status = 'anonymous';
  onLogoutHooks.forEach(fn => fn());
}

export async function bootstrap() {
  session.status = 'booting';
  try {
    const me = await api.auth.me();
    if (me.authenticated) await enter(me.user, me.csrfToken);
    else leave();
  } catch (err) {
    session.error = err instanceof ApiError ? err.message : 'API niet bereikbaar';
    session.status = 'offline';
  }
}

export async function login(email, password) {
  session.submitting = true;
  session.error = '';
  try {
    const res = await api.auth.login(email.trim(), password);
    await enter(res.user, res.csrfToken);
  } catch (err) {
    session.error = err instanceof ApiError ? err.message : 'Inloggen mislukt';
  } finally {
    session.submitting = false;
  }
}

export async function logout() {
  try {
    await api.auth.logout();
  } catch { /* sessie is dan al weg */ }
  leave();
}

// Centrale 401: direct terug naar het inlogscherm
onUnauthorized(() => {
  if (session.status !== 'authenticated') return;
  leave();
  toast('Je sessie is verlopen, log opnieuw in.', 'warn');
});
