// Editor mixin: Catmull-Clark subdivision of the selected faces (one refinement level per call).
import { edgeKey } from './model.js';

export class SubdivideMethods {
  canSubdivide() { return !!this.model && this.kind === 'face' && this.selF.size > 0; }

  // Face boundary loops; faces without a simple loop (holes, interior points) fall back to their triangles
  subdivPolygons(faceIds) {
    const m = this.model, polys = [];
    for (const f of faceIds) {
      const loop = this.faceLoop(f);
      if (loop) polys.push({ loop, face: f });
      else for (const t of m.faces.get(f).tris) polys.push({ loop: m.triVids(t), face: f });
    }
    return polys;
  }

  // Catmull-Clark on the selected faces (incl. mirrored ones): every n-gon becomes n quads.
  // Vertices on the border to unselected faces stay fixed; neighbouring faces get the new edge points so the mesh stays closed.
  subdivide() {
    if (!this.canSubdivide()) return false;
    const faceIds = [...this.mirrorExpand().F].filter(f => this.model.faces.has(f));
    const T = this.topo(), V = T.verts;
    const polys = this.subdivPolygons(faceIds);
    if (!polys.length) { this.onMessage?.('Select faces to subdivide'); return false; }
    const selected = new Set(faceIds);
    const get = i => [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
    const addVert = p => { V.push(p[0], p[1], p[2]); return V.length / 3 - 1; };
    const avg = list => {
      const s = [0, 0, 0];
      for (const p of list) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
      return s.map(x => x / list.length);
    };

    const fp = polys.map(p => avg(p.loop.map(get)));
    const edges = new Map();
    polys.forEach((p, pi) => p.loop.forEach((a, i) => {
      const b = p.loop[(i + 1) % p.loop.length], k = edgeKey(a, b);
      let e = edges.get(k);
      if (!e) edges.set(k, e = { a, b, polys: [], shared: false });
      e.polys.push(pi);
    }));
    T.tris.forEach((tr, i) => {
      if (selected.has(T.face[i])) return;
      for (let k = 0; k < 3; k++) { const e = edges.get(edgeKey(tr[k], tr[(k + 1) % 3])); if (e) e.shared = true; }
    });

    const vertEdges = new Map(), vertPolys = new Map();
    const push = (map, v, x) => { if (!map.has(v)) map.set(v, []); map.get(v).push(x); };
    for (const e of edges.values()) {
      e.mid = avg([get(e.a), get(e.b)]);
      e.point = e.polys.length === 2 ? avg([get(e.a), get(e.b), fp[e.polys[0]], fp[e.polys[1]]]) : e.mid;
      push(vertEdges, e.a, e); push(vertEdges, e.b, e);
    }
    polys.forEach((p, pi) => p.loop.forEach(v => push(vertPolys, v, pi)));

    const moved = new Map();
    for (const [v, es] of vertEdges) {
      if (es.some(e => e.shared)) continue;
      const P = get(v), border = es.filter(e => e.polys.length !== 2);
      if (!border.length) {
        const n = es.length, F = avg(vertPolys.get(v).map(pi => fp[pi])), R = avg(es.map(e => e.mid));
        moved.set(v, P.map((x, k) => (F[k] + 2 * R[k] + (n - 3) * x) / n));
      } else if (border.length === 2 && border.every(e => e.polys.length === 1)) {
        const [A, B] = border.map(e => get(e.a === v ? e.b : e.a));
        moved.set(v, P.map((x, k) => (6 * x + A[k] + B[k]) / 8));
      }
    }
    for (const e of edges.values()) e.id = addVert(e.point);
    const faceVert = fp.map(addVert);
    for (const [v, p] of moved) { V[3 * v] = p[0]; V[3 * v + 1] = p[1]; V[3 * v + 2] = p[2]; }

    const colors = this.model.faceColors;
    let nextFace = Math.max(...T.face) + 1;
    const tris = [], face = [], newIds = new Set();
    // Unselected faces: keep triangles, but split them at the new edge points
    T.tris.forEach((tr, i) => {
      if (selected.has(T.face[i])) return;
      let parts = [tr];
      for (let k = 0; k < 3; k++) {
        const x = tr[k], y = tr[(k + 1) % 3], e = edges.get(edgeKey(x, y));
        if (!e) continue;
        const next = [];
        for (const t of parts) {
          const j = [0, 1, 2].find(q => (t[q] === x && t[(q + 1) % 3] === y) || (t[q] === y && t[(q + 1) % 3] === x));
          if (j === undefined) { next.push(t); continue; }
          const p = t[j], q = t[(j + 1) % 3], z = t[(j + 2) % 3];
          next.push([p, e.id, z], [e.id, q, z]);
        }
        parts = next;
      }
      for (const t of parts) { tris.push(t); face.push(T.face[i]); }
    });

    polys.forEach((p, pi) => {
      const L = p.loop, n = L.length, color = colors.get(p.face);
      for (let i = 0; i < n; i++) {
        const prev = L[(i + n - 1) % n], v = L[i], next = L[(i + 1) % n];
        const q = [v, edges.get(edgeKey(v, next)).id, faceVert[pi], edges.get(edgeKey(prev, v)).id];
        const id = nextFace++;
        newIds.add(id);
        if (color) colors.set(id, color);
        const d = (i0, i1) => Math.hypot(...get(q[i0]).map((x, k) => x - get(q[i1])[k]));
        if (d(0, 2) <= d(1, 3)) tris.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
        else tris.push([q[0], q[1], q[3]], [q[1], q[2], q[3]]);
        face.push(id, id);
      }
    });
    T.tris = tris;
    T.face = face;
    this.rebuild(T);
    newIds.forEach(id => this.selF.add(id));
    this.refreshSelection();
    return true;
  }
}
