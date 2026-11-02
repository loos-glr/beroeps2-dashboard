import { createApp } from './lib/vue.js';
import { purgeLegacyCache } from './util/storage.js';
import { bootstrap } from './store/session.js';
import App from './components/App.js';

purgeLegacyCache();
createApp(App).mount('#app');
bootstrap();
