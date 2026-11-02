import { html, ref, onBeforeUnmount } from '../../lib/vue.js';
import { api } from '../../api.js';
import { load } from '../../store/dashboard.js';
import { toast } from '../../store/ui.js';
import Icon from '../ui/Icon.js';
import ConfirmDialog from '../ui/ConfirmDialog.js';
import IdentityModal from '../IdentityModal.js';

export default {
  name: 'StudentsTab',
  setup() {
    const q = ref('');
    const students = ref([]);
    const state = ref({ loading: true, error: '' });
    const editing = ref(null);
    const toDelete = ref(null);
    let timer = null;

    async function fetchList() {
      state.value = { loading: true, error: '' };
      try {
        students.value = (await api.students.list(q.value.trim())).students;
        state.value = { loading: false, error: '' };
      } catch (err) {
        state.value = { loading: false, error: err.message };
      }
    }
    const onSearch = e => { q.value = e.target.value; clearTimeout(timer); timer = setTimeout(fetchList, 300); };
    onBeforeUnmount(() => clearTimeout(timer));
    fetchList();

    async function confirmDelete() {
      const s = toDelete.value;
      toDelete.value = null;
      try {
        const res = await api.students.remove(s.id);
        toast(`${s.fullName} verwijderd · ${res.unlinkedHandles.length} accounts ontkoppeld.`, 'ok');
        await fetchList();
        load();
      } catch (err) {
        toast(err.message, 'bad');
      }
    }

    return () => html`
      <div class="modal-body">
        <input class="input" type="search" placeholder="Zoek op naam, studentnummer of account…" aria-label="Zoek student" value=${q.value} onInput=${onSearch} />
        ${state.value.error ? html`<p class="msg-bad" role="alert">${state.value.error}</p>` : null}
        <div class="team-list tall">
          ${students.value.length ? students.value.map(s => html`
            <div key=${s.id} class="row">
              <div>
                <strong>${s.fullName}</strong>
                ${s.studentNumber ? html` <span class="mono msg-muted small">${s.studentNumber}</span>` : null}
                ${s.notes ? html` <span class="note-flag" title="Heeft docentnotities"><${Icon} name="note" /></span>` : null}
                <div class="repo">${s.handles.length ? s.handles.map(h => `@${h}`).join(' + ') : 'geen accounts'}</div>
              </div>
              <div class="row-actions">
                <button type="button" class="btn btn-ghost btn-sm" onClick=${() => { editing.value = s; }}>Wijzigen</button>
                <button type="button" class="btn btn-ghost btn-sm btn-danger" onClick=${() => { toDelete.value = s; }}>Verwijderen</button>
              </div>
            </div>`) : html`<div class="empty">${state.value.loading ? 'Laden…' : 'Geen studenten gevonden.'}</div>`}
        </div>
        ${editing.value ? html`<${IdentityModal} student=${editing.value}
          onSaved=${() => { fetchList(); }} onClose=${() => { editing.value = null; }} />` : null}
        ${toDelete.value ? html`<${ConfirmDialog} danger=${true} title="Student verwijderen?" confirmLabel="Verwijderen"
          message=${`${toDelete.value.fullName}: notities en studentnummer gaan verloren en alle accounts worden ontkoppeld.`}
          onConfirm=${confirmDelete} onCancel=${() => { toDelete.value = null; }} />` : null}
      </div>`;
  },
};
