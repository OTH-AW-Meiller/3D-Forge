// Blender-style navigation widget: axis gizmo (click = snap view, drag = orbit) plus zoom and pan drag buttons.
import * as THREE from 'three';

const AXES = [
  { label: 'X', dir: new THREE.Vector3(1, 0, 0), color: '#ff4f64' },
  { label: 'Y', dir: new THREE.Vector3(0, 1, 0), color: '#57d58a' },
  { label: 'Z', dir: new THREE.Vector3(0, 0, 1), color: '#4f9fff' },
];

export function setupNavGizmo({ canvas, zoomBtn, panBtn, camera, navigate }) {
  const ctx = canvas.getContext('2d');
  const size = 90, R = 30, r = 9;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = size + 'px';
  let hover = null, items = [];

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = hover === 'bg' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
    ctx.fill();
    const inv = camera.quaternion.clone().invert();
    items = [];
    for (const a of AXES) for (const sign of [1, -1]) {
      const v = a.dir.clone().multiplyScalar(sign).applyQuaternion(inv);
      items.push({ a, sign, x: size / 2 + v.x * R, y: size / 2 - v.y * R, z: v.z });
    }
    items.sort((p, q) => p.z - q.z);
    for (const it of items) {
      if (it.sign > 0) {
        ctx.beginPath();
        ctx.moveTo(size / 2, size / 2);
        ctx.lineTo(it.x, it.y);
        ctx.strokeStyle = it.a.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(it.x, it.y, r, 0, Math.PI * 2);
      const isHover = hover === it;
      if (it.sign > 0) {
        ctx.fillStyle = isHover ? '#fff' : it.a.color;
        ctx.fill();
      } else {
        ctx.fillStyle = isHover ? 'rgba(255,255,255,0.6)' : 'rgba(40,44,52,0.85)';
        ctx.fill();
        ctx.strokeStyle = it.a.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (it.sign > 0 || isHover) {
        ctx.fillStyle = isHover ? '#111' : '#1e2127';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.a.label, it.x, it.y + 0.5);
      }
    }
  };
  const loop = () => { draw(); requestAnimationFrame(loop); };
  loop();

  const hit = e => {
    const b = canvas.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    for (let i = items.length - 1; i >= 0; i--) if (Math.hypot(items[i].x - x, items[i].y - y) <= r + 1) return items[i];
    return null;
  };

  // Drag helper: calls onMove(dx, dy) while dragging, onClick if the pointer barely moved
  const dragger = (el, onMove, onClick) => {
    let st = null;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      st = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, start: e };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!st) return;
      if (!st.moved && Math.hypot(e.clientX - st.sx, e.clientY - st.sy) > 4) st.moved = true;
      if (st.moved) onMove(e.clientX - st.x, e.clientY - st.y);
      st.x = e.clientX; st.y = e.clientY;
    });
    const end = e => {
      if (!st) return;
      const s = st;
      st = null;
      el.releasePointerCapture(e.pointerId);
      if (!s.moved) onClick?.(e);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { st = null; });
  };

  dragger(canvas, navigate.orbit, e => {
    const it = hit(e);
    if (it) navigate.viewFrom(it.a.dir.clone().multiplyScalar(it.sign));
  });
  canvas.addEventListener('pointermove', e => { hover = hit(e) || 'bg'; });
  canvas.addEventListener('pointerleave', () => { hover = null; });
  dragger(zoomBtn, (dx, dy) => navigate.zoom(dy));
  dragger(panBtn, navigate.pan);
}
