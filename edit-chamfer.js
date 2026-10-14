// Editor mixin: edge chamfer.
import * as THREE from 'three';
import { edgeKey } from './model.js';
import { triangulatePoly, newellNormal } from './polygon.js';

export class ChamferMethods {
  // Boundary loop of a face (null for holes, interior points or branching boundaries)
  faceLoop(f) {
    const m = this.model, face = m.faces.get(f);
    const dir = new Set();
    for (const t of face.tris) { const [a, b, c] = m.triVids(t); dir.add(a + '>' + b); dir.add(b + '>' + c); dir.add(c + '>' + a); }
    const next = new Map();
    for (const t of face.tris) {
      const [a, b, c] = m.triVids(t);
      for (const [x, y] of [[a, b], [b, c], [c, a]]) if (!dir.has(y + '>' + x)) { if (next.has(x)) return null; next.set(x, y); }
    }
    if (next.size < 3 || next.size !== face.vids.size) return null;
    const start = next.keys().next().value, loop = [];
    let v = start;
    do { loop.push(v); v = next.get(v); if (v === undefined || loop.length > next.size) return null; } while (v !== start);
    return loop.length === next.size ? loop : null;
  }

  canChamfer() { return this.kind === 'edge' && this.selE.size > 0; }

  // Chamfer: replaces every selected edge by a bevel strip of the given width (distance measured along the neighbouring edges)
  chamferEdges(width) {
    const m = this.model;
    const fail = msg => { this.onMessage?.(msg); return false; };
    const { E } = this.mirrorExpand();
    const sel = new Set([...E].filter(k => m.edgeByKey.get(k)?.faces.size === 2));
    if (!sel.size) return fail('Select edges that border two faces');
    if (!(width > 0)) return fail('Chamfer width must be greater than 0');
    const isSel = (a, b) => sel.has(edgeKey(a, b));
    const aff = new Set();
    sel.forEach(k => { const e = m.edgeByKey.get(k); aff.add(e.a); aff.add(e.b); });
    const sc = this.mesh.scale;
    const d0 = width / ((sc.x + sc.y + sc.z) / 3 || 1);
    const T = this.topo();
    const P = v => new THREE.Vector3().fromArray(T.verts, 3 * v);
    const addVert = p => { const id = T.verts.length / 3; T.verts.push(p.x, p.y, p.z); return id; };

    const loops = new Map(), faceNor = new Map();
    for (const [f, face] of m.faces) {
      if (![...face.vids].some(v => aff.has(v))) continue;
      const L = this.faceLoop(f);
      if (!L) return fail('Chamfer is not supported for faces with holes or inner points');
      loops.set(f, L);
      faceNor.set(f, newellNormal(L, P).normalize());
    }
    const need = new Set();
    loops.forEach(L => {
      const n = L.length;
      for (let i = 0; i < n; i++) {
        const p = L[(i + n - 1) % n], v = L[i], q = L[(i + 1) % n];
        if (!aff.has(v)) continue;
        const sp = isSel(p, v), sn = isSel(v, q);
        if (sn && !sp) need.add(v + '>' + p);
        if (sp && !sn) need.add(v + '>' + q);
      }
    });
    const cuts = new Map();
    const cut = (v, x) => {
      const k = v + '>' + x;
      if (!cuts.has(k)) {
        const A = P(v), B = P(x), len = A.distanceTo(B);
        cuts.set(k, addVert(A.lerp(B, Math.min(d0, 0.45 * len) / len)));
      }
      return cuts.get(k);
    };
    const offs = new Map();
    const off = (f, p, v, q) => {
      const k = f + ':' + v;
      if (!offs.has(k)) {
        const A = P(v), u = P(p).sub(A), w = P(q).sub(A), lu = u.length(), lw = w.length();
        u.divideScalar(lu); w.divideScalar(lw);
        const sin = Math.max(0.2, Math.sqrt(Math.max(0, 1 - u.dot(w) ** 2)));
        const k2 = Math.min(d0, 0.45 * Math.min(lu, lw) * sin) / sin;
        offs.set(k, addVert(A.addScaledVector(u, k2).addScaledVector(w, k2)));
      }
      return offs.get(k);
    };

    const chains = new Map();
    loops.forEach((L, f) => {
      const n = L.length;
      chains.set(f, L.map((v, i) => {
        if (!aff.has(v)) return [v];
        const p = L[(i + n - 1) % n], q = L[(i + 1) % n];
        const sp = isSel(p, v), sn = isSel(v, q);
        if (sp && sn) return [off(f, p, v, q)];
        if (sp) return [cut(v, q)];
        if (sn) return [cut(v, p)];
        const cp = need.has(v + '>' + p), cn = need.has(v + '>' + q);
        if (cp && cn) return [cut(v, p), cut(v, q)];
        if (cp) return [cut(v, p), v];
        if (cn) return [v, cut(v, q)];
        return [v];
      }));
    });

    const oriented = (poly, ref) => (newellNormal(poly, P).dot(ref) < 0 ? poly.slice().reverse() : poly);
    const newTris = [], newFace = [];
    let nextFace = Math.max(...T.face) + 1;
    const addPoly = (poly, ref, f) => {
      const o = oriented(poly, ref);
      const tris = triangulatePoly(o, P, ref.clone().normalize());
      if (!tris) return false;
      for (const t of tris) { newTris.push(t); newFace.push(f); }
      return true;
    };

    const changed = new Set();
    for (const [f, L] of loops) {
      const ch = chains.get(f);
      if (ch.every(c => c.length === 1 && c[0] === L[ch.indexOf(c)])) continue;
      const poly = [];
      ch.forEach(c => c.forEach(v => { if (poly[poly.length - 1] !== v) poly.push(v); }));
      if (poly[poly.length - 1] === poly[0]) poly.pop();
      if (poly.length < 3 || !addPoly(poly, faceNor.get(f), f)) return fail('Chamfer failed on a face');
      changed.add(f);
    }

    for (const k of sel) {
      const e = m.edgeByKey.get(k), [f1, f2] = [...e.faces];
      const q = (f, v) => chains.get(f)[loops.get(f).indexOf(v)][0];
      const ref = faceNor.get(f1).clone().add(faceNor.get(f2));
      if (ref.lengthSq() < 1e-9) ref.copy(faceNor.get(f1));
      if (!addPoly([q(f1, e.a), q(f1, e.b), q(f2, e.b), q(f2, e.a)], ref, nextFace++)) return fail('Chamfer failed on an edge');
    }

    for (const v of aff) {
      const around = [...loops.keys()].filter(f => loops.get(f).includes(v));
      if (!around.length) continue;
      const ring = [], ref = new THREE.Vector3();
      around.forEach(f => ref.add(faceNor.get(f)));
      let cur = around[0], open = false;
      for (let guard = 0; guard <= around.length; guard++) {
        const L = loops.get(cur), i = L.indexOf(v);
        for (const c of chains.get(cur)[i]) if (ring[ring.length - 1] !== c) ring.push(c);
        const e = m.edgeByKey.get(edgeKey(v, L[(i + 1) % L.length]));
        if (!e || e.faces.size !== 2) { open = true; break; }
        const nxt = [...e.faces].find(x => x !== cur);
        if (nxt === around[0]) break;
        if (!loops.has(nxt)) { open = true; break; }
        cur = nxt;
      }
      if (open) continue;
      if (ring[ring.length - 1] === ring[0]) ring.pop();
      if (ring.length >= 3 && ref.lengthSq() > 1e-9 && !addPoly(ring, ref, nextFace++)) return fail('Chamfer failed at a corner');
    }

    const keep = [], keepF = [];
    T.tris.forEach((tr, i) => { if (!changed.has(T.face[i])) { keep.push(tr); keepF.push(T.face[i]); } });
    T.tris = keep.concat(newTris);
    T.face = keepF.concat(newFace);
    this.rebuild(T);
    this.refreshSelection();
    return true;
  }
}
