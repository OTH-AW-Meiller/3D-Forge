// App entry point: wires scene, toolbar, panels, object list, undo/redo and navigation together.
// Related modules: stage.js (3D stage), io.js (file import/export), shapes.js (primitives),
// subedit.js (vertex/edge/face editor).
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { SubObjectEditor, createGeometry, applyColors, outlineGeometry } from './subedit.js';
import { createStage } from './stage.js';
import { setupIO } from './io.js';
import { setupShortcuts } from './shortcuts.js';
import { SHAPES, defaultParams, normalizeParams, buildShape } from './shapes.js';

const $ = id => document.getElementById(id);
const container = $('view');

const { scene, camera, renderer, orbit, ground, resize } = createStage(container);

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSpace('local');
scene.add(gizmo);
const editor = new SubObjectEditor({ camera, dom: renderer.domElement, gizmo, scene, snap: v => snapV(v) });
editor.onSelectionChange = () => updateToolbar();
editor.onMessage = msg => { $('status').textContent = msg; setTimeout(() => { $('status').textContent = `${boxes.length} objects`; }, 2500); };
gizmo.addEventListener('dragging-changed', e => orbit.enabled = !e.value);
gizmo.addEventListener('objectChange', () => { if (editor.active) return; applySnapToSelection(); syncPanel(); });

const boxes = [];
let selected = null;
let mode = 'place';
let shape = 'box';

// Grid 0 = off (continuous movement)
function snapV(v) { const s = +$('snap').value; return s > 0 ? Math.round(v / s) * s : v; }
const baseHex = m => '#' + m.userData.baseColor.getHexString();
const round = v => Math.round(v * 1000) / 1000;

function uniqueName(base) {
  const used = new Set(boxes.map(b => b.userData.name));
  if (base && !used.has(base)) return base;
  base = (base || '').replace(/ \d+$/, '') || 'Object';
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

function addBox({ position, size, color, rotation, type = 'box', params, positions, faces, faceColors, name }) {
  if (!SHAPES[type]) type = 'box';
  params = normalizeParams(type, params);
  let geo, edges, model = null;
  if (positions) {
    ({ geometry: geo, model } = createGeometry(positions, faces));
    edges = outlineGeometry(geo, model);
  } else {
    ({ geometry: geo, edges } = buildShape(type, params));
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  Object.assign(mesh.userData, { type, params, baseColor: new THREE.Color(color), name: uniqueName(name || SHAPES[type].label + ' 1') });
  if (model) {
    Object.assign(mesh.userData, { custom: true, model });
    if (faceColors) model.faceColors = new Map(faceColors);
    applyColors(mesh);
  }
  const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
  outline.userData.own = true;
  mesh.userData.outline = outline;
  mesh.add(outline);
  mesh.position.copy(position);
  if (size) mesh.scale.copy(size);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  boxes.push(mesh);
  return mesh;
}

// Shape parameters (remembered per shape) and the placement preview
const shapeParams = Object.fromEntries(Object.keys(SHAPES).map(t => [t, defaultParams(t)]));
let ghostSize = new THREE.Vector3(1, 1, 1);
const ghost = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x4c8bf5, transparent: true, opacity: 0.35, depthWrite: false }));
ghost.visible = false;
scene.add(ghost);

function rebuildGhost() {
  const { geometry, size } = buildShape(shape, shapeParams[shape]);
  ghost.geometry.dispose();
  ghost.geometry = geometry;
  ghostSize = size;
}

