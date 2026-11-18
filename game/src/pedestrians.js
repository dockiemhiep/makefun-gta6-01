// pedestrians.js: civilians who walk the sidewalk rings around every block and the seaside promenade.
// They flee gunfire and crime, dodge and get hit by cars, can be killed (dropping cash) and are
// kept topped up around the player. Police officers share world.peds but are skipped here.
import {
  world, on, emit, rand, randInt, pick, chance, clamp, angleDiff, groundHeight, resolveCircle, reportCrime,
  BLOCKS, CELL, HALF, CITY_MIN,
} from './world.js';
import { blockRect } from './districts.js';
import { createFigure, animateFigure, SKIN_TONES, SHIRT_COLORS, PANTS_COLORS, HAIR_COLORS } from './characters.js';

const RING_INSET = 2; // walking line sits 2 m inside the block edge
const CROSS_GAP = 16 + 2 * RING_INSET; // corner to the facing corner of the next block
const PROMENADE_X = CITY_MIN - 5;
const PROMENADE_Z = 290;
const TARGET_LIVING = 34;
const MAX_PEDS = 44;
const CORPSE_SECONDS = 18;
const FAR_ANIMATION_SKIP = 120 * 120;
const RECYCLE_DISTANCE = 190;
const DEFAULT_CENTER = { x: -300, z: 0 };

const ringHit = { x: 0, z: 0, edge: 0, bi: 0, bj: 0 };
const cornerOut = { x: 0, z: 0 };
const spot = { x: 0, z: 0 };
let topUpClock = 0;

// ---- Setup and events ----------------------------------------------------------------------------
export function initPedestrians() {
  on('shot', (e) => reactToNoise(e.x, e.z, 45, 8));
  on('crime', (e) => reactToNoise(e.x, e.z, 25, 0));
  on('respawn', calmEveryone);
}

function reactToNoise(x, z, radius, freezeRadius) {
  const r2 = radius * radius;
  for (const ped of world.peds) {
    if (ped.isCop || ped.state === 'dead') continue;
    const dx = ped.pos.x - x;
    const dz = ped.pos.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    if (d2 < freezeRadius * freezeRadius && ped.state !== 'flee') {
      ped.freeze = 0.9; // hands up for a moment, then run
      ped.threatX = x;
      ped.threatZ = z;
    } else {
      startFleeFrom(ped, x, z);
    }
  }
}

function calmEveryone() {
  for (const ped of world.peds) {
    if (ped.isCop || ped.state === 'dead') continue;
    ped.freeze = 0;
    if (ped.state === 'flee') returnToRoute(ped);
  }
}

// ---- Creating and removing ------------------------------------------------------------------------
export function spawnPedestrian(x, z, opts = {}) {
  const figure = createFigure({
    skin: pick(SKIN_TONES), shirt: pick(SHIRT_COLORS), pants: pick(PANTS_COLORS), hair: pick(HAIR_COLORS),
    cap: chance(0.2) ? pick(SHIRT_COLORS) : null,
  });
  const group = figure.group;
  group.scale.setScalar(rand(0.95, 1.06));
  group.position.set(x, groundHeight(x, z), z);
  world.scene.add(group);
  const heading = opts.heading ?? rand(0, Math.PI * 2);
  const ped = {
    figure, group, pos: group.position, heading, speed: 0, hp: 30, state: opts.idle ? 'idle' : 'walk',
    isCop: false, radius: 0.4, deadTime: 0, takeDamage: null,
    walkSpeed: rand(1.2, 1.7), tx: x, tz: z, bi: 0, bj: 0, ci: 0, dir: chance(0.5) ? 1 : -1,
    onPromenade: false, promDir: 1, crossing: false, rejoinEdge: -1,
    fleeX: 0, fleeZ: 0, fleeT: 0, freeze: 0, threatX: 0, threatZ: 0, kx: 0, kz: 0, hitCool: 0, posed: false,
  };
  ped.takeDamage = (amount, info = {}) => damagePed(ped, amount, info);
  group.rotation.y = heading;
  if (!opts.idle) {
    returnToRoute(ped);
    if (opts.heading === undefined) ped.heading = Math.atan2(ped.tx - x, ped.tz - z);
  }
  world.peds.push(ped);
  return ped;
}

