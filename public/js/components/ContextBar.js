import { html, ref } from '../lib/vue.js';
import { contexts, selected, years, coursesOf, classesOf, selectYear, selectCourse, select } from '../store/contexts.js';
import ContextModal from './ContextModal.js';
import Icon from './ui/Icon.js';

export default {
  name: 'ContextBar',
  setup() {
    const modal = ref(null); // null | 'new' | 'edit'

    return () => {
      const cur = selected.value;
      const year = cur?.schoolYear;
      const course = cur?.courseCode;
      return html`
        <div class="context-bar">
          <div class="wrap context-bar-inner">
            <label class="field"><span>Schooljaar</span>
              <select class="select" aria-label="Schooljaar" onChange=${e => selectYear(e.target.value)}>
                ${years.value.map(y => html`<option key=${y} value=${y} selected=${y === year}>${y}</option>`)}
              </select>
            </label>
            <label class="field"><span>Vak</span>
              <select class="select" aria-label="Vak" onChange=${e => selectCourse(year, e.target.value)}>
                ${coursesOf(year).map(v => html`<option key=${v} value=${v} selected=${v === course}>${v}</option>`)}
              </select>
            </label>
            <label class="field"><span>Klas</span>
              <select class="select" aria-label="Klas" onChange=${e => select(Number(e.target.value))}>
                ${classesOf(year, course).map(k => html`<option key=${k.id} value=${k.id} selected=${k.id === contexts.selectedId}>${k.className}${k.teamCount != null ? ` · ${k.teamCount} ${k.teamCount === 1 ? 'team' : 'teams'}` : ''}</option>`)}
              </select>
            </label>
            <button type="button" class="btn btn-ghost btn-sm" title="Klas bewerken" aria-label="Klas bewerken" onClick=${() => { modal.value = 'edit'; }}><${Icon} name="settings" /></button>
            <button type="button" class="btn btn-sm" onClick=${() => { modal.value = 'new'; }}><${Icon} name="plus" />Nieuwe klas / projectvak</button>
          </div>
        </div>
        ${modal.value ? html`<${ContextModal} context=${modal.value === 'edit' ? cur : null} onClose=${() => { modal.value = null; }} />` : null}
      `;
    };
  },
};