function renderParams() {
  const def = SHAPES[shape];
  $('createTitle').textContent = 'New: ' + def.label;
  const box = $('params');
  box.replaceChildren();
  for (const f of def.fields) {
    const label = document.createElement('label');
    label.textContent = f.label;
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', value: shapeParams[shape][f.key], min: f.min, step: f.step });
    if (f.max !== undefined) input.max = f.max;
    input.addEventListener('input', () => {
      if (input.value === '' || !Number.isFinite(+input.value)) return;
      shapeParams[shape] = normalizeParams(shape, { ...shapeParams[shape], [f.key]: +input.value });
      rebuildGhost();
    });
    // Reset to the valid value when the field loses focus
    input.addEventListener('change', () => { input.value = shapeParams[shape][f.key]; });
    box.append(label, input);
  }
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

// Computes the placement position (centre) of a new object under the mouse pointer
function placementAt(e) {
  setPointer(e);
  const size = ghostSize;
  const hit = raycaster.intersectObjects([...boxes, ground], false)[0];
  if (!hit) return null;
  const p = new THREE.Vector3();
  if (hit.object === ground) {
    p.set(snapV(hit.point.x), size.y / 2, snapV(hit.point.z));
  } else {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const ax = ['x', 'y', 'z'].reduce((a, b) => Math.abs(n[b]) > Math.abs(n[a]) ? b : a);
    const bounds = new THREE.Box3().setFromObject(hit.object);
    p.set(snapV(hit.point.x), snapV(hit.point.y), snapV(hit.point.z));
    p[ax] = n[ax] > 0 ? bounds.max[ax] + size[ax] / 2 : bounds.min[ax] - size[ax] / 2;
  }
  return { position: p, size };
}

function select(mesh) {
  if (selected) selected.material.emissive.setHex(0x000000);
  selected = mesh;
  if (mesh) {
    mesh.material.emissive.setHex(0x222222);
    gizmo.attach(mesh);
  } else gizmo.detach();
  updateToolbar();
  syncPanel();
}

function syncPanel() {
  if (!selected) return;
  const m = selected;
  const d = THREE.MathUtils.radToDeg;
  [['px', m.position.x], ['py', m.position.y], ['pz', m.position.z],
   ['sx', m.scale.x], ['sy', m.scale.y], ['sz', m.scale.z],
   ['rx', d(m.rotation.x)], ['ry', d(m.rotation.y)], ['rz', d(m.rotation.z)]]
    .forEach(([id, v]) => $(id).value = round(v));
  $('col').value = baseHex(m);
}

function applySnapToSelection() {
  if (!selected) return;
  const m = selected;
  if (gizmo.mode === 'translate') m.position.set(snapV(m.position.x), snapV(m.position.y), snapV(m.position.z));
}

function setMode(m) {
  if (m === 'edit' && !selected) return;
  if (mode === 'edit' && m !== 'edit') {
    editor.exit();
    if (selected) gizmo.attach(selected);
  }
  mode = m;
  if (m === 'edit') { gizmo.detach(); editor.enter(selected); }
  $('mSelect').classList.toggle('active', m === 'select');
  $('mCreate').classList.toggle('active', m === 'place');
  $('secCreate').hidden = m !== 'place';
  $('secSel').hidden = m === 'place';
  $('gCreate').classList.toggle('open', m === 'place');
  document.querySelectorAll('[data-shape]').forEach(b => b.classList.toggle('active', m === 'place' && b.dataset.shape === shape));
  if (m === 'place') select(null); else ghost.visible = false;
  updateToolbar();
}
function setSub(kind) {
  document.querySelectorAll('[data-sub]').forEach(b => b.classList.toggle('active', b.dataset.sub === kind));
  if (mode === 'edit') editor.setKind(kind); else editor.kind = kind;
  updateToolbar();
}
const ADD_TITLES = { vertex: 'Add vertex: click in the view', edge: 'Connect two selected points with a new edge', face: 'Extrude selected faces' };
const DEL_TITLES = { vertex: 'Remove selected vertices', edge: 'Remove selected edges / merge faces', face: 'Delete selected faces' };
function subAdd() { if (mode !== 'edit' || !editor.canAdd()) return; editor.add(); commit(); updateToolbar(); }
function subDel() { if (mode !== 'edit' || !editor.canRemove()) return; editor.remove(); commit(); updateToolbar(); }
function subChamfer() {
  if (mode !== 'edit' || !editor.canChamfer()) return;
  if (editor.chamferEdges(parseFloat($('chamferW').value))) commit();
  updateToolbar();
}
function subDivide() {
  if (mode !== 'edit' || !editor.canSubdivide()) return;
  if (editor.subdivide()) commit();
  updateToolbar();
}
$('subDivide').onclick = subDivide;
$('subChamfer').onclick = subChamfer;
$('subAdd').onclick = subAdd;
$('subDel').onclick = subDel;
document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => setSub(b.dataset.sub));
$('mEdit').onclick = () => setMode(mode === 'edit' ? 'select' : 'edit');
function setShape(t) {
  shape = t;
  renderParams();
  rebuildGhost();
  setMode('place');
}
document.querySelectorAll('[data-shape]').forEach(b => b.onclick = () => setShape(b.dataset.shape));
$('mSelect').onclick = () => setMode('select');
$('mCreate').onclick = () => (mode === 'place' ? setMode('select') : setShape(shape));
function updateToolbar() {
  const editing = mode === 'edit';
  for (const id of ['tMove', 'tRot', 'tScale']) $(id).disabled = !selected;
  for (const id of ['dup', 'del']) $(id).disabled = !selected || editing;
  $('mEdit').disabled = !selected;
  $('mEdit').classList.toggle('active', editing);
  $('gEdit').classList.toggle('open', editing);
  document.querySelectorAll('[data-sub]').forEach(b => b.disabled = !editing);
  $('subAdd').disabled = !editing || !editor.canAdd();
  $('subDel').disabled = !editing || !editor.canRemove();
  $('subDivide').disabled = !editing || !editor.canSubdivide();
  $('subChamfer').hidden = !editing || editor.kind !== 'edge';
  $('chamferRow').hidden = $('subChamfer').hidden;
  $('subChamfer').disabled = !editing || !editor.canChamfer();
  $('subAdd').classList.toggle('active', editing && editor.addMode);
  $('subAdd').dataset.tip = ADD_TITLES[editor.kind];
  $('subDel').dataset.tip = DEL_TITLES[editor.kind];
  $('props').classList.toggle('disabled', !selected);
  if (!editing) { $('lblS').textContent = 'Scale'; $('lblR').textContent = 'Rot °'; }
}

