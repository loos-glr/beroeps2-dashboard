import { html, ref } from '../lib/vue.js';
import { KEYS, read, write } from '../util/storage.js';
import { dashboard, load } from '../store/dashboard.js';
import Modal from './ui/Modal.js';

export default {
  name: 'TokenModal',
  emits: ['close'],
  setup(props, { emit }) {
    const token = ref(read(KEYS.GH_TOKEN));
    const save = value => {
      write(KEYS.GH_TOKEN, value.trim());
      emit('close');
      load({ force: true });
    };
    return () => html`
      <${Modal} size="narrow" title="GitHub-token" titleId="tokenTitle" subtitle="Leesrechten volstaan. Zo zie je ook studenten met 0 commits." onClose=${() => emit('close')}>
        <div class="modal-body">
          ${dashboard.github?.authMode === 'env'
            ? html`<p class="callout">De server gebruikt al een eigen token; dit lokale token wordt genegeerd.</p>` : null}
          <div>
            <label class="lbl" for="tokenInput">Persoonlijk fallback-token</label>
            <p class="help">Wordt alleen in deze browser bewaard en per request als <code>X-GitHub-Token</code> naar jouw eigen server gestuurd.</p>
            <input id="tokenInput" type="password" class="input mono" placeholder="ghp_… of github_pat_…" autocomplete="off"
              value=${token.value} onInput=${e => { token.value = e.target.value; }} />
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost btn-sm btn-danger" onClick=${() => save('')}>Wissen</button>
          <div class="group">
            <button type="button" class="btn" onClick=${() => emit('close')}>Sluiten</button>
            <button type="button" class="btn btn-primary" onClick=${() => save(token.value)}>Opslaan</button>
          </div>
        </div>
      <//>`;
  },
};
