import { html, ref, onMounted, onUnmounted } from '../lib/vue.js';
import { dashboard, setPeriod } from '../store/dashboard.js';
import { board, autoRefreshTick } from '../store/board.js';
import { coaching } from '../store/coaching.js';
import { exitBoard, closeModal } from '../store/ui.js';
import BoardHeader from './board/BoardHeader.js';
import MomentumBanner from './board/MomentumBanner.js';
import BoardTeamTile from './board/BoardTeamTile.js';

const HEARTBEAT_MS = 30000;

/**
 * Digibord / klas-modus: alleen klas- en teamcijfers, geen docentgegevens (status, notities, wachtrij, beheer).
 * Beheert de hartslag voor relatieve tijden en auto-verversen; alles wordt bij verlaten opgeruimd.
 */
export default {
  name: 'ClassBoardView',
  setup() {
    const now = ref(Date.now());
    const fullscreen = ref(!!document.fullscreenElement);
    let teacherPeriod = dashboard.period;
    let timer = null;

    const beat = () => { now.value = Date.now(); autoRefreshTick(now.value); };
    const stop = () => { clearInterval(timer); timer = null; };
    const start = () => { stop(); timer = setInterval(beat, HEARTBEAT_MS); };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') { beat(); start(); } else stop();
    };
    const onFullscreen = () => { fullscreen.value = !!document.fullscreenElement; };
    const onKey = e => {
      if (e.key !== 'Escape' || document.fullscreenElement) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) return;
      exitBoard();
    };
    const toggleFullscreen = () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else document.documentElement.requestFullscreen?.().catch(() => {});
    };

    onMounted(() => {
      closeModal();
      coaching.panelOpen = false;
      teacherPeriod = dashboard.period;
      board.lastRunAt = Date.now();
      setPeriod(board.period, { remember: false });
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('fullscreenchange', onFullscreen);
      document.addEventListener('keydown', onKey);
      if (document.visibilityState === 'visible') start();
    });
    onUnmounted(() => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('keydown', onKey);
      setPeriod(teacherPeriod);
    });

    return () => {
      let body;
      if (!dashboard.loaded && dashboard.loading) body = html`<div class="loading" role="status">Ophalen…</div>`;
      else if (dashboard.error && !dashboard.loaded) body = html`<div class="placeholder"><h2>Gegevens laden mislukt</h2><p>${dashboard.error}</p></div>`;
      else if (dashboard.loaded && !dashboard.teams.length) body = html`<div class="placeholder"><h2>Nog geen teams in deze klas</h2></div>`;
      else body = html`<div class="b-grid">${dashboard.teams.map(t => html`<${BoardTeamTile} key=${t.id} team=${t} now=${now.value} />`)}</div>`;

      return html`
        <div class="board">
          <${BoardHeader} now=${now.value} fullscreen=${fullscreen.value} onExit=${exitBoard} onToggleFullscreen=${toggleFullscreen} />
          <${MomentumBanner} />
          <main aria-busy=${dashboard.loading ? 'true' : 'false'}>${body}</main>
        </div>`;
    };
  },
};