function setTool(t) {
  gizmo.setMode(t);
  $('tMove').classList.toggle('active', t === 'translate');
  $('tRot').classList.toggle('active', t === 'rotate');
  $('tScale').classList.toggle('active', t === 'scale');
}
$('tMove').onclick = () => setTool('translate');
$('tRot').onclick = () => setTool('rotate');
$('tScale').onclick = () => setTool('scale');

function setSpace(s) {
  gizmo.setSpace(s);
  $('spaceLbl').textContent = s === 'local' ? 'Local' : 'Global';
  $('tSpace').classList.toggle('active', s === 'local');
  if (editor.active) editor.updatePivot();
}
$('tSpace').onclick = () => setSpace(gizmo.space === 'local' ? 'world' : 'local');

// Colour of the selected faces
$('fcol').addEventListener('input', () => { editor.setFaceColor($('fcol').value); fcolKey = ''; });
$('fcol').addEventListener('change', commit);
$('fcolReset').onclick = () => { editor.resetFaceColor(); fcolKey = ''; commit(); };

// Input fields -> selection
function editFieldsChanged(id) {
  const g = p => [+$(p + 'x').value || 0, +$(p + 'y').value || 0, +$(p + 'z').value || 0];
  const ok = id[0] === 'p' ? editor.applyPanel({ pos: g('p') })
    : id[0] === 's' ? editor.applyPanel({ scale: g('s').map(v => Math.max(0.01, v)) })
    : editor.applyPanel({ rot: g('r') });
  if (ok) { syncEditPanel(true); updateToolbar(); }
}
for (const id of ['px', 'py', 'pz', 'sx', 'sy', 'sz', 'rx', 'ry', 'rz']) {
  $(id).addEventListener('change', () => { if (editor.active) editFieldsChanged(id); });
}
// In edit mode the panel shows the centre (world), scale 1 and rotation 0 of the sub-object selection
document.querySelectorAll('[data-mirror]').forEach(c => c.onchange = () => editor.setMirror(c.dataset.mirror, c.checked));
let fcolKey = '';
function syncEditPanel(force) {
  $('mirrorRow').hidden = !editor.active;
  if (!editor.active) { $('faceColRow').hidden = true; return; }
  const has = editor.hasSelection() && editor.gizmo.object === editor.pivot;
  $('props').classList.toggle('disabled', !has);
  $('lblS').textContent = 'Scale ×'; $('lblR').textContent = 'Rotate °';
  const showFc = editor.kind === 'face' && editor.hasSelection();
  $('faceColRow').hidden = !showFc;
  const fkey = showFc ? [...editor.selF].join(',') + '|' + editor.model.faceColors.size : '';
  if (showFc && fkey !== fcolKey) { fcolKey = fkey; $('fcol').value = editor.selectedFaceColor(); }
  if (!showFc) fcolKey = '';
  if (!has) return;
  const a = document.activeElement;
  if (!force && a && a.closest && a.closest('#props') && a.tagName === 'INPUT') return;
  const p = editor.pivot.position;
  [['px', p.x], ['py', p.y], ['pz', p.z], ['sx', 1], ['sy', 1], ['sz', 1], ['rx', 0], ['ry', 0], ['rz', 0]]
    .forEach(([id, v]) => $(id).value = round(v));
}
for (const id of ['px', 'py', 'pz', 'sx', 'sy', 'sz', 'rx', 'ry', 'rz']) {
  $(id).addEventListener('input', () => {
    if (!selected || editor.active) return;
    const v = id => +$(id).value || 0;
    const r = THREE.MathUtils.degToRad;
    selected.position.set(v('px'), v('py'), v('pz'));
    selected.scale.set(Math.max(0.01, v('sx')), Math.max(0.01, v('sy')), Math.max(0.01, v('sz')));
    selected.rotation.set(r(v('rx')), r(v('ry')), r(v('rz')));
  });
}
$('col').addEventListener('input', () => {
  if (!selected) return;
  selected.userData.baseColor.set($('col').value);
  applyColors(selected);
});
$('ncol').addEventListener('input', () => ghost.material.color.set($('ncol').value));

