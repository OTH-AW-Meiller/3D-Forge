// Isotropic remeshing (split long / collapse short / flip / tangential smoothing with projection onto the original surface).
// Sharp edges (dihedral angle above featureDeg) and open boundaries are kept.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Closest point on triangle abc to p (Ericson, Real-Time Collision Detection)
function closestOnTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

// positions: non-indexed triangle soup (9 floats per triangle). Returns { positions, src } or null for an empty mesh.
// src[i] is the index of the original triangle closest to output triangle i.
export function remesh(positions, edgeLen, { iterations = 5, featureDeg = 35, maxTris = 150000 } = {}) {
  const cosF = Math.cos(featureDeg * Math.PI / 180), hi = edgeLen * 4 / 3, lo = edgeLen * 4 / 5, K = 1 << 22;
  const P = [], T = [], vt = [], weld = new Map();
  const vid = i => {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
    let id = weld.get(k);
    if (id === undefined) { id = P.length; weld.set(k, id); P.push([x, y, z]); vt.push(new Set()); }
    return id;
  };
  const tris0 = [], srcIdx = [];
  for (let i = 0; i < positions.length; i += 9) {
    const a = vid(i), b = vid(i + 3), c = vid(i + 6);
    if (a === b || b === c || a === c) continue;
    if (len(cross(sub(P[b], P[a]), sub(P[c], P[a]))) < 1e-12 * edgeLen * edgeLen) continue;
    tris0.push([a, b, c]);
    srcIdx.push(i / 9);
  }
  if (!tris0.length) return null;
  const origP = P.map(p => p.slice()), origT = tris0.map(t => t.slice());

  // Spatial grid over the original triangles for closest-point queries
  const cell = edgeLen * 2, grid = new Map(), cellKey = (i, j, k) => i + ',' + j + ',' + k;
  origT.forEach((t, ti) => {
    const ps = t.map(v => origP[v]), lo3 = [0, 1, 2].map(c => Math.floor(Math.min(ps[0][c], ps[1][c], ps[2][c]) / cell));
    const hi3 = [0, 1, 2].map(c => Math.floor(Math.max(ps[0][c], ps[1][c], ps[2][c]) / cell));
    for (let i = lo3[0]; i <= hi3[0]; i++) for (let j = lo3[1]; j <= hi3[1]; j++) for (let k = lo3[2]; k <= hi3[2]; k++) {
      const key = cellKey(i, j, k);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(ti);
    }
  });
  function closest(p) {
    const c = [Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)];
    let best = Infinity, bq = null, bt = -1;
    for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (r > 1 && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < r) continue;
        const list = grid.get(cellKey(c[0] + dx, c[1] + dy, c[2] + dz));
        if (!list) continue;
        for (const ti of list) {
          const t = origT[ti], q = closestOnTri(p, origP[t[0]], origP[t[1]], origP[t[2]]);
          const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
          if (d < best) { best = d; bq = q; bt = ti; }
        }
      }
      if (bq && best <= (r * cell) ** 2) break;
    }
    return bq ? { q: bq, t: bt } : null;
  }

  // Live triangle mesh with vertex -> triangle adjacency
  let live = 0;
  const addV = p => { P.push(p); vt.push(new Set()); return P.length - 1; };
  const addT = (a, b, c) => {
    if (++live > maxTris) throw new Error('Too many triangles');
    T.push([a, b, c]);
    const t = T.length - 1;
    vt[a].add(t); vt[b].add(t); vt[c].add(t);
    return t;
  };
  const delT = t => { for (const v of T[t]) vt[v].delete(t); T[t] = null; live--; };
  tris0.forEach(t => addT(t[0], t[1], t[2]));
  const edgeTris = (a, b) => {
    const [s, l] = vt[a].size < vt[b].size ? [vt[a], vt[b]] : [vt[b], vt[a]], r = [];
    for (const t of s) if (l.has(t)) r.push(t);
    return r;
  };
  const triNormal = t => cross(sub(P[T[t][1]], P[T[t][0]]), sub(P[T[t][2]], P[T[t][0]]));
  const isFeature = (a, b) => {
    const ts = edgeTris(a, b);
    return ts.length !== 2 || dot(unit(triNormal(ts[0])), unit(triNormal(ts[1]))) < cosF;
  };
  const neighbors = v => { const s = new Set(); for (const t of vt[v]) for (const w of T[t]) if (w !== v) s.add(w); return s; };
  const featNbrs = v => [...neighbors(v)].filter(w => isFeature(v, w));
  const allEdges = () => {
    const seen = new Set(), out = [];
    for (const t of T) {
      if (!t) continue;
      for (let k = 0; k < 3; k++) {
        const a = Math.min(t[k], t[(k + 1) % 3]), b = Math.max(t[k], t[(k + 1) % 3]);
        if (!seen.has(a * K + b)) { seen.add(a * K + b); out.push([a, b]); }
      }
    }
    return out;
  };

  function splitLong() {
    let n = 0;
    for (const [a, b] of allEdges()) {
      const ts = edgeTris(a, b);
      if (!ts.length || dist(P[a], P[b]) <= hi) continue;
      const m = addV([(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2, (P[a][2] + P[b][2]) / 2]);
      for (const t of ts) {
        const tri = T[t];
        let k = 0;
        while (!((tri[k] === a && tri[(k + 1) % 3] === b) || (tri[k] === b && tri[(k + 1) % 3] === a))) k++;
        const p = tri[k], q = tri[(k + 1) % 3], r = tri[(k + 2) % 3];
        delT(t);
        addT(p, m, r); addT(m, q, r);
      }
      n++;
    }
    return n;
  }

  // Merge v into u
  function tryCollapse(u, v) {
    const fn = featNbrs(v);
    if (fn.length && (fn.length !== 2 || !fn.includes(u))) return false;
    const ts = edgeTris(u, v);
    const nu = neighbors(u);
    let common = 0;
    for (const w of neighbors(v)) if (nu.has(w)) common++;
    if (common !== 2) return false;
    for (const t of vt[v]) {
      if (ts.includes(t)) continue;
      const nt = T[t].map(w => (w === v ? u : w));
      const old = triNormal(t), nn = cross(sub(P[nt[1]], P[nt[0]]), sub(P[nt[2]], P[nt[0]]));
      if (len(nn) < 1e-20 || dot(old, nn) < 0.3 * len(old) * len(nn)) return false;
      for (const w of T[t]) if (w !== v && dist(P[u], P[w]) > hi) return false;
    }
    for (const t of ts) delT(t);
    for (const t of [...vt[v]]) { vt[v].delete(t); T[t][T[t].indexOf(v)] = u; vt[u].add(t); }
    return true;
  }
  function collapseShort() {
    for (const [a, b] of allEdges()) {
      if (!vt[a].size || !vt[b].size || dist(P[a], P[b]) >= lo || edgeTris(a, b).length !== 2) continue;
      if (!tryCollapse(a, b)) tryCollapse(b, a);
    }
  }

  // Flip edges to bring vertex valences closer to 6 (4 on sharp edges)
  function flipEdges() {
    const target = w => (featNbrs(w).length ? 4 : 6);
    for (const [a, b] of allEdges()) {
      const ts = edgeTris(a, b);
      if (ts.length !== 2 || isFeature(a, b)) continue;
      const [t1, t2] = ts, tri1 = T[t1], tri2 = T[t2];
      const c = tri1.find(w => w !== a && w !== b), d = tri2.find(w => w !== a && w !== b);
      if (c === d || edgeTris(c, d).length) continue;
      const dev = (w, delta) => Math.abs(vt[w].size + delta - target(w));
      if (dev(a, -1) + dev(b, -1) + dev(c, 1) + dev(d, 1) >= dev(a, 0) + dev(b, 0) + dev(c, 0) + dev(d, 0)) continue;
      let k = 0;
      while (tri1[k] !== a && tri1[k] !== b) k++;
      const A = tri1[k] === a && tri1[(k + 1) % 3] === b ? a : b, B = A === a ? b : a;
      const n1 = triNormal(t1), n2 = triNormal(t2), ns = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]];
      const f1 = cross(sub(P[d], P[A]), sub(P[c], P[A])), f2 = cross(sub(P[B], P[d]), sub(P[c], P[d]));
      const minA = 0.1 * edgeLen * edgeLen;
      if (len(f1) < minA || len(f2) < minA || dot(f1, ns) <= 0.2 * len(f1) * len(ns) || dot(f2, ns) <= 0.2 * len(f2) * len(ns)) continue;
      delT(t1); delT(t2);
      addT(A, d, c); addT(d, B, c);
    }
  }

  // Tangential relaxation of smooth vertices, projected back onto the original surface
  function smooth() {
    for (let v = 0; v < P.length; v++) {
      if (!vt[v].size || featNbrs(v).length) continue;
      const nb = [...neighbors(v)], c = [0, 0, 0], n = [0, 0, 0];
      for (const w of nb) { c[0] += P[w][0]; c[1] += P[w][1]; c[2] += P[w][2]; }
      c[0] /= nb.length; c[1] /= nb.length; c[2] /= nb.length;
      for (const t of vt[v]) { const tn = triNormal(t); n[0] += tn[0]; n[1] += tn[1]; n[2] += tn[2]; }
      const un = unit(n), d = sub(c, P[v]), dn = dot(d, un);
      const q = [P[v][0] + 0.5 * (d[0] - un[0] * dn), P[v][1] + 0.5 * (d[1] - un[1] * dn), P[v][2] + 0.5 * (d[2] - un[2] * dn)];
      const pr = closest(q), np = pr ? pr.q : q;
      // Skip moves that would pile vertices on top of each other (e.g. clamping onto a shared original corner)
      if (!nb.every(w => dist(np, P[w]) > 0.3 * edgeLen)) continue;
      // Also reject moves that flip or squash an adjacent triangle
      const ok = [...vt[v]].every(t => {
        const tri = T[t], pts = tri.map(w => (w === v ? np : P[w])), old = triNormal(t);
        const nn = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
        return len(nn) > 0.15 * edgeLen * edgeLen && dot(nn, old) > 0.2 * len(nn) * len(old);
      });
      if (ok) P[v] = np;
    }
  }

  for (let it = 0; it < iterations; it++) {
    for (let g = 0; g < 30 && splitLong(); g++);
    collapseShort();
    flipEdges();
    smooth();
  }

  const out = [], src = [];
  for (const t of T) {
    if (!t) continue;
    const [a, b, c] = t.map(v => P[v]);
    out.push(...a, ...b, ...c);
    const ctr = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    src.push(srcIdx[closest(ctr)?.t ?? 0]);
  }
  return { positions: Float32Array.from(out), src: Int32Array.from(src) };
}

