// police.js: the Port Solano Police Department's answer to the wanted level. Spawns siren-lit cruisers
// out of sight, drives them through the road grid, boxes the player in or rams, sends officers out on
// foot, opens fire from three stars, makes arrests, and lets the heat decay once the player hides.
import {
  world, on, emit, addHeat, reportCrime, damagePlayer, lineOfSight, resolveCircle, groundHeight,
  roadCoord, nearestRoadIndex, lanePoint, angleDiff, clamp, dist, rand, randInt, chance, CELL, HALF, ROAD, BLOCKS,
} from './world.js';
import { spawnVehicle, removeVehicle, damageVehicle, placeVehicle } from './vehicles.js';
import { createFigure, giveFigurePistol, animateFigure } from './characters.js';
import { spawnTracer, spawnMuzzleFlash } from './effects.js';

const DESIRED_CRUISERS = [0, 1, 2, 3, 5, 6]; // by wanted level
const SEE_RANGE = 85;
const PURSUIT_RANGE = 45;
const FIRE_RANGE = 32;
const ARREST_TIME = 2.2;
const MAX_OFFICERS = 4;
const OFFICER_SPEED = 4.6;
const SLOTS = ['behind', 'ahead', 'left', 'right'];
const TURN_OPTIONS = [['x', 1], ['x', -1], ['z', 1], ['z', -1]];

const cruisers = [];
const officers = [];
let spawnClock = 1.5;
let arrestClock = 0;
let listening = false;
// per-frame scratch: the player's position and velocity, and the current steering target
let px = 0;
let pz = 0;
const playerVel = { x: 0, z: 0 };
const aim = { x: 0, z: 0 };

const isWreck = (v) => v.dead || v.wrecked;
const junctionKey = (axis, i, j) => (axis === 'x' ? i * 16 + j : j * 16 + i);

// ---- Cruisers --------------------------------------------------------------------------------

/** Least-used box-in slot among the active cruisers, so new arrivals take a free side. */
function pickFreeSlot() {
  const used = [0, 0, 0, 0];
  for (const v of cruisers) if (!isWreck(v) && !v.ai.leaving) used[v.ai.slot] += 1;
  let best = 0;
  for (let s = 1; s < SLOTS.length; s += 1) if (used[s] < used[best]) best = s;
  return best;
}

/** Put a pursuing PSPD cruiser on the map, siren on. Also used by screenshot staging. */
export function spawnPoliceCruiser(x, z, heading = 0) {
  const v = spawnVehicle('police', x, z, heading, { driver: 'cop' });
  v.sirenOn = true;
  v.ai = {
    slot: pickFreeSlot(), nav: { axis: 'x', i: 0, dir: 1, pending: null, lastJ: -1 },
    dist: 999, los: false, chasing: false, ram: false, leaving: false, leaveTime: 0, deadTime: 0,
    stuck: 0, reverseFor: 0, reverseSteer: 0, stopTime: 0, officerDeployed: false, fireClock: rand(0.5, 1.3),
  };
  syncRoadNav(v);
  cruisers.push(v);
  return v;
}

/** A free driving lane 100-170 m from the player, heading toward them, preferably out of sight. */
function findSpawnLane() {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const axis = chance(0.5) ? 'x' : 'z';
    const i = randInt(0, BLOCKS);
    const across = roadCoord(i) - (axis === 'x' ? px : pz);
    if (Math.abs(across) > 165) continue;
    const r = rand(Math.max(100, Math.abs(across) + 1), 170);
    const playerAlong = axis === 'x' ? pz : px;
    const along = clamp(playerAlong + Math.sqrt(r * r - across * across) * (chance(0.5) ? 1 : -1), -HALF, HALF);
    const lane = lanePoint(axis, i, along, playerAlong >= along ? 1 : -1);
    const d = dist(lane.x, lane.z, px, pz);
    if (d < 100 || d > 175 || laneOccupied(lane.x, lane.z)) continue;
    if (attempt < 10 && lineOfSight(lane.x, lane.z, px, pz)) continue;
    return lane;
  }
  return null;
}

function laneOccupied(x, z) {
  for (const v of world.vehicles) if (Math.abs(v.pos.x - x) < 7 && Math.abs(v.pos.z - z) < 7) return true;
  return false;
}