export function removePedestrian(ped) {
  const i = world.peds.indexOf(ped);
  if (i >= 0) world.peds.splice(i, 1);
  if (ped.group.parent) ped.group.parent.remove(ped.group);
}

export function countWitnesses(x, z, radius) {
  const r2 = radius * radius;
  let n = 0;
  for (const ped of world.peds) {
    if (ped.isCop || ped.state === 'dead') continue;
    const dx = ped.pos.x - x;
    const dz = ped.pos.z - z;
    if (dx * dx + dz * dz <= r2) n += 1;
  }
  return n;
}

export function populatePedestriansAround(x, z, count, minDist = 0, maxDist = 150) {
  let made = 0;
  for (let i = 0; i < count && countCivilians() < MAX_PEDS; i += 1) {
    if (!findSidewalkSpot(x, z, minDist, maxDist)) continue;
    spawnPedestrian(spot.x, spot.z, { idle: chance(0.08) });
    made += 1;
  }
  return made;
}

function countCivilians() {
  let n = 0;
  for (const p of world.peds) if (!p.isCop) n += 1;
  return n;
}

// ---- Sidewalk geometry -----------------------------------------------------------------------------
/** Project a point onto the walking ring of the block it lies in; result in the shared ringHit. */
function projectToRing(x, z) {
  const bi = clamp(Math.floor((x + HALF) / CELL), 0, BLOCKS - 1);
  const bj = clamp(Math.floor((z + HALF) / CELL), 0, BLOCKS - 1);
  const r = blockRect(bi, bj);
  const ix0 = r.x0 + RING_INSET;
  const ix1 = r.x1 - RING_INSET;
  const iz0 = r.z0 + RING_INSET;
  const iz1 = r.z1 - RING_INSET;
  let cx = clamp(x, ix0, ix1);
  let cz = clamp(z, iz0, iz1);
  const dTop = cz - iz0;
  const dRight = ix1 - cx;
  const dBottom = iz1 - cz;
  const dLeft = cx - ix0;
  const m = Math.min(dTop, dRight, dBottom, dLeft);
  let edge;
  if (m === dTop) { edge = 0; cz = iz0; } else if (m === dRight) { edge = 1; cx = ix1; } else if (m === dBottom) { edge = 2; cz = iz1; } else { edge = 3; cx = ix0; }
  ringHit.x = cx;
  ringHit.z = cz;
  ringHit.edge = edge;
  ringHit.bi = bi;
  ringHit.bj = bj;
  return ringHit;
}

/** Corner ci (0 NW, 1 NE, 2 SE, 3 SW) of a block's walking ring, into the shared cornerOut. */
function cornerXZ(bi, bj, ci) {
  const r = blockRect(bi, bj);
  const c = ((ci % 4) + 4) % 4;
  cornerOut.x = (c === 0 || c === 3 ? r.x0 : r.x1) + (c === 0 || c === 3 ? RING_INSET : -RING_INSET);
  cornerOut.z = (c === 0 || c === 1 ? r.z0 : r.z1) + (c === 0 || c === 1 ? RING_INSET : -RING_INSET);
  return cornerOut;
}

/** A random spot on a walkway between minD and maxD metres from (cx, cz); fills `spot`. */
function findSidewalkSpot(cx, cz, minD, maxD) {
  const coastal = cx < -200 ? 0.35 : 0.08;
  for (let tries = 0; tries < 10; tries += 1) {
    let x;
    let z;
    if (chance(coastal)) {
      x = PROMENADE_X + rand(-1.2, 1.2);
      z = clamp(cz + rand(-maxD, maxD), -PROMENADE_Z, PROMENADE_Z);
    } else {
      const a = rand(0, Math.PI * 2);
      const r = rand(minD, maxD);
      const hit = projectToRing(clamp(cx + Math.sin(a) * r, CITY_MIN + 1, -CITY_MIN - 1), clamp(cz + Math.cos(a) * r, CITY_MIN + 1, -CITY_MIN - 1));
      x = hit.x + rand(-1, 1);
      z = hit.z + rand(-1, 1);
    }
    const d = Math.hypot(x - cx, z - cz);
    if (d < minD || d > maxD) continue;
    spot.x = x;
    spot.z = z;
    return true;
  }
  return false;
}

