// Mesh topology model and geometry helpers shared by the editor and the app.
import * as THREE from 'three';

const CREASE = Math.cos(THREE.MathUtils.degToRad(30));
export const edgeKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

// Welded topology over a non-indexed triangle list:
// vertices (unique positions), faces (coplanar triangle groups) and edges (face boundaries).
export class Model {
  // preset = { verts, corner }: reuse the topology without welding again
  constructor(positions, faceOfTri, preset) {
    const nc = positions.length / 3;
    this.nTri = nc / 3;
    this.positions = positions;
    if (preset) {
      this.corner = preset.corner;
      this.verts = preset.verts;
    } else {
      this.corner = new Int32Array(nc);
      const map = new Map();
      const vs = [];
      for (let i = 0; i < nc; i++) {
        const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
        const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
        let id = map.get(k);
        if (id === undefined) { id = vs.length / 3; map.set(k, id); vs.push(x, y, z); }
        this.corner[i] = id;
      }
      this.verts = Float32Array.from(vs);
    }
    this.nVerts = this.verts.length / 3;
    this.normals = new Float32Array(nc * 3);
    this.fn = new Float32Array(this.nTri * 3);
    this.un = new Float32Array(this.nTri * 3);

    this.valid = new Uint8Array(this.nTri);
    for (let t = 0; t < this.nTri; t++) {
      const a = this.corner[3 * t], b = this.corner[3 * t + 1], c = this.corner[3 * t + 2];
      this.valid[t] = a !== b && b !== c && a !== c ? 1 : 0;
    }
    this.triNormals();
    for (let t = 0; t < this.nTri; t++) {
      if (this.valid[t] && Math.hypot(this.fn[3 * t], this.fn[3 * t + 1], this.fn[3 * t + 2]) < 1e-12) this.valid[t] = 0;
    }
    this.triNormals();

    this.vidTris = Array.from({ length: this.nVerts }, () => []);
    for (let t = 0; t < this.nTri; t++) {
      if (!this.valid[t]) continue;
      for (let k = 0; k < 3; k++) this.vidTris[this.corner[3 * t + k]].push(t);
    }

    this.faceOfTri = faceOfTri && faceOfTri.length === this.nTri ? Int32Array.from(faceOfTri) : this.groupFaces();
    this.faceColors = new Map();
    this.buildFacesAndEdges();
    this.updateNormals();
  }

  triVids(t) { return [this.corner[3 * t], this.corner[3 * t + 1], this.corner[3 * t + 2]]; }

  triNormals() {
    const v = this.verts;
    for (let t = 0; t < this.nTri; t++) {
      if (!this.valid[t]) { this.fn.fill(0, 3 * t, 3 * t + 3); this.un.fill(0, 3 * t, 3 * t + 3); continue; }
      const [a, b, c] = this.triVids(t).map(i => i * 3);
      const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
      const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
      const x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x;
      const l = Math.hypot(x, y, z) || 1;
      this.fn[3 * t] = x; this.fn[3 * t + 1] = y; this.fn[3 * t + 2] = z;
      this.un[3 * t] = x / l; this.un[3 * t + 1] = y / l; this.un[3 * t + 2] = z / l;
    }
  }

  groupFaces() {
    const edgeTris = new Map();
    for (let t = 0; t < this.nTri; t++) {
      if (!this.valid[t]) continue;
      const [a, b, c] = this.triVids(t);
      for (const k of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
        if (!edgeTris.has(k)) edgeTris.set(k, []);
        edgeTris.get(k).push(t);
      }
    }
    const faceOf = new Int32Array(this.nTri).fill(-1);
    const un = this.un;
    let id = 0;
    for (let s = 0; s < this.nTri; s++) {
      if (!this.valid[s] || faceOf[s] !== -1) continue;
      faceOf[s] = id;
      const stack = [s];
      while (stack.length) {
        const t = stack.pop();
        const [a, b, c] = this.triVids(t);
        for (const k of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
          for (const u of edgeTris.get(k)) {
            if (faceOf[u] !== -1) continue;
            const d = un[3 * s] * un[3 * u] + un[3 * s + 1] * un[3 * u + 1] + un[3 * s + 2] * un[3 * u + 2];
            if (d > 0.99999) { faceOf[u] = id; stack.push(u); }
          }
        }
      }
      id++;
    }
    return faceOf;
  }

