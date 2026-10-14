// File import/export (JSON, 3DS, OBJ, STL, glTF), including the minimal 3DS reader/writer.
import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = id => document.getElementById(id);

// --- 3DS format: minimal reader/writer (triangle meshes + diffuse colour). 3DS is Z-up, the scene is Y-up.
const MAIN = 0x4d4d, VERSION = 0x0002, EDIT = 0x3d3d, MESHVER = 0x3d3e, OBJECT = 0x4000, MESH = 0x4100,
  VERTS = 0x4110, FACES = 0x4120, FACEMAT = 0x4130, MATERIAL = 0xafff, MATNAME = 0xa000, DIFFUSE = 0xa020, COLOR24 = 0x0011;
const LIMIT = 65535;

const chunk = (id, ...parts) => {
  const body = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(6 + body);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, id, true); dv.setUint32(2, 6 + body, true);
  let o = 6;
  for (const p of parts) { out.set(new Uint8Array(p.buffer ?? p, p.byteOffset ?? 0, p.byteLength), o); o += p.byteLength; }
  return out;
};
const u16 = v => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, v, true); return a; };
const cstr = s => Uint8Array.from([...new TextEncoder().encode(s), 0]);

// objects: [{ name, color: '#rrggbb', positions: Float32Array (non-indexed, Y-up, world coordinates) }]
export function write3ds(objects) {
  const edit = [chunk(MESHVER, new Uint8Array(Uint32Array.of(3).buffer))];
  objects.forEach((o, n) => {
    const map = new Map(), verts = [], tris = [];
    const p = o.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = Math.fround(p[i]), y = Math.fround(-p[i + 2]), z = Math.fround(p[i + 1]);
      const k = x + ',' + y + ',' + z;
      let id = map.get(k);
      if (id === undefined) { id = verts.length / 3; map.set(k, id); verts.push(x, y, z); }
      tris.push(id);
    }
    if (verts.length / 3 > LIMIT || tris.length / 3 > LIMIT) throw new Error(`Object ${n + 1} has too many vertices/faces for 3DS (max. ${LIMIT})`);
    const vb = new Uint8Array(2 + verts.length * 4);
    new DataView(vb.buffer).setUint16(0, verts.length / 3, true);
    const vdv = new DataView(vb.buffer);
    verts.forEach((v, i) => vdv.setFloat32(2 + 4 * i, v, true));
    const fb = new Uint8Array(2 + tris.length / 3 * 8);
    const fdv = new DataView(fb.buffer);
    fdv.setUint16(0, tris.length / 3, true);
    for (let t = 0; t < tris.length / 3; t++) for (let k = 0; k < 3; k++) fdv.setUint16(2 + 8 * t + 2 * k, tris[3 * t + k], true);
    const matName = 'Mat' + (n + 1);
    const matAssign = new Uint8Array(cstr(matName).length + 2 + tris.length / 3 * 2);
    const mdv = new DataView(matAssign.buffer);
    matAssign.set(cstr(matName), 0);
    const off = cstr(matName).length;
    mdv.setUint16(off, tris.length / 3, true);
    for (let t = 0; t < tris.length / 3; t++) mdv.setUint16(off + 2 + 2 * t, t, true);
    const rgb = Uint8Array.from([1, 3, 5].map(i => parseInt(o.color.slice(i, i + 2), 16)));
    edit.push(chunk(OBJECT, cstr(o.name), chunk(MESH, chunk(VERTS, vb), chunk(FACES, fb, chunk(FACEMAT, matAssign)))));
    edit.push(chunk(MATERIAL, chunk(MATNAME, cstr(matName)), chunk(DIFFUSE, chunk(COLOR24, rgb))));
  });
  return chunk(MAIN, chunk(VERSION, new Uint8Array(Uint32Array.of(3).buffer)), chunk(EDIT, ...edit)).buffer;
}

