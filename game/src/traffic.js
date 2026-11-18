// traffic.js: civilian traffic for Port Solano. Parks cars along the kerbs, keeps a pool of
// AI-driven cars circulating the road grid near the player (lane keeping, junction turns,
// braking for whatever is ahead, panic at gunfire) and recycles cars that fall far behind.
import {
  world, on, BLOCKS, CELL, HALF, LANE, PARK, ROAD, roadCoord, lanePoint, angleDiff, clamp, rand, randInt, pick, chance, dist,
} from './world.js';
import { spawnVehicle, removeVehicle, placeVehicle, TRAFFIC_KINDS } from './vehicles.js';

const TRAFFIC_TARGET = 24;
const RECYCLE_DISTANCE = 235;
const LOOKAHEAD = 6.5;

const focusPoint = () => (world.player ? world.player.pos : { x: -300, z: 0 });

function isSpotFree(x, z, clearance) {
  for (const v of world.vehicles) if (Math.abs(v.pos.x - x) < clearance && Math.abs(v.pos.z - z) < clearance) return false;
  return true;
}

/** Line the kerbs of most road segments with parked cars that can be stolen. */
export function spawnParkedCars() {
  const kinds = ['sedan', 'sedan', 'pickup', 'van', 'sedan', 'sport', 'taxi', 'sedan'];
  const avoid = world.places.scoreCar;
  for (const axis of ['x', 'z']) {
    for (let i = 0; i <= BLOCKS; i += 1) {
      for (let j = 0; j < BLOCKS; j += 1) {
        const count = chance(0.5) ? randInt(1, 2) : 0;
        for (let n = 0; n < count; n += 1) {
          const along = roadCoord(j) + ROAD / 2 + 8 + rand(0, 44);
          const spot = lanePoint(axis, i, along, chance(0.5) ? 1 : -1, PARK);
          if (!isSpotFree(spot.x, spot.z, 7.5) || dist(spot.x, spot.z, avoid.x, avoid.z) < 12) continue;
          spawnVehicle(pick(kinds), spot.x, spot.z, spot.heading, { parked: true });
        }
      }
    }
  }
}

/** A random driving-lane spot between minDist and maxDist from a point, or null if none was free. */
function findTrafficSpot(cx, cz, minDist, maxDist) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const axis = chance(0.5) ? 'x' : 'z';
    const centre = axis === 'x' ? cx : cz;
    const other = axis === 'x' ? cz : cx;
    const road = clamp(Math.round((centre + HALF) / CELL) + randInt(-2, 2), 0, BLOCKS);
    const along = clamp(other + rand(-maxDist, maxDist), -HALF + 12, HALF - 12);
    // keep clear of junction boxes so a new car never lands mid-turn
    const toJunction = Math.abs(along - roadCoord(Math.round((along + HALF) / CELL)));
    if (toJunction < 14) continue;
    const dir = chance(0.5) ? 1 : -1;
    const spot = lanePoint(axis, road, along, dir);
    const d = dist(spot.x, spot.z, cx, cz);
    if (d < minDist || d > maxDist || !isSpotFree(spot.x, spot.z, 9)) continue;
    return { ...spot, axis, road, dir };
  }
  return null;
}

function assignTrafficRoute(vehicle, spot) {
  vehicle.driver = 'traffic';
  vehicle.parked = false;
  vehicle.ai = { axis: spot.axis, road: spot.road, dir: spot.dir, cruise: rand(8.5, 13), plan: null, blockedFor: 0, pushFor: 0, panic: 0 };
}

/** Add one AI car on a lane near a point. Returns it, or null when no free spot was found. */
export function spawnTrafficCar(cx, cz, minDist, maxDist) {
  const spot = findTrafficSpot(cx, cz, minDist, maxDist);
  if (!spot) return null;
  const vehicle = spawnVehicle(pick(TRAFFIC_KINDS), spot.x, spot.z, spot.heading, {});
  assignTrafficRoute(vehicle, spot);
  placeVehicle(vehicle, spot.x, spot.z, spot.heading, vehicle.ai.cruise * 0.8);
  return vehicle;
}

/** Fill the streets around a point with moving traffic (game start and staged screenshots). */
export function populateTrafficAround(cx, cz, count, minDist = 25, maxDist = 200) {
  let made = 0;
  for (let i = 0; i < count * 3 && made < count; i += 1) if (spawnTrafficCar(cx, cz, minDist, maxDist)) made += 1;
  return made;
}

/** Put an AI car at an exact lane position: used to compose screenshots. */
export function spawnTrafficCarAt(kind, axis, road, along, dir, color) {
  const spot = lanePoint(axis, road, along, dir);
  const vehicle = spawnVehicle(kind, spot.x, spot.z, spot.heading, { color });
  assignTrafficRoute(vehicle, { axis, road, dir });
  placeVehicle(vehicle, spot.x, spot.z, spot.heading, vehicle.ai.cruise * 0.8);
  return vehicle;
}

/** Pick straight, right or left at the junction ahead, only where the grid continues. */
function planJunctionTurn(ai, junction, lateralRoad) {
  const options = [];
  const ahead = junction + ai.dir;
  if (ahead >= 0 && ahead <= BLOCKS) options.push('straight', 'straight');
  const rightDir = ai.axis === 'x' ? -ai.dir : ai.dir;
  for (const [name, newDir] of [['right', rightDir], ['left', -rightDir]]) {
    const next = lateralRoad + newDir;
    if (next >= 0 && next <= BLOCKS) options.push(name);
  }
  const choice = pick(options);
  if (choice === 'straight') return { junction, choice };
  const newDir = choice === 'right' ? rightDir : -rightDir;
  return { junction, choice, newAxis: ai.axis === 'x' ? 'z' : 'x', newDir, switchAt: choice === 'right' ? LANE + 4.6 : 4.6 - LANE };
}

