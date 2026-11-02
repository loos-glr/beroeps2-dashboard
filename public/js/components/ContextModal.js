import { html } from '../lib/vue.js';
import Modal from './ui/Modal.js';
import ContextForm from './ContextForm.js';

export default {
  name: 'ContextModal',
  props: { context: { type: Object, default: null } },
  emits: ['close'],
  setup(props, { emit }) {
    return () => html`
      <${Modal} size="narrow" titleId="ctxTitle" onClose=${() => emit('close')}
        title=${props.context ? 'Klas bewerken' : 'Nieuwe klas / projectvak'}
        subtitle="Een klas is de combinatie schooljaar + vak + klas.">
        <${ContextForm} context=${props.context} onSaved=${() => emit('close')} onCancel=${() => emit('close')} />
      <//>
    `;
  },
};
