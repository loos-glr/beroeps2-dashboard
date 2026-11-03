import { html } from '../../lib/vue.js';

/** Voortgangsbalk; de breedte gaat via een :style-binding (CSSOM), dus CSP-veilig. */
export default {
  name: 'ProgressBar',
  props: {
    value: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    done: { type: Boolean, default: false },
    label: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const pct = props.max > 0 ? Math.min(100, (props.value / props.max) * 100) : 0;
      return html`<div class=${`b-bar ${props.done ? 'is-done' : ''}`} role="progressbar" aria-label=${props.label}
        aria-valuemin="0" aria-valuemax=${props.max} aria-valuenow=${Math.min(props.value, props.max)}>
        <i style=${{ width: `${pct}%` }}></i></div>`;
    };
  },
};
