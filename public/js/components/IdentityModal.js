import { html, ref, computed } from '../lib/vue.js';
import { api } from '../api.js';
import { findMember, applyStudentUpdate, load } from '../store/dashboard.js';
import { toast } from '../store/ui.js';
import { parseHandleList } from '../util/links.js';
import Modal from './ui/Modal.js';
import ConfirmDialog from './ui/ConfirmDialog.js';
import Icon from './ui/Icon.js';

const norm = h => String(h).trim().replace(/^@/, '').toLowerCase();

/**
 * Student-identiteit en dubbelaccounts.
 * Teammodus: teamId + handle (met suggesties van teamgenoten). Globale modus: student {id, fullName, handles}.
 * `handles` die naar de server gaan zijn altijd de volledige set (ook koppelingen buiten deze klas).
 */
export default {
  name: 'IdentityModal',
  props: { teamId: Number, handle: String, student: { type: Object, default: null } },
  emits: ['close', 'saved'],
  setup(props, { emit }) {
    const { team, member } = props.student ? { team: null, member: null } : findMember(props.teamId, props.handle);
    const existing = props.student ?? member?.student ?? null;
    const initial = (props.student ? props.student.handles : (member?.student ? member.linkedHandles : member?.handles) ?? []).map(norm);

    const fullName = ref(existing?.fullName ?? '');
    const handles = ref([...initial]);
    const draft = ref('');
    const error = ref('');
    const busy = ref(false);
    const confirmDelete = ref(false);

    // Teamgenoten als suggestie, met de naam van de student waar ze nu aan gekoppeld zijn
    const suggestions = computed(() => {
      if (!team) return [];
      const out = [];
      for (const m of team.members) {
        if (m === member) continue;
        for (const h of m.handles) out.push({ handle: norm(h), movedFrom: m.student && m.student.id !== existing?.id ? m.student.fullName : null });
      }
      return out;
    });

    const toggle = h => {
      const k = norm(h);
      handles.value = handles.value.includes(k) ? handles.value.filter(x => x !== k) : [...handles.value, k];
    };
    const addDraft = () => {
      parseHandleList(draft.value).forEach(h => { if (!handles.value.includes(norm(h))) handles.value = [...handles.value, norm(h)]; });
      draft.value = '';
    };

    async function submit(event) {
      event.preventDefault();
      addDraft();
      if (!fullName.value.trim() && !existing && !handles.value.length) { error.value = 'Vul een naam of minimaal één account in.'; return; }
      busy.value = true;
      error.value = '';
      try {
        const body = { handles: handles.value };
        if (existing) body.studentId = existing.id;
        if (fullName.value.trim()) body.fullName = fullName.value.trim();
        const res = await api.students.saveIdentity(body);

        const changedSet = res.movedHandles.length || res.removedHandles.length || res.deletedStudentIds.length
          || [...handles.value].sort().join() !== [...initial].sort().join() || !existing;
        if (changedSet) await load();
        else applyStudentUpdate(res.student);

        const moved = res.movedHandles.length;
        toast(moved ? `Opgeslagen · ${moved} ${moved === 1 ? 'account' : 'accounts'} samengevoegd.` : 'Opgeslagen.', 'ok');
        emit('saved', res.student);
        emit('close');
      } catch (err) {
        error.value = err.message;
      } finally {
        busy.value = false;
      }
    }

    async function remove() {
      confirmDelete.value = false;
      try {
        const res = await api.students.remove(existing.id);
        toast(`Student verwijderd · ${res.unlinkedHandles.length} accounts ontkoppeld.`, 'ok');
        emit('saved', null);
        emit('close');
        await load();
      } catch (err) {
        error.value = err.message;
      }
    }

    return () => html`
      <${Modal} size="narrow" title="Studentnaam & accounts samenvoegen" titleId="identityTitle"
        subtitle=${props.handle ? `Hoofdaccount: @${props.handle}` : existing?.fullName} onClose=${() => emit('close')}>
        <form onSubmit=${submit}>
          <div class="modal-body">
            <div>
              <label class="lbl" for="idName">Echte naam van student</label>
              <p class="help">Alle accounts die aan deze student gekoppeld zijn, worden in elk team samengevoegd.</p>
              <input id="idName" class="input" autocomplete="off" placeholder="Bijv. Sem de Vries" value=${fullName.value}
                onInput=${e => { fullName.value = e.target.value; }} />
            </div>
            <div>
              <span class="lbl">Gekoppelde accounts</span>
              <div class="chip-select-list">
                ${handles.value.length ? handles.value.map(h => html`
                  <span key=${h} class="handle-chip">@${h}
                    <button type="button" aria-label=${`Ontkoppel ${h}`} onClick=${() => toggle(h)}><${Icon} name="x" /></button>
                  </span>`) : html`<span class="help">Nog geen accounts.</span>`}
              </div>
              <div class="inline-add">
                <input class="input mono" placeholder="Extra account of git-naam + Enter" value=${draft.value}
                  onInput=${e => { draft.value = e.target.value; }}
                  onKeydown=${e => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } }} />
                <button type="button" class="btn" onClick=${addDraft}><${Icon} name="plus" />Toevoegen</button>
              </div>
            </div>
            ${suggestions.value.length ? html`
              <div>
                <span class="lbl">Teamgenoten (klik om te koppelen)</span>
                <div class="chip-select-list">
                  ${suggestions.value.map(s => html`
                    <button key=${s.handle} type="button" class=${`chip-btn ${handles.value.includes(s.handle) ? 'active' : ''}`}
                      title=${s.movedFrom ? `Wordt verplaatst van ${s.movedFrom}` : ''} onClick=${() => toggle(s.handle)}>
                      <${Icon} name="link" />@${s.handle}${s.movedFrom ? html` <small>(van ${s.movedFrom})</small>` : null}
                    </button>`)}
                </div>
              </div>` : null}
            ${error.value ? html`<p class="msg-bad" role="alert">${error.value}</p>` : null}
          </div>
          <div class="modal-foot">
            ${existing
              ? html`<button type="button" class="btn btn-ghost btn-sm btn-danger" onClick=${() => { confirmDelete.value = true; }}><${Icon} name="trash" />Student verwijderen</button>`
              : html`<span></span>`}
            <div class="group">
              <button type="button" class="btn" onClick=${() => emit('close')}>Annuleren</button>
              <button type="submit" class="btn btn-primary" disabled=${busy.value}>Opslaan & samenvoegen</button>
            </div>
          </div>
        </form>
        ${confirmDelete.value ? html`<${ConfirmDialog} danger=${true} title="Student verwijderen?" confirmLabel="Verwijderen"
          message="Notities en het studentnummer gaan verloren en alle gekoppelde accounts worden ontkoppeld."
          onConfirm=${remove} onCancel=${() => { confirmDelete.value = false; }} />` : null}
      <//>`;
  },
};
