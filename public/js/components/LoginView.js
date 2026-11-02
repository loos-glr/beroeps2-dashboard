import { html, ref } from '../lib/vue.js';
import { session, login } from '../store/session.js';
import Icon from './ui/Icon.js';

export default {
  name: 'LoginView',
  setup() {
    const email = ref('');
    const password = ref('');

    const submit = event => {
      event.preventDefault();
      if (!password.value || session.submitting) return;
      login(email.value, password.value);
    };

    return () => html`
      <div class="login-shell">
        <form class="login-card" onSubmit=${submit}>
          <div class="brand">
            <div class="brand-mark" aria-hidden="true">B2</div>
            <div>
              <h1>BEROEPS2 · GitHub Flow</h1>
              <p>Grafisch Lyceum Rotterdam</p>
            </div>
          </div>

          <div>
            <label class="lbl" for="loginEmail">E-mailadres (optioneel)</label>
            <input id="loginEmail" class="input" type="email" autocomplete="username" placeholder="docent@glr.nl"
              value=${email.value} onInput=${e => { email.value = e.target.value; }} />
            <p class="help help-tight">Laat leeg om in te loggen met het gedeelde teamwachtwoord.</p>
          </div>

          <div>
            <label class="lbl" for="loginPassword">Wachtwoord</label>
            <input id="loginPassword" class="input" type="password" autocomplete="current-password" required
              value=${password.value} onInput=${e => { password.value = e.target.value; }} />
          </div>

          ${session.error ? html`<p class="msg-bad" role="alert">${session.error}</p>` : null}

          <button type="submit" class="btn btn-primary btn-block" disabled=${session.submitting || !password.value}>
            <${Icon} name="key" />${session.submitting ? 'Bezig met inloggen…' : 'Inloggen'}
          </button>

          <div class="divider-or"><span>of</span></div>

          <button type="button" class="btn btn-block" disabled aria-disabled="true"
            title="Microsoft SSO wordt binnenkort gekoppeld">
            Inloggen met GLR Microsoft-account (Binnenkort)
          </button>
        </form>
      </div>
    `;
  },
};