// ---- Routes ------------------------------------------------------------------------------------------
function setCornerTarget(ped, ci) {
  const c = cornerXZ(ped.bi, ped.bj, ci);
  ped.ci = ((ci % 4) + 4) % 4;
  ped.tx = c.x;
  ped.tz = c.z;
}

/** Snap the ped's route to the nearest walking line from where it stands and start walking. */
function returnToRoute(ped) {
  ped.state = 'walk';
  ped.fleeT = 0;
  ped.crossing = false;
  if (ped.pos.x < CITY_MIN - 2) {
    ped.onPromenade = true;
    ped.rejoinEdge = -1;
    ped.promDir = chance(0.5) ? 1 : -1;
    ped.tx = PROMENADE_X;
    ped.tz = ped.promDir * PROMENADE_Z;
    return;
  }
  ped.onPromenade = false;
  const hit = projectToRing(ped.pos.x, ped.pos.z);
  ped.bi = hit.bi;
  ped.bj = hit.bj;
  ped.rejoinEdge = hit.edge;
  ped.tx = hit.x;
  ped.tz = hit.z;
}

function arriveAtTarget(ped) {
  if (ped.onPromenade) {
    ped.promDir = -ped.promDir;
    ped.tz = ped.promDir * PROMENADE_Z;
    return;
  }
  if (ped.rejoinEdge >= 0) {
    const e = ped.rejoinEdge;
    ped.rejoinEdge = -1;
    setCornerTarget(ped, ped.dir > 0 ? e + 1 : e);
    return;
  }
  if (ped.crossing) {
    ped.crossing = false;
    ped.dir = chance(0.5) ? 1 : -1;
    setCornerTarget(ped, ped.ci + ped.dir);
    return;
  }
  // at a corner: work out which way we were travelling, then cross or turn
  const cur = cornerXZ(ped.bi, ped.bj, ped.ci);
  const curX = cur.x;
  const curZ = cur.z;
  const prev = cornerXZ(ped.bi, ped.bj, ped.ci - ped.dir);
  const sx = Math.sign(curX - prev.x);
  const sz = Math.sign(curZ - prev.z);
  const nbi = ped.bi + sx;
  const nbj = ped.bj + sz;
  const canCross = nbi >= 0 && nbi < BLOCKS && nbj >= 0 && nbj < BLOCKS;
  if (canCross && chance(0.35)) {
    ped.bi = nbi;
    ped.bj = nbj;
    const hit = projectToRing(curX + sx * CROSS_GAP, curZ + sz * CROSS_GAP);
    ped.ci = nearestCorner(nbi, nbj, hit.x, hit.z);
    ped.tx = hit.x;
    ped.tz = hit.z;
    ped.crossing = true;
    return;
  }
  setCornerTarget(ped, ped.ci + ped.dir);
}

