// player.js: Mara Quill, the player. On-foot walking and running relative to the camera,
// entering, stealing and exiting cars (E), driving input, fists and a mouse-aimed pistol,
// getting hit by traffic, and the busted / wasted states with their respawn.
import * as THREE from '../vendor/three.module.min.js';
import {
  world, emit, toast, resolveCircle, groundHeight, reportCrime, damagePlayer, setWanted, lineOfSight, angleDiff, clamp, dist,
} from './world.js';
import { createFigure, giveFigurePistol, animateFigure } from './characters.js';
import { nearestVehicle, damageVehicle } from './vehicles.js';
import { spawnMuzzleFlash, spawnTracer, spawnSparks } from './effects.js';
import { isKeyDown, wasKeyPressed, wasMouseClicked, isMouseDown, isAimHeld, readMoveAxes } from './input.js';
import { cameraYaw, snapCameraBehind } from './camera.js';
import { countWitnesses, spawnPedestrian } from './pedestrians.js';

const WALK_SPEED = 2.7;
const RUN_SPEED = 6.4;
const ENTER_REACH = 3.4;
const PUNCH_REACH = 1.7;
const PISTOL_RANGE = 70;
const PISTOL_COOLDOWN = 0.26;
const RESPAWN_DELAY = 4.2;

/** Create the player figure and state at the spawn point. */
export function createPlayer() {
  const figure = createFigure({ skin: 0xd9a273, shirt: 0xf4f0ea, jacket: 0x19c9c0, pants: 0x1c1c26, hair: 0xff4f9a });
  giveFigurePistol(figure);
  const spawn = world.places.spawn;
  figure.group.position.set(spawn.x, groundHeight(spawn.x, spawn.z), spawn.z);
  world.scene.add(figure.group);
  world.player = {
    figure, group: figure.group, pos: figure.group.position, heading: spawn.heading, speed: 0,
    health: 100, armor: 0, money: 250, vehicle: null, state: 'foot', stateTime: 0,
    weapon: 'fists', hasPistol: true, ammo: 24, fireCooldown: 0, punchTime: -1, aimTime: 0, hurtFlash: 0, gunfireHeatAt: -9, lastCarName: '',
  };
  figure.group.rotation.y = spawn.heading;
  snapCameraBehind(spawn.heading);
  return world.player;
}

/** Put the player on foot at a spot, out of any car. */
export function placePlayerOnFoot(x, z, heading) {
  const p = world.player;
  if (p.vehicle) { p.vehicle.driver = null; p.vehicle = null; }
  p.state = 'foot';
  p.pos.set(x, groundHeight(x, z), z);
  p.heading = heading;
  p.speed = 0;
  p.group.visible = true;
  p.group.rotation.y = heading;
}

/** Seat the player in a vehicle. A car with a driver or an unseen owner counts as stolen. */
export function enterVehicle(vehicle, quiet = false) {
  const p = world.player;
  const hadDriver = vehicle.driver === 'traffic';
  const stolen = !vehicle.owned;
  if (hadDriver && !quiet) {
    // the driver is thrown out and runs
    const side = { x: Math.cos(vehicle.heading) * 1.8, z: -Math.sin(vehicle.heading) * 1.8 };
    const victim = spawnPedestrian(vehicle.pos.x + side.x, vehicle.pos.z + side.z, {});
    if (victim && victim.takeDamage) victim.takeDamage(1, { byPlayer: false, cause: 'carjack' });
    emit('crime', { type: 'carjack', x: vehicle.pos.x, z: vehicle.pos.z });
  }
  if (!quiet && stolen) {
    const witnessed = hadDriver || vehicle.isPolice || countWitnesses(vehicle.pos.x, vehicle.pos.z, 22) > 0;
    if (witnessed) reportCrime('carTheft', vehicle.pos.x, vehicle.pos.z);
    toast(vehicle.name, witnessed ? 'Stolen: someone saw that' : 'Stolen clean', 'info');
  }
  vehicle.owned = true;
  vehicle.driver = 'player';
  vehicle.parked = false;
  vehicle.ai = null;
  p.vehicle = vehicle;
  p.state = 'drive';
  p.group.visible = false;
  p.lastCarName = vehicle.name;
  if (!quiet) world.sfx('carDoor');
  emit('enterVehicle', { vehicle, stolen });
}

