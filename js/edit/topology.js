// Editor mixin: topology changes (insert vertex, connect vertices, remove, rebuild).
import * as THREE from 'three';
import { Model, applyColors, edgeKey } from '../model.js';

export class TopologyMethods {
  // --- Add / remove ---------------------------------------------------
  setAddMode(on) {
    this.addMode = on;
    this.dom.style.cursor = on ? 'crosshair' : '';
  }

  topo() {
    const m = this.model, tris = [], face = [];
    for (let t = 0; t < m.nTri; t++) if (m.valid[t]) { tris.push(m.triVids(t)); face.push(m.faceOfTri[t]); }
    return { verts: Array.from(m.verts), tris, face, };
  }

  // Replaces geometry and model; returns the mapping old -> new vertex indices
  rebuild(T) {
    const used = new Map();
    const verts = [];
    for (const tri of T.tris) for (const v of tri) {
      if (!used.has(v)) { used.set(v, verts.length / 3); verts.push(T.verts[3 * v], T.verts[3 * v + 1], T.verts[3 * v + 2]); }
    }
    const positions = new Float32Array(T.tris.length * 9);
    const corner = new Int32Array(T.tris.length * 3);
    T.tris.forEach((tri, t) => tri.forEach((v, k) => {
      const id = used.get(v);
      corner[3 * t + k] = id;
      positions.set(verts.slice(3 * id, 3 * id + 3), 9 * t + 3 * k);
    }));
    const model = new Model(positions, Int32Array.from(T.face), { verts: Float32Array.from(verts), corner });
    const keep = new Set(T.face);
    this.model.faceColors.forEach((hex, id) => { if (keep.has(id)) model.faceColors.set(id, hex); });
    const mesh = this.mesh;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
    geometry.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.userData.model = model;
    this.model = model;
    applyColors(mesh);
    this.changed = true;
    this.disposeOverlays();
    this.buildOverlays();
    this.vertPoints.visible = this.kind !== 'face';
    this.selV.clear(); this.selE.clear(); this.selF.clear();
    return used;
  }

  splitEdge(T, p, q, s) {
    const P = T.verts.slice(3 * p, 3 * p + 3), Q = T.verts.slice(3 * q, 3 * q + 3);
    const mid = T.verts.length / 3;
    T.verts.push(P[0] + s * (Q[0] - P[0]), P[1] + s * (Q[1] - P[1]), P[2] + s * (Q[2] - P[2]));
    const n = T.tris.length;
    for (let i = 0; i < n; i++) {
      const tr = T.tris[i];
      for (let k = 0; k < 3; k++) {
        const e0 = tr[k], e1 = tr[(k + 1) % 3], e2 = tr[(k + 2) % 3];
        if ((e0 === p && e1 === q) || (e0 === q && e1 === p)) {
          T.tris[i] = [e0, mid, e2];
          T.tris.push([mid, e1, e2]);
          T.face.push(T.face[i]);
          break;
        }
      }
    }
    return mid;
  }

  add() {
    if (this.kind === 'vertex') { this.setAddMode(!this.addMode); return; }
    if (this.kind === 'edge') this.connectVertices();
    else this.extrudeMirrored();
  }

  remove() {
    this.withMirroredSelection(() => {
      if (this.kind === 'vertex') this.dissolveVertices();
      else if (this.kind === 'edge') this.dissolveEdges();
      else this.deleteFaces();
    });
  }

  // Insert a vertex by clicking a face or edge (also on the mirrored sides when mirror is active)
  insertPoint(e) {
    const m = this.model, mesh = this.mesh;
    const rect = this.dom.getBoundingClientRect();
    mesh.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObject(mesh, false)[0];
    if (!hit || !m.valid[hit.faceIndex]) return;
    const P = mesh.worldToLocal(hit.point.clone());
    const r = this.insertInTri(hit.faceIndex, P);
    let primary = r.mid;
    for (const s of this.combos()) {
      const Q = new THREE.Vector3(P.x * s[0], P.y * s[1], P.z * s[2]);
      if (Q.distanceTo(P) < 1e-4) continue;
      const t = this.findTri(Q);
      if (t < 0) continue;
      const r2 = this.insertInTri(t, Q);
      if (r2) primary = r2.map.get(primary);
    }
    this.selV.add(primary);
    this.refreshSelection();
  }