function nearestCorner(bi, bj, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < 4; c += 1) {
    const p = cornerXZ(bi, bj, c);
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ---- Damage ---------------------------------------------------------------------------------------------
function damagePed(ped, amount, info) {
  if (ped.state === 'dead') return;
  ped.hp -= amount;
  const x = ped.pos.x;
  const z = ped.pos.z;
  if (info.dirX !== undefined) {
    ped.kx = info.dirX * 1.5;
    ped.kz = (info.dirZ ?? 0) * 1.5;
  }
  if (ped.hp <= 0) {
    ped.state = 'dead';
    ped.speed = 0;
    ped.deadTime = 0;
    ped.posed = false;
    if (info.byPlayer) {
      if (chance(0.6)) emit('dropCash', { x, z, amount: randInt(15, 90) });
      reportCrime('killPed', x, z);
    }
    return;
  }
  if (info.byPlayer) reportCrime('hitPed', x, z);
  startFleeFrom(ped, x - (info.dirX ?? 0), z - (info.dirZ ?? 0));
}

// ---- Fleeing ------------------------------------------------------------------------------------------------
function startFleeFrom(ped, tx, tz) {
  let dx = ped.pos.x - tx;
  let dz = ped.pos.z - tz;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) {
    const a = rand(0, Math.PI * 2);
    dx = Math.sin(a);
    dz = Math.cos(a);
  } else {
    dx /= d;
    dz /= d;
  }
  startFleeDir(ped, dx, dz, rand(6, 9));
}

function startFleeDir(ped, dx, dz, seconds) {
  ped.state = 'flee';
  ped.fleeX = dx;
  ped.fleeZ = dz;
  ped.fleeT = seconds;
  ped.freeze = 0;
  ped.speed = rand(4.5, 5.5);
}

// ---- Per-frame update ---------------------------------------------------------------------------------
export function updatePedestrians(dt) {
  const player = world.player;
  const cx = player ? player.pos.x : DEFAULT_CENTER.x;
  const cz = player ? player.pos.z : DEFAULT_CENTER.z;
  let living = 0;
  for (let i = world.peds.length - 1; i >= 0; i -= 1) {
    const ped = world.peds[i];
    if (ped.isCop) continue;
    const dx = ped.pos.x - cx;
    const dz = ped.pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (ped.state === 'dead') {
      if (updateCorpse(ped, dt)) removePedestrian(ped);
      continue;
    }
    if (d2 > RECYCLE_DISTANCE * RECYCLE_DISTANCE && findSidewalkSpot(cx, cz, 60, 150)) {
      ped.pos.set(spot.x, groundHeight(spot.x, spot.z), spot.z);
      returnToRoute(ped);
      continue;
    }
    if (d2 < 150 * 150) living += 1;
    updateLivingPed(ped, dt, player, d2);
  }
  topUpClock -= dt;
  if (topUpClock <= 0) {
    topUpClock = 0.3;
    if (living < TARGET_LIVING && countCivilians() < MAX_PEDS && findSidewalkSpot(cx, cz, 60, 150)) {
      spawnPedestrian(spot.x, spot.z);
    }
  }
}

function updateCorpse(ped, dt) {
  ped.deadTime += dt;
  if (!ped.posed) {
    animateFigure(ped.figure, 0, 0, 'dead');
    ped.group.rotation.y = ped.heading;
    ped.posed = true;
  }
  if (Math.abs(ped.kx) + Math.abs(ped.kz) > 0.05) {
    ped.pos.x += ped.kx * dt;
    ped.pos.z += ped.kz * dt;
    resolveCircle(ped.pos, ped.radius);
    ped.pos.y = groundHeight(ped.pos.x, ped.pos.z);
    const decay = Math.max(0, 1 - 5 * dt);
    ped.kx *= decay;
    ped.kz *= decay;
  }
  return ped.deadTime > CORPSE_SECONDS;
}

