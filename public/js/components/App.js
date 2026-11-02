import { html } from '../lib/vue.js';
import { session, bootstrap, onAuthenticated, onSignedOut } from '../store/session.js';
import { contexts, load as loadContexts, reset as resetContexts } from '../store/contexts.js';
import { clear as clearDashboard } from '../store/dashboard.js';
import { ui, closeModal } from '../store/ui.js';
import LoginView from './LoginView.js';
import AppHeader from './AppHeader.js';
import ContextBar from './ContextBar.js';
import DashboardView from './DashboardView.js';
import EmptyState from './EmptyState.js';
import Toasts from './ui/Toasts.js';

onAuthenticated(loadContexts);
onSignedOut(() => { resetContexts(); clearDashboard(); closeModal(); });

/** Modals per type; komen binnen met 4d/4e. */
const MODALS = {};

function Shell() {
  const Modal = ui.modal ? MODALS[ui.modal.type] : null;
  return html`
    <${AppHeader} />
    ${contexts.loaded && contexts.list.length ? html`<${ContextBar} />` : null}
    ${!contexts.loaded
      ? html`<div class="loading" role="status">Klassen laden…</div>`
      : contexts.list.length
        ? html`<${DashboardView} />`
        : html`<div class="wrap"><main class="teams"><${EmptyState} variant="no-contexts" /></main></div>`}
    ${Modal ? html`<${Modal} ...${ui.modal} onClose=${closeModal} />` : null}
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
export { MODALS };