export function parse3ds(buffer) {
  const dv = new DataView(buffer);
  if (buffer.byteLength < 6 || dv.getUint16(0, true) !== MAIN) throw new Error('Not a 3DS file');
  const objects = [], mats = new Map();
  const readStr = (pos, end) => { let s = ''; while (pos < end && dv.getUint8(pos)) s += String.fromCharCode(dv.getUint8(pos++)); return [s, pos + 1]; };
  const walk = (start, end, ctx) => {
    for (let p = start; p + 6 <= end;) {
      const id = dv.getUint16(p, true), len = dv.getUint32(p + 2, true);
      if (len < 6) break;
      const body = p + 6, next = Math.min(p + len, end);
      if (id === EDIT || id === MESH) walk(body, next, ctx);
      else if (id === OBJECT) {
        const [name, pos] = readStr(body, next);
        const obj = { name, verts: null, faces: null, mat: null };
        objects.push(obj);
        walk(pos, next, obj);
      } else if (id === VERTS && ctx) {
        const n = dv.getUint16(body, true);
        ctx.verts = new Float32Array(3 * n);
        for (let i = 0; i < 3 * n; i++) ctx.verts[i] = dv.getFloat32(body + 2 + 4 * i, true);
      } else if (id === FACES && ctx) {
        const n = dv.getUint16(body, true);
        ctx.faces = new Uint16Array(3 * n);
        for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) ctx.faces[3 * t + k] = dv.getUint16(body + 2 + 8 * t + 2 * k, true);
        walk(body + 2 + 8 * n, next, ctx);
      } else if (id === FACEMAT && ctx) ctx.mat = readStr(body, next)[0];
      else if (id === MATERIAL) {
        const m = { name: '', color: '#cccccc' };
        walk(body, next, m);
        mats.set(m.name, m.color);
      } else if (id === MATNAME && ctx) ctx.name = readStr(body, next)[0];
      else if (id === DIFFUSE && ctx) walk(body, next, { diffuse: ctx });
      else if (id === COLOR24 && ctx?.diffuse) {
        ctx.diffuse.color = '#' + [0, 1, 2].map(i => dv.getUint8(body + i).toString(16).padStart(2, '0')).join('');
      }
      p += len;
    }
  };
  walk(6, buffer.byteLength, null);
  return objects.filter(o => o.verts && o.faces?.length).map(o => {
    const positions = new Float32Array(o.faces.length * 3);
    o.faces.forEach((vi, i) => {
      const x = o.verts[3 * vi], y = o.verts[3 * vi + 1], z = o.verts[3 * vi + 2];
      positions.set([x, z, -y], 3 * i);
    });
    return { name: o.name, color: mats.get(o.mat) ?? '#4c8bf5', positions };
  });
}

// --- File menu wiring

