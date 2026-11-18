// vehicles.js: every car in Port Solano. Builds the low-poly models (sports car, sedan, van,
// pickup, taxi, police cruiser) from extruded side profiles, and runs the arcade driving physics:
// throttle, steering, grip and drift, handbrake, collisions with buildings and other cars, damage.
// Whoever drives (the player, traffic AI, police AI) only fills vehicle.input.
import * as THREE from '../vendor/three.module.min.js';
import { world, emit, resolveCircle, groundHeight, reportCrime, damagePlayer, clamp, rand, pick } from './world.js';
import { GeometryBatch, placeMatrix, makeGlowSprite, glowTexture } from './meshkit.js';
import { spawnSparks, spawnSmoke, spawnExplosion } from './effects.js';

/**
 * Per-model numbers. profile: body outline points [z, y] from the rear bumper round the top to the
 * nose; cabin: glasshouse outline. Speeds in m/s, accelerations in m/s^2.
 */
export const VEHICLE_SPECS = {
  sport: {
    name: 'Kestrel GT', length: 4.5, width: 1.96, maxSpeed: 46, accel: 17, brake: 30, grip: 7.5, turn: 2.5, hp: 100,
    profile: [[-2.25, 0.3], [-2.28, 0.86], [-1.9, 0.94], [-0.9, 0.9], [0.7, 0.82], [1.9, 0.62], [2.28, 0.5], [2.25, 0.3]],
    cabin: [[-1.35, 0.9], [-0.75, 1.2], [0.05, 1.22], [0.85, 0.82]], spoiler: true, colors: [0xff2e88, 0x19e3d6, 0xffa01f, 0xf5f5f5, 0xa64dff],
  },
  sedan: {
    name: 'Marlin', length: 4.6, width: 1.86, maxSpeed: 34, accel: 11, brake: 26, grip: 8.5, turn: 2.3, hp: 100,
    profile: [[-2.3, 0.34], [-2.32, 0.95], [-1.5, 1.04], [1.0, 1.02], [2.1, 0.9], [2.32, 0.7], [2.3, 0.34]],
    cabin: [[-1.6, 1.02], [-1.05, 1.5], [0.2, 1.52], [1.0, 1.02]], colors: [0x2f6fb5, 0xc23b3b, 0xe8e2d6, 0x2a2d38, 0x3f9a70, 0xd98a2b, 0x8a8f9c, 0x7a3fa0],
  },
  taxi: {
    name: 'Solano Cab', length: 4.6, width: 1.86, maxSpeed: 33, accel: 11, brake: 26, grip: 8.5, turn: 2.3, hp: 100,
    profile: [[-2.3, 0.34], [-2.32, 0.95], [-1.5, 1.04], [1.0, 1.02], [2.1, 0.9], [2.32, 0.7], [2.3, 0.34]],
    cabin: [[-1.6, 1.02], [-1.05, 1.5], [0.2, 1.52], [1.0, 1.02]], roofSign: 0xfff2a0, colors: [0xf7c531],
  },
  van: {
    name: 'Dromo', length: 5.0, width: 2.0, maxSpeed: 28, accel: 8.5, brake: 22, grip: 8, turn: 2.0, hp: 130,
    profile: [[-2.5, 0.38], [-2.52, 2.0], [0.9, 2.02], [1.7, 1.25], [2.45, 1.1], [2.5, 0.38]],
    cabin: [[0.5, 1.3], [0.86, 1.95], [0.95, 1.97], [1.72, 1.28]], cabinWide: true, colors: [0xf4f0ea, 0x1fa8a0, 0xd95f2b, 0x4a5a7a],
  },
  pickup: {
    name: 'Bruin', length: 5.1, width: 2.0, maxSpeed: 31, accel: 10, brake: 24, grip: 8, turn: 2.1, hp: 130,
    profile: [[-2.55, 0.42], [-2.57, 1.12], [-0.3, 1.14], [-0.28, 1.1], [1.3, 1.1], [2.3, 1.0], [2.57, 0.8], [2.55, 0.42]],
    cabin: [[-0.3, 1.1], [-0.1, 1.72], [0.75, 1.72], [1.3, 1.1]], colors: [0xc23b3b, 0x2a2d38, 0x3a7ca5, 0xe0b040, 0x5a7a4a],
  },
  police: {
    name: 'PSPD Cruiser', length: 4.7, width: 1.9, maxSpeed: 42, accel: 15, brake: 30, grip: 9, turn: 2.5, hp: 140,
    profile: [[-2.35, 0.34], [-2.37, 0.95], [-1.5, 1.04], [1.0, 1.02], [2.15, 0.9], [2.37, 0.7], [2.35, 0.34]],
    cabin: [[-1.6, 1.02], [-1.05, 1.5], [0.2, 1.52], [1.0, 1.02]], lightbar: true, colors: [0xf4f6fa],
  },
};
export const TRAFFIC_KINDS = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'pickup', 'sport', 'sedan', 'taxi'];

