// Boolean operations on triangle meshes (BSP-tree CSG, after Evan Wallace's csg.js).
// Input and output are non-indexed triangle position arrays in the same (world) space.
import * as THREE from 'three';
import { triangulatePoly, newellNormal } from './polygon.js';

const EPS = 1e-5;
const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

class Plane {
  constructor(n, w) { this.n = n; this.w = w; }
  static fromPoints(a, b, c) {
    const u = sub(b, a), v = sub(c, a);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12) return null;
    n[0] /= l; n[1] /= l; n[2] /= l;
    return new Plane(n, dot(n, a));
  }
  clone() { return new Plane(this.n.slice(), this.w); }
  flip() { this.n = [-this.n[0], -this.n[1], -this.n[2]]; this.w = -this.w; }

  // Splits a polygon by this plane into the four output lists
  splitPolygon(poly, coplanarFront, coplanarBack, front, back) {
    let type = COPLANAR;
    const types = poly.v.map(p => {
      const t = dot(this.n, p) - this.w;
      const k = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
      type |= k;
      return k;
    });
    if (type === COPLANAR) (dot(this.n, poly.plane.n) > 0 ? coplanarFront : coplanarBack).push(poly);
    else if (type === FRONT) front.push(poly);
    else if (type === BACK) back.push(poly);
    else {
      const f = [], b = [], n = poly.v.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(vi);
        if ((ti | tj) === SPANNING) {
          const t = (this.w - dot(this.n, vi)) / dot(this.n, sub(vj, vi));
          const p = lerp(vi, vj, t);
          f.push(p); b.push(p);
        }
      }
      if (f.length >= 3) front.push({ v: f, plane: poly.plane });
      if (b.length >= 3) back.push({ v: b, plane: poly.plane });
    }
  }
}

class Node {
  constructor() { this.plane = null; this.front = null; this.back = null; this.polygons = []; }

  invert() {
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      n.polygons.forEach(p => { p.v.reverse(); p.plane = p.plane.clone(); p.plane.flip(); });
      if (n.plane) n.plane.flip();
      [n.front, n.back] = [n.back, n.front];
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
  }

  clipPolygons(polys) {
    if (!this.plane) return polys.slice();
    let f = [], b = [];
    for (const p of polys) this.plane.splitPolygon(p, f, b, f, b);
    f = this.front ? this.front.clipPolygons(f) : f;
    b = this.back ? this.back.clipPolygons(b) : [];
    for (const p of b) f.push(p);
    return f;
  }

  clipTo(bsp) {
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      n.polygons = bsp.clipPolygons(n.polygons);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
  }

  allPolygons() {
    const out = [], stack = [this];
    while (stack.length) {
      const n = stack.pop();
      for (const p of n.polygons) out.push(p);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
    return out;
  }

  build(polys) {
    const stack = [[this, polys]];
    while (stack.length) {
      const [node, ps] = stack.pop();
      if (!ps.length) continue;
      if (!node.plane) node.plane = ps[ps.length >> 1].plane.clone();
      const f = [], b = [];
      for (const p of ps) node.plane.splitPolygon(p, node.polygons, node.polygons, f, b);
      if (f.length) { node.front ||= new Node(); stack.push([node.front, f]); }
      if (b.length) { node.back ||= new Node(); stack.push([node.back, b]); }
    }
  }
}

function toPolygons(pos) {
  const polys = [];
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const v = [[pos[i], pos[i + 1], pos[i + 2]], [pos[i + 3], pos[i + 4], pos[i + 5]], [pos[i + 6], pos[i + 7], pos[i + 8]]];
    const plane = Plane.fromPoints(v[0], v[1], v[2]);
    if (plane) polys.push({ v, plane });
  }
  return polys;
}