/** Spawn one cruiser at a time until the level's quota of active cruisers is met. */
function maintainCruiserCount(dt, level) {
  const p = world.player;
  if (world.mode === 'shot' || p.state === 'busted' || p.state === 'wasted') return;
  let active = 0;
  for (const v of cruisers) if (!isWreck(v) && !v.ai.leaving) active += 1;
  if (active >= DESIRED_CRUISERS[level]) return;
  spawnClock -= dt;
  if (spawnClock > 0) return;
  spawnClock = Math.max(1.1, 2.5 - 0.3 * (level - 1));
  const lane = findSpawnLane();
  if (lane) spawnPoliceCruiser(lane.x, lane.z, lane.heading);
}

// ---- Road-grid navigation ----------------------------------------------------------------------

/** Work out which road and direction a cruiser is driving along from where it is and where it faces. */
function syncRoadNav(v) {
  const nav = v.ai.nav;
  const ix = nearestRoadIndex(v.pos.x);
  const iz = nearestRoadIndex(v.pos.z);
  const offX = Math.abs(v.pos.x - roadCoord(ix));
  const offZ = Math.abs(v.pos.z - roadCoord(iz));
  const fx = Math.sin(v.heading);
  const fz = Math.cos(v.heading);
  if (offX <= ROAD / 2 && offZ <= ROAD / 2) nav.axis = Math.abs(fz) >= Math.abs(fx) ? 'x' : 'z';
  else nav.axis = offX < offZ ? 'x' : 'z';
  nav.i = nav.axis === 'x' ? ix : iz;
  const f = nav.axis === 'x' ? fz : fx;
  nav.dir = f >= 0 ? 1 : -1;
  if (Math.abs(f) < 0.3) nav.dir = (nav.axis === 'x' ? pz - v.pos.z : px - v.pos.x) >= 0 ? 1 : -1;
  nav.pending = null;
  nav.lastJ = -1;
}

/** Index of the next junction ahead on the current road, skipping the one just turned at. */
function nextJunction(nav, along) {
  const frac = (along + HALF) / CELL;
  let j = nav.dir > 0 ? Math.floor(frac) + 1 : Math.ceil(frac) - 1;
  if (junctionKey(nav.axis, nav.i, j) === nav.lastJ) j += nav.dir;
  return j;
}

/** At junction j pick the exit whose next road segment comes closest (Manhattan) to the player. */
function chooseJunctionTurn(nav, j, away) {
  const xi = nav.axis === 'x' ? nav.i : j;
  const zi = nav.axis === 'x' ? j : nav.i;
  const jx = roadCoord(xi);
  const jz = roadCoord(zi);
  let best = null;
  let bestScore = Infinity;
  for (const [axis, dir] of TURN_OPTIONS) {
    if (axis === nav.axis && dir === -nav.dir) continue; // no U-turns
    const ni = (axis === 'x' ? zi : xi) + dir;
    if (ni < 0 || ni > BLOCKS) continue;
    const end = roadCoord(ni);
    let score;
    if (axis === 'x') score = Math.abs(px - jx) + Math.abs(pz - clamp(pz, Math.min(jz, end), Math.max(jz, end)));
    else score = Math.abs(pz - jz) + Math.abs(px - clamp(px, Math.min(jx, end), Math.max(jx, end)));
    if (axis === nav.axis) score -= 2;
    score += rand(0, 4);
    if (away) score = -score;
    if (score < bestScore) { bestScore = score; best = { j, axis, i: axis === 'x' ? xi : zi, dir }; }
  }
  return best;
}

/** Drive the right-hand lane toward the best junction, turning there. Sets aim; returns a target speed. */
function steerAlongGrid(v, level) {
  const nav = v.ai.nav;
  let along = nav.axis === 'x' ? v.pos.z : v.pos.x;
  let j = nextJunction(nav, along);
  if (j < 0 || j > BLOCKS) { nav.dir = -nav.dir; nav.pending = null; j = nextJunction(nav, along); }
  if (nav.pending && nav.pending.j !== j) nav.pending = null; // passed it going straight
  let toJ = (roadCoord(j) - along) * nav.dir;
  if (!nav.pending && toJ < 32) nav.pending = chooseJunctionTurn(nav, j, v.ai.leaving);
  let turning = !!nav.pending && nav.pending.axis !== nav.axis;
  if (turning) {
    // old forward f, new forward g; right of f is (-fz, fx)
    const fx = nav.axis === 'z' ? nav.dir : 0;
    const fz = nav.axis === 'x' ? nav.dir : 0;
    const gx = nav.pending.axis === 'z' ? nav.pending.dir : 0;
    const gz = nav.pending.axis === 'x' ? nav.pending.dir : 0;
    const rightTurn = gx * -fz + gz * fx > 0;
    if (toJ < (rightTurn ? 6.5 : 2.5)) {
      nav.lastJ = junctionKey(nav.axis, nav.i, j);
      nav.axis = nav.pending.axis;
      nav.i = nav.pending.i;
      nav.dir = nav.pending.dir;
      nav.pending = null;
      turning = false;
      along = nav.axis === 'x' ? v.pos.z : v.pos.x;
      toJ = 99;
    }
  }
  const lane = lanePoint(nav.axis, nav.i, along + nav.dir * (8 + Math.abs(v.speed) * 0.35), nav.dir);
  aim.x = lane.x;
  aim.z = lane.z;
  const cruise = v.ai.leaving ? 15 : 22 + level * 2.5;
  return turning ? Math.min(cruise, 9 + toJ * 0.55) : cruise;
}

