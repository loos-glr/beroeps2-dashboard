import { state } from './state.js';
import { STORAGE_KEYS, getToken, setOrRemoveStored } from './storage.js';
import { setModal, isOpen } from './utils.js';
import { renderConfiguredTeamsList, closeTeamNameModal } from './teams.js';
import { renderConfiguredAliasesList, closeAliasModal } from './aliases.js';
import { closeStudentDetailModal } from './detail.js';

/**
 * ============================================================================
 * MODALS & BEHEER FUNCTIES
 * ============================================================================
 */

export function toggleTokenModal() {
  const open = !isOpen('tokenModal');
  if (open) {
    document.getElementById('tokenInput').value = getToken();
    document.getElementById('teacherUsernameInput').value = localStorage.getItem(STORAGE_KEYS.TEACHER) || '';
  }
  setModal('tokenModal', open);
  if (open) document.getElementById('tokenInput').focus();
}

export function saveTokenAndTeacher() {
  setOrRemoveStored(STORAGE_KEYS.TOKEN, document.getElementById('tokenInput').value.trim());
  setOrRemoveStored(STORAGE_KEYS.TEACHER, document.getElementById('teacherUsernameInput').value.trim());
  toggleTokenModal();
  state.reload();
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.TEACHER);
  document.getElementById('tokenInput').value = '';
  document.getElementById('teacherUsernameInput').value = '';
  toggleTokenModal();
  state.reload();
}

export function toggleTeamsModal() {
  const open = !isOpen('teamsModal');
  if (open) {
    renderConfiguredTeamsList();
    renderConfiguredAliasesList();
  }
  setModal('teamsModal', open);
}

// Klik op de donkere overlay (buiten de modal) sluit diezelfde modal
const overlayCloseHandlers = {
  teamsModal: () => toggleTeamsModal(),
  tokenModal: () => toggleTokenModal(),
  aliasModal: () => closeAliasModal(),
  teamNameModal: () => closeTeamNameModal(),
  studentDetailModal: () => closeStudentDetailModal()
};

export function closeOverlay(modalId) {
  const handler = overlayCloseHandlers[modalId];
  if (handler) handler();
}

// Escape sluit de bovenste open modal
export function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isOpen('aliasModal')) closeAliasModal();
    else if (isOpen('teamNameModal')) closeTeamNameModal();
    else if (isOpen('studentDetailModal')) closeStudentDetailModal();
    else if (isOpen('teamsModal')) toggleTeamsModal();
    else if (isOpen('tokenModal')) toggleTokenModal();
  });
}
