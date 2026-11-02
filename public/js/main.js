import { state } from './state.js';
import { icon, getThresholdDays, sameText, updateTeamCountBadge } from './utils.js';
import {
  addAliasManually, clearAllAliases, closeAliasModal, openAliasModal,
  removeAliasGroup, removeCurrentAlias, saveAliasFromModal, toggleSuggestedHandle
} from './aliases.js';
import {
  addTeamManually, clearAllTeams, closeTeamNameModal, exportConfigJson,
  getStoredTeams, importConfigJson, openTeamNameModal, removeTeam, saveTeamNameFromModal
} from './teams.js';
import { checkRateLimit, discoverCollaboratorRepos, fetchTeamData, quickAddDiscoveredRepo } from './github.js';
import { renderCacheStatus, renderDashboard, renderKpis, renderNoTeamsPlaceholder, renderSingleTeam, setRefreshing } from './dashboard.js';
import {
  CACHE_TTL_OPTIONS, clearAllCaches, getCacheTtlMinutes, isFresh, pruneTeamCache,
  readTeamCache, setCacheTtlMinutes, writeTeamCache
} from './cache.js';
import { mergeRawTeamMembers } from './analysis.js';
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
  'refresh': () => loadAllTeams(true),
  'refresh-team': el => refreshSingleTeam(el.dataset.repo),
  'clear-cache': () => { clearAllCaches(); loadAllTeams(true); },
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
    // De drempel wordt alleen bij het renderen gebruikt: geen nieuwe requests nodig
    state.rerender();
  } else if (target.id === 'cacheTtl') {
    setCacheTtlMinutes(target.value);
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

/**
 * Laadt één team. Laag 1: verse cache-entry (jonger dan de TTL) zonder netwerk,
 * tenzij `forceRefresh`. Anders via fetchTeamData (laag 2: ETag-revalidatie).
 * Aliassen en teamnaam worden altijd NA het laden dynamisch toegepast.
 */
async function loadTeam(team, forceRefresh) {
  const cached = readTeamCache(team.repo);
  let result;

  if (!forceRefresh && isFresh(cached)) {
    result = { team, data: structuredClone(cached.data), cache: { source: 'cache', fetchedAt: cached.fetchedAt } };
  } else {
    try {
      const { data, requests } = await fetchTeamData(team);
      const fetchedAt = Date.now();
      writeTeamCache(team.repo, data, fetchedAt);
      result = { team, data, cache: { source: 'live', fetchedAt, ...requests } };
    } catch (err) {
      // Netwerk-/rate-limitfout: toon liever verouderde data dan een lege foutkaart
      result = cached?.data
        ? { team, data: structuredClone(cached.data), cache: { source: 'stale', fetchedAt: cached.fetchedAt, error: err.message } }
        : { team, error: err };
    }
  }

  if (result.data) {
    result.data.teamName = team.name;
    result.data.members = mergeRawTeamMembers(result.data.rawMembers);
  }
  return result;
}

async function loadAllTeams(forceRefresh = false) {
  const container = document.getElementById('teamsContainer');
  const teams = getStoredTeams();

  updateTeamCountBadge(teams.length);
  pruneTeamCache(teams.map(t => t.repo));

  if (teams.length === 0) {
    state.lastResults = null;
    renderKpis([], getThresholdDays());
    renderCacheStatus([]);
    renderNoTeamsPlaceholder(container);
    await checkRateLimit();
    return;
  }

  state.loading = true;
  setRefreshing(true);
  container.innerHTML = `<div class="loading" role="status">${icon('refresh')}Ophalen…</div>`;

  state.lastResults = await Promise.all(teams.map(team => loadTeam(team, forceRefresh)));

  state.loading = false;
  setRefreshing(false);
  renderDashboard();
  if (state.activeStudentDetail) {
    renderStudentDetailModalContent();
  }
  document.getElementById('lastUpdated').textContent = `Update: ${new Date().toLocaleTimeString('nl-NL')}`;
  // Na het ophalen, zodat de teller het verbruik weerspiegelt
  await checkRateLimit();
}

// Ververst alleen het gekozen team (altijd met ETag-revalidatie), de rest blijft staan
async function refreshSingleTeam(repo) {
  const key = String(repo || '').toLowerCase();
  const team = getStoredTeams().find(t => sameText(t.repo, repo));
  if (!team || state.loading || state.refreshingRepos.has(key)) return;

  state.refreshingRepos.add(key);
  renderSingleTeam(repo);

  const result = await loadTeam(team, true);
  state.refreshingRepos.delete(key);

  if (!Array.isArray(state.lastResults)) return;
  const index = state.lastResults.findIndex(r => sameText(r.team.repo, repo));
  if (index === -1) return;
  state.lastResults[index] = result;

  renderSingleTeam(repo);
  if (state.activeStudentDetail) renderStudentDetailModalContent();
  await checkRateLimit();
}

/* ===== Hooks registreren (voorkomt circulaire imports tussen modules) ===== */
state.rerender = () => {
  renderDashboard();
  if (state.activeStudentDetail) renderStudentDetailModalContent();
};
state.reload = (force = false) => loadAllTeams(force);

function init() {
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('submit', handleSubmit);
  initKeyboardShortcuts();
  const ttlSelect = document.getElementById('cacheTtl');
  if (ttlSelect && CACHE_TTL_OPTIONS.includes(getCacheTtlMinutes())) ttlSelect.value = String(getCacheTtlMinutes());
  loadAllTeams();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
