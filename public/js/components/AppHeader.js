import { html } from '../lib/vue.js';
import { session, logout } from '../store/session.js';
import { dashboard, load } from '../store/dashboard.js';
import { contexts } from '../store/contexts.js';
import Icon from './ui/Icon.js';

export default {
  name: 'AppHeader',
  setup(props, { slots }) {
    return () => {
      const who = session.user?.display_name ?? 'Docent';
      const shared = session.user?.auth_method === 'shared';
      return html`
        <header class="topbar">
          <div class="wrap topbar-inner">
            <div class="brand">
              <div class="brand-mark" aria-hidden="true">B2</div>
              <div><h1>BEROEPS2 · GitHub Flow</h1><p>Grafisch Lyceum Rotterdam</p></div>
            </div>
            <div class="actions">
              ${contexts.selectedId ? html`
                <button type="button" class=${`btn btn-primary ${dashboard.loading ? 'spin' : ''}`} disabled=${dashboard.loading}
                  title="Haalt alle teams opnieuw op bij GitHub (ETag-revalidatie; 304-antwoorden tellen niet mee voor de rate limit)"
                  onClick=${() => load({ force: true })}><${Icon} name="refresh" />Data verversen</button>` : null}
              ${slots.default?.()}
              <span class="user-label">${who}${shared ? ' (gedeeld account)' : ''}</span>
              <button type="button" class="btn btn-ghost" onClick=${logout}><${Icon} name="logout" />Uitloggen</button>
            </div>
          </div>
        </header>`;
    };
  },
};