// Wires up the File menu: JSON/3DS/OBJ/STL/glTF export and import.
// ctx: { boxes (live array of meshes), addBox, applyColors, clearAll, commit, baseHex, round }
export function setupIO({ boxes, addBox, applyColors, clearAll, commit, baseHex, round }) {
  // Import / Export
  $('exp').onclick = () => {
    const data = boxes.map(m => ({
      name: m.userData.name, position: m.position.toArray().map(round), size: m.scale.toArray().map(round),
      rotation: [m.rotation.x, m.rotation.y, m.rotation.z].map(round), color: baseHex(m), type: m.userData.type, params: m.userData.params,
      ...(m.userData.custom && { positions: Array.from(m.userData.model.positions, v => Math.round(v * 1e4) / 1e4), faces: Array.from(m.userData.model.faceOfTri) }),
      ...(m.userData.model?.faceColors.size && { faceColors: [...m.userData.model.faceColors] })
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'szene.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  // Scene with transforms baked in, without outline lines (for OBJ/STL/glTF)
  function bakedScene() {
    const g = new THREE.Group();
    boxes.forEach((m, i) => {
      m.updateMatrixWorld(true);
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: m.material.color.clone(), roughness: 0.6, vertexColors: m.material.vertexColors }));
      mesh.name = m.userData.name;
      g.add(mesh);
    });
    return g;
  }
  function disposeBaked(g) { g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }

  async function exportAs(fmt) {
    if (!boxes.length) { alert('The scene is empty'); return; }
    try {
      if (fmt === '3ds') {
        const objs = boxes.map((m, i) => {
          m.updateMatrixWorld(true);
          const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
          const pos = g.getAttribute('position'), out = new Float32Array(pos.count * 3), v = new THREE.Vector3();
          for (let k = 0; k < pos.count; k++) v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld).toArray(out, 3 * k);
          if (g !== m.geometry) g.dispose();
          return { name: m.userData.name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10), color: baseHex(m), positions: out };
        });
        download(new Blob([write3ds(objs)], { type: 'application/octet-stream' }), 'szene.3ds');
        return;
      }
      const g = bakedScene();
      try {
        if (fmt === 'obj') download(new Blob([new OBJExporter().parse(g)], { type: 'text/plain' }), 'szene.obj');
        else if (fmt === 'stl') download(new Blob([new STLExporter().parse(g, { binary: true })], { type: 'model/stl' }), 'szene.stl');
        else if (fmt === 'glb') {
          const buf = await new Promise((res, rej) => new GLTFExporter().parse(g, res, rej, { binary: true }));
          download(new Blob([buf], { type: 'model/gltf-binary' }), 'szene.glb');
        }
      } finally { disposeBaked(g); }
    } catch (err) { alert(err.message || 'Export failed'); }
  }
  document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => exportAs(b.dataset.exp));

  // Imported meshes -> editable objects (centre becomes the origin)
  function addImported(list) {
    if (!list.length) throw new Error('No objects found');
    clearAll();
    for (const o of list) {
      const box = new THREE.Box3(), v = new THREE.Vector3();
      for (let i = 0; i < o.positions.length; i += 3) box.expandByPoint(v.fromArray(o.positions, i));
      const c = box.getCenter(new THREE.Vector3());
      for (let i = 0; i < o.positions.length; i += 3) { o.positions[i] -= c.x; o.positions[i + 1] -= c.y; o.positions[i + 2] -= c.z; }
      let color = o.color, faceColors;
      if (o.triColors) {
        // Most frequent triangle colour becomes the object colour, the rest become per-face colours
        const count = new Map();
        o.triColors.forEach(h => count.set(h, (count.get(h) || 0) + 1));
        color = [...count].sort((a, b) => b[1] - a[1])[0][0];
        if (count.size > 1) faceColors = o.triColors;
      }
      const mesh = addBox({ position: c, size: new THREE.Vector3(1, 1, 1), color, positions: o.positions, name: o.name });
      if (faceColors) {
        const model = mesh.userData.model, map = new Map();
        for (let t = 0; t < model.nTri; t++) {
          const f = model.faceOfTri[t];
          if (!map.has(f) && faceColors[t] !== color) map.set(f, faceColors[t]);
        }
        model.faceColors = map;
        applyColors(mesh);
      }
    }
    commit();
  }
  function meshesOf(root) {
    root.updateMatrixWorld(true);
    const list = [];
    root.traverse(o => {
      if (!o.isMesh || !o.geometry.getAttribute('position')) return;
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const entry = { name: o.name, color: '#' + (mat?.color ?? new THREE.Color('#4c8bf5')).getHexString(), positions: Float32Array.from(g.getAttribute('position').array) };
      // Vertex colours (per-face colours exported as glTF COLOR_0): one colour per triangle
      const ca = g.getAttribute('color');
      if (ca && ca.count === g.getAttribute('position').count) {
        const c = new THREE.Color();
        entry.triColors = [];
        for (let i = 0; i < ca.count; i += 3) entry.triColors.push('#' + c.setRGB(ca.getX(i), ca.getY(i), ca.getZ(i)).getHexString());
      }
      list.push(entry);
      g.dispose();
    });
    return list;
  }
  document.querySelectorAll('[data-imp]').forEach(b => b.onclick = () => { $('file').accept = b.dataset.imp; $('file').click(); });
  $('file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      if (ext === '3ds') addImported(parse3ds(await f.arrayBuffer()));
      else if (ext === 'obj') addImported(meshesOf(new OBJLoader().parse(await f.text())));
      else if (ext === 'stl') {
        const geo = new STLLoader().parse(await f.arrayBuffer());
        addImported(meshesOf(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#4c8bf5' }))));
      } else if (ext === 'glb' || ext === 'gltf') {
        const data = ext === 'glb' ? await f.arrayBuffer() : await f.text();
        const gltf = await new Promise((res, rej) => new GLTFLoader().parse(data, '', res, rej));
        addImported(meshesOf(gltf.scene));
      } else {
        const data = JSON.parse(await f.text());
        clearAll();
        for (const b of data) addBox({ position: new THREE.Vector3(...b.position), size: new THREE.Vector3(...b.size),
          color: b.color, rotation: b.rotation, type: b.type, params: b.params, positions: b.positions, faces: b.faces, faceColors: b.faceColors, name: b.name });
        commit();
      }
    } catch (err) { alert('Import failed: ' + (err.message || 'Invalid file')); }
    e.target.value = '';
  };
}
