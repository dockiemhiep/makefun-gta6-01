// effects.js: short-lived visual effects from a fixed pool of additive sprites and lines.
// Muzzle flashes, bullet tracers, crash sparks, tyre smoke, explosions and pickup sparkles.
import * as THREE from '../vendor/three.module.min.js';
import { glowTexture } from './meshkit.js';

const POOL_SIZE = 90;
const TRACER_COUNT = 14;
const particles = [];
const tracers = [];
let nextParticle = 0;
let nextTracer = 0;
const TRACER_WIDTH = 0.09;
const tracerGeometry = new THREE.BoxGeometry(1, 1, 1);

/** Create the sprite and tracer pools once. */
export function initEffects(scene) {
  for (let i = 0; i < POOL_SIZE; i += 1) {
    const material = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    scene.add(sprite);
    particles.push({ sprite, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, gravity: 0, fade: 1 });
  }
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    // a thin glowing bar stretched between muzzle and target: a 1 px line vanishes at a distance
    const material = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const line = new THREE.Mesh(tracerGeometry, material);
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
}

/** One glowing particle. Options: velocity (vx, vy, vz), size, grow per second, life, gravity, smoke (normal blending). */
export function spawnParticle(x, y, z, color, { vx = 0, vy = 0, vz = 0, size = 1, grow = 0, life = 0.4, gravity = 0, smoke = false, opacity = 1 } = {}) {
  const p = particles[nextParticle];
  nextParticle = (nextParticle + 1) % POOL_SIZE;
  p.sprite.position.set(x, y, z);
  p.sprite.material.color.set(color);
  p.sprite.material.blending = smoke ? THREE.NormalBlending : THREE.AdditiveBlending;
  p.sprite.material.opacity = opacity;
  p.sprite.scale.set(size, size, 1);
  p.sprite.visible = true;
  Object.assign(p, { life, maxLife: life, vx, vy, vz, size, grow, gravity, fade: opacity });
  return p;
}

/** A bright flash at a gun muzzle. */
export function spawnMuzzleFlash(x, y, z) {
  spawnParticle(x, y, z, 0xffb347, { size: 2.2, life: 0.08 });
  spawnParticle(x, y, z, 0xffffff, { size: 1.0, life: 0.06 });
}

/** A bullet streak between two points that fades in a few frames. */
export function spawnTracer(ax, ay, az, bx, by, bz, color = 0xffe6a0) {
  const t = tracers[nextTracer];
  nextTracer = (nextTracer + 1) % TRACER_COUNT;
  t.line.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  t.line.lookAt(bx, by, bz);
  t.line.scale.set(TRACER_WIDTH, TRACER_WIDTH, Math.hypot(bx - ax, by - ay, bz - az));
  t.line.material.color.set(color);
  t.line.material.opacity = 1;
  t.line.visible = true;
  t.life = 0.09;
}

/** Orange sparks thrown from an impact point. */
export function spawnSparks(x, y, z, count = 6, color = 0xffb347) {
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 5;
    spawnParticle(x, y, z, color, { vx: Math.cos(a) * s, vy: 2 + Math.random() * 4, vz: Math.sin(a) * s, size: 0.35, life: 0.35 + Math.random() * 0.25, gravity: 12 });
  }
}

/** A puff of grey smoke that rises and swells: burning engines, tyre smoke. */
export function spawnSmoke(x, y, z, dark = false, size = 1.2) {
  spawnParticle(x, y, z, dark ? 0x2a2630 : 0xcfc6c9, { vy: 1.6, vx: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8, size, grow: 2.4, life: 1.1, smoke: true, opacity: dark ? 0.55 : 0.32 });
}

/** A fireball with sparks and a smoke column. */
export function spawnExplosion(x, y, z) {
  spawnParticle(x, y + 1, z, 0xffa040, { size: 5, grow: 22, life: 0.45 });
  spawnParticle(x, y + 1, z, 0xffffff, { size: 3, grow: 10, life: 0.2 });
  spawnSparks(x, y + 1, z, 14, 0xff8030);
  for (let i = 0; i < 4; i += 1) spawnSmoke(x + (Math.random() - 0.5) * 2, y + 1 + i * 0.6, z + (Math.random() - 0.5) * 2, true, 3);
}

/** Advance and fade every live effect. */
export function updateEffects(dt) {
  for (let i = 0; i < POOL_SIZE; i += 1) {
    const p = particles[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.sprite.visible = false; continue; }
    p.vy -= p.gravity * dt;
    p.sprite.position.x += p.vx * dt;
    p.sprite.position.y += p.vy * dt;
    p.sprite.position.z += p.vz * dt;
    p.size += p.grow * dt;
    p.sprite.scale.set(p.size, p.size, 1);
    p.sprite.material.opacity = p.fade * Math.min(1, (p.life / p.maxLife) * 1.6);
  }
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const t = tracers[i];
    if (t.life <= 0) continue;
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.09);
    if (t.life <= 0) t.line.visible = false;
  }
}
