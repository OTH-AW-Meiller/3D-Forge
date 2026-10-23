// Screen-space selection regions (rectangle, circle, lasso) as polygons: [[x, y], ...]

export function rectPolygon(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export function circlePolygon(cx, cy, r, n = 48) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
}

// Even-odd rule, works for concave lasso shapes
export function pointIn(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Parameter t (0..1) of a point of the segment a-b lying inside the polygon, or null
export function segHit(poly, a, b) {
  if (pointIn(poly, a[0], a[1])) return 0;
  if (pointIn(poly, b[0], b[1])) return 1;
  let best = null;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j], ex = poly[i][0] - p[0], ey = poly[i][1] - p[1];
    const den = dx * ey - dy * ex;
    if (den === 0) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

// Does the convex screen shape (triangle or quad) overlap the polygon?
export function shapeHit(poly, pts) {
  if (pts.some(p => pointIn(poly, p[0], p[1]))) return true;
  for (let i = 0; i < pts.length; i++) if (segHit(poly, pts[i], pts[(i + 1) % pts.length]) !== null) return true;
  return pointIn(pts, poly[0][0], poly[0][1]);
}
