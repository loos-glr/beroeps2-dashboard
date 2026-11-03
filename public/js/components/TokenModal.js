import { html, ref } from '../lib/vue.js';
import { api } from '../api.js';
import { KEYS, read, write } from '../util/storage.js';
import { dashboard, load, refreshAll } from '../store/dashboard.js';
import { toast } from '../store/ui.js';
import Modal from './ui/Modal.js';

export default {
  name: 'TokenModal',
  emits: ['close'],
  setup(props, { emit }) {
    const token = ref(read(KEYS.GH_TOKEN));
    const accounts = ref([]);
    const newAccounts = ref('');
    const accountsError = ref('');

    api.excludedAccounts.list()
      .then(res => { accounts.value = res.accounts; })
      .catch(err => { accountsError.value = err.message; });

    async function saveAccounts(next) {
      try {
        const res = await api.excludedAccounts.save(next.filter(a => a.source === 'db').map(a => a.identifier));
        accounts.value = res.accounts;
        accountsError.value = '';
        load();
      } catch (err) {
        toast(err.message, 'bad');
      }
    }
    function addAccounts() {
      const known = new Set(accounts.value.map(a => a.identifier));
      const added = newAccounts.value.split(/[\s,;]+/)
        .map(v => v.replace(/^@/, '').trim().toLowerCase())
        .filter(v => v && !known.has(v));
      newAccounts.value = '';
      if (added.length) saveAccounts([...accounts.value, ...[...new Set(added)].map(identifier => ({ identifier, source: 'db' }))]);
    }
    const removeAccount = identifier => saveAccounts(accounts.value.filter(a => a.identifier !== identifier));

    const save = value => {
      write(KEYS.GH_TOKEN, value.trim());
      emit('close');
      refreshAll();
    };
    return () => html`
      <${Modal} size="narrow" title="Token & uitgesloten accounts" titleId="tokenTitle" subtitle="Leesrechten volstaan. Zo zie je ook studenten met 0 commits." onClose=${() => emit('close')}>
        <div class="modal-body">
          ${dashboard.github?.authMode === 'env'
            ? html`<p class="callout">De server gebruikt al een eigen token; dit lokale token wordt genegeerd.</p>` : null}
          <div>
            <label class="lbl" for="tokenInput">Persoonlijk fallback-token</label>
            <p class="help">Wordt alleen in deze browser bewaard en per request als <code>X-GitHub-Token</code> naar jouw eigen server gestuurd.</p>
            <input id="tokenInput" type="password" class="input mono" placeholder="ghp_… of github_pat_…" autocomplete="off"
              value=${token.value} onInput=${e => { token.value = e.target.value; }} />
          </div>
          <div>
            <label class="lbl" for="excludeInput">Uitgesloten GitHub-accounts</label>
            <p class="help">Deze accounts (jouw docent-account, een tweede account, collega's) tellen nergens mee en verschijnen niet als student. Meerdere tegelijk: scheid met komma of spatie.</p>
            ${accountsError.value ? html`<p class="help">${accountsError.value}</p>` : null}
            <div class="chip-select-list">
              ${accounts.value.map(a => html`<span key=${a.identifier} class="chip">
                <b>${a.identifier}</b>${a.source === 'env'
                  ? html`<small title="Ingesteld via TEACHER_GITHUB_USERNAME in .env">via .env</small>`
                  : html`<button type="button" class="btn btn-ghost btn-sm" aria-label=${`${a.identifier} niet meer uitsluiten`}
                      onClick=${() => removeAccount(a.identifier)}>×</button>`}
              </span>`)}
            </div>
            <div class="field">
              <input id="excludeInput" type="text" class="input mono" placeholder="bijv. docent-glr, docent-glr-2" autocomplete="off"
                value=${newAccounts.value} onInput=${e => { newAccounts.value = e.target.value; }}
                onKeydown=${e => { if (e.key === 'Enter') { e.preventDefault(); addAccounts(); } }} />
              <button type="button" class="btn btn-sm" onClick=${addAccounts}>Toevoegen</button>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost btn-sm btn-danger" onClick=${() => save('')}>Token wissen</button>
          <div class="group">
            <button type="button" class="btn" onClick=${() => emit('close')}>Sluiten</button>
            <button type="button" class="btn btn-primary" onClick=${() => save(token.value)}>Token opslaan</button>
          </div>
        </div>
      <//>`;
  },
};
