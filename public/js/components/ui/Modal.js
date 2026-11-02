import { html, Teleport, onMounted, onBeforeUnmount } from '../../lib/vue.js';
import Icon from './Icon.js';

// Escape sluit alleen de bovenste modal
const stack = [];
let listening = false;
function onKey(e) {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
}

/**
 * <${Modal} title="…" subtitle="…" size="narrow|wide" onClose=${fn}>${body}<//>
 * Footer als named slot: ${{ default: () => body, footer: () => foot }}
 */
export default {
  name: 'Modal',
  props: { title: String, subtitle: String, size: { type: String, default: '' }, titleId: { type: String, default: 'modalTitle' } },
  emits: ['close'],
  setup(props, { emit, slots }) {
    const entry = { close: () => emit('close') };
    let opener = null;
    let panel = null;

    onMounted(() => {
      opener = document.activeElement;
      stack.push(entry);
      if (!listening) { window.addEventListener('keydown', onKey); listening = true; }
      const target = panel?.querySelector('[autofocus], input, textarea, select, button:not(.modal-close)') ?? panel;
      target?.focus();
    });
    onBeforeUnmount(() => {
      stack.splice(stack.indexOf(entry), 1);
      if (!stack.length) { window.removeEventListener('keydown', onKey); listening = false; }
      if (opener && document.contains(opener)) opener.focus();
    });

    return () => html`
      <${Teleport} to="body">
        <div class="overlay open" onMousedown=${e => { if (e.target === e.currentTarget) emit('close'); }}>
          <div class=${`modal ${props.size}`} role="dialog" aria-modal="true" aria-labelledby=${props.titleId} tabindex="-1" ref=${el => { panel = el; }}>
            <div class="modal-head">
              <div>
                <h2 id=${props.titleId}>${props.title}</h2>
                ${props.subtitle ? html`<p>${props.subtitle}</p>` : null}
              </div>
              <button type="button" class="btn btn-ghost btn-sm modal-close" aria-label="Sluiten" onClick=${() => emit('close')}><${Icon} name="x" /></button>
            </div>
            ${slots.default?.()}
            ${slots.footer ? html`<div class="modal-foot">${slots.footer()}</div>` : null}
          </div>
        </div>
      <//>
    `;
  },
};
