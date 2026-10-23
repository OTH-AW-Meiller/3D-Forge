// Drag-to-change for numeric fields: press on a number input and move the mouse up/down to change its value.
const PX_PER_STEP = 6;

export function setupNumberScrub() {
  let st = null;
  const fire = (el, type, scrub) => {
    const ev = new Event(type, { bubbles: true });
    ev.scrub = scrub;
    el.dispatchEvent(ev);
  };
  document.addEventListener('pointerdown', e => {
    const el = e.target;
    if (e.button !== 0 || !(el instanceof HTMLInputElement) || el.type !== 'number' || el.disabled || el.readOnly) return;
    // Leave the native spinner buttons at the right edge alone
    if (e.offsetX > el.clientWidth - 14) return;
    st = { el, y: e.clientY, acc: 0, moved: false, id: e.pointerId };
  });
  document.addEventListener('pointermove', e => {
    if (!st) return;
    const dy = st.y - e.clientY;
    if (!st.moved && Math.abs(dy) < 4) return;
    if (!st.moved) {
      st.moved = true;
      st.el.focus();
      st.el.setPointerCapture(st.id);
      document.body.style.userSelect = 'none';
    }
    st.acc += dy;
    st.y = e.clientY;
    const steps = Math.trunc(st.acc / PX_PER_STEP);
    if (!steps) return;
    st.acc -= steps * PX_PER_STEP;
    const el = st.el;
    const step = parseFloat(el.step) || 1;
    const dec = (String(step).split('.')[1] || '').length;
    let v = (parseFloat(el.value) || 0) + steps * step * (e.shiftKey ? 0.1 : 1);
    if (el.min !== '') v = Math.max(parseFloat(el.min), v);
    if (el.max !== '') v = Math.min(parseFloat(el.max), v);
    el.value = String(+v.toFixed(Math.max(dec, 3)));
    fire(el, 'input', true);
    fire(el, 'change', true);
  });
  const end = () => {
    if (!st) return;
    const s = st;
    st = null;
    document.body.style.userSelect = '';
    if (s.moved) fire(s.el, 'change', false);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}
