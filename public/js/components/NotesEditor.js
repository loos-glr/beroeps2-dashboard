import { html, ref, computed, watch } from '../lib/vue.js';
import { api } from '../api.js';
import { applyStudentUpdate, load } from '../store/dashboard.js';
import Icon from './ui/Icon.js';

/** Formatieve docentnotities + studentnummer; slaat op via POST /students/identity. */
export default {
  name: 'NotesEditor',
  props: { member: { type: Object, required: true } },
  emits: ['dirty'],
  setup(props, { emit }) {
    const base = () => ({ notes: props.member.student?.notes ?? '', number: props.member.student?.studentNumber ?? '' });
    const notes = ref(base().notes);
    const number = ref(base().number);
    const error = ref('');
    const saved = ref(false);
    const busy = ref(false);

    const dirty = computed(() => notes.value !== base().notes || number.value !== base().number);
    watch(dirty, v => emit('dirty', v), { immediate: true });

    async function save() {
      if (busy.value || !dirty.value) return;
      busy.value = true;
      error.value = '';
      const m = props.member;
      try {
        const fields = { notes: notes.value, studentNumber: number.value.trim() || null };
        if (m.student) {
          // Zonder `handles`: koppelingen blijven ongemoeid, en geen herlaad nodig
          const res = await api.students.saveIdentity({ studentId: m.student.id, ...fields });
          applyStudentUpdate(res.student);
        } else {
          await api.students.saveIdentity({ fullName: m.displayName, handles: m.handles, ...fields });
          await load();   // groepering verandert; hergebruikt snapshots
        }
        saved.value = true;
        setTimeout(() => { saved.value = false; }, 2500);
      } catch (err) {
        error.value = err.status === 409 ? 'Dit studentnummer is al in gebruik.' : err.message;
      } finally {
        busy.value = false;
      }
    }

    return () => html`
      <section class="notes-editor">
        <div class="section-title"><span><${Icon} name="note" /> Vaste achtergrondnotitie (algemeen)</span>
          ${saved.value ? html`<span class="notes-saved">Opgeslagen ✓</span>` : dirty.value ? html`<span class="msg-warn">Niet opgeslagen</span>` : null}
        </div>
        <p class="help">Blijvende context over deze student. Datum-gebonden gesprekken en afspraken staan hieronder in het logboek.</p>
        <textarea class="textarea" rows="4" placeholder="Achtergrond, leerstijl, aandachtspunten…" aria-label="Vaste achtergrondnotitie"
          value=${notes.value} onInput=${e => { notes.value = e.target.value; }}
          onKeydown=${e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}></textarea>
        <div class="notes-row">
          <div>
            <label class="lbl" for="studentNumber">Studentnummer (optioneel)</label>
            <input id="studentNumber" class="input mono" maxlength="32" value=${number.value} onInput=${e => { number.value = e.target.value; }} />
          </div>
          <button type="button" class="btn btn-primary" disabled=${!dirty.value || busy.value} onClick=${save}>Opslaan</button>
        </div>
        ${error.value ? html`<p class="msg-bad" role="alert">${error.value}</p>` : null}
      </section>`;
  },
};