function disposeMesh(m) {
  scene.remove(m);
  m.material.dispose();
  m.geometry.dispose();
  m.userData.outline.geometry.dispose();
}
function deleteSelected() {
  if (!selected || mode === 'edit') return;
  const m = selected;
  select(null);
  boxes.splice(boxes.indexOf(m), 1);
  disposeMesh(m);
  commit();
}
function duplicateSelected() {
  if (!selected || mode === 'edit') return;
  const s = selected;
  const c = addBox({ position: s.position.clone().add(new THREE.Vector3(+$('snap').value || 0.5, 0, 0)),
    size: s.scale.clone(), color: s.userData.baseColor.clone(), rotation: [s.rotation.x, s.rotation.y, s.rotation.z], type: s.userData.type, params: { ...s.userData.params },
    positions: s.userData.model?.positions, faces: s.userData.model?.faceOfTri, faceColors: s.userData.model?.faceColors, name: s.userData.name });
  select(c);
  commit();
}
$('del').onclick = deleteSelected;
$('dup').onclick = duplicateSelected;

// Tell clicks from drags so orbiting does not place anything
let down = null;
const dom = renderer.domElement;
dom.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button, onGizmo: !!gizmo.axis }; });
dom.addEventListener('pointermove', e => {
  if (mode !== 'place' || e.buttons) { if (e.buttons) ghost.visible = false; return; }
  const pl = placementAt(e);
  if (!pl) { ghost.visible = false; return; }
  ghost.visible = true;
  ghost.position.copy(pl.position);
});
dom.addEventListener('pointerleave', () => ghost.visible = false);
dom.addEventListener('pointerup', e => {
  if (!down || down.b !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const onGizmo = down.onGizmo;
  down = null;
  if (gizmo.dragging || onGizmo) return;
  if (mode === 'edit') {
    if (editor.addMode) { editor.insertPoint(e); commit(); } else editor.pick(e, e.shiftKey);
  } else if (mode === 'place') {
    const pl = placementAt(e);
    if (pl) {
      select(addBox({ position: pl.position, color: $('ncol').value, type: shape, params: shapeParams[shape] }));
      commit();
    }
  } else {
    setPointer(e);
    const hit = raycaster.intersectObjects(boxes, false)[0];
    select(hit ? hit.object : null);
  }
});

// Keyboard shortcuts: the key table lives in shortcuts.js, this maps action ids to app functions
const clickEl = sel => document.querySelector(sel).click();
const stepSelection = d => {
  if (!boxes.length) return;
  const i = boxes.indexOf(selected);
  if (mode === 'place') setMode('select');
  select(boxes[i < 0 ? (d > 0 ? 0 : boxes.length - 1) : (i + d + boxes.length) % boxes.length]);
};
const toggleMirror = a => { const c = document.querySelector(`[data-mirror=${a}]`); c.checked = !c.checked; c.dispatchEvent(new Event('change')); };
const stepChamfer = d => { const w = $('chamferW'); w.value = Math.max(0.01, round(parseFloat(w.value || 0.1) + d * 0.05)); };
setupShortcuts({
  open: () => clickEl('[data-imp=".json"]'),
  save: () => $('exp').click(),
  clear: () => $('clear').click(),
  undo, redo,
  dup: duplicateSelected,
  del: deleteSelected,
  deselect: () => select(null),
  prev: () => stepSelection(-1),
  next: () => stepSelection(1),
  rename: () => { const inp = listEl.querySelector('.sel input'); if (!inp) return false; inp.readOnly = false; inp.focus(); inp.select(); },
  objColor: () => $('col').click(),
  select: () => setMode('select'),
  box: () => setShape('box'), sphere: () => setShape('sphere'), cylinder: () => setShape('cylinder'), tube: () => setShape('tube'),
  editMode: () => setMode(mode === 'edit' ? 'select' : 'edit'),
  move: () => setTool('translate'), rotate: () => setTool('rotate'), scale: () => setTool('scale'),
  space: () => setSpace(gizmo.space === 'local' ? 'world' : 'local'),
  snap: () => { $('snap').focus(); $('snap').select(); },
  focus: focusPivot,
  pvOrigin: () => setPivotMode('origin'), pvSel: () => setPivotMode('selection'),
  vertex: () => setSub('vertex'), edge: () => setSub('edge'), face: () => setSub('face'),
  selectAll: () => editor.selectAll(),
  subAdd, subDel, chamfer: subChamfer, subdivide: subDivide,
  chamferDown: () => stepChamfer(-1), chamferUp: () => stepChamfer(1),
  mirrorX: () => toggleMirror('x'), mirrorY: () => toggleMirror('y'), mirrorZ: () => toggleMirror('z'),
  faceColor: () => { if ($('faceColRow').hidden) return false; $('fcol').click(); },
  faceColorReset: () => { if ($('faceColRow').hidden) return false; $('fcolReset').click(); },
  editEsc: () => {
    if (editor.addMode) { editor.setAddMode(false); updateToolbar(); }
    else if (!editor.clearSelection()) setMode('select');
  },
  helpKeys: () => $('helpKeysDlg').showModal(),
  help: () => $('helpDlg').showModal(),
  helpEdit: () => $('helpEditDlg').showModal(),
  about: () => $('logoBtn').click(),
}, { edit: () => mode === 'edit', sel: () => !!selected });

setupIO({ boxes, addBox, applyColors, clearAll, commit, baseHex, round });

function clearAll() { if (mode === 'edit') setMode('select'); select(null); while (boxes.length) disposeMesh(boxes.pop()); }
$('clear').onclick = () => { if (!boxes.length || confirm('Delete all objects?')) { clearAll(); commit(); } };

addEventListener('resize', resize);
resize();

// Initial scene
addBox({ position: new THREE.Vector3(0, 0.5, 0), size: new THREE.Vector3(1, 1, 1), color: '#4c8bf5' });

renderer.setAnimationLoop(() => {
  trackSelection();
  stepNav();
  orbit.update();
  $('status').textContent = `${boxes.length} objects`;
  renderer.render(scene, camera);
});
updateToolbar();
setShape('box');

// Undo / redo via snapshots of the whole scene
const undoStack = [], redoStack = [];
let current = null;
const MAX_HISTORY = 100;
function snapshot() {
  return boxes.map(m => {
    const ed = editor.active && editor.mesh === m;
    return {
      name: m.userData.name, position: m.position.toArray(), size: m.scale.toArray(), rotation: [m.rotation.x, m.rotation.y, m.rotation.z],
      color: baseHex(m), type: m.userData.type, params: { ...m.userData.params },
      ...(m.userData.custom && (!ed || editor.changed || editor.wasCustom) && { positions: Array.from(m.userData.model.positions), faces: Array.from(m.userData.model.faceOfTri), ...(m.userData.model.faceColors.size && { faceColors: [...m.userData.model.faceColors] }) }),
    };
  });
}
function updateHistoryUI() {
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
}
function commit() {
  const s = JSON.stringify(snapshot());
  if (s === current) return;
  if (current !== null) { undoStack.push(current); if (undoStack.length > MAX_HISTORY) undoStack.shift(); }
  current = s;
  redoStack.length = 0;
  updateHistoryUI();
}
function restore(json) {
  const wasEdit = mode === 'edit';
  const idx = boxes.indexOf(selected);
  clearAll();
  for (const b of JSON.parse(json)) addBox({ position: new THREE.Vector3(...b.position), size: new THREE.Vector3(...b.size),
    color: b.color, rotation: b.rotation, type: b.type, params: b.params, positions: b.positions, faces: b.faces, faceColors: b.faceColors, name: b.name });
  if (mode !== 'place' && boxes[idx]) {
    select(boxes[idx]);
    if (wasEdit) setMode('edit');
  }
  updateToolbar();
}
function undo() {
  if (!undoStack.length) return;
  commit();
  if (!undoStack.length) return;
  redoStack.push(current);
  current = undoStack.pop();
  restore(current);
  updateHistoryUI();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(current);
  current = redoStack.pop();
  restore(current);
  updateHistoryUI();
}
$('undo').onclick = undo;
$('redo').onclick = redo;
gizmo.addEventListener('dragging-changed', e => { if (!e.value) commit(); });
for (const id of ['px', 'py', 'pz', 'sx', 'sy', 'sz', 'rx', 'ry', 'rz', 'col']) $(id).addEventListener('change', commit);
// 3D navigation: pivot = world origin or selection
let pivotMode = 'origin';
let navGoal = null;
let navKey = '';
function selectionCenter() {
  if (!selected) return null;
  if (editor.active && editor.hasSelection() && editor.gizmo.object === editor.pivot) return editor.pivot.position.clone();
  return new THREE.Box3().setFromObject(selected).getCenter(new THREE.Vector3());
}
function pivotPoint() { return pivotMode === 'origin' ? new THREE.Vector3(0, 0, 0) : selectionCenter(); }
function focusPivot() { const p = pivotPoint(); if (p) navGoal = p; }
function setPivotMode(p) {
  pivotMode = p;
  $('pvOrigin').classList.toggle('active', p === 'origin');
  $('pvSel').classList.toggle('active', p === 'selection');
  navKey = '';
  focusPivot();
}
$('pvOrigin').onclick = () => setPivotMode('origin');
$('pvSel').onclick = () => setPivotMode('selection');
$('pvFocus').onclick = focusPivot;
// In select mode the pivot follows selection changes
// Object list
const listEl = $('objList');
let listKey = '';
function syncList() {
  const key = boxes.map(b => b.userData.name).join('\n');
  if (key === listKey && listEl.children.length === boxes.length) {
    boxes.forEach((b, i) => listEl.children[i].classList.toggle('sel', b === selected));
    listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (listEl.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  listKey = key;
  const top = listEl.scrollTop;
  listEl.replaceChildren(...boxes.map(m => {
    const row = document.createElement('div');
    row.className = 'objRow' + (m === selected ? ' sel' : '');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = m.userData.name;
    inp.spellcheck = false;
    inp.title = 'Click to select, double-click to rename';
    inp.readOnly = true;
    row.onclick = () => { if (mode === 'edit') return; if (mode === 'place') setMode('select'); select(m); };
    inp.ondblclick = () => { inp.readOnly = false; inp.focus(); inp.select(); };
    inp.onkeydown = e => {
      if (e.key === 'Enter') inp.blur();
      else if (e.key === 'Escape') { inp.value = m.userData.name; inp.blur(); }
    };
    inp.onblur = () => {
      inp.readOnly = true;
      const v = inp.value.trim();
      if (v && v !== m.userData.name) { m.userData.name = ''; m.userData.name = uniqueName(v); commit(); }
      inp.value = m.userData.name;
      listKey = '';
    };
    row.append(inp);
    return row;
  }));
  listEl.scrollTop = top;
  listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
function trackSelection() {
  syncList();
  syncEditPanel();
  if (pivotMode !== 'selection' || gizmo.dragging) return;
  let key = selected ? selected.uuid : '';
  if (editor.active) key += '|' + editor.kind + [...editor.selV, ...editor.selE, ...editor.selF].join(',');
  if (key === navKey) return;
  navKey = key;
  focusPivot();
}
function stepNav() {
  if (!navGoal) return;
  camera.position.add(navGoal.clone().sub(orbit.target));
  orbit.target.copy(navGoal);
  navGoal = null;
}
setPivotMode('origin');

// Start in select mode with the initial box selected
setMode('select');
select(boxes[0]);
commit();

// Top menu
const menus = [...document.querySelectorAll('.menu')];
menus.forEach(mn => {
  mn.firstElementChild.onclick = e => { e.stopPropagation(); const o = !mn.classList.contains('open'); menus.forEach(x => x.classList.remove('open')); mn.classList.toggle('open', o); };
  mn.onmouseenter = () => { if (menus.some(x => x.classList.contains('open'))) { menus.forEach(x => x.classList.remove('open')); mn.classList.add('open'); } };
});
document.addEventListener('click', () => menus.forEach(x => x.classList.remove('open')));
$('helpBtn').addEventListener('click', () => $('helpDlg').showModal());
$('helpKeysBtn').addEventListener('click', () => $('helpKeysDlg').showModal());
$('helpEditBtn').addEventListener('click', () => $('helpEditDlg').showModal());
document.querySelectorAll('dialog.help [data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('.subhead').forEach(b => b.addEventListener('click', e => e.stopPropagation()));