/** Is something in this car's path within its stopping distance? */
function isPathBlocked(vehicle) {
  const fx = Math.sin(vehicle.heading);
  const fz = Math.cos(vehicle.heading);
  const reach = 5.5 + Math.abs(vehicle.speed) * 0.85;
  for (const other of world.vehicles) {
    if (other === vehicle) continue;
    const dx = other.pos.x - vehicle.pos.x;
    const dz = other.pos.z - vehicle.pos.z;
    if (Math.abs(dx) > reach + 3 || Math.abs(dz) > reach + 3) continue;
    const along = dx * fx + dz * fz;
    if (along > 0.5 && along < reach && Math.abs(dx * -fz + dz * fx) < 1.7) return true;
  }
  const p = world.player;
  if (p && !p.vehicle) {
    const dx = p.pos.x - vehicle.pos.x;
    const dz = p.pos.z - vehicle.pos.z;
    const along = dx * fx + dz * fz;
    if (along > 0.5 && along < reach && Math.abs(dx * -fz + dz * fx) < 1.4) return true;
  }
  return false;
}

function driveTrafficCar(vehicle, dt) {
  const ai = vehicle.ai;
  const onX = ai.axis === 'x';
  const along = onX ? vehicle.pos.z : vehicle.pos.x;
  const laneCentre = onX ? roadCoord(ai.road) - ai.dir * LANE : roadCoord(ai.road) + ai.dir * LANE;
  // the junction ahead and how far its centre is
  const junction = clamp(ai.dir > 0 ? Math.ceil((along + HALF - 0.01) / CELL) : Math.floor((along + HALF + 0.01) / CELL), 0, BLOCKS);
  const toJunction = (roadCoord(junction) - along) * ai.dir;
  if (toJunction < 18 && toJunction > 0 && (!ai.plan || ai.plan.junction !== junction || ai.plan.axis !== ai.axis)) {
    ai.plan = planJunctionTurn(ai, junction, ai.road);
    ai.plan.axis = ai.axis;
  }
  let turning = false;
  if (ai.plan && ai.plan.axis === ai.axis && ai.plan.choice !== 'straight' && ai.plan.junction === junction) {
    turning = true;
    if (toJunction <= ai.plan.switchAt) {
      ai.axis = ai.plan.newAxis;
      ai.road = junction;
      ai.dir = ai.plan.newDir;
      ai.plan = null;
      return;
    }
  }
  // steer for a point a few metres down the lane
  const aheadAlong = along + ai.dir * LOOKAHEAD;
  const tx = onX ? laneCentre : aheadAlong;
  const tz = onX ? aheadAlong : laneCentre;
  const wantHeading = Math.atan2(tx - vehicle.pos.x, tz - vehicle.pos.z);
  const error = angleDiff(wantHeading, vehicle.heading);
  vehicle.input.steer = clamp(-error * 2.4, -1, 1);

  let targetSpeed = ai.panic > 0 ? 19 : ai.cruise;
  if (turning && toJunction < 17) targetSpeed = Math.min(targetSpeed, 5.2);
  if (Math.abs(error) > 0.5) targetSpeed = Math.min(targetSpeed, 4.5);
  ai.panic -= dt;
  if (ai.pushFor > 0) ai.pushFor -= dt;
  else if (isPathBlocked(vehicle)) {
    targetSpeed = 0;
    ai.blockedFor += dt;
    if (ai.blockedFor > 7) { ai.blockedFor = 0; ai.pushFor = 1.6; }
  } else ai.blockedFor = Math.max(0, ai.blockedFor - dt * 2);
  const speedError = targetSpeed - vehicle.speed;
  vehicle.input.throttle = clamp(speedError * 0.6, -1, 0.8);
  vehicle.input.handbrake = targetSpeed === 0 && vehicle.speed < 1.5;
}

/** Start traffic: park cars, fill the nearby streets, and react to gunfire. */
export function initTraffic() {
  spawnParkedCars();
  on('shot', ({ x, z }) => {
    for (const v of world.vehicles) if (v.driver === 'traffic' && v.ai && dist(v.pos.x, v.pos.z, x, z) < 45) v.ai.panic = 6;
  });
}

/** Drive every AI car, then top up and recycle the pool around the player. */
export function updateTraffic(dt) {
  const focus = focusPoint();
  let moving = 0;
  for (let i = world.vehicles.length - 1; i >= 0; i -= 1) {
    const v = world.vehicles[i];
    if (v.driver === 'traffic') {
      if (v.dead) { v.driver = null; continue; }
      moving += 1;
      driveTrafficCar(v, dt);
      if (world.mode !== 'shot' && dist(v.pos.x, v.pos.z, focus.x, focus.z) > RECYCLE_DISTANCE) {
        const spot = findTrafficSpot(focus.x, focus.z, 120, 200);
        if (spot) { assignTrafficRoute(v, spot); placeVehicle(v, spot.x, spot.z, spot.heading, v.ai.cruise * 0.8); v.hp = v.spec.hp; }
      }
    } else if (!v.driver && !v.parked && !v.marked && !v.isPolice && dist(v.pos.x, v.pos.z, focus.x, focus.z) > 210) {
      // abandoned or wrecked cars are cleared once out of sight
      removeVehicle(v);
    } else if (v.wrecked && !v.marked && world.time - v.lastCrash > 25 && dist(v.pos.x, v.pos.z, focus.x, focus.z) > 60) {
      removeVehicle(v);
    }
  }
  if (world.mode !== 'shot' && moving < TRAFFIC_TARGET) spawnTrafficCar(focus.x, focus.z, 120, 200);
}
