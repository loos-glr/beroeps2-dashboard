import { html, ref } from '../../lib/vue.js';
import { api } from '../../api.js';
import { contexts } from '../../store/contexts.js';
import { dashboard, replaceTeam, removeTeam } from '../../store/dashboard.js';
import { toast, openModal } from '../../store/ui.js';
import { cleanRepoPath, parseHandleList } from '../../util/links.js';
import Icon from '../ui/Icon.js';
import Pill from '../ui/Pill.js';
import ConfirmDialog from '../ui/ConfirmDialog.js';

export default {
  name: 'TeamsTab',
  props: { autoDiscover: Boolean },
  emits: ['close'],
  setup(props, { emit }) {
    const name = ref(''), repo = ref(''), expected = ref('');
    const formError = ref('');
    const repos = ref(null);          // null = niet gezocht
    const discoverState = ref({ busy: false, error: '', needsToken: false });
    const toDelete = ref(null);

    /** Team aanmaken en alleen dat team meteen laten ophalen (geen volledige herlaad). */
    async function createTeam(teamName, repoFullName, expectedMembers = []) {
      const { team } = await api.teams.create({ contextId: contexts.selectedId, teamName, repoFullName, expectedMembers });
      try {
        const res = await api.teams.refresh(team.id);
        replaceTeam(res.team);
        if (res.github) dashboard.github = res.github;
      } catch (err) {
        toast(`Team toegevoegd, maar ophalen mislukt: ${err.message}`, 'warn');
        replaceTeam({ id: team.id, teamName: team.teamName, repo: team.repoFullName, expectedMembers: team.expectedMembers, cacheStatus: 'error',
          error: err.message, totals: null, statusCounts: { green: 0, amber: 0, red: 0 }, members: [], warnings: [], truncated: {} });
      }
      return team;
    }

    async function add(event) {
      event.preventDefault();
      const path = cleanRepoPath(repo.value);
      if (!/^[^/\s]+\/[^/\s]+$/.test(path)) { formError.value = 'Voer een geldige repository in: "eigenaar/repo-naam" of een GitHub-URL.'; return; }
      formError.value = '';
      try {
        await createTeam(name.value.trim() || path, path, parseHandleList(expected.value));
        name.value = ''; repo.value = ''; expected.value = '';
        toast('Team toegevoegd.', 'ok', 2500);
      } catch (err) {
        formError.value = err.message;
      }
    }

    async function discover() {
      discoverState.value = { busy: true, error: '', needsToken: false };
      try {
        repos.value = (await api.github.collaboratorRepos(contexts.selectedId)).repos;
        discoverState.value = { busy: false, error: '', needsToken: false };
      } catch (err) {
        repos.value = null;
        discoverState.value = { busy: false, error: err.message, needsToken: err.status === 401 };
      }
    }
    async function quickAdd(r) {
      try {
        const team = await createTeam(r.name, r.fullName);
        r.teamId = team.id;
      } catch (err) {
        discoverState.value = { ...discoverState.value, error: err.message };
      }
    }
    async function confirmDelete() {
      const t = toDelete.value;
      toDelete.value = null;
      try {
        await api.teams.remove(t.id);
        removeTeam(t.id);
        if (repos.value) repos.value.forEach(r => { if (r.teamId === t.id) r.teamId = null; });
        toast('Team verwijderd.', 'ok', 2500);
      } catch (err) {
        toast(err.message, 'bad');
      }
    }

    if (props.autoDiscover) discover();

    return () => html`
      <div class="modal-body">
        <div class="callout">
          <div class="callout-row">
            <div><h3>Ophalen via GitHub</h3><p>Repo's waarvoor het token collaborator is.</p></div>
            <button type="button" class="btn btn-sm" disabled=${discoverState.value.busy} onClick=${discover}><${Icon} name="search" />${discoverState.value.busy ? 'Zoeken…' : 'Zoeken'}</button>
          </div>
          ${discoverState.value.error ? html`<p class="msg-bad discover-msg" role="alert">${discoverState.value.error}
            ${discoverState.value.needsToken ? html` <button type="button" class="btn btn-sm" onClick=${() => { emit('close'); openModal('token'); }}>Token instellen</button>` : null}</p>` : null}
          ${repos.value ? html`<div class="discovered">
            ${repos.value.length ? repos.value.map(r => html`
              <div key=${r.fullName} class="row">
                <div><strong>${r.name}</strong> <span class="mono msg-muted small">${r.fullName}</span> ${r.private ? html`<${Pill} cls="muted">privé<//>` : null}</div>
                ${r.teamId ? html`<${Pill} cls="ok" icon="check">Toegevoegd<//>` : html`<button type="button" class="btn btn-sm" onClick=${() => quickAdd(r)}><${Icon} name="plus" />Toevoegen</button>`}
              </div>`) : html`<p class="msg-muted">Geen repo's gevonden.</p>`}
          </div>` : null}
        </div>

        <form onSubmit=${add}>
          <h3 class="section-title">Team toevoegen</h3>
          <div class="form-grid">
            <input class="input" placeholder="Teamnaam" aria-label="Teamnaam" value=${name.value} onInput=${e => { name.value = e.target.value; }} />
            <input class="input mono" placeholder="eigenaar/repo of URL" aria-label="Repository" value=${repo.value} onInput=${e => { repo.value = e.target.value; }} />
            <button type="submit" class="btn btn-primary"><${Icon} name="plus" />Toevoegen</button>
          </div>
          <input class="input mono expected-input" placeholder="Verwachte leden (optioneel, komma-gescheiden)" aria-label="Verwachte leden" value=${expected.value} onInput=${e => { expected.value = e.target.value; }} />
          ${formError.value ? html`<p class="help msg-bad" role="alert">${formError.value}</p>` : null}
        </form>

        <div>
          <h3 class="section-title">Teams in deze klas (${dashboard.teams.length})</h3>
          <div class="team-list">
            ${dashboard.teams.length ? dashboard.teams.map(t => html`
              <div key=${t.id} class="row">
                <div><strong>${t.teamName}</strong><div class="repo">${t.repo}</div></div>
                <div class="row-actions">
                  <button type="button" class="btn btn-ghost btn-sm" onClick=${() => openModal('team', { teamId: t.id })}>Wijzigen</button>
                  <button type="button" class="btn btn-ghost btn-sm btn-danger" onClick=${() => { toDelete.value = t; }}>Verwijderen</button>
                </div>
              </div>`) : html`<div class="empty">Nog geen teams.</div>`}
          </div>
        </div>
        ${toDelete.value ? html`<${ConfirmDialog} danger=${true} title="Team verwijderen?" confirmLabel="Verwijderen"
          message=${`${toDelete.value.teamName} (${toDelete.value.repo}) wordt uit deze klas verwijderd. Studenten en notities blijven bewaard.`}
          onConfirm=${confirmDelete} onCancel=${() => { toDelete.value = null; }} />` : null}
      </div>`;
  },
};
