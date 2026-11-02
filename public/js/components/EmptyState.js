import { html } from '../lib/vue.js';
import ContextForm from './ContextForm.js';
import { openModal } from '../store/ui.js';
import { readLegacyConfig } from '../util/storage.js';
import Icon from './ui/Icon.js';

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
            ${readLegacyConfig() ? html`<p class="help">In deze browser staat nog data van het oude dashboard; die kun je na het aanmaken van de klas importeren.</p>` : null}
            ${slots.default?.()}
          </div>`;
      }
      if (props.variant === 'no-attention') {
        return html`<div class="placeholder"><h2>Geen aandachtspunten</h2><p>Iedereen is op koers.</p></div>`;
      }
      const legacy = readLegacyConfig();
      return html`
        <div class="placeholder">
          <h2>Nog geen teams in deze klas</h2>
          <p>Voeg teams toe, haal ze op via GitHub of importeer een .json-export.</p>
          <div class="row">
            <button type="button" class="btn btn-primary" onClick=${() => openModal('manage', { tab: 'teams' })}><${Icon} name="plus" />Teams toevoegen</button>
            <button type="button" class="btn" onClick=${() => openModal('manage', { tab: 'teams', autoDiscover: true })}><${Icon} name="search" />Ophalen via GitHub</button>
            <button type="button" class="btn" onClick=${() => openModal('manage', { tab: 'import' })}><${Icon} name="upload" />Importeer .json</button>
          </div>
          ${legacy ? html`<p class="help legacy-hint">Gevonden in deze browser: ${legacy.teams} teams, ${legacy.aliases} studentnamen uit het oude dashboard.
            <button type="button" class="btn btn-sm" onClick=${() => openModal('manage', { tab: 'import', legacy: true })}>Importeer in deze klas</button></p>` : null}
        </div>`;
    };
  },
};
