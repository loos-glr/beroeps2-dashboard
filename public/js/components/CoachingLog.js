import { html, ref, computed, watch } from '../lib/vue.js';
import { coaching, createLog, updateLog, deleteLog, memberRef, todayLocal } from '../store/coaching.js';
import { toast } from '../store/ui.js';
import { formatDate, formatDateTime } from '../util/format.js';
import ConfirmDialog from './ui/ConfirmDialog.js';
import Icon from './ui/Icon.js';
import Pill from './ui/Pill.js';

/** Formatief Logboek & Lesafspraken van één student (coaching_logs), nieuwste regel bovenaan. */
export default {
  name: 'CoachingLog',
  props: { team: { type: Object, required: true }, member: { type: Object, required: true } },
  emits: ['dirty'],
  setup(props, { emit }) {
    const note = ref('');
    const date = ref('');
    const busy = ref(false);
    const error = ref('');
    const removing = ref(null);

    const dirty = computed(() => note.value.trim() !== '' || date.value !== '');
    watch(dirty, v => emit('dirty', v), { immediate: true });

    // Een lid zonder studentrecord heeft nog geen logs; na de eerste log is er een student-id
    const logs = computed(() => {
      const id = props.member.student?.id;
      return id ? coaching.logs.filter(l => l.studentId === id) : [];
    });

    async function add() {
      if (busy.value || !dirty.value) return;
      busy.value = true;
      error.value = '';
      try {
        await createLog({ ...memberRef(props.team, props.member), noteText: note.value, followUpDate: date.value || null });
        note.value = '';
        date.value = '';
      } catch (err) {
        error.value = err.message;
      } finally {
        busy.value = false;
      }
    }
    const guard = fn => async (...a) => { try { await fn(...a); } catch (err) { toast(`Opslaan mislukt: ${err.message}`, 'bad'); } };
    const toggle = guard((l, v) => updateLog(l.id, { isResolved: v }));
    const confirmRemove = guard(async () => { const l = removing.value; removing.value = null; await deleteLog(l.id); });

    return () => html`
      <section class="coaching-log">
        <div class="section-title"><span><${Icon} name="note" /> Formatief Logboek & Lesafspraken</span></div>
        <form class="log-form" onSubmit=${e => { e.preventDefault(); add(); }}>
          <textarea class="textarea" rows="2" aria-label="Logboeknotitie" placeholder="Wat is besproken of afgesproken?" value=${note.value}
            onInput=${e => { note.value = e.target.value; }}></textarea>
          <label class="field"><span>Checken op datum</span>
            <input type="date" value=${date.value} onInput=${e => { date.value = e.target.value; }} /></label>
          <button type="submit" class="btn btn-primary btn-sm" disabled=${!dirty.value || busy.value}>Toevoegen</button>
        </form>
        ${error.value ? html`<p class="msg-bad" role="alert">${error.value}</p>` : null}
        <ul class="log-list">
          ${logs.value.length ? logs.value.map(l => {
            const open = l.followUpDate && !l.isResolved;
            const due = open && l.followUpDate <= todayLocal();
            return html`
              <li key=${l.id} class=${`log-item ${l.isResolved ? 'resolved' : ''}`}>
                <div class="log-main">
                  <div class="log-meta"><span>${formatDateTime(l.visitedAt)}</span>
                    ${l.followUpDate ? html`<${Pill} cls=${due ? 'bad' : l.isResolved ? 'ok' : 'warn'} icon=${l.isResolved ? 'check' : 'alert'}>Checken: ${formatDate(l.followUpDate)}<//>` : null}</div>
                  <div class="log-text">${l.noteText}</div>
                </div>
                <div class="log-actions">
                  ${l.followUpDate ? html`<label class="switch-inline"><input type="checkbox" checked=${l.isResolved}
                    onChange=${e => toggle(l, e.target.checked)} /> Afgerond</label>` : null}
                  <button type="button" class="edit-alias-btn" title="Logregel verwijderen" aria-label="Logregel verwijderen"
                    onClick=${() => { removing.value = l; }}><${Icon} name="trash" /></button>
                </div>
              </li>`;
          }) : html`<li class="empty">Nog geen logboekregels voor deze student.</li>`}
        </ul>
        ${removing.value ? html`<${ConfirmDialog} title="Logregel verwijderen" confirmLabel="Verwijderen" danger=${true}
          message="Deze logregel wordt definitief verwijderd." onConfirm=${confirmRemove} onCancel=${() => { removing.value = null; }} />` : null}
      </section>`;
  },
};
