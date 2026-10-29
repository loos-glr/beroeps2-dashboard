import { state, findTeamData } from './state.js';
import { STORAGE_KEYS, readJson } from './storage.js';
import { esc, icon, sameText, normalizeHandle, parseHandleList, showInlineFeedback, setModal, formatHandles } from './utils.js';

/**
 * ============================================================================
 * LOKALE STUDENTNAMEN (ALIASES) & ACCOUNT ONTDUBBELING
 * ============================================================================
 * Wanneer twee of meer GitHub-usernames (of Git commit-namen) aan dezelfde
 * studentnaam zijn gekoppeld, worden ze automatisch samengevoegd tot één
 * student-profiel met gecombineerde commits, PR's en issues.
 */

export function getStoredAliases() {
  return readJson(STORAGE_KEYS.ALIASES, {});
}

export function saveStoredAliases(aliases) {
  localStorage.setItem(STORAGE_KEYS.ALIASES, JSON.stringify(aliases));
  renderConfiguredAliasesList();
}

function saveAliasesAndRerender(aliases) {
  saveStoredAliases(aliases);
  state.rerender();
}

export function deleteAliasGroup(aliases, realName) {
  Object.keys(aliases).forEach(handle => {
    if (sameText(aliases[handle], realName)) delete aliases[handle];
  });
}

export function getStudentAlias(githubUsername) {
  if (!githubUsername) return '';
  return getStoredAliases()[githubUsername.toLowerCase()] || '';
}

// Vind alle andere handles die dezelfde studentnaam (alias) delen
export function getLinkedHandlesForIdentity(githubUsername, realName) {
  const targetName = (realName || getStudentAlias(githubUsername) || '').trim().toLowerCase();
  if (!targetName) return [];
  const primaryKey = (githubUsername || '').trim().toLowerCase();
  return Object.entries(getStoredAliases())
    .filter(([handle, alias]) => handle !== primaryKey && String(alias).trim().toLowerCase() === targetName)
    .map(([handle]) => handle);
}

export function setStudentAliasAndMerge(primaryUsername, realName, extraHandles = []) {
  if (!primaryUsername) return;
  const primaryKey = normalizeHandle(primaryUsername).toLowerCase();
  const extraKeys = extraHandles
    .map(h => normalizeHandle(h).toLowerCase())
    .filter(h => h && h !== primaryKey);

  const aliases = getStoredAliases();
  const previousName = aliases[primaryKey];

  // Als de docent géén echte naam invult maar wél een 2e account koppelt, gebruiken we de hoofd-username als groepsnaam
  const effectiveName = (realName || '').trim() || (extraKeys.length > 0 ? primaryUsername.trim() : '');

  // Ontkoppel accounts die uit de lijst met extra accounts zijn gehaald
  if (previousName) {
    Object.keys(aliases).forEach(handle => {
      if (handle !== primaryKey && sameText(aliases[handle], previousName) && !extraKeys.includes(handle)) {
        delete aliases[handle];
      }
    });
  }

  if (effectiveName) {
    [primaryKey, ...extraKeys].forEach(handle => { aliases[handle] = effectiveName; });
  } else {
    delete aliases[primaryKey];
  }

  saveAliasesAndRerender(aliases);
}

function focusAndSelect(input) {
  setTimeout(() => {
    input.focus();
    input.select();
  }, 20);
}

export function openAliasModal(githubUsername, repo = '') {
  state.activeAliasUsername = githubUsername;
  state.activeAliasRepo = repo || (state.activeStudentDetail ? state.activeStudentDetail.repo : '');
  document.getElementById('aliasTargetHandle').textContent = `@${githubUsername}`;

  const currentAlias = getStudentAlias(githubUsername);
  const linkedOthers = getLinkedHandlesForIdentity(githubUsername, currentAlias);

  const nameInput = document.getElementById('aliasNameInput');
  nameInput.value = currentAlias;
  document.getElementById('aliasExtraHandlesInput').value = linkedOthers.join(', ');

  renderTeamMergeSuggestions(githubUsername, state.activeAliasRepo, linkedOthers);

  setModal('aliasModal', true);
  focusAndSelect(nameInput);
}

export function renderTeamMergeSuggestions(primaryUsername, repo, currentlyLinked) {
  const container = document.getElementById('teamMergeSuggestions');
  if (!container) return;

  const teamData = findTeamData(repo);
  const otherAccountsInRepo = teamData && Array.isArray(teamData.rawMembers)
    ? teamData.rawMembers.map(m => m.username).filter(u => u && !sameText(u, primaryUsername))
    : [];

  container.innerHTML = otherAccountsInRepo.map(handle => `
    <button type="button" class="chip-btn ${currentlyLinked.includes(handle.toLowerCase()) ? 'active' : ''}" data-action="toggle-suggested-handle" data-handle="${esc(handle)}">
      ${icon('link')}@${esc(handle)}
    </button>
  `).join('');
}

