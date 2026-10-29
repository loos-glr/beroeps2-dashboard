import { state } from './state.js';
import { STORAGE_KEYS, readJson } from './storage.js';
import { getStoredAliases, saveStoredAliases } from './aliases.js';
import { esc, sameText, showInlineFeedback, setModal, updateTeamCountBadge } from './utils.js';

/**
 * ============================================================================
 * TEAMS (LOKAAL OPGESLAGEN)
 * ============================================================================
 * Teams en hun weergavenamen leven uitsluitend in localStorage van de docent.
 */

export function getStoredTeams() {
  return readJson(STORAGE_KEYS.TEAMS, []);
}

export function saveStoredTeams(teams) {
  localStorage.setItem(STORAGE_KEYS.TEAMS, JSON.stringify(teams));
  renderConfiguredTeamsList();
}

export function findStoredTeam(teams, repo) {
  return teams.find(t => sameText(t.repo, repo));
}

export function addTeamIfNew(name, repo) {
  const teams = getStoredTeams();
  if (findStoredTeam(teams, repo)) return;
  teams.push({ name, repo });
  saveStoredTeams(teams);
}

export function updateTeamName(repo, newName) {
  if (!repo) return;
  const cleanName = (newName || '').trim() || repo;
  const teams = getStoredTeams();
  const target = findStoredTeam(teams, repo);
  if (target) {
    target.name = cleanName;
    saveStoredTeams(teams);
  }
  if (!Array.isArray(state.lastResults)) return;

  state.lastResults.forEach(r => {
    if (r.team && sameText(r.team.repo, repo)) r.team.name = cleanName;
    if (r.data && sameText(r.data.repo, repo)) r.data.teamName = cleanName;
  });
  state.rerender();
}

function focusAndSelect(input) {
  setTimeout(() => {
    input.focus();
    input.select();
  }, 20);
}

export function openTeamNameModal(repo) {
  if (!repo) return;
  state.activeTeamRepo = repo;
  const found = findStoredTeam(getStoredTeams(), repo);

  document.getElementById('teamNameTargetRepo').textContent = repo;
  const input = document.getElementById('teamNameEditInput');
  input.value = found ? found.name : repo;
  setModal('teamNameModal', true);
  focusAndSelect(input);
}

export function closeTeamNameModal() {
  setModal('teamNameModal', false);
  state.activeTeamRepo = '';
}

export function saveTeamNameFromModal(event) {
  event.preventDefault();
  if (!state.activeTeamRepo) return;
  updateTeamName(state.activeTeamRepo, document.getElementById('teamNameEditInput').value);
  closeTeamNameModal();
}

export function cleanRepoPath(input) {
  return input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}

export function addTeamManually() {
  const nameInput = document.getElementById('newTeamName');
  const repoInput = document.getElementById('newTeamRepo');
  const repo = cleanRepoPath(repoInput.value);

  if (!repo.includes('/')) {
    showInlineFeedback('teamFormFeedback', 'Voer een geldige repository in het formaat "eigenaar/repo-naam" of een GitHub URL in.');
    return;
  }

  showInlineFeedback('teamFormFeedback', '');
  addTeamIfNew(nameInput.value.trim() || repo, repo);
  nameInput.value = '';
  repoInput.value = '';
}

export function removeTeam(index) {
  const teams = getStoredTeams();
  teams.splice(index, 1);
  saveStoredTeams(teams);
}

export function clearAllTeams() {
  saveStoredTeams([]);
  state.reload();
}

export function renderConfiguredTeamsList() {
  const listEl = document.getElementById('configuredTeamsList');
  const teams = getStoredTeams();
  updateTeamCountBadge(teams.length);

  if (teams.length === 0) {
    listEl.innerHTML = `<div class="empty">Nog geen teams.</div>`;
    return;
  }

  listEl.innerHTML = teams.map((t, idx) => `
    <div class="row">
      <div>
        <strong>${esc(t.name)}</strong>
        <div class="repo">${esc(t.repo)}</div>
      </div>
      <div class="row-actions">
        <button type="button" data-action="open-team-name-modal" data-repo="${esc(t.repo)}" class="btn btn-ghost btn-sm">Wijzigen</button>
        <button type="button" data-action="remove-team" data-index="${idx}" class="btn btn-ghost btn-sm btn-danger">Verwijderen</button>
      </div>
    </div>
  `).join('');
}

/* ===== JSON export & import (inclusief gekoppelde studentnamen) ===== */
export function exportConfigJson() {
  const payload = {
    version: 2,
    teams: getStoredTeams(),
    aliases: getStoredAliases()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'beroeps2-config-lokaal.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Accepteert zowel een kale teams-array (v1) als { teams, aliases } (v2)
export function applyImportedConfig(parsed) {
  if (Array.isArray(parsed)) {
    saveStoredTeams(parsed);
    return true;
  }
  if (!parsed || typeof parsed !== 'object') return false;

  if (Array.isArray(parsed.teams)) saveStoredTeams(parsed.teams);
  if (parsed.aliases && typeof parsed.aliases === 'object') {
    saveStoredAliases({ ...getStoredAliases(), ...parsed.aliases });
  }
  return true;
}

export function importConfigJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      showInlineFeedback('importFeedback', '');
      if (applyImportedConfig(JSON.parse(e.target.result))) {
        state.reload();
      } else {
        showInlineFeedback('importFeedback', 'Ongeldig JSON-formaat.');
      }
    } catch (err) {
      showInlineFeedback('importFeedback', 'Kon het JSON-bestand niet lezen.');
    }
  };
  reader.readAsText(file);
}