/** Step out on the driver's side, or wherever there is room. */
export function exitVehicle() {
  const p = world.player;
  const vehicle = p.vehicle;
  if (!vehicle) return;
  const leftX = Math.cos(vehicle.heading);
  const leftZ = -Math.sin(vehicle.heading);
  p.pos.set(vehicle.pos.x + leftX * 1.9, 0, vehicle.pos.z + leftZ * 1.9);
  resolveCircle(p.pos, 0.4);
  p.pos.y = groundHeight(p.pos.x, p.pos.z);
  p.heading = vehicle.heading;
  vehicle.driver = null;
  vehicle.input.throttle = 0;
  vehicle.input.steer = 0;
  p.vehicle = null;
  p.state = 'foot';
  p.group.visible = true;
  world.sfx('carDoor');
  emit('exitVehicle', { vehicle });
}

function tryEnterNearestVehicle() {
  const p = world.player;
  const vehicle = nearestVehicle(p.pos.x, p.pos.z, ENTER_REACH, (v) => !v.dead && !v.wrecked && v.driver !== 'cop');
  if (vehicle) enterVehicle(vehicle);
  return vehicle;
}

function driveVehicle(p) {
  const vehicle = p.vehicle;
  const axes = readMoveAxes();
  vehicle.input.throttle = axes.y;
  vehicle.input.steer = axes.x;
  vehicle.input.handbrake = isKeyDown('Space');
  p.pos.set(vehicle.pos.x, vehicle.pos.y, vehicle.pos.z);
  p.heading = vehicle.heading;
  p.speed = vehicle.speed;
  if (wasKeyPressed('KeyH')) world.sfx('horn');
  if (wasKeyPressed('KeyE') && Math.abs(vehicle.speed) < 7) exitVehicle();
  else if (vehicle.wrecked) exitVehicle();
}

function throwPunch(p) {
  p.punchTime = 0;
  world.sfx('punch');
  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  for (const ped of world.peds) {
    if (ped.state === 'dead') continue;
    const dx = ped.pos.x - p.pos.x;
    const dz = ped.pos.z - p.pos.z;
    const along = dx * fx + dz * fz;
    if (along < 0 || along > PUNCH_REACH || Math.abs(dx * -fz + dz * fx) > 0.9) continue;
    ped.takeDamage(18, { byPlayer: true, dirX: fx, dirZ: fz, cause: 'punch' });
    spawnSparks(ped.pos.x, 1.4, ped.pos.z, 3, 0xffffff);
    return;
  }
  const vehicle = nearestVehicle(p.pos.x + fx, p.pos.z + fz, 1.8);
  if (vehicle) damageVehicle(vehicle, 2);
}