const GLASS = 0x15303d;
const TYRE = 0x18161c;
const geometryCache = new Map();
let paintMaterial;
let lightMaterial;
let underglowMaterials;
let nextId = 1;

function extrudeProfile(points, width, bevel) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 });
  // profile x becomes +z (the nose), extrusion depth becomes x (the width)
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  return g;
}

/** Merged, vertex-coloured body and a separate emissive lights geometry for one model and paint colour. */
function carGeometries(kind, color) {
  const key = `${kind}:${color}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const spec = VEHICLE_SPECS[kind];
  const body = new GeometryBatch();
  const lights = new GeometryBatch();
  const W = spec.width;
  const half = spec.length / 2;
  body.addGeometry(extrudeProfile(spec.profile, W, 0.07), null, color);
  body.addGeometry(extrudeProfile(spec.cabin, spec.cabinWide ? W - 0.1 : W * 0.84, 0.03), null, GLASS);
  // roof skin, in paint, over the glasshouse
  const roofPts = spec.cabin.slice(1, 3);
  const roofLen = Math.abs(roofPts[1][0] - roofPts[0][0]) + 0.16;
  const roofY = Math.max(roofPts[0][1], roofPts[1][1]);
  if (!spec.cabinWide) body.addBox(0, roofY + 0.02, (roofPts[0][0] + roofPts[1][0]) / 2, W * 0.8, 0.06, roofLen, kind === 'police' ? 0x1a2238 : color);
  // wheels with bright hubs, arches tucked into the body sides
  const tyre = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 14).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.23, 0.23, 0.32, 8).rotateZ(Math.PI / 2);
  const arch = new THREE.CylinderGeometry(0.52, 0.52, 0.1, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wx = sx * (W / 2 - 0.06);
      const wz = sz * (half - 0.92);
      body.addGeometry(tyre, placeMatrix(wx, 0.4, wz), TYRE);
      body.addGeometry(hub, placeMatrix(wx, 0.4, wz), 0xd4d4dc);
      body.addGeometry(arch, placeMatrix(sx * (W / 2 + 0.02), 0.42, wz, sx > 0 ? 0 : Math.PI), 0x1c1a22);
    }
    body.addBox(sx * (W / 2 + 0.01), 0.36, 0, 0.06, 0.16, spec.length - 2.9, 0x1c1a22); // sill
  }
  const noseZ = half + 0.1;
  const tailZ = -half - 0.1;
  const noseY = spec.profile[spec.profile.length - 2][1];
  const tailY = spec.profile[1][1];
  for (const sx of [-1, 1]) {
    lights.addBox(sx * (W / 2 - 0.36), noseY - 0.06, noseZ, 0.46, 0.15, 0.08, 0xfff3c4);
    lights.addBox(sx * (W / 2 - 0.34), tailY - 0.14, tailZ, 0.5, 0.15, 0.08, 0xff2a2a);
  }
  body.addBox(0, 0.5, noseZ, W * 0.72, 0.2, 0.08, 0x1c1a22); // grille
  body.addBox(0, 0.42, tailZ, W * 0.9, 0.16, 0.1, 0x1c1a22); // rear bumper
  body.addBox(0, tailY - 0.36, tailZ - 0.03, 0.5, 0.15, 0.04, 0xf2ecd8); // number plate
  if (spec.spoiler) {
    body.addBox(0, 1.2, -half + 0.2, W * 0.96, 0.06, 0.46, color);
    for (const sx of [-1, 1]) body.addBox(sx * W * 0.34, 1.06, -half + 0.25, 0.07, 0.28, 0.22, 0x1c1a22);
    body.addBox(0, 0.845, 0.75, 0.46, 0.03, 1.3, 0x1c1a22); // bonnet stripe
    lights.addBox(0, tailY - 0.14, tailZ, W * 0.78, 0.07, 0.08, 0xff2a2a); // full-width tail light bar
    for (const sx of [-1, 1]) body.addBox(sx * (W / 2 + 0.03), 0.62, -0.5, 0.04, 0.2, 0.7, 0x1c1a22); // side intakes
  }
  if (spec.roofSign) {
    body.addBox(0, roofY + 0.12, -0.3, 0.9, 0.14, 0.3, 0x2a2420);
    lights.addBox(0, roofY + 0.24, -0.3, 0.8, 0.2, 0.26, spec.roofSign);
  }
  if (spec.lightbar) {
    // PSPD livery: navy doors and a teal stripe
    for (const sx of [-1, 1]) {
      body.addBox(sx * (W / 2 + 0.005), 0.72, -0.2, 0.02, 0.42, 1.9, 0x1a2238);
      body.addBox(sx * (W / 2 + 0.01), 0.74, -0.2, 0.02, 0.1, 4.3, 0x19c9c0);
    }
    body.addBox(0, roofY + 0.09, -0.4, 1.3, 0.08, 0.36, 0x1a1a22);
    body.addBox(0, 0.5, half + 0.12, W * 0.8, 0.3, 0.12, 0x1a1a22); // push bar
  }
  const result = { body: body.build(), lights: lights.build(), roofY };
  geometryCache.set(key, result);
  return result;
}

function ensureMaterials() {
  if (paintMaterial) return;
  paintMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.32, envMapIntensity: 1.1 });
  lightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  underglowMaterials = new Map();
}

/**
 * Create a vehicle and add it to the world. kind is a key of VEHICLE_SPECS.
 * Options: color (hex), driver (null | 'player' | 'traffic' | 'cop'), parked (bool).
 * Fields others may use: id, kind, spec, mesh, pos (the mesh position), heading, vel {x, z},
 * speed (signed, along the nose), input { throttle, steer, handbrake }, driver, parked, hp, dead,
 * isPolice, sirenOn, radius, marked (mission target), ai (free slot for the driving AI).
 */
export function spawnVehicle(kind, x, z, heading = 0, { color, driver = null, parked = false } = {}) {
  ensureMaterials();
  const spec = VEHICLE_SPECS[kind];
  const paint = color ?? pick(spec.colors);
  const geo = carGeometries(kind, paint);
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(geo.body, paintMaterial);
  body.castShadow = true;
  mesh.add(body, new THREE.Mesh(geo.lights, lightMaterial));
  mesh.rotation.order = 'YXZ';
  mesh.position.set(x, groundHeight(x, z), z);
  mesh.rotation.y = heading;
  const vehicle = {
    id: nextId++, kind, spec, name: spec.name, color: paint, mesh, pos: mesh.position, heading,
    vel: { x: 0, z: 0 }, speed: 0, input: { throttle: 0, steer: 0, handbrake: false },
    driver, parked, hp: spec.hp, dead: false, isPolice: kind === 'police', sirenOn: false,
    radius: spec.width * 0.62, marked: false, ai: null, steerVisual: 0, lastCrash: -9, smokeClock: 0, bar: null, burnTime: 0,
  };
  if (spec.lightbar) {
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }));
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0x2a6bff, toneMapped: false }));
    red.position.set(0.34, geo.roofY + 0.2, -0.4);
    blue.position.set(-0.34, geo.roofY + 0.2, -0.4);
    const redGlow = makeGlowSprite(0xff2030, 7.5, 1);
    const blueGlow = makeGlowSprite(0x3a7bff, 7.5, 1);
    redGlow.position.copy(red.position);
    blueGlow.position.copy(blue.position);
    // the strobe also washes the road around the cruiser in red and blue
    const wash = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff2030, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    wash.position.y = 0.09;
    wash.renderOrder = 3;
    mesh.add(red, blue, redGlow, blueGlow, wash);
    vehicle.bar = { red, blue, redGlow, blueGlow, wash };
  }
  if (kind === 'sport') {
    // neon underglow in a colour that sets off the paint
    const glowColor = paint === 0x19e3d6 ? 0xff2e88 : 0x19e3d6;
    if (!underglowMaterials.has(glowColor)) {
      underglowMaterials.set(glowColor, new THREE.MeshBasicMaterial({ map: glowTexture(), color: glowColor, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 6.6).rotateX(-Math.PI / 2), underglowMaterials.get(glowColor));
    glow.position.y = 0.06;
    mesh.add(glow);
  }
  world.scene.add(mesh);
  world.vehicles.push(vehicle);
  return vehicle;
}

export function removeVehicle(vehicle) {
  const i = world.vehicles.indexOf(vehicle);
  if (i >= 0) world.vehicles.splice(i, 1);
  world.scene.remove(vehicle.mesh);
  vehicle.removed = true;
}

/** Move a vehicle instantly (respawns, screenshots, traffic recycling). */
export function placeVehicle(vehicle, x, z, heading, speed = 0) {
  vehicle.pos.set(x, groundHeight(x, z), z);
  vehicle.heading = heading;
  vehicle.mesh.rotation.set(0, heading, 0);
  vehicle.speed = speed;
  vehicle.vel.x = Math.sin(heading) * speed;
  vehicle.vel.z = Math.cos(heading) * speed;
}

/** The closest vehicle to a point within maxDist that passes the filter, or null. */
export function nearestVehicle(x, z, maxDist, filter = null) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const v of world.vehicles) {
    const d = (v.pos.x - x) ** 2 + (v.pos.z - z) ** 2;
    if (d < bestD && (!filter || filter(v))) { best = v; bestD = d; }
  }
  return best;
}

/** Hurt a vehicle. At zero it burns out, then explodes. */
export function damageVehicle(vehicle, amount) {
  if (vehicle.dead) return;
  vehicle.hp -= amount;
  if (vehicle.hp <= 0) {
    vehicle.hp = 0;
    vehicle.dead = true;
    vehicle.burnTime = 2.2;
    vehicle.sirenOn = false;
  }
}

function integrateDriving(v, dt) {
  const spec = v.spec;
  const input = v.input;
  const fx = Math.sin(v.heading);
  const fz = Math.cos(v.heading);
  let forward = v.vel.x * fx + v.vel.z * fz;
  let lateral = v.vel.x * -fz + v.vel.z * fx;
  const throttle = v.dead ? 0 : clamp(input.throttle, -1, 1);
  if (throttle > 0) {
    forward += (forward < 0 ? spec.brake : spec.accel * Math.max(0, 1 - forward / spec.maxSpeed)) * throttle * dt;
  } else if (throttle < 0) {
    if (forward > 0.8) forward = Math.max(0, forward + spec.brake * throttle * dt);
    else forward += spec.accel * 0.7 * throttle * dt * Math.max(0, 1 + forward / (spec.maxSpeed * 0.32));
  }
  // rolling drag, stronger when coasting
  forward -= forward * (throttle === 0 ? 0.9 : 0.18) * dt;
  if (input.handbrake) forward -= Math.sign(forward) * Math.min(Math.abs(forward), 14 * dt);
  if (throttle === 0 && Math.abs(forward) < 0.25) forward = 0;
  // tyres kill sideways speed; the handbrake lets the tail slide
  const grip = input.handbrake ? 1.6 : spec.grip;
  lateral *= Math.exp(-grip * dt);
  // steering authority fades in from a standstill and softens at high speed
  const steer = clamp(input.steer, -1, 1);
  const authority = clamp(Math.abs(forward) / 5, 0, 1) / (1 + Math.abs(forward) / 34);
  v.heading -= steer * spec.turn * authority * Math.sign(forward || 1) * (input.handbrake ? 1.35 : 1) * dt;
  v.vel.x = fx * forward - fz * lateral;
  v.vel.z = fz * forward + fx * lateral;
  v.speed = forward;
  v.slip = Math.abs(lateral);
  v.pos.x += v.vel.x * dt;
  v.pos.z += v.vel.z * dt;
}

const probe = { x: 0, z: 0 };
function collideWithCity(v) {
  const fx = Math.sin(v.heading);
  const fz = Math.cos(v.heading);
  const reach = v.spec.length * 0.3;
  for (const side of [1, -1]) {
    probe.x = v.pos.x + fx * reach * side;
    probe.z = v.pos.z + fz * reach * side;
    const bx = probe.x;
    const bz = probe.z;
    const hit = resolveCircle(probe, v.radius);
    if (!hit.hit) continue;
    v.pos.x += probe.x - bx;
    v.pos.z += probe.z - bz;
    const into = v.vel.x * hit.nx + v.vel.z * hit.nz;
    if (into < 0) {
      v.vel.x -= hit.nx * into * 1.25;
      v.vel.z -= hit.nz * into * 1.25;
      // scraping a wall also bleeds speed
      v.vel.x *= 0.985;
      v.vel.z *= 0.985;
      registerCrash(v, null, -into, probe.x - hit.nx * v.radius, probe.z - hit.nz * v.radius);
    }
  }
}

function registerCrash(v, other, impact, x, z) {
  if (impact < 3 || world.time - v.lastCrash < 0.25) return;
  v.lastCrash = world.time;
  if (other) other.lastCrash = world.time;
  const playerIn = world.player && (world.player.vehicle === v || world.player.vehicle === other);
  const damage = (impact - 2) * 2.2;
  damageVehicle(v, damage * (v.driver === 'player' ? 0.6 : 1));
  if (other) damageVehicle(other, damage * (other.driver === 'player' ? 0.6 : 1));
  spawnSparks(x, 0.7, z, Math.min(10, 3 + Math.floor(impact / 2)));
  if (playerIn) {
    world.sfx('crash', { volume: clamp(impact / 22, 0.2, 1) });
    world.camShake = Math.max(world.camShake || 0, clamp(impact / 30, 0.1, 0.7));
    if (impact > 9) damagePlayer((impact - 9) * 1.3, 'crash');
    if (other && impact > 3.5 && world.mode !== 'shot') reportCrime(other.isPolice ? 'hitCop' : 'hitCar', x, z);
  }
  emit('vehicleCrash', { vehicle: v, other, impact, x, z });
}

function collideVehicles() {
  const list = world.vehicles;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
      if (a.speed === 0 && b.speed === 0 && a.parked && b.parked) continue;
      // two circles along each car's length
      for (const sa of [1, -1]) {
        const ax = a.pos.x + Math.sin(a.heading) * a.spec.length * 0.27 * sa;
        const az = a.pos.z + Math.cos(a.heading) * a.spec.length * 0.27 * sa;
        for (const sb of [1, -1]) {
          const bx = b.pos.x + Math.sin(b.heading) * b.spec.length * 0.27 * sb;
          const bz = b.pos.z + Math.cos(b.heading) * b.spec.length * 0.27 * sb;
          let nx = bx - ax;
          let nz = bz - az;
          const d = Math.hypot(nx, nz);
          const min = a.radius + b.radius - 0.12;
          if (d >= min || d < 1e-4) continue;
          nx /= d;
          nz /= d;
          const push = (min - d) / 2;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
          const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
          if (rel < 0) {
            const impulse = -rel * 0.65;
            a.vel.x -= nx * impulse; a.vel.z -= nz * impulse;
            b.vel.x += nx * impulse; b.vel.z += nz * impulse;
            a.parked = false;
            b.parked = false;
            registerCrash(a, b, -rel, (ax + bx) / 2, (az + bz) / 2);
          }
        }
      }
    }
  }
}

function updateVehicleLook(v, dt) {
  v.mesh.position.y += (groundHeight(v.pos.x, v.pos.z) - v.mesh.position.y) * Math.min(1, dt * 14);
  v.steerVisual += (clamp(v.input.steer, -1, 1) - v.steerVisual) * Math.min(1, dt * 6);
  const lean = clamp(v.steerVisual * Math.abs(v.speed) * 0.0035, -0.07, 0.07);
  v.mesh.rotation.set(clamp(-v.input.throttle * 0.012 * (Math.abs(v.speed) < 20 ? 1 : 0.3), -0.03, 0.03), v.heading, lean);
  if (v.bar) {
    const on = v.sirenOn;
    const beat = Math.floor(world.time * 6 + v.id * 0.37) % 2 === 0;
    v.bar.red.visible = !on || beat;
    v.bar.blue.visible = !on || !beat;
    v.bar.redGlow.visible = on;
    v.bar.blueGlow.visible = on;
    v.bar.redGlow.material.opacity = beat ? 1 : 0.35;
    v.bar.blueGlow.material.opacity = beat ? 0.35 : 1;
    v.bar.wash.visible = on;
    v.bar.wash.material.color.setHex(beat ? 0xff2030 : 0x3a7bff);
    v.bar.red.material.color.setHex(on ? 0xff2030 : 0x7a1a22);
    v.bar.blue.material.color.setHex(on ? 0x2a6bff : 0x1a2f7a);
  }
  if (v.hp < v.spec.hp * 0.4 || v.dead) {
    v.smokeClock -= dt;
    if (v.smokeClock <= 0) {
      v.smokeClock = v.dead ? 0.12 : 0.3;
      spawnSmoke(v.pos.x + Math.sin(v.heading) * 1.6, 1.1, v.pos.z + Math.cos(v.heading) * 1.6, v.hp < v.spec.hp * 0.2);
    }
  }
  if (v.dead && v.burnTime > 0) {
    v.burnTime -= dt;
    if (v.burnTime <= 0) {
      spawnExplosion(v.pos.x, 0.4, v.pos.z);
      world.sfx('crash', { volume: 1 });
      const p = world.player;
      if (p && Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z) < 7) damagePlayer(p.vehicle === v ? 80 : 45, 'explosion');
      v.wrecked = true;
    }
  }
  if (v.slip > 5 && Math.abs(v.speed) > 8 && Math.random() < 0.4) spawnSmoke(v.pos.x - Math.sin(v.heading) * 1.8, 0.3, v.pos.z - Math.cos(v.heading) * 1.8, false, 0.9);
}

/** Step every vehicle: driving physics, collisions, then visuals. */
export function updateVehicles(dt) {
  for (const v of world.vehicles) {
    if (v.parked && v.speed === 0 && v.vel.x === 0 && v.vel.z === 0 && v.driver === null) continue;
    if (!v.driver) { v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = Math.abs(v.speed) < 6; }
    integrateDriving(v, dt);
    collideWithCity(v);
  }
  collideVehicles();
  for (const v of world.vehicles) updateVehicleLook(v, dt);
}

/** A random paint for a model, from the seeded world generator. */
export const randomVehicleColor = (kind) => VEHICLE_SPECS[kind].colors[Math.floor(rand(VEHICLE_SPECS[kind].colors.length))];
