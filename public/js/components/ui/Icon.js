import { html } from '../../lib/vue.js';

/** Icoon uit de sprite (assets/icons.svg): <${Icon} name="refresh" /> */
export default {
  name: 'Icon',
  props: { name: { type: String, required: true } },
  setup(props) {
    return () => html`<svg class="i" aria-hidden="true"><use href=${`assets/icons.svg#i-${props.name}`}></use></svg>`;
  },
};
