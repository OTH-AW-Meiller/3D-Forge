// Copies the static web files into dist-app/, the frontend folder bundled by Tauri
// (the project root itself also contains node_modules, src-tauri, ...).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-app');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const item of ['index.html', 'css', 'js', 'icons', 'lib']) {
  const src = path.join(root, item);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, item), { recursive: true });
}
if (!fs.existsSync(path.join(out, 'lib/three/build/three.module.js'))) {
  console.warn('WARNING: lib/three is missing, the app would load three.js from the CDN and need internet. See lib/README.txt.');
}
