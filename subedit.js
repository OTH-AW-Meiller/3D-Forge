// Sub-object editor (vertices / edges / faces): overlays, selection, picking and gizmo transforms.
// Operations live in mixin files: edit-topology.js (add/remove), edit-mirror.js, edit-chamfer.js, edit-extrude.js, edit-subdivide.js.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createGeometry, applyColors, outlineGeometry, nonIndexedPositions } from './model.js';
import { MirrorMethods } from './edit-mirror.js';
import { TopologyMethods } from './edit-topology.js';
import { ChamferMethods } from './edit-chamfer.js';
import { ExtrudeMethods } from './edit-extrude.js';
import { SubdivideMethods } from './edit-subdivide.js';

// Re-exported so callers only need this module
export { createGeometry, applyColors, outlineGeometry };

const ORANGE = 0xff9020;

const noRaycast = () => {};

export class SubObjectEditor {
  constructor({ camera, dom, gizmo, scene, snap }) {
    Object.assign(this, { camera, dom, gizmo, scene, snap });
    this.active = false;
    this.kind = 'vertex';
    this.mesh = null;
    this.pivot = new THREE.Object3D();
    this.center = new THREE.Vector3();
    scene.add(this.pivot);
    this.raycaster = new THREE.Raycaster();
    this.selV = new Set();
    this.selE = new Set();
    this.selF = new Set();
    this.drag = null;
    this.addMode = false;
    this.mirror = { x: false, y: false, z: false };
    gizmo.addEventListener('dragging-changed', e => {
      if (!this.active || gizmo.object !== this.pivot) return;
      if (e.value) this.beginDrag(); else this.endDrag();
    });
    gizmo.addEventListener('objectChange', () => { if (this.active && this.drag) this.dragMove(); });
  }

  enter(mesh) {
    this.mesh = mesh;
    this.active = true;
    this.changed = false;
    this.wasCustom = !!mesh.userData.custom;
    this.origGeo = mesh.geometry;
    if (!this.wasCustom) {
      const { geometry, model } = createGeometry(nonIndexedPositions(mesh.geometry));
      mesh.geometry = geometry;
      mesh.userData.model = model;
      mesh.userData.custom = true;
    }
    this.model = mesh.userData.model;
    if (mesh.userData.outline) mesh.userData.outline.visible = false;
    this.buildOverlays();
    this.setKind(this.kind);
  }

  exit() {
    if (!this.active) return;
    const mesh = this.mesh;
    this.gizmo.detach();
    this.disposeOverlays();
    const ol = mesh.userData.outline;
    if (!this.changed && !this.wasCustom) {
      mesh.geometry.dispose();
      mesh.geometry = this.origGeo;
      delete mesh.userData.custom;
      delete mesh.userData.model;
    } else if (this.changed && ol) {
      if (ol.userData.own) ol.geometry.dispose();
      ol.geometry = outlineGeometry(mesh.geometry, this.model);
      ol.userData.own = true;
    }
    if (ol) ol.visible = true;
    this.setAddMode(false);
    this.active = false;
    this.mesh = null;
    this.model = null;
    this.selV.clear(); this.selE.clear(); this.selF.clear();
  }

  setKind(kind) {
    this.kind = kind;
    this.setAddMode(false);
    this.selV.clear(); this.selE.clear(); this.selF.clear();
    this.vertPoints.visible = kind !== 'face';
    this.refreshSelection();
  }

  selectAll() {
    const m = this.model;
    if (this.kind === 'vertex') for (let i = 0; i < m.nVerts; i++) this.selV.add(i);
    else if (this.kind === 'edge') m.edges.forEach(e => this.selE.add(e.key));
    else m.faces.forEach((_, id) => this.selF.add(id));
    this.refreshSelection();
  }

  clearSelection() {
    const had = this.hasSelection();
    this.selV.clear(); this.selE.clear(); this.selF.clear();
    this.refreshSelection();
    return had;
  }

  setFaceColor(hex) {
    if (!this.active || this.kind !== 'face') return;
    this.selF.forEach(id => this.model.faceColors.set(id, hex));
    this.changed = true;
    applyColors(this.mesh);
  }

  resetFaceColor() {
    if (!this.active || this.kind !== 'face') return;
    this.selF.forEach(id => this.model.faceColors.delete(id));
    this.changed = true;
    applyColors(this.mesh);
  }

  selectedFaceColor() {
    for (const id of this.selF) { const h = this.model.faceColors.get(id); if (h) return h; }
    return '#' + this.mesh.userData.baseColor.getHexString();
  }

  hasSelection() { return this.selV.size + this.selE.size + this.selF.size > 0; }