  buildFacesAndEdges() {
    this.faces = new Map();
    const info = new Map();
    for (let t = 0; t < this.nTri; t++) {
      if (!this.valid[t]) continue;
      const f = this.faceOfTri[t];
      if (!this.faces.has(f)) this.faces.set(f, { tris: [], vids: new Set() });
      const face = this.faces.get(f);
      face.tris.push(t);
      const [a, b, c] = this.triVids(t);
      face.vids.add(a); face.vids.add(b); face.vids.add(c);
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const k = edgeKey(p, q);
        let e = info.get(k);
        if (!e) info.set(k, e = { a: p, b: q, key: k, count: 0, faces: new Set() });
        e.count++;
        e.faces.add(f);
      }
    }
    const open = [...info.values()].filter(e => e.count === 1);
    const hidden = this.tJunctionEdges(open);
    this.edges = [...info.values()].filter(e => (e.count === 1 ? !hidden.has(e) : e.faces.size > 1));
    this.edgeByKey = new Map(this.edges.map(e => [e.key, e]));
  }

  // Open edges that overlap another open edge are T-junction seams inside a surface, not real borders
  tJunctionEdges(open) {
    const hidden = new Set();
    if (open.length < 2 || open.length > 8000) return hidden;
    const v = this.verts, tol = 1e-4;
    const seg = open.map(e => [v[3 * e.a], v[3 * e.a + 1], v[3 * e.a + 2], v[3 * e.b], v[3 * e.b + 1], v[3 * e.b + 2]]);
    const onSeg = (p, s) => {
      const dx = s[3] - s[0], dy = s[4] - s[1], dz = s[5] - s[2], l2 = dx * dx + dy * dy + dz * dz;
      if (l2 < 1e-12) return false;
      const t = ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy + (p[2] - s[2]) * dz) / l2;
      if (t < -1e-6 || t > 1 + 1e-6) return false;
      return Math.hypot(s[0] + t * dx - p[0], s[1] + t * dy - p[1], s[2] + t * dz - p[2]) < tol;
    };
    const parallel = (p, q) => {
      const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2], bx = q[3] - q[0], by = q[4] - q[1], bz = q[5] - q[2];
      return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) < 1e-4 * Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
    };
    for (let i = 0; i < open.length; i++) {
      const m = [(seg[i][0] + seg[i][3]) / 2, (seg[i][1] + seg[i][4]) / 2, (seg[i][2] + seg[i][5]) / 2];
      for (let j = 0; j < open.length; j++) {
        if (i === j || open[i].key === open[j].key) continue;
        if (onSeg(m, seg[j]) && parallel(seg[i], seg[j])) {
          hidden.add(open[i]); hidden.add(open[j]); break;
        }
      }
    }
    return hidden;
  }

  // Smooth normals only between triangles with less than a 30° crease
  updateNormals() {
    this.triNormals();
    const { un, fn, normals: n } = this;
    for (let t = 0; t < this.nTri; t++) {
      for (let k = 0; k < 3; k++) {
        const c = 3 * t + k;
        if (!this.valid[t]) { n[3 * c] = 0; n[3 * c + 1] = 1; n[3 * c + 2] = 0; continue; }
        let x = 0, y = 0, z = 0;
        for (const u of this.vidTris[this.corner[c]]) {
          if (un[3 * t] * un[3 * u] + un[3 * t + 1] * un[3 * u + 1] + un[3 * t + 2] * un[3 * u + 2] > CREASE) {
            x += fn[3 * u]; y += fn[3 * u + 1]; z += fn[3 * u + 2];
          }
        }
        const l = Math.hypot(x, y, z) || 1;
        n[3 * c] = x / l; n[3 * c + 1] = y / l; n[3 * c + 2] = z / l;
      }
    }
  }

  syncPositions() {
    for (let c = 0; c < this.corner.length; c++) {
      const v = this.corner[c] * 3;
      this.positions[3 * c] = this.verts[v];
      this.positions[3 * c + 1] = this.verts[v + 1];
      this.positions[3 * c + 2] = this.verts[v + 2];
    }
  }
}

export function nonIndexedPositions(geo) {
  return (geo.index ? geo.toNonIndexed() : geo).getAttribute('position').array.slice();
}

// Creates an editable geometry plus model (positions are shared with the model)
export function createGeometry(positions, faceOfTri) {
  const model = new Model(Float32Array.from(positions), faceOfTri);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
  return { geometry, model };
}

// Face colours: vertex colours are used only if faces have their own colour; otherwise the object colour applies
export function applyColors(mesh) {
  const base = mesh.userData.baseColor, model = mesh.userData.model, mat = mesh.material, geo = mesh.geometry;
  const use = !!model && model.faceColors.size > 0;
  if (use) {
    const col = new Float32Array(model.nTri * 9), c = new THREE.Color();
    for (let t = 0; t < model.nTri; t++) {
      const hex = model.faceColors.get(model.faceOfTri[t]);
      if (hex) c.set(hex); else c.copy(base);
      for (let k = 0; k < 3; k++) { col[9 * t + 3 * k] = c.r; col[9 * t + 3 * k + 1] = c.g; col[9 * t + 3 * k + 2] = c.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    mat.color.set(0xffffff);
  } else {
    geo.deleteAttribute('color');
    mat.color.copy(base);
  }
  if (mat.vertexColors !== use) { mat.vertexColors = use; mat.needsUpdate = true; }
}

// Outline lines: all model edges (face boundaries), so added edges are always visible
export function outlineGeometry(geo, model) {
  if (!model) return new THREE.EdgesGeometry(geo, 30);
  const arr = new Float32Array(model.edges.length * 6);
  model.edges.forEach((e, i) => {
    for (let k = 0; k < 3; k++) { arr[6 * i + k] = model.verts[3 * e.a + k]; arr[6 * i + 3 + k] = model.verts[3 * e.b + k]; }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}
