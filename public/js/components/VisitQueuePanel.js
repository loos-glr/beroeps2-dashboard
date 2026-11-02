import { html, ref } from '../lib/vue.js';
import { coaching, queue, createLog } from '../store/coaching.js';
import { toast, openModal } from '../store/ui.js';
import { formatDate } from '../util/format.js';
import Icon from './ui/Icon.js';
import Pill from './ui/Pill.js';

const SECTIONS = [
  { key: 'due', title: 'Verlopen / vandaag opvolgen', cls: 'bad', icon: 'alert' },
  { key: 'red', title: 'Direct bijsturen', cls: 'bad', icon: 'x' },
  { key: 'amber', title: 'Gesprekspunt', cls: 'warn', icon: 'alert' },
  { key: 'unvisited', title: 'Nog niet bezochte teams vandaag', cls: 'muted', icon: 'users' },
];

/** Uitklapbaar paneel "Lesronde & Bezoek-Wachtrij" met geprioriteerde bezoeken voor de docent. */
export default {
  name: 'VisitQueuePanel',
  setup() {
    const busyId = ref('');
    const formId = ref('');
    const note = ref('');
    const date = ref('');

    const run = async (item, payload, after) => {
      if (busyId.value) return;
      busyId.value = item.id;
      try {
        await createLog({ ...item.ref, ...payload });
        after?.();
      } catch (err) {
        toast(`Opslaan mislukt: ${err.message}`, 'bad');
      } finally {
        busyId.value = '';
      }
    };
    const openForm = item => { formId.value = formId.value === item.id ? '' : item.id; note.value = ''; date.value = ''; };
    const goTo = item => {
      if (item.kind === 'student') openModal('detail', { teamId: item.team.id, handle: item.member.username });
      else document.getElementById(`team-${item.team.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const row = (item, section) => {
      const c = item.kind === 'student' ? item.member.coaching : item.team.coaching;
      const busy = busyId.value === item.id;
      const isDue = section === 'due';
      return html`
        <li key=${item.id} class="visit-item">
          <div class="visit-main">
            <button type="button" class="primary-name-btn" onClick=${() => goTo(item)}>${item.name}</button>
            ${item.kind === 'student' ? html`<span class="msg-muted">${item.team.teamName}</span>` : html`<${Pill} cls="muted">team<//>`}
            ${item.kind === 'student' ? html`<${Pill} cls=${section === 'red' || isDue ? 'bad' : section === 'amber' ? 'warn' : 'ok'}>${item.member.status.label}<//>` : null}
            ${isDue ? html`<${Pill} cls="bad" icon="alert">${c.dueFollowUps} te volgen<//>` : null}
          </div>
          ${isDue ? dueNotes(item) : null}
          <div class="visit-actions">
            <button type="button" class="btn btn-sm" disabled=${busy} onClick=${() => run(item, isDue ? { resolveDue: true } : {})}>
              <${Icon} name="check" />${isDue ? 'Afspraak afgerond ✓' : 'Vandaag besproken ✓'}</button>
            <button type="button" class="btn btn-sm btn-ghost" aria-expanded=${formId.value === item.id ? 'true' : 'false'} onClick=${() => openForm(item)}>
              <${Icon} name="plus" />Afspraak / Notitie</button>
          </div>
          ${formId.value === item.id ? html`
            <form class="visit-form" onSubmit=${e => { e.preventDefault(); run(item, { noteText: note.value, followUpDate: date.value || null }, () => { formId.value = ''; }); }}>
              <textarea class="textarea" rows="2" aria-label="Notitie" placeholder="Notitie of afspraak…" value=${note.value}
                onInput=${e => { note.value = e.target.value; }}></textarea>
              <label class="field"><span>Checken op datum</span>
                <input type="date" value=${date.value} onInput=${e => { date.value = e.target.value; }} /></label>
              <button type="submit" class="btn btn-primary btn-sm" disabled=${busy}>Opslaan</button>
              <button type="button" class="btn btn-sm" onClick=${() => { formId.value = ''; }}>Annuleren</button>
            </form>` : null}
        </li>`;
    };

    const dueNotes = item => {
      const own = coaching.logs.filter(l => !l.isResolved && l.followUpDate && (item.kind === 'student'
        ? l.studentId === item.member.student?.id : l.teamId === item.team.id && l.studentId === null));
      return html`<ul class="visit-notes">${own.map(l => html`<li key=${l.id}><b>${formatDate(l.followUpDate)}</b> · ${l.noteText}</li>`)}</ul>`;
    };

    return () => {
      if (!coaching.panelOpen) return null;
      const q = queue.value;
      return html`
        <section id="visitQueue" class="visit-panel" aria-label="Lesronde en bezoek-wachtrij">
          <div class="visit-panel-head">
            <h2>Lesronde / Wachtrij <span class="mono">(${q.openCount})</span></h2>
            <button type="button" class="btn btn-ghost btn-sm" onClick=${() => { coaching.panelOpen = false; }}>Sluiten</button>
          </div>
          ${q.openCount === 0 ? html`<p class="empty">Niets meer te bespreken. Goed gedaan! ✓</p>` : null}
          ${SECTIONS.map(sec => q[sec.key].length ? html`
            <div key=${sec.key} class="visit-section">
              <h3><${Pill} cls=${sec.cls} icon=${sec.icon}>${sec.title}<//> <span class="mono msg-muted">${q[sec.key].length}</span></h3>
              <ul class="visit-list">${q[sec.key].map(item => row(item, sec.key))}</ul>
            </div>` : null)}
          <details class="visit-done">
            <summary>Al besproken tijdens deze les (${q.done.length})</summary>
            <ul class="visit-list">${q.done.map(item => html`
              <li key=${item.id} class="visit-item"><div class="visit-main">
                <button type="button" class="primary-name-btn" onClick=${() => goTo(item)}>${item.name}</button>
                ${item.kind === 'student' ? html`<span class="msg-muted">${item.team.teamName}</span>` : html`<${Pill} cls="muted">team<//>`}
                <${Pill} cls="ok" icon="check">besproken<//>
              </div></li>`)}</ul>
          </details>
        </section>`;
    };
  },
};
