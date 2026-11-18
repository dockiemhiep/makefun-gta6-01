// pickups.js: collectables scattered through the city and dropped by pedestrians.
// Spinning, glowing ammo crates, health packs, body armor and cash that the player grabs by touch.
import * as THREE from '../vendor/three.module.min.js';
import { world, on, emit, addMoney, toast, groundHeight, roadCoord, BLOCKS, ROAD, rand, clamp } from './world.js';
import { makeGlowSprite } from './meshkit.js';
import { spawnParticle } from './effects.js';

const PICKUP_LOOKS = {
  ammo: { color: 0xffb02e, size: [0.5, 0.34, 0.34], label: 'Pistol ammo' },
  health: { color: 0xff3d6a, size: [0.46, 0.46, 0.46], label: 'Health' },
  armor: { color: 0x25c9f0, size: [0.5, 0.56, 0.24], label: 'Body armor' },
  cash: { color: 0x5dff8f, size: [0.44, 0.12, 0.26], label: 'Cash' },
};
const materials = new Map();

/** Drop a pickup of a kind ('ammo' | 'health' | 'armor' | 'cash') at a spot. Cash and ammo carry an amount. */
export function spawnPickup(kind, x, z, amount = 0, respawns = false) {
  const look = PICKUP_LOOKS[kind];
  if (!materials.has(kind)) materials.set(kind, new THREE.MeshBasicMaterial({ color: look.color, toneMapped: false }));
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(...look.size), materials.get(kind));
  group.add(box, makeGlowSprite(look.color, 2.6, 0.7));
  group.position.set(x, groundHeight(x, z) + 0.8, z);
  world.scene.add(group);
  const pickup = { kind, group, x, z, amount, respawns, hiddenUntil: 0, baseY: group.position.y };
  world.pickups.push(pickup);
  return pickup;
}

function collectPickup(pickup) {
  const p = world.player;
  if (pickup.kind === 'ammo') { p.ammo += pickup.amount || 18; p.hasPistol = true; }
  if (pickup.kind === 'health') { if (p.health >= 100) return false; p.health = Math.min(100, p.health + 40); }
  if (pickup.kind === 'armor') { if (p.armor >= 100) return false; p.armor = 100; }
  if (pickup.kind === 'cash') addMoney(pickup.amount || 50);
  world.sfx('pickup');
  emit('pickup', { kind: pickup.kind, amount: pickup.amount });
  const look = PICKUP_LOOKS[pickup.kind];
  toast(pickup.kind === 'cash' ? `+$${pickup.amount || 50}` : look.label, '', 'pickup');
  for (let i = 0; i < 5; i += 1) spawnParticle(pickup.x, pickup.baseY, pickup.z, look.color, { vy: 2 + Math.random() * 2, vx: Math.random() - 0.5, vz: Math.random() - 0.5, size: 0.5, life: 0.5 });
  return true;
}

/** Scatter the standing pickups: at sidewalk corners through the grid, plus armor at a few landmarks. */
export function initPickups() {
  const kinds = ['ammo', 'health', 'ammo', 'cash', 'armor', 'ammo', 'health', 'cash'];
  let n = 0;
  for (let i = 0; i < BLOCKS; i += 1) {
    for (let j = 0; j < BLOCKS; j += 1) {
      if ((i * 3 + j * 5) % 4 !== 0) continue;
      const kind = kinds[n % kinds.length];
      n += 1;
      const x = roadCoord(i) + ROAD / 2 + 2 + rand(0, 1);
      const z = roadCoord(j) + ROAD / 2 + 2 + rand(0, 1);
      spawnPickup(kind, x, z, kind === 'cash' ? 100 + Math.floor(rand(0, 5)) * 50 : 18, true);
    }
  }
  on('dropCash', ({ x, z, amount }) => spawnPickup('cash', x, z, amount, false));
}

/** Spin the pickups, collect the ones the player touches, and bring standing ones back later. */
export function updatePickups(dt) {
  const p = world.player;
  for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
    const pickup = world.pickups[i];
    if (pickup.hiddenUntil > 0) {
      if (world.time >= pickup.hiddenUntil) { pickup.hiddenUntil = 0; pickup.group.visible = true; }
      continue;
    }
    pickup.group.rotation.y += dt * 2.2;
    pickup.group.position.y = pickup.baseY + Math.sin(world.time * 2.4 + pickup.x) * 0.12;
    if (!p || p.state === 'wasted' || p.state === 'busted' || world.mode !== 'play') continue;
    const reach = p.vehicle ? 2.4 : 1.3;
    if (Math.abs(p.pos.x - pickup.x) > reach || Math.abs(p.pos.z - pickup.z) > reach) continue;
    if (!collectPickup(pickup)) continue;
    if (pickup.respawns) {
      pickup.hiddenUntil = world.time + 60;
      pickup.group.visible = false;
    } else {
      world.scene.remove(pickup.group);
      world.pickups.splice(i, 1);
    }
  }
}

/** Fraction 0..1 used by the HUD to flash the ammo counter when it is low. */
export const lowAmmoWarning = () => (world.player && world.player.ammo <= 6 ? clamp(1 - world.player.ammo / 6, 0, 1) : 0);
