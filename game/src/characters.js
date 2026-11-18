// characters.js: the low-poly human figure used by the player, pedestrians and police officers.
// Builds a jointed body from boxes (legs, arms, torso, head, hair or cap) and animates its poses:
// idle, walk/run cycle, punch, aim, hands-up, and lying dead.
import * as THREE from '../vendor/three.module.min.js';

const geometryCache = new Map();
const materialCache = new Map();
function boxGeometry(w, h, d) {
  const key = `${w},${h},${d}`;
  if (!geometryCache.has(key)) geometryCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geometryCache.get(key);
}
function flatMaterial(color) {
  if (!materialCache.has(color)) materialCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  return materialCache.get(color);
}

export const SKIN_TONES = [0xf1c9a5, 0xd9a273, 0xb07a4f, 0x7d5234, 0xf5d6bc];
export const SHIRT_COLORS = [0xff4f8b, 0x1fc9c0, 0xffb02e, 0xf4f0ea, 0x6a5acd, 0xff7a45, 0x2f6fb5, 0x9fe6b4, 0xe83e3e, 0x222630];
export const PANTS_COLORS = [0x2b3145, 0x3d4a66, 0xd8c9b0, 0x1c1c22, 0x5a4a3a, 0xf4f0ea, 0x39566b];
export const HAIR_COLORS = [0x1b1412, 0x3a2416, 0x8a5a2b, 0xd9b36a, 0xff5fa2, 0xd7d7d7];

function limb(w, h, d, color, pivotY, x) {
  const pivot = new THREE.Group();
  pivot.position.set(x, pivotY, 0);
  const mesh = new THREE.Mesh(boxGeometry(w, h, d), flatMaterial(color));
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

/**
 * Build a figure about 1.8 m tall, facing +Z, feet at y = 0.
 * Options: skin, shirt, pants, hair colours; cap (a colour) for a hat; cop for a police uniform.
 * Returns { group, parts: { torso, head, armL, armR, legL, legR }, phase }.
 */
export function createFigure({ skin = SKIN_TONES[0], shirt = SHIRT_COLORS[0], pants = PANTS_COLORS[0], hair = HAIR_COLORS[0], cap = null, cop = false, jacket = null } = {}) {
  if (cop) { shirt = 0x1d2b4f; pants = 0x151a2c; cap = 0x101626; }
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const torso = new THREE.Mesh(boxGeometry(0.5, 0.66, 0.28), flatMaterial(jacket ?? shirt));
  torso.position.y = 1.2;
  torso.castShadow = true;
  const head = new THREE.Mesh(boxGeometry(0.27, 0.29, 0.27), flatMaterial(skin));
  head.position.y = 1.7;
  head.castShadow = true;
  const top = new THREE.Mesh(boxGeometry(0.3, cap ? 0.1 : 0.12, cap ? 0.36 : 0.3), flatMaterial(cap ?? hair));
  top.position.set(0, 0.17, cap ? 0.03 : -0.01);
  head.add(top);
  if (!cap) {
    const back = new THREE.Mesh(boxGeometry(0.3, 0.2, 0.08), flatMaterial(hair));
    back.position.set(0, 0.03, -0.13);
    head.add(back);
  }
  const armL = limb(0.15, 0.64, 0.17, jacket ?? shirt, 1.5, 0.33);
  const armR = limb(0.15, 0.64, 0.17, jacket ?? shirt, 1.5, -0.33);
  const legL = limb(0.21, 0.88, 0.24, pants, 0.88, 0.13);
  const legR = limb(0.21, 0.88, 0.24, pants, 0.88, -0.13);
  for (const arm of [armL, armR]) {
    const hand = new THREE.Mesh(boxGeometry(0.13, 0.14, 0.14), flatMaterial(skin));
    hand.position.y = -0.68;
    arm.add(hand);
  }
  if (cop) {
    const badge = new THREE.Mesh(boxGeometry(0.1, 0.1, 0.02), flatMaterial(0xf2c230));
    badge.position.set(0.13, 0.16, 0.15);
    torso.add(badge);
  }
  body.add(torso, head, armL, armR, legL, legR);
  return { group, body, parts: { torso, head, armL, armR, legL, legR }, phase: Math.random() * 6, gun: null };
}

/** Put a small pistol in the figure's right hand (hidden until shown). */
export function giveFigurePistol(figure) {
  const gun = new THREE.Mesh(boxGeometry(0.07, 0.14, 0.3), flatMaterial(0x1a1a1f));
  gun.position.set(0, -0.72, 0.12);
  gun.visible = false;
  figure.parts.armR.add(gun);
  figure.gun = gun;
  return gun;
}

/**
 * Pose the figure for this frame. speed is ground speed in m/s (drives the stride);
 * pose is 'move' (idle/walk/run by speed), 'punch', 'aim', 'handsUp', 'dead' or 'sit'.
 * poseTime is seconds since the pose began (for the punch swing).
 */
export function animateFigure(figure, dt, speed, pose = 'move', poseTime = 0) {
  const { armL, armR, legL, legR, torso, head } = figure.parts;
  const body = figure.body;
  body.rotation.set(0, 0, 0);
  body.position.set(0, 0, 0);
  torso.rotation.set(0, 0, 0);
  armL.rotation.set(0, 0, 0);
  armR.rotation.set(0, 0, 0);
  if (pose === 'dead') {
    body.rotation.x = -Math.PI / 2;
    body.position.set(0, 0.16, 0.9);
    legL.rotation.x = 0.2;
    legR.rotation.x = -0.1;
    armL.rotation.z = 0.9;
    armR.rotation.z = -0.6;
    return;
  }
  if (pose === 'sit') {
    legL.rotation.x = -1.4;
    legR.rotation.x = -1.4;
    armL.rotation.x = -1.1;
    armR.rotation.x = -1.1;
    return;
  }
  figure.phase += dt * (2.5 + speed * 1.9);
  const stride = Math.min(1, speed / 4.5);
  const swing = Math.sin(figure.phase) * (0.25 + stride * 0.75) * (speed > 0.2 ? 1 : 0);
  legL.rotation.x = swing;
  legR.rotation.x = -swing;
  armL.rotation.x = -swing * 0.8;
  armR.rotation.x = swing * 0.8;
  body.position.y = speed > 0.2 ? Math.abs(Math.cos(figure.phase)) * 0.05 * (0.5 + stride) : Math.sin(figure.phase * 0.4) * 0.008;
  body.rotation.x = stride * 0.12;
  head.rotation.y = speed > 0.2 ? 0 : Math.sin(figure.phase * 0.23) * 0.25;
  if (pose === 'punch') {
    const t = Math.min(1, poseTime / 0.28);
    const jab = Math.sin(t * Math.PI);
    armR.rotation.x = -1.5 * jab - 0.3;
    armL.rotation.x = -0.7;
    torso.rotation.y = 0.5 * jab;
  } else if (pose === 'aim') {
    armR.rotation.x = -Math.PI / 2;
    armL.rotation.x = -Math.PI / 2 + 0.1;
    armL.rotation.z = -0.35;
    armR.rotation.z = 0.12;
  } else if (pose === 'handsUp') {
    armL.rotation.x = Math.PI;
    armR.rotation.x = Math.PI;
    armL.rotation.z = 0.3;
    armR.rotation.z = -0.3;
  }
}
