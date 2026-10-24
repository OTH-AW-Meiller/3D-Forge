// Fills every [data-app] element with values from config.js
import { APP_NAME, APP_VERSION, APP_SUBTITLE, APP_COPYRIGHT } from './config.js';

const values = { name: APP_NAME, version: APP_VERSION, subtitle: APP_SUBTITLE, copyright: APP_COPYRIGHT, 'short-version': 'v' + APP_VERSION,
  'full-version': 'Version ' + APP_VERSION, title: `${APP_NAME} ${APP_VERSION} – ${APP_SUBTITLE}`, about: 'About ' + APP_NAME };
document.querySelectorAll('[data-app]').forEach(el => { el.textContent = values[el.dataset.app]; });
document.title = values.title;
document.getElementById('logoBtn').title = values.about;