// ---- Close pursuit -----------------------------------------------------------------------------

/** Aim at the player's box-in slot (led by their velocity), or straight at their car to ram. */
function steerPursuit(v, level) {
  const p = world.player;
  const ai = v.ai;
  const pSpeed = Math.hypot(playerVel.x, playerVel.z);
  let fx = Math.sin(p.heading);
  let fz = Math.cos(p.heading);
  if (pSpeed > 3) { fx = playerVel.x / pSpeed; fz = playerVel.z / pSpeed; }
  const onFoot = !p.vehicle;
  const lead = clamp(ai.dist / 25, 0, 1);
  if (level >= 2 && !onFoot && ai.dist < 16) {
    ai.ram = true;
    aim.x = px + playerVel.x * lead * 0.6;
    aim.z = pz + playerVel.z * lead * 0.6;
    return v.spec.maxSpeed;
  }
  const r = onFoot ? 4.5 : 6.5;
  let ox = 0;
  let oz = 0;
  switch (SLOTS[ai.slot]) {
    case 'ahead': ox = fx * (r + 1.5); oz = fz * (r + 1.5); break;
    case 'behind': ox = -fx * r; oz = -fz * r; break;
    case 'left': ox = fz * r + fx; oz = -fx * r + fz; break;
    default: ox = -fz * r + fx; oz = fx * r + fz; break; // right
  }
  aim.x = px + playerVel.x * lead + ox;
  aim.z = pz + playerVel.z * lead + oz;
  const dAim = dist(v.pos.x, v.pos.z, aim.x, aim.z);
  let speed = dAim < 2.5 ? pSpeed : Math.min(36, pSpeed + dAim * 0.9);
  if (onFoot) speed = Math.min(speed, Math.max(0, dAim * 1.1 - 0.5));
  return speed;
}

/** True when another cruiser sits directly ahead within 6 m and the player does not. */
function cruiserBlockingAhead(v) {
  const fx = Math.sin(v.heading);
  const fz = Math.cos(v.heading);
  const inFront = (x, z) => {
    const dx = x - v.pos.x;
    const dz = z - v.pos.z;
    const ahead = dx * fx + dz * fz;
    return ahead > 0 && ahead < 6 && Math.abs(dx * -fz + dz * fx) < 2.4;
  };
  if (inFront(px, pz)) return false;
  for (const other of cruisers) if (other !== v && inFront(other.pos.x, other.pos.z)) return true;
  return false;
}

/** Fill vehicle.input to reach aim at the desired speed: steering, braking, handbrake, unsticking. */
function driveTowardAim(v, desired, dt) {
  const ai = v.ai;
  const input = v.input;
  const dx = aim.x - v.pos.x;
  const dz = aim.z - v.pos.z;
  const dAim = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz);
  const err = angleDiff(want, v.heading);
  let steer = clamp(-err * 2.2, -1, 1); // positive steer turns right (heading decreases)
  if (!ai.ram && Math.abs(err) > 0.8) desired = Math.min(desired, 14);
  const diff = desired - v.speed;
  let throttle = ai.ram ? 1 : diff > 0.5 ? clamp(diff / 4, 0.35, 1) : diff < -2 ? -1 : 0;
  if (!ai.ram && Math.abs(err) > 2.1 && dAim < 10 && v.speed < 3) {
    // target close behind: back toward it (reversing flips the steering sense)
    throttle = -0.7;
    steer = clamp(angleDiff(want, v.heading + Math.PI) * 2, -1, 1);
  }
  const wantsMove = throttle > 0.3;
  if (wantsMove && cruiserBlockingAhead(v)) throttle = v.speed > 2 ? -1 : 0;
  if (ai.reverseFor > 0) {
    ai.reverseFor -= dt;
    input.throttle = -1;
    input.steer = ai.reverseSteer;
    input.handbrake = false;
    return;
  }
  if (wantsMove && Math.abs(v.speed) < 1) {
    ai.stuck += dt;
    if (ai.stuck > 1.5) {
      ai.stuck = 0;
      ai.reverseFor = 1.2;
      ai.reverseSteer = Math.abs(steer) > 0.2 ? -Math.sign(steer) : chance(0.5) ? 1 : -1;
    }
  } else ai.stuck = 0;
  input.throttle = throttle;
  input.steer = steer;
  input.handbrake = Math.abs(err) > 1.0 && v.speed > 15;
}