// Welds vertices, inserts vertices that touch another polygon's edge (T-junctions), triangulates
// without degenerate triangles and fills any remaining holes, so the result is a closed mesh.
function toPositions(polys) {
  const verts = [], cells = new Map(), MERGE = 2e-4, CS = 2e-4;
  const cellKey = (x, y, z) => x + ',' + y + ',' + z;
  const vertexId = p => {
    const cx = Math.floor(p[0] / CS), cy = Math.floor(p[1] / CS), cz = Math.floor(p[2] / CS);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const l = cells.get(cellKey(cx + i, cy + j, cz + k));
      if (l) for (const id of l) {
        const q = verts[id];
        if (Math.abs(q[0] - p[0]) < MERGE && Math.abs(q[1] - p[1]) < MERGE && Math.abs(q[2] - p[2]) < MERGE) return id;
      }
    }
    const id = verts.length;
    verts.push(p.slice());
    const key = cellKey(cx, cy, cz);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(id);
    return id;
  };
  const loops = [];
  for (const { v } of polys) {
    const ids = [];
    for (const p of v) { const id = vertexId(p); if (ids[ids.length - 1] !== id) ids.push(id); }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length >= 3) loops.push(ids);
  }

  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6) / 48;
  const grid = new Map(), gc = v => Math.floor((v) / size);
  verts.forEach((p, id) => {
    const key = cellKey(gc(p[0]), gc(p[1]), gc(p[2]));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(id);
  });
  const ON = 2e-4;
  const onEdge = (a, b) => {
    const pa = verts[a], pb = verts[b], d = sub(pb, pa), l2 = dot(d, d), found = [];
    if (l2 < 1e-16) return found;
    const x0 = gc(Math.min(pa[0], pb[0]) - ON), x1 = gc(Math.max(pa[0], pb[0]) + ON);
    const y0 = gc(Math.min(pa[1], pb[1]) - ON), y1 = gc(Math.max(pa[1], pb[1]) + ON);
    const z0 = gc(Math.min(pa[2], pb[2]) - ON), z1 = gc(Math.max(pa[2], pb[2]) + ON);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const l = grid.get(cellKey(x, y, z));
      if (!l) continue;
      for (const id of l) {
        if (id === a || id === b) continue;
        const w = sub(verts[id], pa), t = dot(w, d) / l2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        const e = sub(w, [d[0] * t, d[1] * t, d[2] * t]);
        if (Math.hypot(e[0], e[1], e[2]) < ON) found.push([t, id]);
      }
    }
    return found.sort((p, q) => p[0] - q[0]).map(f => f[1]);
  };

  const P = id => new THREE.Vector3(verts[id][0], verts[id][1], verts[id][2]);
  const tris = [];
  for (const ids of loops) {
    const poly = [];
    ids.forEach((a, i) => { poly.push(a, ...onEdge(a, ids[(i + 1) % ids.length])); });
    if (poly.length === 3) { tris.push(poly); continue; }
    const nor = newellNormal(poly, P);
    let out = nor.lengthSq() > 1e-20 ? triangulatePoly(poly, P, nor.normalize()) : null;
    if (!out) { out = []; for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]); }
    tris.push(...out);
  }
  // Identical triangles: same orientation = duplicate (keep one), opposite orientation = internal face (drop both)
  const byKey = new Map(), good = [];
  for (const t of tris) {
    const [a, b, c] = t;
    if (a === b || b === c || a === c) continue;
    const k = [a, b, c].sort((x, y) => x - y).join(',');
    const m = Math.min(a, b, c), r = t.indexOf(m), sig = t[r] + ',' + t[(r + 1) % 3] + ',' + t[(r + 2) % 3];
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { sig, t, keep: true }); good.push(byKey.get(k)); }
    else if (prev.sig !== sig) prev.keep = false;
  }
  const kept = good.filter(g => g.keep).map(g => g.t);

  const stats = closeHoles(kept, verts);
  const out = [];
  for (const t of kept) for (const id of t) out.push(verts[id][0], verts[id][1], verts[id][2]);
  const res = Float32Array.from(out);
  res.openEdges = stats;
  return res;
}

