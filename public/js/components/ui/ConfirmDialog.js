import { html } from '../../lib/vue.js';
import Modal from './Modal.js';

export default {
  name: 'ConfirmDialog',
  props: { title: String, message: String, confirmLabel: { type: String, default: 'Bevestigen' }, danger: Boolean },
  emits: ['confirm', 'cancel'],
  setup(props, { emit }) {
    return () => html`
      <${Modal} size="narrow" title=${props.title} titleId="confirmTitle" onClose=${() => emit('cancel')}>
        <div class="modal-body"><p>${props.message}</p></div>
        <div class="modal-foot">
          <span></span>
          <div class="group">
            <button type="button" class="btn" onClick=${() => emit('cancel')}>Annuleren</button>
            <button type="button" class=${`btn ${props.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick=${() => emit('confirm')}>${props.confirmLabel}</button>
          </div>
        </div>
      <//>`;
  },
};
