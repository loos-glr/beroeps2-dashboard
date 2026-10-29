import { sameText } from './utils.js';

/**
 * Centrale, gedeelde applicatiestate.
 *
 * `state.rerender` en `state.reload` worden bij het opstarten door main.js
 * gevuld. Zo kunnen modules opnieuw renderen of herladen zonder elkaar
 * (circulair) te importeren.
 */
export const state = {
  /** Resultaten van de laatste laadactie: [{ team, data } | { team, error }] */
  lastResults: null,
  /** Actieve selectie in de ontdubbel-modal. */
  activeAliasUsername: '',
  activeAliasRepo: '',
  /** Repo waarvan de teamnaam wordt bewerkt. */
  activeTeamRepo: '',
  /** { repo, username } van de geopende studentdetailpagina. */
  activeStudentDetail: null,

  /** True tijdens een volledige laadactie van alle teams. */
  loading: false,
  /** Repo's (lowercase) waarvan op dit moment alleen dat team wordt ververst. */
  refreshingRepos: new Set(),

  /** Door main.js geregistreerd: dashboard + open detailmodal opnieuw renderen. */
  rerender: () => {},
  /** Door main.js geregistreerd: alle teams laden; `force` slaat de TTL-cache over (ETag-revalidatie). */
  reload: (force = false) => {}
};

/** Zoek de opgehaalde teamdata die bij een repo hoort. */
export function findTeamData(repo) {
  if (!repo || !Array.isArray(state.lastResults)) return null;
  const result = state.lastResults.find(r => r.data && sameText(r.data.repo, repo));
  return result ? result.data : null;
}