/** Fire one pistol round along the aim direction: hits the first pedestrian, car or wall on the line. */
function firePistol(p) {
  p.ammo -= 1;
  p.fireCooldown = PISTOL_COOLDOWN;
  p.aimTime = 0.6;
  const yaw = cameraYaw();
  p.heading = yaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const ox = p.pos.x + fx * 0.7;
  const oz = p.pos.z + fz * 0.7;
  const oy = p.pos.y + 1.42;
  let range = PISTOL_RANGE;
  let hitPed = null;
  let hitVehicle = null;
  for (const ped of world.peds) {
    if (ped.state === 'dead') continue;
    const dx = ped.pos.x - ox;
    const dz = ped.pos.z - oz;
    const along = dx * fx + dz * fz;
    // a forgiving hit cylinder that widens a little with distance
    if (along > 0 && along < range && Math.abs(dx * -fz + dz * fx) < 0.55 + along * 0.012) { range = along; hitPed = ped; }
  }
  for (const v of world.vehicles) {
    if (v === p.vehicle) continue;
    const dx = v.pos.x - ox;
    const dz = v.pos.z - oz;
    const along = dx * fx + dz * fz;
    if (along > 0 && along < range && Math.abs(dx * -fz + dz * fx) < v.radius + 0.3) { range = along - v.radius * 0.6; hitPed = null; hitVehicle = v; }
  }
  // walls stop the round
  for (let d = 2; d < range; d += 2) {
    if (!lineOfSight(ox, oz, ox + fx * d, oz + fz * d)) { range = d - 1; hitPed = null; hitVehicle = null; break; }
  }
  const ex = ox + fx * range;
  const ez = oz + fz * range;
  spawnMuzzleFlash(ox, oy, oz);
  spawnTracer(ox, oy, oz, ex, hitPed ? 1.3 : oy - 0.2, ez);
  spawnSparks(ex, hitPed ? 1.3 : 1, ez, hitPed ? 3 : 4, hitPed ? 0xff5a5a : 0xffd27a);
  world.sfx('gunshot');
  world.camShake = Math.max(world.camShake || 0, 0.08);
  if (hitPed) hitPed.takeDamage(35, { byPlayer: true, dirX: fx, dirZ: fz, cause: 'bullet' });
  if (hitVehicle) {
    damageVehicle(hitVehicle, 9);
    if (hitVehicle.isPolice) reportCrime('hitCop', ex, ez);
  }
  emit('shot', { x: p.pos.x, z: p.pos.z, dirX: fx, dirZ: fz, by: 'player' });
  if (world.time - p.gunfireHeatAt > 2.5) {
    p.gunfireHeatAt = world.time;
    reportCrime('gunfire', p.pos.x, p.pos.z);
  }
}

function switchWeapon(p) {
  if (!p.hasPistol) return;
  p.weapon = p.weapon === 'fists' ? 'pistol' : 'fists';
  world.sfx('uiClick');
}

function walkOnFoot(p, dt) {
  const axes = readMoveAxes();
  const yaw = cameraYaw();
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // camera-relative: forward along the view, strafe to its right (-fz, fx)
  let mx = fx * axes.y - fz * axes.x;
  let mz = fz * axes.y + fx * axes.x;
  const moving = mx !== 0 || mz !== 0;
  const aiming = p.weapon === 'pistol' && (isAimHeld() || p.aimTime > 0);
  const top = isKeyDown('ShiftLeft') || isKeyDown('ShiftRight') ? RUN_SPEED : WALK_SPEED;
  const goal = moving ? top * (aiming ? 0.6 : 1) : 0;
  p.speed += (goal - p.speed) * Math.min(1, dt * 10);
  if (moving) {
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    p.pos.x += mx * p.speed * dt;
    p.pos.z += mz * p.speed * dt;
    if (!aiming) p.heading += angleDiff(Math.atan2(mx, mz), p.heading) * Math.min(1, dt * 12);
  }
  if (aiming) p.heading += angleDiff(yaw, p.heading) * Math.min(1, dt * 18);
  resolveCircle(p.pos, 0.4);
  // cars are solid, and a moving one hurts
  for (const v of world.vehicles) {
    const dx = p.pos.x - v.pos.x;
    const dz = p.pos.z - v.pos.z;
    if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
    for (const side of [1, -1]) {
      const cx = v.pos.x + Math.sin(v.heading) * v.spec.length * 0.27 * side;
      const cz = v.pos.z + Math.cos(v.heading) * v.spec.length * 0.27 * side;
      const d = Math.hypot(p.pos.x - cx, p.pos.z - cz);
      const min = v.radius + 0.35;
      if (d >= min || d < 1e-4) continue;
      p.pos.x = cx + ((p.pos.x - cx) / d) * min;
      p.pos.z = cz + ((p.pos.z - cz) / d) * min;
      const hitSpeed = Math.abs(v.speed);
      if (hitSpeed > 5 && world.time - (p.lastRunOver || -9) > 0.8) {
        p.lastRunOver = world.time;
        damagePlayer(hitSpeed * 2.4, 'vehicle');
        world.camShake = 0.5;
        world.sfx('crash', { volume: 0.6 });
      }
    }
  }
  p.pos.y += (groundHeight(p.pos.x, p.pos.z) - p.pos.y) * Math.min(1, dt * 16);

  p.fireCooldown -= dt;
  p.aimTime -= dt;
  if (wasKeyPressed('KeyQ') || wasKeyPressed('Digit1') || wasKeyPressed('Digit2')) switchWeapon(p);
  if (wasKeyPressed('KeyE')) tryEnterNearestVehicle();
  if (p.state !== 'foot') return;
  if (p.punchTime >= 0) { p.punchTime += dt; if (p.punchTime > 0.34) p.punchTime = -1; }
  const wantsAttack = wasMouseClicked() || wasKeyPressed('KeyF') || (p.weapon === 'pistol' && isMouseDown());
  if (wantsAttack && p.fireCooldown <= 0) {
    if (p.weapon === 'pistol' && p.ammo > 0) firePistol(p);
    else if (p.punchTime < 0) {
      if (p.weapon === 'pistol') { p.weapon = 'fists'; toast('Out of ammo', 'Find an ammo crate', 'warn'); }
      p.fireCooldown = 0.4;
      throwPunch(p);
    }
  }
}

