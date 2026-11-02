import { html } from '../lib/vue.js';
import ContextForm from './ContextForm.js';

/** variant: 'no-contexts' | 'no-teams' | 'no-attention' (acties volgen in 4c/4e via slots/props) */
export default {
  name: 'EmptyState',
  props: { variant: { type: String, required: true } },
  setup(props, { slots }) {
    return () => {
      if (props.variant === 'no-contexts') {
        return html`
          <div class="placeholder welcome">
            <h2>Welkom! Maak je eerste klas aan om te beginnen.</h2>
            <p>Een klas combineert schooljaar, vak en klas. Daarna voeg je teams toe of importeer je een export van het oude dashboard.</p>
            <${ContextForm} inline=${true} />
            ${slots.default?.()}
          </div>`;
      }
      if (props.variant === 'no-attention') {
        return html`<div class="placeholder"><h2>Geen aandachtspunten</h2><p>Iedereen is op koers.</p></div>`;
      }
      return html`
        <div class="placeholder">
          <h2>Nog geen teams in deze klas</h2>
          <p>Voeg teams toe, haal ze op via GitHub of importeer een .json-export.</p>
          <div class="row">${slots.default?.()}</div>
        </div>`;
    };
  },
};
