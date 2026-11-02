import { html } from '../lib/vue.js';
import { session, bootstrap, logout, onAuthenticated, onSignedOut } from '../store/session.js';
import { contexts, load as loadContexts, reset as resetContexts } from '../store/contexts.js';
import ContextBar from './ContextBar.js';
import EmptyState from './EmptyState.js';
import LoginView from './LoginView.js';
import Toasts from './ui/Toasts.js';
import Icon from './ui/Icon.js';

onAuthenticated(loadContexts);
onSignedOut(resetContexts);

// Tijdelijke shell (4a): header met gebruiker en uitloggen. Contextbalk en dashboard volgen in 4b/4c.
function Shell() {
  const who = session.user?.display_name ?? 'Docent';
  const shared = session.user?.auth_method === 'shared';
  return html`
    <header class="topbar">
      <div class="wrap topbar-inner">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">B2</div>
          <div>
            <h1>BEROEPS2 · GitHub Flow</h1>
            <p>Grafisch Lyceum Rotterdam</p>
          </div>
        </div>
        <div class="actions">
          <span class="user-label">${who}${shared ? ' (gedeeld account)' : ''}</span>
          <button type="button" class="btn" onClick=${logout}><${Icon} name="logout" />Uitloggen</button>
        </div>
      </div>
    </header>
    ${contexts.list.length ? html`<${ContextBar} />` : null}
    <div class="wrap"><main class="teams">${contexts.list.length
      ? html`<div class="placeholder"><h2>Klas gekozen</h2><p>Het dashboard volgt in de volgende stap.</p></div>`
      : html`<${EmptyState} variant="no-contexts" />`}</main></div>
  `;
}

export default {
  name: 'App',
  setup() {
    return () => {
      let body;
      if (session.status === 'booting') {
        body = html`<div class="loading" role="status">Laden…</div>`;
      } else if (session.status === 'offline') {
        body = html`
          <div class="placeholder">
            <h2>API niet bereikbaar</h2>
            <p>${session.error}</p>
            <div class="row"><button type="button" class="btn btn-primary" onClick=${bootstrap}>Opnieuw proberen</button></div>
          </div>`;
      } else if (session.status === 'anonymous') {
        body = html`<${LoginView} />`;
      } else {
        body = Shell();
      }
      return html`<div class="app">${body}<${Toasts} /></div>`;
    };
  },
};
