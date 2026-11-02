import { html, ref } from '../lib/vue.js';
import { api } from '../api.js';
import { dashboard, replaceTeam, refreshTeam } from '../store/dashboard.js';
import { toast } from '../store/ui.js';
import { cleanRepoPath, parseHandleList } from '../util/links.js';
import Modal from './ui/Modal.js';

export default {
  name: 'TeamEditModal',
  props: { teamId: { type: Number, required: true } },
  emits: ['close'],
  setup(props, { emit }) {
    const team = dashboard.teams.find(t => t.id === props.teamId);
    if (!team) { queueMicrotask(() => emit('close')); }
    const name = ref(team?.teamName ?? '');
    const repo = ref(team?.repo ?? '');
    const expected = ref((team?.expectedMembers ?? []).join(', '));
    const error = ref('');
    const busy = ref(false);

    async function submit(event) {
      event.preventDefault();
      const newRepo = cleanRepoPath(repo.value);
      const newExpected = parseHandleList(expected.value);
      if (!name.value.trim()) { error.value = 'Vul een teamnaam in.'; return; }
      if (!newRepo.includes('/')) { error.value = 'Gebruik het formaat "eigenaar/repo-naam" of een GitHub-URL.'; return; }
      const body = {};
      const oldExpected = team.expectedMembers ?? [];
      if (name.value.trim() !== team.teamName) body.teamName = name.value.trim();
      if (newRepo.toLowerCase() !== team.repo.toLowerCase()) body.repoFullName = newRepo;
      if (newExpected.join(',').toLowerCase() !== oldExpected.join(',').toLowerCase()) body.expectedMembers = newExpected;
      if (!Object.keys(body).length) return emit('close');

      busy.value = true;
      try {
        await api.teams.update(team.id, body);
        if (body.repoFullName || body.expectedMembers) await refreshTeam(team.id);
        else replaceTeam({ ...team, teamName: body.teamName });
        emit('close');
      } catch (err) {
        error.value = err.message;
        toast(err.message, 'bad');
      } finally {
        busy.value = false;
      }
    }

    return () => html`
      <${Modal} size="narrow" title="Team wijzigen" titleId="teamTitle" subtitle=${team?.repo} onClose=${() => emit('close')}>
        <form onSubmit=${submit}>
          <div class="modal-body">
            <div><label class="lbl" for="teamName">Teamnaam</label>
              <input id="teamName" class="input" value=${name.value} onInput=${e => { name.value = e.target.value; }} /></div>
            <div><label class="lbl" for="teamRepo">Repository</label>
              <input id="teamRepo" class="input mono" value=${repo.value} placeholder="eigenaar/repo of URL" onInput=${e => { repo.value = e.target.value; }} /></div>
            <div><label class="lbl" for="teamExpected">Verwachte leden (GitHub-accounts, komma-gescheiden)</label>
              <p class="help">Verschijnen ook als ze nog niets hebben gedaan.</p>
              <input id="teamExpected" class="input mono" value=${expected.value} onInput=${e => { expected.value = e.target.value; }} /></div>
            ${error.value ? html`<p class="msg-bad" role="alert">${error.value}</p>` : null}
          </div>
          <div class="modal-foot">
            <span></span>
            <div class="group">
              <button type="button" class="btn" onClick=${() => emit('close')}>Annuleren</button>
              <button type="submit" class="btn btn-primary" disabled=${busy.value}>Opslaan</button>
            </div>
          </div>
        </form>
      <//>`;
  },
};