export function toggleSuggestedHandle(handle) {
  const extrasInput = document.getElementById('aliasExtraHandlesInput');
  const handles = parseHandleList(extrasInput.value);

  const idx = handles.findIndex(h => sameText(h, handle));
  if (idx >= 0) {
    handles.splice(idx, 1);
  } else {
    handles.push(handle);
  }
  extrasInput.value = handles.join(', ');

  const selected = handles.map(h => h.toLowerCase());
  document.querySelectorAll('#teamMergeSuggestions .chip-btn').forEach(btn => {
    btn.classList.toggle('active', selected.includes((btn.dataset.handle || '').toLowerCase()));
  });
}

export function closeAliasModal() {
  setModal('aliasModal', false);
  state.activeAliasUsername = '';
  state.activeAliasRepo = '';
}

export function saveAliasFromModal(event) {
  event.preventDefault();
  if (!state.activeAliasUsername) return;
  const realName = document.getElementById('aliasNameInput').value;
  const extraHandles = parseHandleList(document.getElementById('aliasExtraHandlesInput').value);
  setStudentAliasAndMerge(state.activeAliasUsername, realName, extraHandles);
  closeAliasModal();
}

export function removeCurrentAlias() {
  if (!state.activeAliasUsername) return;
  const currentAlias = getStudentAlias(state.activeAliasUsername);
  const aliases = getStoredAliases();

  if (currentAlias) {
    deleteAliasGroup(aliases, currentAlias);
  } else {
    delete aliases[state.activeAliasUsername.toLowerCase()];
  }

  saveAliasesAndRerender(aliases);
  closeAliasModal();
}

export function addAliasManually() {
  const ghInput = document.getElementById('newAliasGithub');
  const nameInput = document.getElementById('newAliasRealName');
  const [firstHandle, ...restHandles] = parseHandleList(ghInput.value);
  const name = nameInput.value.trim();

  if (!firstHandle || !name) {
    showInlineFeedback('aliasFormFeedback', 'Vul minimaal één GitHub-account én de echte naam van de student in.');
    return;
  }

  showInlineFeedback('aliasFormFeedback', '');
  setStudentAliasAndMerge(firstHandle, name, restHandles);
  ghInput.value = '';
  nameInput.value = '';
}

export function removeAliasGroup(realName) {
  const aliases = getStoredAliases();
  deleteAliasGroup(aliases, realName);
  saveAliasesAndRerender(aliases);
}

export function clearAllAliases() {
  saveAliasesAndRerender({});
}

// Groepeer per studentnaam zodat samengevoegde accounts netjes bij elkaar staan
export function groupAliasesByName(aliases) {
  const groups = {};
  Object.entries(aliases).forEach(([handle, realName]) => {
    const key = realName.trim().toLowerCase();
    groups[key] ??= { realName: realName.trim(), handles: [] };
    groups[key].handles.push(handle);
  });
  return Object.values(groups).sort((a, b) => a.realName.localeCompare(b.realName, 'nl'));
}

export function renderConfiguredAliasesList() {
  const listEl = document.getElementById('configuredAliasesList');
  if (!listEl) return;
  const groups = groupAliasesByName(getStoredAliases());

  if (groups.length === 0) {
    listEl.innerHTML = `<div class="empty">Nog geen studentnamen of samengevoegde accounts ingesteld. Klik op het potloodje bij een student in het overzicht.</div>`;
    return;
  }

  listEl.innerHTML = groups.map(group => {
    const mergedLabel = group.handles.length > 1
      ? `<span class="merged-badge" style="margin-left:6px">${group.handles.length} accounts samengevoegd</span>`
      : '';

    return `
      <div class="row">
        <div>
          <strong>${esc(group.realName)}</strong>${mergedLabel}
          <div class="repo">${formatHandles(group.handles)}</div>
        </div>
        <div class="row-actions">
          <button type="button" data-action="open-alias-modal" data-gh="${esc(group.handles[0])}" class="btn btn-ghost btn-sm">Wijzigen</button>
          <button type="button" data-action="remove-alias-group" data-name="${esc(group.realName)}" class="btn btn-ghost btn-sm btn-danger">Wissen</button>
        </div>
      </div>
    `;
  }).join('');
}