function updateLivingPed(ped, dt, player, d2) {
  ped.hitCool -= dt;
  if (d2 < 120 * 120) checkVehicles(ped);
  if (ped.state === 'dead') return; // run over this frame
  let pose = 'move';
  let moveSpeed = 0;
  let desired = ped.heading;
  let turnRate = 5;

  if (ped.freeze > 0) {
    ped.freeze -= dt;
    pose = 'handsUp';
    if (ped.freeze <= 0) startFleeFrom(ped, ped.threatX, ped.threatZ);
  } else if (ped.state === 'flee') {
    ped.fleeT -= dt;
    desired = Math.atan2(ped.fleeX, ped.fleeZ);
    moveSpeed = ped.speed;
    turnRate = 12;
    if (ped.fleeT <= 0) { returnToRoute(ped); moveSpeed = 0; }
  } else if (ped.state === 'walk') {
    const dx = ped.tx - ped.pos.x;
    const dz = ped.tz - ped.pos.z;
    if (dx * dx + dz * dz < 0.64) {
      arriveAtTarget(ped);
    } else {
      desired = Math.atan2(dx, dz);
      moveSpeed = ped.walkSpeed;
      if (player && player.state === 'foot') moveSpeed *= avoidPlayer(ped, player, dt);
    }
  }

  ped.heading += clamp(angleDiff(desired, ped.heading), -turnRate * dt, turnRate * dt);
  ped.speed = ped.state === 'flee' ? ped.speed : moveSpeed;
  const stepSpeed = ped.state === 'flee' || ped.state === 'walk' ? moveSpeed : 0;
  const knocked = Math.abs(ped.kx) + Math.abs(ped.kz) > 0.05;
  if (stepSpeed > 0 || knocked) {
    ped.pos.x += Math.sin(ped.heading) * stepSpeed * dt + ped.kx * dt;
    ped.pos.z += Math.cos(ped.heading) * stepSpeed * dt + ped.kz * dt;
    if (knocked) {
      const decay = Math.max(0, 1 - 6 * dt);
      ped.kx *= decay;
      ped.kz *= decay;
    }
    resolveCircle(ped.pos, ped.radius);
    ped.pos.y = groundHeight(ped.pos.x, ped.pos.z);
  }
  ped.group.rotation.y = ped.heading;
  if (d2 < FAR_ANIMATION_SKIP) animateFigure(ped.figure, dt, stepSpeed, pose);
}

/** Slow down and sidestep when the on-foot player stands in front; returns a speed multiplier. */
function avoidPlayer(ped, player, dt) {
  const dx = ped.pos.x - player.pos.x;
  const dz = ped.pos.z - player.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 1.1 || d < 0.01) return 1;
  const ahead = (-dx * Math.sin(ped.heading) - dz * Math.cos(ped.heading)) > 0;
  ped.pos.x += (dx / d) * 1.2 * dt;
  ped.pos.z += (dz / d) * 1.2 * dt;
  return ahead ? 0.35 : 1;
}

/** Run-over damage, dodging fast cars, and stepping around stopped ones. */
function checkVehicles(ped) {
  const px = ped.pos.x;
  const pz = ped.pos.z;
  for (const v of world.vehicles) {
    const dx = px - v.pos.x;
    const dz = pz - v.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 64) continue;
    const speed = Math.abs(v.speed);
    const hitRange = v.radius + 0.5;
    if (speed > 4 && d2 < hitRange * hitRange) {
      if (ped.hitCool > 0) continue;
      ped.hitCool = 0.5;
      const info = { byPlayer: v.driver === 'player', dirX: v.vel.x / speed, dirZ: v.vel.z / speed, cause: 'vehicle' };
      ped.takeDamage(speed * 4, info);
      ped.kx = v.vel.x * 0.5;
      ped.kz = v.vel.z * 0.5;
      if (ped.state === 'dead') return;
    } else if (speed > 8 && ped.state !== 'flee') {
      const d = Math.sqrt(d2) || 0.01;
      const heads = (dx * v.vel.x + dz * v.vel.z) / (d * speed);
      if (heads > 0.85) {
        // the car is coming straight at us: leap sideways, off its line
        const side = (dx * -v.vel.z + dz * v.vel.x) >= 0 ? 1 : -1;
        startFleeDir(ped, (-v.vel.z / speed) * side, (v.vel.x / speed) * side, 1.2);
      }
    } else if (speed <= 4 && d2 < (v.radius + 0.6) * (v.radius + 0.6) && ped.state === 'walk') {
      const d = Math.sqrt(d2) || 0.01;
      const push = v.radius + 0.6 - d;
      ped.pos.x += (dx / d) * push;
      ped.pos.z += (dz / d) * push;
    }
  }
}
