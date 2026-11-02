import { html, ref } from '../../lib/vue.js';
import Modal from '../ui/Modal.js';
import TeamsTab from './TeamsTab.js';
import StudentsTab from './StudentsTab.js';
import ImportExportTab from './ImportExportTab.js';

const TABS = [['teams', 'Teams'], ['students', 'Studenten'], ['import', 'Import & Export']];

export default {
  name: 'ManageModal',
  props: { tab: { type: String, default: 'teams' }, autoDiscover: Boolean, legacy: Boolean },
  emits: ['close'],
  setup(props, { emit }) {
    const tab = ref(props.tab);
    return () => html`
      <${Modal} title="Beheer" titleId="manageTitle" subtitle="Teams, studenten en JSON-import voor de gekozen klas." onClose=${() => emit('close')}>
        <div class="tabs" role="tablist">
          ${TABS.map(([id, label]) => html`<button key=${id} type="button" role="tab" class=${`tab ${tab.value === id ? 'active' : ''}`}
            aria-selected=${tab.value === id ? 'true' : 'false'} onClick=${() => { tab.value = id; }}>${label}</button>`)}
        </div>
        ${tab.value === 'teams' ? html`<${TeamsTab} autoDiscover=${props.autoDiscover} onClose=${() => emit('close')} />`
          : tab.value === 'students' ? html`<${StudentsTab} />` : html`<${ImportExportTab} legacy=${props.legacy} />`}
        <div class="modal-foot"><span></span><button type="button" class="btn btn-primary" onClick=${() => emit('close')}>Sluiten</button></div>
      <//>`;
  },
};
