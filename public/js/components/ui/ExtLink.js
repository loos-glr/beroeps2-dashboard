import { html } from '../../lib/vue.js';
import { safeGithubUrl } from '../../util/links.js';

/** Externe GitHub-link; bij een onveilige URL wordt alleen de tekst getoond. */
export default {
  name: 'ExtLink',
  props: { href: String, cls: { type: String, default: '' }, title: { type: String, default: '' } },
  setup(props, { slots }) {
    return () => {
      const safe = safeGithubUrl(props.href);
      return safe
        ? html`<a href=${safe} target="_blank" rel="noopener noreferrer" class=${props.cls} title=${props.title || null}>${slots.default?.()}</a>`
        : html`<span class=${props.cls}>${slots.default?.()}</span>`;
    };
  },
};