// Keeps only the outer skin of a triangle soup: a triangle survives if the point just outside of either of its sides
// lies outside the solid (winding number of the whole mesh = 0). Interior shells, overlaps and cavities are dropped.
// Returns { positions, map } where map[i] is the original triangle index of kept triangle i.
export function skinOnly(positions) {
  const n = positions.length / 9, all = () => ({ positions, map: Int32Array.from({ length: n }, (_, i) => i) });
  if (!n) return all();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]); }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const eps = diag * 1e-4, jy = diag * 1.3e-6, jz = diag * 0.7e-6;
  const nrm = new Float64Array(n * 3);
  const dim = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(n))));
  const cy = (hi[1] - lo[1]) / dim || 1, cz = (hi[2] - lo[2]) / dim || 1;
  const cells = Array.from({ length: dim * dim }, () => []);
  const ci = (v, l, c) => Math.min(dim - 1, Math.max(0, Math.floor((v - l) / c)));
  for (let t = 0; t < n; t++) {
    const o = 9 * t, p = positions;
    const e1 = [p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]], e2 = [p[o + 6] - p[o], p[o + 7] - p[o + 1], p[o + 8] - p[o + 2]];
    const c = cross(e1, e2);
    nrm[3 * t] = c[0]; nrm[3 * t + 1] = c[1]; nrm[3 * t + 2] = c[2];
    if (Math.abs(c[0]) < 1e-14 * diag * diag) continue;
    const ys = [p[o + 1], p[o + 4], p[o + 7]], zs = [p[o + 2], p[o + 5], p[o + 8]];
    for (let a = ci(Math.min(...ys), lo[1], cy); a <= ci(Math.max(...ys), lo[1], cy); a++)
      for (let b = ci(Math.min(...zs), lo[2], cz); b <= ci(Math.max(...zs), lo[2], cz); b++) cells[a * dim + b].push(t);
  }
  const inside = q => {
    const y = q[1] + jy, z = q[2] + jz;
    let w = 0;
    for (const t of cells[ci(y, lo[1], cy) * dim + ci(z, lo[2], cz)]) {
      const o = 9 * t, p = positions;
      const d1 = (p[o + 4] - p[o + 1]) * (z - p[o + 2]) - (p[o + 5] - p[o + 2]) * (y - p[o + 1]);
      const d2 = (p[o + 7] - p[o + 4]) * (z - p[o + 5]) - (p[o + 8] - p[o + 5]) * (y - p[o + 4]);
      const d3 = (p[o + 1] - p[o + 7]) * (z - p[o + 8]) - (p[o + 2] - p[o + 8]) * (y - p[o + 7]);
      if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue;
      const nx = nrm[3 * t], ny = nrm[3 * t + 1], nz = nrm[3 * t + 2];
      const x = p[o] - (ny * (y - p[o + 1]) + nz * (z - p[o + 2])) / nx;
      if (x > q[0]) w += nx > 0 ? 1 : -1;
    }
    return w !== 0;
  };
  const keep = [];
  for (let t = 0; t < n; t++) {
    const o = 9 * t, p = positions, l = Math.hypot(nrm[3 * t], nrm[3 * t + 1], nrm[3 * t + 2]);
    if (!l) continue;
    const c = [(p[o] + p[o + 3] + p[o + 6]) / 3, (p[o + 1] + p[o + 4] + p[o + 7]) / 3, (p[o + 2] + p[o + 5] + p[o + 8]) / 3];
    const u = [nrm[3 * t] / l * eps, nrm[3 * t + 1] / l * eps, nrm[3 * t + 2] / l * eps];
    if (!inside([c[0] + u[0], c[1] + u[1], c[2] + u[2]]) || !inside([c[0] - u[0], c[1] - u[1], c[2] - u[2]])) keep.push(t);
  }
  if (!keep.length || keep.length === n) return all();
  const out = new Float32Array(keep.length * 9);
  keep.forEach((t, i) => out.set(positions.subarray(9 * t, 9 * t + 9), 9 * i));
  return { positions: out, map: Int32Array.from(keep) };
}
