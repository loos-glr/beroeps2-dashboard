import { html } from '../../lib/vue.js';
import Icon from './Icon.js';

export default {
  name: 'Pill',
  props: { cls: { type: String, default: 'muted' }, icon: String, title: String },
  setup(props, { slots }) {
    return () => html`<span class=${`pill ${props.cls}`} title=${props.title || null}>${props.icon ? html`<${Icon} name=${props.icon} />` : null}${slots.default?.()}</span>`;
  },
};
