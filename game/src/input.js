// input.js: keyboard and mouse state for the game. Tracks held keys, keys pressed this frame,
// mouse buttons and pointer-locked mouse movement for the camera.
const held = new Set();
const pressed = new Set();
const mouse = { dx: 0, dy: 0, left: false, right: false, clicked: false };
let lockTarget = null;

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight',
  'KeyE', 'KeyF', 'KeyQ', 'KeyM', 'KeyP', 'KeyR', 'KeyH', 'KeyC', 'Tab', 'Digit1', 'Digit2']);

/** Listen on the window; the canvas takes pointer lock on click while the game is in play. */
export function initInput(canvas) {
  lockTarget = canvas;
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    held.add(e.code);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); mouse.left = false; mouse.right = false; });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { mouse.left = true; mouse.clicked = true; }
    if (e.button === 2) mouse.right = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === lockTarget || mouse.right) {
      mouse.dx += e.movementX || 0;
      mouse.dy += e.movementY || 0;
    }
  });
}

/** Ask the browser to capture the mouse so it steers the camera. Safe to call when unsupported. */
export function capturePointer() {
  if (!lockTarget || document.pointerLockElement === lockTarget) return;
  try {
    const request = lockTarget.requestPointerLock();
    if (request && request.catch) request.catch(() => {});
  } catch { /* pointer lock unavailable: right-drag still turns the camera */ }
}
export function releasePointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

export const isKeyDown = (code) => held.has(code);
export const wasKeyPressed = (code) => pressed.has(code);
export const isMouseDown = () => mouse.left;
export const wasMouseClicked = () => mouse.clicked;
export const isAimHeld = () => mouse.right;
/** Take the mouse movement accumulated since the last call. */
export function consumeMouseDelta() {
  const d = { x: mouse.dx, y: mouse.dy };
  mouse.dx = 0;
  mouse.dy = 0;
  return d;
}
/** Forget one-frame presses; call after the simulation has seen them. */
export function clearPressedInput() {
  pressed.clear();
  mouse.clicked = false;
}
/** Movement axes from WASD / arrows: x is strafe right, y is forward. */
export function readMoveAxes() {
  const x = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
  const y = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0);
  return { x, y };
}
