import * as THREE from 'three';

// Parametric primitives: sizes are real world units, geometry is centred at the origin.
const dim = (key, label, def, step = 0.5) => ({ key, label, def, min: 0.01, step });
const seg = (key, label, def, min, max, step = 1) => ({ key, label, def, min, max, step, int: true });

export const SHAPES = {
  box: {
    label: 'Box',
    fields: [
      dim('w', 'Width', 1), dim('h', 'Height', 1), dim('d', 'Depth', 1),
      seg('sx', 'Subdivisions X', 1, 1, 32), seg('sy', 'Subdivisions Y', 1, 1, 32), seg('sz', 'Subdivisions Z', 1, 1, 32),
    ],
    build: p => ({
      geometry: new THREE.BoxGeometry(p.w, p.h, p.d, p.sx, p.sy, p.sz),
      size: new THREE.Vector3(p.w, p.h, p.d),
    }),
  },
  sphere: {
    label: 'Sphere',
    fields: [dim('d', 'Diameter', 1), seg('seg', 'Subdivisions', 48, 3, 128)],
    build: p => ({
      geometry: new THREE.SphereGeometry(p.d / 2, p.seg, Math.max(2, Math.round(p.seg * 2 / 3))),
      size: new THREE.Vector3(p.d, p.d, p.d),
    }),
  },
  cylinder: {
    label: 'Cylinder',
    fields: [dim('d', 'Diameter', 1), dim('h', 'Height', 1), seg('seg', 'Subdivisions', 48, 3, 128)],
    build: p => ({
      geometry: new THREE.CylinderGeometry(p.d / 2, p.d / 2, p.h, p.seg),
      size: new THREE.Vector3(p.d, p.h, p.d),
    }),
  },
  tube: {
    label: 'Tube',
    fields: [dim('od', 'Outer diameter', 1), dim('id', 'Inner diameter', 0.7), dim('h', 'Height', 1),
      // Circles are subdivided in pairs
      seg('seg', 'Subdivisions', 48, 4, 128, 2)],
    build: p => {
      const ro = p.od / 2, ri = Math.min(p.id, p.od * 0.98) / 2;
      const shape = new THREE.Shape().absarc(0, 0, ro, 0, Math.PI * 2, false);
      shape.holes.push(new THREE.Path().absarc(0, 0, ri, 0, Math.PI * 2, true));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: p.h, bevelEnabled: false, curveSegments: Math.ceil(p.seg / 2) });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, -p.h / 2, 0);
      return { geometry, size: new THREE.Vector3(p.od, p.h, p.od) };
    },
  },
};

export const defaultParams = type => Object.fromEntries(SHAPES[type].fields.map(f => [f.key, f.def]));

// Fills in missing values and clamps all parameters to valid ranges
export function normalizeParams(type, params = {}) {
  const out = {};
  for (const f of SHAPES[type].fields) {
    let v = Number(params[f.key]);
    if (!Number.isFinite(v)) v = f.def;
    v = Math.max(f.min, f.max !== undefined ? Math.min(f.max, v) : v);
    out[f.key] = f.int ? Math.round(v) : v;
  }
  return out;
}

export function buildShape(type, params) {
  const p = normalizeParams(type, params);
  const { geometry, size } = SHAPES[type].build(p);
  return { geometry, size, params: p, edges: new THREE.EdgesGeometry(geometry, 30) };
}
