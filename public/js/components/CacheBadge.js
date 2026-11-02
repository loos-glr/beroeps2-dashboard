import { html } from '../lib/vue.js';
import { CACHE_BADGES } from '../util/status.js';
import { formatAge } from '../util/format.js';
import Pill from './ui/Pill.js';

export default {
  name: 'CacheBadge',
  props: { team: { type: Object, required: true } },
  setup(props) {
    return () => {
      const t = props.team;
      const b = CACHE_BADGES[t.cacheStatus] ?? CACHE_BADGES.error;
      const age = t.fetchedAt ? formatAge(t.fetchedAt) : '';
      const label = t.cacheStatus === 'fresh' && age ? `${b.label} (${age})` : b.label;
      return html`<${Pill} cls=${`${b.cls} cache-badge`} icon=${b.icon} title=${t.error || (t.fetchedAt ? `Opgehaald ${age}` : '')}>${label}<//>`;
    };
  },
};