// Fills boundary loops (edges without an opposite half-edge); returns the number of edges that stay open
function closeHoles(tris, verts, loopOf) {
  const half = new Map();
  for (const t of tris) for (let i = 0; i < 3; i++) { const k = t[i] + '>' + t[(i + 1) % 3]; half.set(k, (half.get(k) || 0) + 1); }
  const next = new Map();
  for (const k of half.keys()) {
    const [a, b] = k.split('>').map(Number);
    if (!half.has(b + '>' + a)) { if (!next.has(a)) next.set(a, []); next.get(a).push(b); }
  }
  let left = 0;
  while (next.size) {
    const start = next.keys().next().value, loop = [start];
    let cur = start;
    for (;;) {
      const outs = next.get(cur);
      if (!outs || !outs.length) { left += 1; break; }
      const n = outs.pop();
      if (!outs.length) next.delete(cur);
      if (n === start) break;
      loop.push(n); cur = n;
    }
    next.delete(start);
    if (loop.length < 3) { left += loop.length; continue; }
    const poly = loop.slice().reverse(), P = id => new THREE.Vector3(verts[id][0], verts[id][1], verts[id][2]);
    const nor = newellNormal(poly, P);
    let fill = null;
    if (nor.lengthSq() > 1e-20) {
      nor.normalize();
      const p0 = P(poly[0]);
      if (poly.every(id => Math.abs(P(id).sub(p0).dot(nor)) < 1e-3)) fill = triangulatePoly(poly, P, nor);
    }
    const first = tris.length;
    if (fill) tris.push(...fill);
    else {
      const c = [0, 0, 0];
      for (const id of loop) for (let k = 0; k < 3; k++) c[k] += verts[id][k] / loop.length;
      const ci = verts.length;
      verts.push(c);
      for (let i = 0; i < loop.length; i++) tris.push([loop[(i + 1) % loop.length], loop[i], ci]);
    }
    if (loopOf) for (let t = first; t < tris.length; t++) loopOf.push(loopOf.length ? loopOf[loopOf.length - 1] + (t === first ? 1 : 0) : 0);
  }
  return left;
}

// op: 'union' (A + B) or 'subtract' (A - B)
export function booleanOp(posA, posB, op) {
  const a = new Node(), b = new Node();
  a.build(toPolygons(posA));
  b.build(toPolygons(posB));
  if (op === 'union') {
    a.clipTo(b); b.clipTo(a);
    b.invert(); b.clipTo(a); b.invert();
    a.build(b.allPolygons());
  } else {
    a.invert();
    a.clipTo(b); b.clipTo(a);
    b.invert(); b.clipTo(a); b.invert();
    a.build(b.allPolygons());
    a.invert();
  }
  return toPositions(a.allPolygons());
}

// Fills all holes of a non-indexed triangle list. Returns { positions, faceOfNew } where the original
// triangles come first and faceOfNew gives, per added triangle, the index of the hole it belongs to.
export function fillHoles(pos) {
  const verts = [], ids = new Map(), tris = [];
  for (let i = 0; i < pos.length; i += 9) {
    const t = [];
    for (let k = 0; k < 3; k++) {
      const q = [0, 1, 2].map(c => Math.round(pos[i + 3 * k + c] * 1e4)), key = q.join(',');
      let id = ids.get(key);
      if (id === undefined) { id = verts.length; ids.set(key, id); verts.push([pos[i + 3 * k], pos[i + 3 * k + 1], pos[i + 3 * k + 2]]); }
      t.push(id);
    }
    tris.push(t);
  }
  const n0 = tris.length, loopOf = [];
  const left = closeHoles(tris, verts, loopOf);
  const out = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.forEach((id, k) => { out[9 * i + 3 * k] = verts[id][0]; out[9 * i + 3 * k + 1] = verts[id][1]; out[9 * i + 3 * k + 2] = verts[id][2]; }));
  return { positions: out, added: tris.length - n0, faceOfNew: loopOf, left };
}
