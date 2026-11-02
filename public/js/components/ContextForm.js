import { html, ref, computed } from '../lib/vue.js';
import { ApiError } from '../api.js';
import { contexts, create, update, select } from '../store/contexts.js';
import { currentSchoolYear } from '../util/format.js';

const TTL_OPTIONS = [0, 5, 10, 30, 60];

/** Formulier voor een nieuwe of bestaande klas. `inline` = zonder modal-footer-stijl (welkomstkaart). */
export default {
  name: 'ContextForm',
  props: { context: { type: Object, default: null }, inline: Boolean },
  emits: ['saved', 'cancel'],
  setup(props, { emit }) {
    const c = props.context;
    const schoolYear = ref(c?.schoolYear ?? currentSchoolYear());
    const courseCode = ref(c?.courseCode ?? 'BEROEPS2');
    const className = ref(c?.className ?? '');
    const threshold = ref(c?.inactivityThresholdDays ?? 7);
    const ttl = ref(c?.cacheTtlMinutes ?? 10);
    const error = ref('');
    const existingId = ref(null);
    const busy = ref(false);

    const courses = computed(() => [...new Set(contexts.list.map(x => x.courseCode))]);

    function validate() {
      const m = /^(\d{4})-(\d{4})$/.exec(schoolYear.value.trim());
      if (!m || Number(m[2]) !== Number(m[1]) + 1) return 'Schooljaar moet de vorm 2026-2027 hebben.';
      if (!/^[A-Z0-9_-]{1,32}$/.test(courseCode.value)) return 'Vak mag alleen letters, cijfers, - en _ bevatten.';
      if (!className.value.trim()) return 'Vul een klas in.';
      const days = Number(threshold.value);
      if (!Number.isInteger(days) || days < 1 || days > 365) return 'Inactief na: 1 t/m 365 dagen.';
      return '';
    }

    async function submit(event) {
      event.preventDefault();
      error.value = validate();
      existingId.value = null;
      if (error.value || busy.value) return;
      busy.value = true;
      const body = {
        schoolYear: schoolYear.value.trim(),
        courseCode: courseCode.value,
        className: className.value.trim().toUpperCase(),
        inactivityThresholdDays: Number(threshold.value),
        cacheTtlMinutes: Number(ttl.value),
      };
      try {
        const saved = c ? await update(c.id, body) : await create(body);
        emit('saved', saved);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          error.value = 'Deze klas bestaat al voor dit schooljaar en vak.';
          existingId.value = contexts.list.find(x =>
            x.schoolYear === body.schoolYear && x.courseCode === body.courseCode && x.className === body.className)?.id ?? null;
        } else {
          error.value = err.message;
        }
      } finally {
        busy.value = false;
      }
    }

    return () => html`
      <form onSubmit=${submit}>
        <div class=${props.inline ? 'form-stack' : 'modal-body'}>
          <div class="form-row">
            <div>
              <label class="lbl" for="ctxYear">Schooljaar</label>
              <input id="ctxYear" class="input mono" value=${schoolYear.value} placeholder="2026-2027" autofocus
                onInput=${e => { schoolYear.value = e.target.value; }} />
            </div>
            <div>
              <label class="lbl" for="ctxCourse">Vak / projectvak</label>
              <input id="ctxCourse" class="input mono" list="ctxCourses" value=${courseCode.value}
                onInput=${e => { courseCode.value = e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''); e.target.value = courseCode.value; }} />
              <datalist id="ctxCourses">${courses.value.map(v => html`<option key=${v} value=${v}></option>`)}</datalist>
            </div>
            <div>
              <label class="lbl" for="ctxClass">Klas</label>
              <input id="ctxClass" class="input mono" maxlength="16" value=${className.value} placeholder="D2B"
                onInput=${e => { className.value = e.target.value.toUpperCase(); e.target.value = className.value; }} />
            </div>
          </div>
          <div class="form-row two">
            <div>
              <label class="lbl" for="ctxDays">Inactief na (dagen)</label>
              <input id="ctxDays" class="input mono" type="number" min="1" max="365" value=${threshold.value}
                onInput=${e => { threshold.value = e.target.value; }} />
            </div>
            <div>
              <label class="lbl" for="ctxTtl">Cache (minuten)</label>
              <select id="ctxTtl" class="select" value=${ttl.value} onChange=${e => { ttl.value = Number(e.target.value); }}>
                ${TTL_OPTIONS.map(v => html`<option key=${v} value=${v} selected=${v === ttl.value}>${v === 0 ? '0 (altijd live)' : `${v} min`}</option>`)}
              </select>
            </div>
          </div>
          ${error.value ? html`
            <p class="msg-bad" role="alert">${error.value}
              ${existingId.value ? html` <button type="button" class="btn btn-sm" onClick=${() => { select(existingId.value); emit('saved'); }}>Ga naar bestaande klas</button>` : null}
            </p>` : null}
        </div>
        <div class=${props.inline ? 'form-actions' : 'modal-foot'}>
          ${props.inline ? null : html`<span></span>`}
          <div class="group">
            ${props.inline ? null : html`<button type="button" class="btn" onClick=${() => emit('cancel')}>Annuleren</button>`}
            <button type="submit" class="btn btn-primary" disabled=${busy.value}>${c ? 'Opslaan' : 'Klas aanmaken'}</button>
          </div>
        </div>
      </form>
    `;
  },
};