  // --- Overlays -------------------------------------------------------
  buildOverlays() {
    const m = this.model;
    this.group = new THREE.Group();
    const mk = (obj, order) => { obj.frustumCulled = false; obj.raycast = noRaycast; obj.renderOrder = order; this.group.add(obj); return obj; };
    this.mirrorPlanes = {};
    for (const [axis, color, rotation] of [
      ['x', 0xff4f64, [0, Math.PI / 2, 0]],
      ['y', 0x57d58a, [Math.PI / 2, 0, 0]],
      ['z', 0x4f9fff, [0, 0, 0]],
    ]) {
      const plane = mk(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide,
      })), 0);
      plane.rotation.set(...rotation);
      this.mirrorPlanes[axis] = plane;
    }
    this.edgeLines = mk(new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.85 })), 1);
    this.vertPoints = mk(new THREE.Points(new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: false })), 2);
    this.selFaces = mk(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: ORANGE, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), 3);
    this.selLines = mk(new LineSegments2(new LineSegmentsGeometry(),
      new LineMaterial({ color: ORANGE, linewidth: 4, depthTest: false })), 4);
    this.selLines.onBeforeRender = r => { r.getSize(this._sz ||= new THREE.Vector2()); this.selLines.material.resolution.copy(this._sz); };
    this.selPoints = mk(new THREE.Points(new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: ORANGE, size: 9, sizeAttenuation: false, depthTest: false })), 5);
    this.edgeLines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.edges.length * 6), 3));
    this.vertPoints.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.verts.length), 3));
    this.refreshMirrorPlanes();
    this.refreshGeometryOverlays();
    this.mesh.add(this.group);
  }

  refreshMirrorPlanes() {
    if (!this.mirrorPlanes) return;
    let extent = 0;
    for (let i = 0; i < this.model.verts.length; i++) extent = Math.max(extent, Math.abs(this.model.verts[i]));
    const size = Math.max(2, extent * 2.2);
    for (const axis of ['x', 'y', 'z']) {
      const plane = this.mirrorPlanes[axis];
      plane.visible = this.mirror[axis];
      plane.scale.set(size, size, 1);
    }
  }

  disposeOverlays() {
    this.mesh.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    this.group = null;
    this.mirrorPlanes = null;
  }

  refreshGeometryOverlays() {
    const m = this.model;
    const ea = this.edgeLines.geometry.getAttribute('position');
    m.edges.forEach((e, i) => {
      for (let k = 0; k < 3; k++) {
        ea.array[6 * i + k] = m.verts[3 * e.a + k];
        ea.array[6 * i + 3 + k] = m.verts[3 * e.b + k];
      }
    });
    ea.needsUpdate = true;
    const va = this.vertPoints.geometry.getAttribute('position');
    va.array.set(m.verts);
    va.needsUpdate = true;
  }

  setPositions(obj, arr) {
    obj.geometry.dispose();
    obj.geometry = new THREE.BufferGeometry();
    obj.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(arr), 3));
  }

  refreshSelection(movePivot = true) {
    const m = this.model;
    const v = m.verts;
    const pts = [], lines = [], tris = [];
    const push = (arr, i) => arr.push(v[3 * i], v[3 * i + 1], v[3 * i + 2]);
    const X = { V: this.selV, E: this.selE, F: this.selF };
    if (this.kind !== 'face') X.V.forEach(i => push(pts, i));
    if (this.kind === 'edge') X.E.forEach(k => { const e = m.edgeByKey.get(k); push(lines, e.a); push(lines, e.b); });
    if (this.kind === 'face') {
      X.F.forEach(f => m.faces.get(f).tris.forEach(t => { for (let k = 0; k < 3; k++) push(tris, m.corner[3 * t + k]); }));
      m.edges.forEach(e => { for (const f of e.faces) if (X.F.has(f)) { push(lines, e.a); push(lines, e.b); break; } });
    }
    this.setPositions(this.selPoints, pts);
    this.selLines.geometry.dispose();
    this.selLines.geometry = new LineSegmentsGeometry();
    if (lines.length) this.selLines.geometry.setPositions(lines);
    this.selLines.visible = lines.length > 0;
    this.setPositions(this.selFaces, tris);
    if (movePivot) this.updatePivot();
    this.onSelectionChange?.();
  }

  canAdd() {
    if (this.kind === 'vertex') return true;
    if (this.kind === 'edge') return this.selV.size === 2;
    return this.selF.size > 0;
  }

  canRemove() { return this.hasSelection(); }

  // --- Transformation -------------------------------------------------
  transformVids() {
    const m = this.model;
    const out = new Set();
    if (this.kind === 'vertex') this.selV.forEach(i => out.add(i));
    if (this.kind === 'edge') this.selE.forEach(k => { const e = m.edgeByKey.get(k); out.add(e.a); out.add(e.b); });
    if (this.kind === 'face') this.selF.forEach(f => m.faces.get(f).vids.forEach(i => out.add(i)));
    return out;
  }

  updatePivot() {
    const vids = this.transformVids();
    if (!vids.size) { this.gizmo.detach(); return; }
    this.mesh.updateMatrixWorld(true);
    const c = new THREE.Vector3(), p = new THREE.Vector3();
    vids.forEach(i => c.add(p.fromArray(this.model.verts, 3 * i)));
    c.divideScalar(vids.size).applyMatrix4(this.mesh.matrixWorld);
    this.center.copy(c);
    this.pivot.position.copy(c);
    if (this.gizmo.space === 'local') this.selectionQuaternion(this.pivot.quaternion);
    else this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    if (this.gizmo.object !== this.pivot) this.gizmo.attach(this.pivot);
  }

  // Selection orientation: Y = averaged normal, X = edge direction
  selectionQuaternion(out) {
    const m = this.model, un = m.un;
    const n = new THREE.Vector3(), t = new THREE.Vector3(), v = new THREE.Vector3(), w = new THREE.Vector3();
    const addTri = u => { if (m.valid[u]) n.x += un[3 * u], n.y += un[3 * u + 1], n.z += un[3 * u + 2]; };
    const addDir = (a, b) => {
      v.fromArray(m.verts, 3 * b).sub(w.fromArray(m.verts, 3 * a));
      if (t.lengthSq() && v.dot(t) < 0) v.negate();
      t.add(v);
    };
    if (this.kind === 'face') {
      this.selF.forEach(f => {
        const face = m.faces.get(f);
        face.tris.forEach(addTri);
        const [a, b] = m.triVids(face.tris[0]);
        addDir(a, b);
      });
    } else if (this.kind === 'edge') {
      this.selE.forEach(k => {
        const e = m.edgeByKey.get(k);
        addDir(e.a, e.b);
        for (const u of m.vidTris[e.a]) if (m.vidTris[e.b].includes(u)) addTri(u);
      });
    } else {
      this.selV.forEach(i => {
        for (const u of m.vidTris[i]) addTri(u);
        const u0 = m.vidTris[i][0];
        if (u0 !== undefined) { const [a, b] = m.triVids(u0); addDir(i, a === i ? b : a); }
      });
    }
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0); else n.normalize();
    t.addScaledVector(n, -t.dot(n));
    if (t.lengthSq() < 1e-12) t.set(1, 0, 0).addScaledVector(n, -n.x);
    if (t.lengthSq() < 1e-12) t.set(0, 0, 1);
    t.normalize();
    const z = new THREE.Vector3().crossVectors(t, n);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, n, z));
    this.mesh.updateMatrixWorld(true);
    out.copy(this.mesh.getWorldQuaternion(new THREE.Quaternion()).multiply(q));
  }

  beginDrag() {
    const m = this.model;
    this.mesh.updateMatrixWorld(true);
    this.drag = {
      start: this.pivot.position.clone(),
      q0inv: this.pivot.quaternion.clone().invert(),
      inv: this.mesh.matrixWorld.clone().invert(),
      partners: this.anyMirror() ? this.mirrorPartners() : null,
      world: [...this.transformVids()].map(i => ({ i, w: new THREE.Vector3().fromArray(m.verts, 3 * i).applyMatrix4(this.mesh.matrixWorld) })),
    };
  }

  dragMove() {
    const d = this.drag, p = this.pivot;
    if (this.gizmo.mode === 'translate') {
      const delta = p.position.clone().sub(d.start);
      p.position.copy(d.start).add(delta.set(this.snap(delta.x), this.snap(delta.y), this.snap(delta.z)));
    }
    this.applyPivotTransform();
  }

  applyPivotTransform() {
    const d = this.drag, p = this.pivot, m = this.model;
    p.updateMatrix();
    const M = p.matrix.clone()
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(d.q0inv))
      .multiply(new THREE.Matrix4().makeTranslation(-d.start.x, -d.start.y, -d.start.z));
    const t = new THREE.Vector3();
    for (const { i, w } of d.world) t.copy(w).applyMatrix4(M).applyMatrix4(d.inv).toArray(m.verts, 3 * i);
    if (d.partners) {
      const prim = new Set(d.world.map(o => o.i)), combos = this.combos();
      d.partners.forEach((p, ci) => {
        const sg = combos[ci];
        for (const { i } of d.world) {
          const j = p[i];
          if (j < 0 || prim.has(j)) continue;
          for (let k = 0; k < 3; k++) m.verts[3 * j + k] = sg[k] * m.verts[3 * i + k];
        }
      });
    }
    this.changed = true;
    this.applyVerts();
  }

  // Numeric input: pos = absolute centre (world), scale = factor, rot = degrees about the selection axes
  applyPanel({ pos, scale, rot }) {
    if (!this.active || this.gizmo.object !== this.pivot) return false;
    this.beginDrag();
    const p = this.pivot;
    if (pos) p.position.set(pos[0], pos[1], pos[2]);
    if (scale) p.scale.set(scale[0], scale[1], scale[2]);
    if (rot) {
      const r = THREE.MathUtils.degToRad;
      p.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(r(rot[0]), r(rot[1]), r(rot[2]))));
    }
    this.applyPivotTransform();
    this.endDrag();
    return true;
  }

  endDrag() {
    this.drag = null;
    if (this.active) this.updatePivot();
  }

  applyVerts() {
    const m = this.model, g = this.mesh.geometry;
    m.syncPositions();
    m.updateNormals();
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('normal').needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.refreshMirrorPlanes();
    this.refreshGeometryOverlays();
    this.refreshSelection(false);
  }

  // --- Picking by mouse click -----------------------------------------
  isVisible(world) {
    const origin = this.camera.position;
    const dir = world.clone().sub(origin);
    const dist = dir.length();
    this.raycaster.set(origin, dir.normalize());
    this.raycaster.far = dist;
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    this.raycaster.far = Infinity;
    return !hit || hit.distance > dist - (0.02 + dist * 0.003);
  }

  pick(e, additive) {
    const m = this.model, mesh = this.mesh;
    const rect = this.dom.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    mesh.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    let id = null;

    if (this.kind === 'face') {
      this.raycaster.setFromCamera(new THREE.Vector2(mx / rect.width * 2 - 1, -(my / rect.height) * 2 + 1), this.camera);
      const hit = this.raycaster.intersectObject(mesh, false)[0];
      if (hit) id = m.faceOfTri[hit.faceIndex];
    } else {
      const sx = new Float32Array(m.nVerts), sy = new Float32Array(m.nVerts), ok = new Uint8Array(m.nVerts);
      const p = new THREE.Vector3();
      for (let i = 0; i < m.nVerts; i++) {
        p.fromArray(m.verts, 3 * i).applyMatrix4(mesh.matrixWorld).project(this.camera);
        sx[i] = (p.x * 0.5 + 0.5) * rect.width;
        sy[i] = (-p.y * 0.5 + 0.5) * rect.height;
        ok[i] = p.z > -1 && p.z < 1 ? 1 : 0;
      }
      const q = new THREE.Vector3(), r = new THREE.Vector3();
      // Nearest candidate that is really visible (not hidden behind the surface)
      const firstVisible = cands => {
        cands.sort((a, b) => a.d - b.d);
        for (const c of cands.slice(0, 40)) {
          q.fromArray(m.verts, 3 * c.a);
          r.fromArray(m.verts, 3 * c.b);
          q.lerp(r, c.t).applyMatrix4(mesh.matrixWorld);
          if (this.isVisible(q)) return c.id;
        }
        return null;
      };
      const vc = [];
      for (let i = 0; i < m.nVerts; i++) {
        if (!ok[i]) continue;
        const d = Math.hypot(sx[i] - mx, sy[i] - my);
        if (d < 10) vc.push({ d, id: i, t: 0, a: i, b: i });
      }
      id = firstVisible(vc);
      // Edge mode: fall back to edges when no visible vertex is close (hidden vertices must not block edges)
      if (id === null && this.kind === 'edge') {
        const ec = [];
        for (const ed of m.edges) {
          if (!ok[ed.a] || !ok[ed.b]) continue;
          const dx = sx[ed.b] - sx[ed.a], dy = sy[ed.b] - sy[ed.a];
          const l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((mx - sx[ed.a]) * dx + (my - sy[ed.a]) * dy) / l2));
          const d = Math.hypot(sx[ed.a] + t * dx - mx, sy[ed.a] + t * dy - my);
          if (d < 8) ec.push({ d, id: ed.key, t, a: ed.a, b: ed.b });
        }
        id = firstVisible(ec);
      }
    }

    if (!additive) { this.selV.clear(); this.selE.clear(); this.selF.clear(); }
    if (id !== null) {
      const set = this.kind === 'vertex' || (this.kind === 'edge' && typeof id === 'number') ? this.selV : this.kind === 'edge' ? this.selE : this.selF;
      if (additive && set.has(id)) set.delete(id); else set.add(id);
    }
    this.refreshSelection();
  }
}

// The editor is split over several files; copy their methods onto the class
for (const Mixin of [MirrorMethods, TopologyMethods, ChamferMethods, ExtrudeMethods, SubdivideMethods]) {
  for (const name of Object.getOwnPropertyNames(Mixin.prototype)) {
    if (name !== 'constructor') Object.defineProperty(SubObjectEditor.prototype, name, Object.getOwnPropertyDescriptor(Mixin.prototype, name));
  }
}
