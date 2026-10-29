import { state } from './state.js';
import { icon, getThresholdDays, updateTeamCountBadge } from './utils.js';
import {
  addAliasManually, clearAllAliases, closeAliasModal, openAliasModal,
  removeAliasGroup, removeCurrentAlias, saveAliasFromModal, toggleSuggestedHandle
} from './aliases.js';
import {
  addTeamManually, clearAllTeams, closeTeamNameModal, exportConfigJson,
  getStoredTeams, importConfigJson, openTeamNameModal, removeTeam, saveTeamNameFromModal
} from './teams.js';
import { checkRateLimit, discoverCollaboratorRepos, fetchTeamData, quickAddDiscoveredRepo } from './github.js';
import { renderDashboard, renderKpis, renderNoTeamsPlaceholder, setRefreshing } from './dashboard.js';
import { closeStudentDetailModal, openStudentDetailModal, renderStudentDetailModalContent } from './detail.js';
import { clearToken, closeOverlay, initKeyboardShortcuts, saveTokenAndTeacher, toggleTeamsModal, toggleTokenModal } from './modals.js';

/**
 * ============================================================================
 * APP-BOOTSTRAP & GECENTRALISEERDE EVENT-AFHANDELING
 * ============================================================================
 * Alle UI-acties lopen via `data-action`-attributen en één gedelegeerde
 * click-listener. Zo staan er geen inline handlers in de HTML.
 */

const clickActions = {
  'refresh': () => loadAllTeams(),
  'toggle-teams-modal': () => toggleTeamsModal(),
  'toggle-token-modal': () => toggleTokenModal(),
  'close-teams-and-load': () => { toggleTeamsModal(); loadAllTeams(); },
  'discover-repos': () => discoverCollaboratorRepos(),
  'add-team': () => addTeamManually(),
  'clear-teams': () => clearAllTeams(),
  'clear-aliases': () => clearAllAliases(),
  'add-alias': () => addAliasManually(),
  'export-config': () => exportConfigJson(),
  'save-token': () => saveTokenAndTeacher(),
  'clear-token': () => clearToken(),
  'open-team-name-modal': el => openTeamNameModal(el.dataset.repo),
  'close-team-name-modal': () => closeTeamNameModal(),
  'remove-team': el => removeTeam(Number(el.dataset.index)),
  'open-alias-modal': el => openAliasModal(el.dataset.gh, el.dataset.repo),
  'close-alias-modal': () => closeAliasModal(),
  'toggle-suggested-handle': el => toggleSuggestedHandle(el.dataset.handle),
  'remove-alias-group': el => removeAliasGroup(el.dataset.name),
  'remove-current-alias': () => removeCurrentAlias(),
  'open-student-detail': el => openStudentDetailModal(el.dataset.repo, el.dataset.gh),
  'close-student-detail': () => closeStudentDetailModal(),
  'quick-add-repo': el => quickAddDiscoveredRepo(el.dataset.name, el.dataset.full)
};

function handleClick(event) {
  const overlay = event.target.closest('.overlay');
  if (overlay && event.target === overlay) {
    closeOverlay(overlay.id);
    return;
  }

  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = clickActions[trigger.dataset.action];
  if (action) action(trigger);
}

function handleChange(event) {
  const target = event.target;
  if (target.id === 'onlyAttention') {
    renderDashboard();
  } else if (target.id === 'inactivityThreshold') {
    loadAllTeams();
  } else if (target.dataset.change === 'import-config') {
    importConfigJson(event);
  }
}

function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  if (form.dataset.form === 'alias') saveAliasFromModal(event);
  else if (form.dataset.form === 'team-name') saveTeamNameFromModal(event);
}

async function loadAllTeams() {
  const container = document.getElementById('teamsContainer');
  const teams = getStoredTeams();

  updateTeamCountBadge(teams.length);
  await checkRateLimit();

  if (teams.length === 0) {
    state.lastResults = null;
    renderKpis([], getThresholdDays());
    renderNoTeamsPlaceholder(container);
    return;
  }

  setRefreshing(true);
  container.innerHTML = `<div class="loading" role="status">${icon('refresh')}Ophalen…</div>`;

  state.lastResults = await Promise.all(teams.map(async (team) => {
    try {
      return { team, data: await fetchTeamData(team) };
    } catch (err) {
      return { team, error: err };
    }
  }));

  setRefreshing(false);
  renderDashboard();
  if (state.activeStudentDetail) {
    renderStudentDetailModalContent();
  }
  document.getElementById('lastUpdated').textContent = `Update: ${new Date().toLocaleTimeString('nl-NL')}`;
}

/* ===== Hooks registreren (voorkomt circulaire imports tussen modules) ===== */
state.rerender = () => {
  renderDashboard();
  if (state.activeStudentDetail) renderStudentDetailModalContent();
};
state.reload = () => loadAllTeams();

function init() {
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('submit', handleSubmit);
  initKeyboardShortcuts();
  loadAllTeams();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