  findTri(Q) {
    const m = this.model, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), bc = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < m.nTri; t++) {
      if (!m.valid[t]) continue;
      const [a, b, c] = m.triVids(t);
      A.fromArray(m.verts, 3 * a); B.fromArray(m.verts, 3 * b); C.fromArray(m.verts, 3 * c);
      n.crossVectors(B.clone().sub(A), C.clone().sub(A)).normalize();
      if (Math.abs(n.dot(Q.clone().sub(A))) > 1e-3) continue;
      THREE.Triangle.getBarycoord(Q, A, B, C, bc);
      if (bc.x > -1e-4 && bc.y > -1e-4 && bc.z > -1e-4 && Math.max(bc.x, bc.y, bc.z) < 0.999) return t;
    }
    return -1;
  }

  insertInTri(ti, P) {
    const m = this.model;
    const [a, b, c] = m.triVids(ti);
    const A = new THREE.Vector3().fromArray(m.verts, 3 * a), B = new THREE.Vector3().fromArray(m.verts, 3 * b), C = new THREE.Vector3().fromArray(m.verts, 3 * c);
    const bc = new THREE.Vector3();
    THREE.Triangle.getBarycoord(P, A, B, C, bc);
    const T = this.topo();
    const w = [bc.x, bc.y, bc.z], ids = [a, b, c];
    const lo = w.indexOf(Math.min(...w));
    let mid;
    if (w[lo] < 0.15) {
      const i = ids[(lo + 1) % 3], j = ids[(lo + 2) % 3];
      const wi = w[(lo + 1) % 3], wj = w[(lo + 2) % 3];
      mid = this.splitEdge(T, i, j, Math.min(0.9, Math.max(0.1, wj / ((wi + wj) || 1))));
    } else {
      mid = T.verts.length / 3;
      const p = A.multiplyScalar(w[0]).addScaledVector(B, w[1]).addScaledVector(C, w[2]);
      T.verts.push(p.x, p.y, p.z);
      const i = T.tris.findIndex((tr, k) => T.face[k] === m.faceOfTri[ti] && tr[0] === a && tr[1] === b && tr[2] === c);
      const f = T.face[i];
      T.tris[i] = [a, b, mid];
      T.tris.push([b, c, mid], [c, a, mid]);
      T.face.push(f, f);
    }
    const map = this.rebuild(T);
    return { mid: map.get(mid), map };
  }

  // New edge between two selected vertices of the same face: splits the face in two
  connectPair(a, b, silent) {
    const m = this.model;
    const fail = msg => { if (!silent) this.onMessage?.(msg); return null; };
    const fid = [...m.faces.keys()].find(f => m.faces.get(f).vids.has(a) && m.faces.get(f).vids.has(b));
    if (fid === undefined) return fail('Both points must lie on the same face');
    const face = m.faces.get(fid);
    const next = new Map(), dir = new Set();
    for (const t of face.tris) {
      const [p, q, r] = m.triVids(t);
      for (const [x, y] of [[p, q], [q, r], [r, p]]) dir.add(x + '>' + y);
    }
    let count = 0;
    for (const t of face.tris) {
      const [p, q, r] = m.triVids(t);
      for (const [x, y] of [[p, q], [q, r], [r, p]]) if (!dir.has(y + '>' + x)) { next.set(x, y); count++; }
    }
    const loop = [], start = next.keys().next().value;
    for (let v = start; loop.length <= count; v = next.get(v)) {
      if (v === undefined) return fail('Face outline is not a simple loop');
      loop.push(v);
      if (next.get(v) === start) break;
    }
    if (loop.length !== count || loop.length !== face.vids.size) return fail('Both points must lie on the face outline');
    const ia = loop.indexOf(a), ib = loop.indexOf(b);
    if (ia < 0 || ib < 0) return fail('Both points must lie on the face outline');
    const n = loop.length;
    if ((ia + 1) % n === ib || (ib + 1) % n === ia) return fail('These points are already connected');

    const P = v => new THREE.Vector3().fromArray(m.verts, 3 * v);
    const nor = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const c = P(loop[i]), d = P(loop[(i + 1) % n]);
      nor.x += (c.y - d.y) * (c.z + d.z); nor.y += (c.z - d.z) * (c.x + d.x); nor.z += (c.x - d.x) * (c.y + d.y);
    }
    nor.normalize();
    const u = new THREE.Vector3(1, 0, 0);
    if (Math.abs(nor.x) > 0.9) u.set(0, 1, 0);
    u.addScaledVector(nor, -u.dot(nor)).normalize();
    const w = new THREE.Vector3().crossVectors(nor, u);
    const xy = v => { const p = P(v); return [p.dot(u), p.dot(w)]; };
    const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    const pa = xy(a), pb = xy(b);
    for (let i = 0; i < n; i++) {
      const c = loop[i], d = loop[(i + 1) % n];
      if (c === a || c === b || d === a || d === b) continue;
      const pc = xy(c), pd = xy(d);
      if (cross(pa, pb, pc) * cross(pa, pb, pd) < 0 && cross(pc, pd, pa) * cross(pc, pd, pb) < 0) return fail('The new edge would leave the face');
    }
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    let inside = false;
    for (let i = 0; i < n; i++) {
      const c = xy(loop[i]), d = xy(loop[(i + 1) % n]);
      if ((c[1] > mid[1]) !== (d[1] > mid[1]) && mid[0] < (d[0] - c[0]) * (mid[1] - c[1]) / (d[1] - c[1]) + c[0]) inside = !inside;
    }
    if (!inside) return fail('The new edge would leave the face');

    const slice = (i, j) => { const r = []; for (let k = i; ; k = (k + 1) % n) { r.push(loop[k]); if (k === j) break; } return r; };
    const earClip = poly => {
      const out = [], idx = poly.slice();
      let guard = idx.length * idx.length;
      while (idx.length > 3 && guard-- > 0) {
        let cut = false;
        for (let i = 0; i < idx.length && !cut; i++) {
          const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
          const p0 = xy(i0), p1 = xy(i1), p2 = xy(i2);
          if (cross(p0, p1, p2) <= 1e-12) continue;
          const blocked = idx.some(k => k !== i0 && k !== i1 && k !== i2 && (() => {
            const q = xy(k);
            return cross(p0, p1, q) >= 0 && cross(p1, p2, q) >= 0 && cross(p2, p0, q) >= 0;
          })());
          if (blocked) continue;
          out.push([i0, i1, i2]); idx.splice(i, 1); cut = true;
        }
        if (!cut) break;
      }
      if (idx.length === 3) out.push(idx.slice());
      return out;
    };
    const T = this.topo();
    const keep = [], keepF = [];
    T.tris.forEach((tr, i) => { if (T.face[i] !== fid) { keep.push(tr); keepF.push(T.face[i]); } });
    const t1 = earClip(slice(ia, ib)), t2 = earClip(slice(ib, ia));
    const newId = Math.max(...T.face) + 1;
    T.tris = keep.concat(t1, t2);
    T.face = keepF.concat(t1.map(() => fid), t2.map(() => newId));
    const col = m.faceColors.get(fid);
    if (col !== undefined) m.faceColors.set(newId, col);
    return this.rebuild(T);
  }

  connectVertices() {
    if (this.selV.size !== 2) return this.onMessage?.('Select exactly two points first');
    const [a, b] = [...this.selV];
    const pairs = [[a, b]], seen = new Set([edgeKey(a, b)]);
    for (const p of this.mirrorPartners()) {
      const a2 = p[a], b2 = p[b];
      if (a2 < 0 || b2 < 0 || a2 === b2 || seen.has(edgeKey(a2, b2))) continue;
      seen.add(edgeKey(a2, b2));
      pairs.push([a2, b2]);
    }
    let primary = [a, b];
    for (let i = 0; i < pairs.length; i++) {
      const map = this.connectPair(pairs[i][0], pairs[i][1], i > 0);
      if (!map) { if (i === 0) return; continue; }
      primary = primary.map(v => map.get(v));
      for (let j = i + 1; j < pairs.length; j++) pairs[j] = pairs[j].map(v => map.get(v));
    }
    const k = edgeKey(primary[0], primary[1]);
    if (this.model.edgeByKey.has(k)) this.selE.add(k);
    this.refreshSelection();
  }
}
