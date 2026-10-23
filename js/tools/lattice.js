// Lattice (free-form deformation): a cage of n x n x n control points around an object.
// Moving control points deforms the object with Bezier (Bernstein) blending; n = 2 is a plain trilinear box.
import * as THREE from 'three';

const BIN = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1]];

// Bernstein weights of degree n-1 at t
function weights(n, t, out) {
  const d = n - 1, s = 1 - t;
  for (let i = 0; i <= d; i++) out[i] = BIN[d][i] * Math.pow(t, i) * Math.pow(s, d - i);
}

export class Lattice {
  constructor(mesh, divisions = 3) {
    this.mesh = mesh;
    const geo = mesh.geometry, pos = geo.attributes.position;
    this.orig = pos.array.slice();
    this.origNormals = geo.attributes.normal ? geo.attributes.normal.array.slice() : null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.orig.length; i += 3) {
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], this.orig[i + k]); hi[k] = Math.max(hi[k], this.orig[i + k]); }
    }
    // Flat objects get a thin cage so that every axis has an extent
    this.lo = lo.map((v, k) => (hi[k] - v < 1e-4 ? v - 0.005 : v));
    this.ext = lo.map((v, k) => Math.max(hi[k] - v, 0.01));
    this.group = new THREE.Group();
    this.group.renderOrder = 999;
    this.pointGeo = new THREE.BufferGeometry();
    this.points = new THREE.Points(this.pointGeo, new THREE.PointsMaterial({ color: 0xffc233, size: 8, sizeAttenuation: false, depthTest: false, transparent: true }));
    this.lineGeo = new THREE.BufferGeometry();
    this.lines = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xffc233, depthTest: false, transparent: true, opacity: 0.8 }));
    this.points.renderOrder = this.lines.renderOrder = 999;
    this.points.frustumCulled = this.lines.frustumCulled = false;
    this.group.add(this.lines, this.points);
    mesh.add(this.group);
    if (mesh.userData.outline) mesh.userData.outline.visible = false;
    this.setDivisions(divisions);
  }

  // Rebuilds the cage with an undeformed n x n x n grid
  setDivisions(n) {
    this.n = n;
    const P = this.P = new Float32Array(n * n * n * 3);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const o = ((i * n + j) * n + k) * 3;
      P[o] = this.lo[0] + this.ext[0] * i / (n - 1);
      P[o + 1] = this.lo[1] + this.ext[1] * j / (n - 1);
      P[o + 2] = this.lo[2] + this.ext[2] * k / (n - 1);
    }
    const idx = [];
    const at = (i, j, k) => (i * n + j) * n + k;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      if (i + 1 < n) idx.push(at(i, j, k), at(i + 1, j, k));
      if (j + 1 < n) idx.push(at(i, j, k), at(i, j + 1, k));
      if (k + 1 < n) idx.push(at(i, j, k), at(i, j, k + 1));
    }
    this.lineIndex = idx;
    this.pointGeo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(idx.length * 3), 3));
    this.refreshCage();
    this.apply();
  }

  reset() { this.setDivisions(this.n); }

  get count() { return this.n ** 3; }

  refreshCage() {
    const a = this.lineGeo.attributes.position.array, P = this.P;
    this.lineIndex.forEach((p, i) => { a[3 * i] = P[3 * p]; a[3 * i + 1] = P[3 * p + 1]; a[3 * i + 2] = P[3 * p + 2]; });
    this.lineGeo.attributes.position.needsUpdate = true;
    this.pointGeo.attributes.position.needsUpdate = true;
    this.pointGeo.computeBoundingSphere();
  }

  // Deformed position of a point given in the object's local space
  deform(x, y, z, out) {
    const n = this.n, P = this.P, bx = [0, 0, 0, 0], by = [0, 0, 0, 0], bz = [0, 0, 0, 0];
    weights(n, (x - this.lo[0]) / this.ext[0], bx);
    weights(n, (y - this.lo[1]) / this.ext[1], by);
    weights(n, (z - this.lo[2]) / this.ext[2], bz);
    let rx = 0, ry = 0, rz = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const wij = bx[i] * by[j];
      for (let k = 0; k < n; k++) {
        const w = wij * bz[k], o = ((i * n + j) * n + k) * 3;
        rx += w * P[o]; ry += w * P[o + 1]; rz += w * P[o + 2];
      }
    }
    return out.set(rx, ry, rz);
  }

  // Writes the deformed shape into the mesh geometry (preview)
  apply() {
    const geo = this.mesh.geometry, arr = geo.attributes.position.array, o = this.orig, v = new THREE.Vector3();
    for (let i = 0; i < o.length; i += 3) {
      this.deform(o[i], o[i + 1], o[i + 2], v);
      arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  }

  // Back to the undeformed geometry (the cage stays)
  restore() {
    const geo = this.mesh.geometry;
    if (!geo.attributes.position || geo.attributes.position.array.length !== this.orig.length) return;
    geo.attributes.position.array.set(this.orig);
    geo.attributes.position.needsUpdate = true;
    if (this.origNormals && geo.attributes.normal) { geo.attributes.normal.array.set(this.origNormals); geo.attributes.normal.needsUpdate = true; }
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  }

  worldPoint(i, out) {
    return this.mesh.localToWorld(out.fromArray(this.P, 3 * i));
  }

  setPointWorld(i, world) {
    this.mesh.worldToLocal(world.clone()).toArray(this.P, 3 * i);
    this.refreshCage();
    this.apply();
  }

  dispose(restore = true) {
    if (restore) this.restore();
    if (this.mesh.userData.outline) this.mesh.userData.outline.visible = true;
    this.mesh.remove(this.group);
    this.pointGeo.dispose(); this.lineGeo.dispose();
    this.points.material.dispose(); this.lines.material.dispose();
  }
}