function respawnAfterArrestOrDeath(p) {
  const wasBusted = p.state === 'busted';
  const place = wasBusted ? world.places.station : world.places.hospital;
  const fee = Math.min(p.money, wasBusted ? 150 : 100);
  p.money -= fee;
  placePlayerOnFoot(place.x, place.z, 0);
  p.health = 100;
  p.armor = 0;
  p.ammo = wasBusted ? 0 : p.ammo;
  if (wasBusted) p.weapon = 'fists';
  p.stateTime = 0;
  setWanted(0);
  snapCameraBehind(0);
  emit('respawn', { busted: wasBusted, fee });
  toast(wasBusted ? 'Released from PSPD Precinct' : 'Patched up at Mercy Clinic', fee ? `-$${fee}` : '', 'info');
}

/** Step the player for one simulation tick. */
export function updatePlayer(dt) {
  const p = world.player;
  if (!p) return;
  p.hurtFlash = Math.max(0, p.hurtFlash - dt * 1.8);
  if (p.state === 'busted' || p.state === 'wasted') {
    if (p.vehicle) { p.vehicle.input.throttle = 0; p.vehicle.input.handbrake = true; exitVehicle(); p.state = p.health <= 0 ? 'wasted' : 'busted'; }
    p.stateTime += dt;
    p.speed = 0;
    animateFigure(p.figure, dt, 0, p.health <= 0 ? 'dead' : 'handsUp');
    if (p.stateTime > RESPAWN_DELAY && world.mode === 'play') respawnAfterArrestOrDeath(p);
    return;
  }
  if (p.vehicle) driveVehicle(p);
  else walkOnFoot(p, dt);
  if (!p.vehicle) {
    p.group.rotation.y = p.heading;
    const pose = p.punchTime >= 0 ? 'punch' : p.weapon === 'pistol' && (isAimHeld() || p.aimTime > 0) ? 'aim' : 'move';
    animateFigure(p.figure, dt, p.speed, pose, Math.max(0, p.punchTime));
    if (p.figure.gun) p.figure.gun.visible = p.weapon === 'pistol';
  }
}

/** The car the player could enter right now, for the HUD prompt. */
export function vehicleInReach() {
  const p = world.player;
  if (!p || p.vehicle || p.state !== 'foot') return null;
  return nearestVehicle(p.pos.x, p.pos.z, ENTER_REACH, (v) => !v.dead && !v.wrecked && v.driver !== 'cop');
}

/** Distance from the player to a point, for objective readouts. */
export const playerDistanceTo = (x, z) => (world.player ? dist(world.player.pos.x, world.player.pos.z, x, z) : 0);
export const playerHealthFraction = () => clamp((world.player?.health ?? 0) / 100, 0, 1);
