// Static 3D stage setup.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Creates the static 3D stage: scene, camera, lights, ground grid, renderer and orbit controls.
export function createStage(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e2127);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(6, 5, 8);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
  scene.add(sun);

  const grid = new THREE.GridHelper(40, 40, 0x6b7385, 0x3a404b);
  scene.add(grid);
  scene.add(new THREE.AxesHelper(2));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.25 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const orbit = new OrbitControls(camera, renderer.domElement);
  // Zooming scales the view about the pivot point (set by the app), so the pivot stays fixed on screen
  let zoomCenter = null, rotateBlocked = null;
  const zoomBy = f => {
    const c = zoomCenter?.() ?? orbit.target;
    const dist = camera.position.distanceTo(c);
    if (dist < 1e-6) return;
    const k = Math.min(300, Math.max(0.3, dist * f)) / dist;
    camera.position.sub(c).multiplyScalar(k).add(c);
    orbit.target.sub(c).multiplyScalar(k).add(c);
  };
  // Alt + left drag zooms (capture phase, so it claims the event before the other pointer handlers)
  let zoomDrag = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.altKey) return;
    e.stopImmediatePropagation();
    zoomDrag = { y: e.clientY };
    el.setPointerCapture(e.pointerId);
  }, true);
  el.addEventListener('pointermove', e => {
    if (!zoomDrag) return;
    zoomBy(Math.exp((e.clientY - zoomDrag.y) * 0.008));
    zoomDrag.y = e.clientY;
  });

  // Left-drag orbit about the pivot point (OrbitControls only rotates about its target); Shift/Ctrl+drag and right-drag still pan
  orbit.enableRotate = false;
  const UP = new THREE.Vector3(0, 1, 0);
  let rot = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || rotateBlocked?.()) return;
    rot = { x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!rot) return;
    if (rotateBlocked?.()) { rot = null; return; }
    const c = zoomCenter?.() ?? orbit.target, k = 2 * Math.PI / el.clientHeight;
    const yaw = -(e.clientX - rot.x) * k;
    let pitch = -(e.clientY - rot.y) * k;
    rot.x = e.clientX; rot.y = e.clientY;
    const view = camera.position.clone().sub(orbit.target);
    const polar = Math.acos(THREE.MathUtils.clamp(view.y / view.length(), -1, 1));
    pitch = THREE.MathUtils.clamp(polar + pitch, 0.01, Math.PI - 0.01) - polar;
    const right = new THREE.Vector3().crossVectors(UP, view).normalize();
    const turn = v => v.sub(c).applyAxisAngle(UP, yaw).applyAxisAngle(right.clone().applyAxisAngle(UP, yaw), pitch).add(c);
    turn(camera.position);
    turn(orbit.target);
  });
  const endRot = e => { if (rot) { rot = null; el.releasePointerCapture(e.pointerId); } };
  el.addEventListener('pointerup', endRot);
  el.addEventListener('pointercancel', endRot);
  const endZoom = e => { if (zoomDrag) { zoomDrag = null; el.releasePointerCapture(e.pointerId); } };
  el.addEventListener('pointerup', endZoom);
  el.addEventListener('pointercancel', endZoom);

  orbit.enableDamping = false;
  // Fixed zoom step per wheel event (independent of device-specific delta values)
  orbit.enableZoom = false;
  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? 1.06 : 1 / 1.06);
  }, { passive: false });
  orbit.target.set(0, 0.5, 0);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  return { scene, camera, renderer, orbit, ground, resize, setZoomCenter: fn => { zoomCenter = fn; }, setRotateBlocked: fn => { rotateBlocked = fn; } };
}
