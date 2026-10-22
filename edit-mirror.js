// Editor mixin: mirror axes (X/Y/Z) and mirrored selection.
import { edgeKey } from './model.js';

export class MirrorMethods {
  // --- Mirror ---------------------------------------------------------
  anyMirror() { return this.mirror.x || this.mirror.y || this.mirror.z; }

  setMirror(axis, on) {
    this.mirror[axis] = on;
    this.refreshMirrorPlanes();
    if (this.active) this.refreshSelection(false);
  }

  // Sign vectors of all active mirror combinations (mirror planes pass through the object origin)
  combos() {
    const out = [];
    for (let mask = 1; mask < 8; mask++) {
      const on = [this.mirror.x, this.mirror.y, this.mirror.z];
      if ([0, 1, 2].some(i => (mask >> i) & 1 && !on[i])) continue;
      out.push([0, 1, 2].map(i => ((mask >> i) & 1 ? -1 : 1)));
    }
    return out;
  }

  // Per combination: vertex index -> index of the mirrored vertex (-1 = none)
  mirrorPartners() {
    const m = this.model, key = (x, y, z) => Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000);
    const combos = this.combos();
    if (!combos.length) return [];
    const at = new Map();
    for (let i = 0; i < m.nVerts; i++) at.set(key(m.verts[3 * i], m.verts[3 * i + 1], m.verts[3 * i + 2]), i);
    return combos.map(s => {
      const p = new Int32Array(m.nVerts);
      for (let i = 0; i < m.nVerts; i++) p[i] = at.get(key(m.verts[3 * i] * s[0], m.verts[3 * i + 1] * s[1], m.verts[3 * i + 2] * s[2])) ?? -1;
      return p;
    });
  }

  // Selection including mirrored counterparts
  mirrorExpand() {
    const V = new Set(this.selV), E = new Set(this.selE), F = new Set(this.selF);
    if (!this.anyMirror()) return { V, E, F };
    const m = this.model, P = this.drag?.partners ?? this.mirrorPartners();
    const faceByKey = new Map();
    m.faces.forEach((f, id) => faceByKey.set([...f.vids].sort((x, y) => x - y).join(','), id));
    for (const p of P) {
      this.selV.forEach(i => { if (p[i] >= 0) V.add(p[i]); });
      this.selE.forEach(k => {
        const e = m.edgeByKey.get(k);
        if (!e || p[e.a] < 0 || p[e.b] < 0) return;
        const k2 = edgeKey(p[e.a], p[e.b]);
        if (m.edgeByKey.has(k2)) E.add(k2);
      });
      this.selF.forEach(f => {
        const ids = [...m.faces.get(f).vids].map(i => p[i]);
        if (ids.some(i => i < 0)) return;
        const id = faceByKey.get(ids.sort((x, y) => x - y).join(','));
        if (id !== undefined) F.add(id);
      });
    }
    return { V, E, F };
  }

  withMirroredSelection(fn) {
    const { V, E, F } = this.mirrorExpand();
    this.selV = V; this.selE = E; this.selF = F;
    fn();
  }
}