/** One cruiser's frame. Returns true when it should be removed. */
function updateCruiser(v, dt, level) {
  const ai = v.ai;
  const p = world.player;
  ai.dist = dist(v.pos.x, v.pos.z, px, pz);
  if (isWreck(v)) {
    ai.los = false;
    ai.deadTime += dt;
    v.input.throttle = 0;
    v.input.steer = 0;
    v.input.handbrake = true;
    return ai.deadTime > 10 || ai.dist > 260; // ~8 s after the explosion
  }
  if (ai.dist > 260) return true;
  ai.los = ai.dist < SEE_RANGE && lineOfSight(v.pos.x, v.pos.z, px, pz);
  if (level === 0 && world.mode !== 'shot' && !ai.leaving) {
    ai.leaving = true;
    ai.leaveTime = 0;
    v.sirenOn = false;
    syncRoadNav(v);
  } else if (level > 0 && ai.leaving) {
    ai.leaving = false;
    v.sirenOn = true;
  }
  if (ai.leaving) {
    ai.leaveTime += dt;
    if (ai.dist > 120 || ai.leaveTime > 10) return true;
  }
  const playerDown = p.state === 'busted' || p.state === 'wasted';
  ai.ram = false;
  let desired;
  if (!ai.leaving && !playerDown && ai.dist < PURSUIT_RANGE && ai.los) {
    ai.chasing = true;
    desired = steerPursuit(v, level);
  } else {
    const nav = ai.nav;
    const off = Math.abs((nav.axis === 'x' ? v.pos.x : v.pos.z) - roadCoord(nav.i));
    if (ai.chasing || off > ROAD / 2 + 2) syncRoadNav(v);
    ai.chasing = false;
    desired = steerAlongGrid(v, level);
    if (playerDown && ai.dist < 30) desired = 0;
  }
  driveTowardAim(v, desired, dt);
  // a stopped cruiser next to an on-foot suspect lets one officer out
  if (p.state === 'foot' && !p.vehicle && !ai.leaving && level >= 1 && Math.abs(v.speed) < 1.5 && ai.dist < 16) {
    ai.stopTime += dt;
    if (ai.stopTime > 1 && !ai.officerDeployed && livingOfficers() < MAX_OFFICERS) deployOfficer(v);
  } else ai.stopTime = 0;
  return false;
}

// ---- Officers on foot ----------------------------------------------------------------------------

function livingOfficers() {
  let n = 0;
  for (const o of officers) if (o.state !== 'dead') n += 1;
  return n;
}

/** An armed officer steps out on the driver's (left) side of a stopped cruiser. */
function deployOfficer(v) {
  v.ai.officerDeployed = true;
  const figure = createFigure({ cop: true });
  giveFigurePistol(figure);
  const group = figure.group;
  const fx = Math.sin(v.heading);
  const fz = Math.cos(v.heading);
  group.position.set(v.pos.x + fz * 1.7 - fx * 0.4, 0, v.pos.z - fx * 1.7 - fz * 0.4);
  resolveCircle(group.position, 0.4);
  group.position.y = groundHeight(group.position.x, group.position.z);
  group.rotation.y = v.heading;
  world.scene.add(group);
  const officer = {
    figure, group, pos: group.position, heading: v.heading, speed: 0, hp: 60, state: 'chase', isCop: true, radius: 0.4,
    dist: 999, los: false, fireClock: rand(0.6, 1.4), aimTime: 0, deadTime: 0,
    takeDamage(amount, info) { hurtOfficer(officer, amount, info); },
  };
  officers.push(officer);
  world.peds.push(officer);
}

