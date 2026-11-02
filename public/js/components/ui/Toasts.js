import { html } from '../../lib/vue.js';
import { ui, dismissToast } from '../../store/ui.js';
import Icon from './Icon.js';

export default {
  name: 'Toasts',
  setup() {
    return () => html`
      <div class="toast-stack" role="status" aria-live="polite">
        ${ui.toasts.map(t => html`
          <div key=${t.id} class=${`toast ${t.kind}`}>
            <span>${t.message}</span>
            <button type="button" class="btn btn-ghost btn-sm" aria-label="Sluiten" onClick=${() => dismissToast(t.id)}>
              <${Icon} name="x" />
            </button>
          </div>
        `)}
      </div>
    `;
  },
};
