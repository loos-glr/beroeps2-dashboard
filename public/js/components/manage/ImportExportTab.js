import { html, ref, watch } from '../../lib/vue.js';
import { api } from '../../api.js';
import { contexts, selected } from '../../store/contexts.js';
import { dashboard, load } from '../../store/dashboard.js';
import { toast } from '../../store/ui.js';
import { readLegacyConfig, clearLegacyConfig } from '../../util/storage.js';
import { downloadJson } from '../../util/download.js';
import Icon from '../ui/Icon.js';
import Pill from '../ui/Pill.js';

const MAX_BYTES = 1048576;
const ACTION_PILL = { created: ['ok', 'nieuw'], updated: ['warn', 'bijgewerkt'], unchanged: ['muted', 'ongewijzigd'] };

export default {
  name: 'ImportExportTab',
  props: { legacy: Boolean },
  setup(props) {
    const payload = ref(null);
    const source = ref('');
    const preview = ref(null);
    const busy = ref(false);
    const error = ref('');
    const done = ref(false);
    const legacy = readLegacyConfig();
    const fromLegacy = ref(false);

    const reset = () => { payload.value = null; source.value = ''; preview.value = null; error.value = ''; done.value = false; fromLegacy.value = false; };
    watch(() => contexts.selectedId, reset);   // een preview hoort bij één klas

    async function runPreview() {
      busy.value = true; error.value = ''; preview.value = null;
      try {
        preview.value = await api.contexts.importJson(contexts.selectedId, payload.value, true);
      } catch (err) {
        error.value = err.message;
      } finally {
        busy.value = false;
      }
    }

    async function chooseFile(event) {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      reset();
      if (file.size > MAX_BYTES) { error.value = 'Bestand is te groot (max 1 MiB).'; return; }
      try {
        payload.value = JSON.parse(await file.text());
      } catch {
        error.value = 'Kon het JSON-bestand niet lezen.';
        return;
      }
      source.value = file.name;
      await runPreview();
    }

    async function useLegacy() {
      reset();
      payload.value = legacy.payload;
      source.value = 'oude browserdata';
      fromLegacy.value = true;
      await runPreview();
    }

    async function commit() {
      busy.value = true; error.value = '';
      try {
        await api.contexts.importJson(contexts.selectedId, payload.value, false);
        toast('Import voltooid.', 'ok');
        const wasLegacy = fromLegacy.value;
        reset();
        done.value = wasLegacy ? 'legacy' : true;
        await load();
      } catch (err) {
        error.value = err.message;
      } finally {
        busy.value = false;
      }
    }

    function exportClass() {
      const ctx = selected.value;
      const aliases = {};
      for (const t of dashboard.teams) {
        for (const m of t.members) {
          if (m.student) (m.linkedHandles.length ? m.linkedHandles : m.handles).forEach(h => { aliases[h.toLowerCase()] = m.student.fullName; });
        }
      }
      downloadJson(`beroeps2-${ctx.schoolYear}-${ctx.courseCode}-${ctx.className}.json`, {
        version: 2,
        exportedAt: new Date().toISOString(),
        context: { schoolYear: ctx.schoolYear, courseCode: ctx.courseCode, className: ctx.className },
        teams: dashboard.teams.map(t => ({ name: t.teamName, repo: t.repo, expectedMembers: t.expectedMembers ?? [] })),
        aliases,
      });
    }

    if (props.legacy && legacy) useLegacy();

    const list = (title, rows, render) => rows.length ? html`
      <details class="import-list"><summary>${title} (${rows.length})</summary>
        ${rows.map(render)}</details>` : null;

    return () => {
      const ctx = selected.value;
      const s = preview.value?.summary;
      return html`
        <div class="modal-body">
          <div class="callout">
            <div class="callout-row">
              <div><h3>Importeren in</h3><p><strong>${ctx.schoolYear} · ${ctx.courseCode} · ${ctx.className}</strong></p></div>
              <label class="btn btn-sm file-btn"><${Icon} name="upload" />Kies .json
                <input type="file" accept=".json,application/json" class="sr-only" onChange=${chooseFile} /></label>
            </div>
            ${legacy && !done.value ? html`<p class="help legacy-hint">Gevonden in deze browser: ${legacy.teams} teams, ${legacy.aliases} studentnamen uit het oude dashboard.
              <button type="button" class="btn btn-sm" onClick=${useLegacy}>Importeer in deze klas</button></p>` : null}
          </div>

          ${error.value ? html`<p class="msg-bad" role="alert">${error.value}</p>` : null}

          ${preview.value ? html`
            <div class="import-summary" aria-live="polite">
              <h3 class="section-title">Voorbeeld van ${source.value} <${Pill} cls="muted">nog niets opgeslagen<//></h3>
              <ul>
                <li><strong>Teams:</strong> ${s.teamsCreated} nieuw · ${s.teamsUpdated} bijgewerkt · ${s.teamsUnchanged} ongewijzigd · +${s.expectedMembersAdded} verwachte leden</li>
                <li><strong>Studenten:</strong> ${s.studentsCreated} nieuw · ${s.studentsUpdated} bijgewerkt · ${s.studentsUnchanged} ongewijzigd</li>
                <li><strong>Accounts:</strong> ${s.handlesLinked} gekoppeld · ${s.handlesMoved} verplaatst · ${s.studentsMergedAway} studenten samengevoegd</li>
              </ul>
              ${list('Teams', preview.value.teams, t => html`<div key=${t.repo} class="import-row"><span>${t.teamName} <span class="mono msg-muted small">${t.repo}</span></span><${Pill} cls=${ACTION_PILL[t.action][0]}>${ACTION_PILL[t.action][1]}<//></div>`)}
              ${list('Studenten', preview.value.students, st => html`<div key=${st.fullName} class="import-row"><span>${st.fullName} <span class="mono msg-muted small">${st.handles.map(h => `@${h}`).join(' + ')}</span></span><${Pill} cls=${ACTION_PILL[st.action][0]}>${ACTION_PILL[st.action][1]}<//></div>`)}
              ${preview.value.warnings.length ? html`
                <div class="warn-list"><strong><${Icon} name="alert" /> ${preview.value.warnings.length} waarschuwingen</strong>
                  <ul>${preview.value.warnings.map((w, i) => html`<li key=${i}><code>${w.code}</code> ${w.message}</li>`)}</ul>
                  ${preview.value.warningsTruncated ? html`<p class="help">…en meer (lijst afgekapt).</p>` : null}</div>` : null}
              <div class="group">
                <button type="button" class="btn btn-primary" disabled=${busy.value} onClick=${commit}>Definitief importeren</button>
                <button type="button" class="btn" onClick=${reset}>Annuleren</button>
              </div>
            </div>` : null}

          ${done.value ? html`<p class="msg-ok" role="status">Import voltooid.
            ${done.value === 'legacy' ? html` <button type="button" class="btn btn-sm" onClick=${() => { clearLegacyConfig(); done.value = true; toast('Oude browserdata verwijderd.', 'ok', 2500); }}>Oude browserdata verwijderen</button>` : null}</p>` : null}

          <div>
            <h3 class="section-title">Back-up</h3>
            <button type="button" class="btn" onClick=${exportClass}><${Icon} name="download" />Exporteer huidige klas als .JSON</button>
          </div>
        </div>`;
    };
  },
};