/** Damage from the player's fists or bullets (or anything else); striking or killing a cop is a crime. */
function hurtOfficer(o, amount, info) {
  if (o.state === 'dead') return;
  o.hp -= amount;
  const byPlayer = !!(info && info.byPlayer);
  if (o.hp <= 0) {
    o.state = 'dead';
    o.speed = 0;
    o.deadTime = 0;
    if (o.figure.gun) o.figure.gun.visible = false;
    if (byPlayer) reportCrime('killCop', o.pos.x, o.pos.z);
  } else if (byPlayer) reportCrime('hitCop', o.pos.x, o.pos.z);
}

/** Run at the player, stand and aim when shooting. Returns true when the officer should be removed. */
function updateOfficer(o, dt, level) {
  if (o.state === 'dead') {
    o.deadTime += dt;
    animateFigure(o.figure, dt, 0, 'dead');
    return o.deadTime > 12;
  }
  const p = world.player;
  if (level === 0 && world.mode !== 'shot') return true;
  const dx = px - o.pos.x;
  const dz = pz - o.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 150) return true;
  o.dist = d;
  o.los = d < SEE_RANGE && lineOfSight(o.pos.x, o.pos.z, px, pz);
  if (d > 0.01) o.heading = Math.atan2(dx, dz);
  const playerDown = p.state === 'busted' || p.state === 'wasted';
  const shooting = level >= 3 && o.los && d < FIRE_RANGE && !playerDown;
  const stopAt = shooting && d < 12 ? d : p.vehicle ? 1.8 : 1.1;
  o.speed = !playerDown && d > stopAt ? OFFICER_SPEED : 0;
  if (o.speed > 0) {
    const step = Math.min(o.speed * dt, d - stopAt);
    o.pos.x += (dx / d) * step;
    o.pos.z += (dz / d) * step;
    resolveCircle(o.pos, 0.4);
  }
  o.pos.y = groundHeight(o.pos.x, o.pos.z);
  o.group.rotation.y = o.heading;
  o.aimTime = Math.max(0, o.aimTime - dt);
  if (o.figure.gun) o.figure.gun.visible = level >= 3;
  animateFigure(o.figure, dt, o.speed, o.aimTime > 0 || (shooting && o.speed === 0) ? 'aim' : 'move');
  return false;
}

function removeOfficer(o) {
  world.scene.remove(o.group);
  const i = world.peds.indexOf(o);
  if (i >= 0) world.peds.splice(i, 1);
  o.removed = true;
}

// ---- Wanted level, arrests and gunfire ------------------------------------------------------------

/** The player is seen when any active cruiser or officer has line of sight within 85 m; hidden, heat decays. */
function updateWantedVisibility(dt, level) {
  let seen = false;
  for (const v of cruisers) if (v.ai.los && !v.ai.leaving) { seen = true; break; }
  if (!seen) for (const o of officers) if (o.state !== 'dead' && o.los) { seen = true; break; }
  const w = world.wanted;
  w.seen = seen;
  if (seen) { w.hiddenFor = 0; return; }
  w.hiddenFor += dt;
  if (world.mode !== 'shot' && w.heat > 0 && w.hiddenFor > 5 + 2 * level) addHeat(-Math.min(0.5 * dt, w.heat));
}

/** A slow player with a cruiser (6.5 m) or officer (2 m) beside them for 2.2 s is busted. */
function tryArrestPlayer(dt, level) {
  const p = world.player;
  const w = world.wanted;
  let close = false;
  if (level >= 1 && world.mode !== 'shot' && (p.state === 'foot' || p.state === 'drive')) {
    const slow = p.vehicle ? Math.abs(p.vehicle.speed) < 2 : Math.abs(p.speed) < 1.5;
    if (slow) {
      for (const v of cruisers) if (!isWreck(v) && !v.ai.leaving && v.ai.dist < 6.5) { close = true; break; }
      if (!close) for (const o of officers) if (o.state !== 'dead' && o.dist < 2) { close = true; break; }
    }
  }
  arrestClock = close ? arrestClock + dt : 0;
  w.arrest = clamp(arrestClock / ARREST_TIME, 0, 1);
  if (arrestClock >= ARREST_TIME) {
    arrestClock = 0;
    w.arrest = 0;
    p.state = 'busted';
    p.stateTime = 0;
    emit('busted');
  }
}

