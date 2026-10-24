// Creates the App Store screenshots in store/screenshots/ (2880x1800) by driving a headless Chrome via the DevTools protocol.
// Uses the app's window.webmcp tools to build the scenes. Needs Google Chrome and Node 22+; no npm packages.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'store', 'screenshots');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1440, H = 900, SCALE = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/index.html`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-shots-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { target = (await (await fetch('http://localhost:9333/json/list')).json()).find(t => t.type === 'page'); } catch {}
    }
    if (!target) throw new Error('Chrome did not start');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    const run = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const tool = (name, args = {}) => run(`window.webmcp.call(${JSON.stringify(name)}, ${JSON.stringify(args)}).then(r => { const t = JSON.parse(r.content[0].text); if (t.error) throw new Error(${JSON.stringify(name)} + ': ' + t.error); return t; })`);
    const shading = mode => run(`document.querySelector('[data-shading="${mode}"]').click()`);
    const shot = async name => {
      await sleep(700);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, name), Buffer.from(data, 'base64'));
      console.log('wrote', name);
    };

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
    await send('Page.navigate', { url });
    await sleep(2500);
    await run(`document.getElementById('splash').click()`);
    await sleep(800);
    await shot('00-splash-check.png').catch(() => {});
    fs.rmSync(path.join(outDir, '00-splash-check.png'), { force: true });

    const buildScene = async () => {
      await tool('clear_scene');
      await tool('create_object', { type: 'box', params: { w: 6, h: 0.4, d: 4 }, position: [0, 0.2, 0], color: '#8a8f9c', name: 'Base' });
      await tool('create_object', { type: 'cylinder', params: { d: 0.9, h: 2.2 }, position: [-2, 1.5, 0], color: '#4c8bf5', name: 'Pillar A' });
      await tool('create_object', { type: 'cylinder', params: { d: 0.9, h: 2.2 }, position: [2, 1.5, 0], color: '#4c8bf5', name: 'Pillar B' });
      await tool('create_object', { type: 'box', params: { w: 5.4, h: 0.35, d: 1.3 }, position: [0, 2.77, 0], color: '#c0504d', name: 'Beam' });
      await tool('create_object', { type: 'sphere', params: { d: 1.3 }, position: [0, 3.6, 0], color: '#e5a44a', name: 'Orb' });
    };

    // 1 Object mode with multi-selection
    await buildScene();
    await tool('select_objects', { names: ['Beam', 'Orb'] });
    await shot('01-object-mode.png');

    // 2 Rendered shading
    await tool('select_objects', { names: [] });
    await shading('better');
    await shot('02-rendered.png');
    await shading('standard');

    // 3 Hide / lock via the object list buttons
    await tool('set_object_props', { name: 'Base', locked: true });
    await tool('set_object_props', { name: 'Orb', hidden: true });
    await tool('select_objects', { names: ['Pillar A', 'Pillar B'] });
    await shot('03-object-list-hide-lock.png');

    // 4 Boolean subtract
    await tool('clear_scene');
    await tool('create_object', { type: 'box', params: { w: 3, h: 3, d: 3 }, position: [0, 1.5, 0], color: '#4c8bf5', name: 'Block' });
    await tool('create_object', { type: 'sphere', params: { d: 3.6 }, position: [0.6, 2.1, 0.8], color: '#e5a44a', name: 'Cutter' });
    await tool('boolean_operation', { names: ['Block', 'Cutter'], op: 'subtract' });
    await shading('better');
    await shot('04-boolean.png');
    await shading('standard');

    // 5 Edit mode: subdivided box with selected faces
    await tool('clear_scene');
    await tool('create_object', { type: 'box', params: { w: 3, h: 2, d: 3 }, position: [0, 1, 0], color: '#4c8bf5', name: 'Box' });
    await tool('enter_edit_mode', { name: 'Box', kind: 'face' });
    await tool('select_sub_objects', { all: true });
    await tool('edit_subdivide');
    await tool('select_sub_objects', { all: true });
    const ids = (await tool('get_edit_state')).selection.faces;
    await tool('select_sub_objects', { ids: ids.slice(0, 6) });
    await shot('05-edit-mode.png');

    ws.close();
  } finally {
    chrome.kill();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exit(1); });
