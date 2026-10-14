// Planar polygon helpers (triangulation, normals).
import * as THREE from 'three';

// Ear clipping of a planar polygon loop (counter-clockwise with respect to nor)
export function triangulatePoly(poly, P, nor) {
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(nor.x) > 0.9) u.set(0, 1, 0);
  u.addScaledVector(nor, -u.dot(nor)).normalize();
  const w = new THREE.Vector3().crossVectors(nor, u);
  const cache = new Map();
  const xy = v => { let r = cache.get(v); if (!r) { const p = P(v); cache.set(v, r = [p.dot(u), p.dot(w)]); } return r; };
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const out = [], idx = poly.slice();
  while (idx.length > 3) {
    let cut = -1;
    for (let pass = 0; pass < 2 && cut < 0; pass++) {
      for (let i = 0; i < idx.length; i++) {
        const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
        const p0 = xy(i0), p1 = xy(i1), p2 = xy(i2), c = cross(p0, p1, p2);
        if (pass === 0 ? c <= 1e-12 : c < -1e-9) continue;
        if (pass === 0 && idx.some(k => {
          if (k === i0 || k === i1 || k === i2) return false;
          const q = xy(k);
          return cross(p0, p1, q) >= 0 && cross(p1, p2, q) >= 0 && cross(p2, p0, q) >= 0;
        })) continue;
        out.push([i0, i1, i2]); cut = i; break;
      }
    }
    if (cut < 0) return null;
    idx.splice(cut, 1);
  }
  out.push(idx.slice());
  return out;
}

export function newellNormal(poly, P) {
  const n = new THREE.Vector3(), len = poly.length;
  for (let i = 0; i < len; i++) {
    const c = P(poly[i]), d = P(poly[(i + 1) % len]);
    n.x += (c.y - d.y) * (c.z + d.z); n.y += (c.z - d.z) * (c.x + d.x); n.z += (c.x - d.x) * (c.y + d.y);
  }
  return n;
}