/** One police shot: flash, tracer, sound, and a 35% chance to hit the player or their car. */
function fireAtPlayer(sx, sy, sz) {
  const p = world.player;
  const hit = chance(0.35);
  let tx = px;
  let tz = pz;
  let ty = p.vehicle ? 0.9 : 1.15;
  if (!hit) { tx += rand(-2.2, 2.2); tz += rand(-2.2, 2.2); ty += rand(-0.6, 1.0); }
  spawnMuzzleFlash(sx, sy, sz);
  spawnTracer(sx, sy, sz, tx, ty, tz);
  world.sfx('gunshot', { volume: 0.45 });
  if (!hit) return;
  if (p.vehicle) {
    if (world.mode !== 'shot') damageVehicle(p.vehicle, 6);
    damagePlayer(2, 'police');
  } else damagePlayer(7, 'police');
}

/** From three stars, every cruiser and officer within 32 m with line of sight shoots every 1.1-1.6 s. */
function officersOpenFire(dt, level) {
  const p = world.player;
  if (level < 3 || p.state === 'busted' || p.state === 'wasted') return;
  for (const v of cruisers) {
    const ai = v.ai;
    if (isWreck(v) || ai.leaving || !ai.los || ai.dist > FIRE_RANGE) continue;
    ai.fireClock -= dt;
    if (ai.fireClock > 0) continue;
    ai.fireClock = rand(1.1, 1.6);
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    fireAtPlayer(v.pos.x + fz * 1.1 + fx * 0.3, 1.35, v.pos.z - fx * 1.1 + fz * 0.3); // driver's window
  }
  for (const o of officers) {
    if (o.state === 'dead' || !o.los || o.dist > FIRE_RANGE) continue;
    o.fireClock -= dt;
    if (o.fireClock > 0) continue;
    o.fireClock = rand(1.1, 1.6);
    o.aimTime = 0.6;
    fireAtPlayer(o.pos.x + Math.sin(o.heading) * 0.55, o.pos.y + 1.45, o.pos.z + Math.cos(o.heading) * 0.55);
  }
}

// ---- Lifecycle -------------------------------------------------------------------------------------

/** Remove every cruiser and officer (respawn, mission resets). */
export function clearPolice() {
  for (const v of cruisers) if (!v.removed && v.driver === 'cop') removeVehicle(v);
  cruisers.length = 0;
  for (const o of officers) removeOfficer(o);
  officers.length = 0;
  arrestClock = 0;
  spawnClock = 1.5;
  world.wanted.arrest = 0;
}

/** Active police: cruisers plus living officers. */
export function policeCount() {
  return cruisers.length + livingOfficers();
}

/** Screenshot staging: cruisers at the given spots, sirens on, already moving. */
export function stagePoliceChase(positions) {
  return positions.map(({ x, z, heading = 0, speed = 0 }) => {
    const v = spawnPoliceCruiser(x, z, heading);
    placeVehicle(v, x, z, heading, speed);
    v.input.throttle = speed > 0 ? 1 : 0;
    return v;
  });
}

export function initPolice() {
  if (!listening) {
    listening = true;
    on('respawn', () => clearPolice());
    on('wantedChanged', ({ level, previous }) => {
      if (level <= previous) return;
      world.sfx('starUp');
      if (previous === 0) spawnClock = Math.min(spawnClock, 0.8);
    });
  }
  clearPolice();
}

/** Step the police: call before updateVehicles(dt) so the inputs set here drive this frame. */
export function updatePolice(dt) {
  const p = world.player;
  if (!p) return;
  const level = world.wanted.level;
  const at = p.vehicle ? p.vehicle.pos : p.pos;
  px = at.x;
  pz = at.z;
  if (p.vehicle) { playerVel.x = p.vehicle.vel.x; playerVel.z = p.vehicle.vel.z; } else {
    playerVel.x = Math.sin(p.heading) * (p.speed || 0);
    playerVel.z = Math.cos(p.heading) * (p.speed || 0);
  }
  for (let k = cruisers.length - 1; k >= 0; k -= 1) {
    const v = cruisers[k];
    if (v.removed || v.driver !== 'cop') { v.ai = null; cruisers.splice(k, 1); continue; } // removed or hijacked
    if (updateCruiser(v, dt, level)) { removeVehicle(v); cruisers.splice(k, 1); }
  }
  for (let k = officers.length - 1; k >= 0; k -= 1) {
    if (updateOfficer(officers[k], dt, level)) { removeOfficer(officers[k]); officers.splice(k, 1); }
  }
  updateWantedVisibility(dt, level);
  tryArrestPlayer(dt, level);
  officersOpenFire(dt, level);
  maintainCruiserCount(dt, level);
}
