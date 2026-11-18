// world.js: the shared state and rules of Port Solano. Every system imports this one object:
// the road-grid maths, the entity lists, a seeded RNG, an event bus, static collision,
// and the money / health / crime-heat rules that drive the wanted level.

// ---- City grid -----------------------------------------------------------------------------
// 9 north-south roads and 9 east-west roads bound 8x8 blocks. Road i runs along
// x = roadCoord(i) (or z = roadCoord(i)). West of road 0 (Marea Boulevard) is promenade,
// beach and the ocean; the sun sets there. Ground is the XZ plane, +Y up.
export const BLOCKS = 8;
export const BLOCK = 60; // block edge, sidewalk included
export const ROAD = 16; // kerb to kerb: two driving lanes and two parking strips
export const CELL = BLOCK + ROAD;
export const HALF = (BLOCKS * CELL) / 2; // 304: road 0 at -304, road 8 at +304
export const LANE = 2.3; // driving-lane centre, metres right of the road centreline
export const PARK = 6.3; // parking-strip centre
export const SIDEWALK = 4; // sidewalk width, inside the block edge
export const CITY_MIN = -HALF - ROAD / 2;
export const CITY_MAX = HALF + ROAD / 2;

export const roadCoord = (i) => -HALF + i * CELL;
export const nearestRoadIndex = (c) => Math.max(0, Math.min(BLOCKS, Math.round((c + HALF) / CELL)));
/** Distance from coordinate c to the nearest road centreline on that axis. */
export const distToRoadLine = (c) => Math.abs(c - roadCoord(nearestRoadIndex(c)));
/** True when (x, z) is on asphalt (inside the city and within a road's width). */
export function isOnRoad(x, z) {
  if (x < CITY_MIN || x > CITY_MAX || z < CITY_MIN || z > CITY_MAX) return false;
  return distToRoadLine(x) <= ROAD / 2 || distToRoadLine(z) <= ROAD / 2;
}
/** Height of the ground: 0 on asphalt, a kerb's 0.15 on sidewalks and lots, sloping down the beach. */
export function groundHeight(x, z) {
  if (x < CITY_MIN - 10) return 0.15 - (CITY_MIN - 10 - x) * 0.016;
  return isOnRoad(x, z) ? 0 : 0.15;
}
/** Heading convention everywhere: forward = (sin h, cos h) in (x, z); mesh.rotation.y = h. */
export const forwardOf = (h) => ({ x: Math.sin(h), z: Math.cos(h) });
/** The four axis headings a road vehicle can hold: +z, +x, -z, -x. */
export const AXIS_HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/**
 * A point in a driving lane: road `i` on `axis` ('x' = the road runs north-south along x = roadCoord(i),
 * 'z' = it runs east-west along z = roadCoord(i)), at coordinate `along` on the other axis, for a car
 * travelling in the positive (dir = 1) or negative (dir = -1) direction. Right-hand traffic.
 */
export function lanePoint(axis, i, along, dir, offset = LANE) {
  const c = roadCoord(i);
  // right of forward (fx, fz) is (-fz, fx)
  if (axis === 'x') return { x: c - dir * offset, z: along, heading: dir > 0 ? 0 : Math.PI };
  return { x: along, z: c + dir * offset, heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

// ---- Seeded randomness -----------------------------------------------------------------------
/** A small deterministic generator (mulberry32): the same seed always gives the same city and scene. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Crime rules ---------------------------------------------------------------------------
/** Heat added per crime; the wanted level is the highest star whose threshold the heat reached. */
export const CRIME_HEAT = {
  carTheft: 1.0, // stealing an occupied or watched car
  hitCar: 0.35, // ramming traffic
  hitPed: 1.2, // running someone over or punching them
  killPed: 1.6,
  gunfire: 1.0, // firing in public
  hitCop: 2.0, // ramming or striking police
  killCop: 3.0,
};
export const STAR_HEAT = [0, 1, 2.2, 3.6, 5.2, 7]; // heat needed for 0..5 stars
export const MAX_STARS = 5;

// ---- The world object ------------------------------------------------------------------------
export const world = {
  // rendering (set by main.js)
  scene: null,
  camera: null,
  renderer: null,
  // run state
  mode: 'title', // 'title' | 'intro' | 'play' | 'paused' | 'shot'
  time: 0, // simulated seconds
  seed: 1,
  rng: makeRng(1),
  // entities (each module owns creating/removing its own)
  player: null, // see player.js
  vehicles: [], // see vehicles.js
  peds: [], // see pedestrians.js
  pickups: [], // see pickups in player.js
  // static collision: axis-aligned boxes { minX, maxX, minZ, maxZ, h } from city.js
  colliders: [],
  // wanted state: `heat` is the truth, `level` derives from it; police.js owns decay and `seen`
  wanted: { level: 0, heat: 0, seen: false, hiddenFor: 0, flash: 0 },
  // mission state shown by the HUD (owned by missions.js)
  mission: { id: null, title: '', objective: 'Explore Port Solano', timer: -1, done: [] },
  /** Current objective marker for the 3D beacon and the minimap, or null: { x, z, label, color }. */
  marker: null,
  /** Named places other systems refer to (filled by city.js): garage, hideout, safehouse, spawn. */
  places: {},
  /** Sound hook; audio.js replaces it. world.sfx('gunshot', { volume }) */
  sfx: () => {},
  listeners: new Map(),
};

export function reseed(seed) {
  world.seed = seed >>> 0;
  world.rng = makeRng(world.seed);
}
export const rand = (a = 1, b) => (b === undefined ? world.rng() * a : a + world.rng() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(world.rng() * arr.length)];
export const chance = (p) => world.rng() < p;

// ---- Events ----------------------------------------------------------------------------------
// Names in use: 'crime' { type, x, z } · 'wantedChanged' { level, previous } · 'toast' { title, sub, kind }
// 'enterVehicle' { vehicle, stolen } · 'exitVehicle' { vehicle } · 'shot' { x, z, dirX, dirZ, by }
// 'pedHit' { ped, by } · 'vehicleCrash' { vehicle, other, impact } · 'pickup' { kind, amount }
// 'busted' · 'wasted' · 'respawn' · 'missionStart' { id } · 'missionComplete' { id, reward }
// 'missionFailed' { id, reason } · 'money' { amount }
export function on(name, fn) {
  if (!world.listeners.has(name)) world.listeners.set(name, []);
  world.listeners.get(name).push(fn);
}
export function emit(name, data = {}) {
  const list = world.listeners.get(name);
  if (list) for (const fn of list) fn(data);
}
/** A banner line on the HUD: kind is 'info' | 'mission' | 'success' | 'fail' | 'warn'. */
export const toast = (title, sub = '', kind = 'info') => emit('toast', { title, sub, kind });

// ---- Static collision ------------------------------------------------------------------------
const HASH = 40;
const buckets = new Map();
const keyOf = (cx, cz) => cx * 4096 + cz;
/** Register a solid box (a building, a wall, a planter). h is its height, for line-of-sight. */
export function addCollider(minX, minZ, maxX, maxZ, h = 10) {
  const box = { minX, minZ, maxX, maxZ, h };
  world.colliders.push(box);
  for (let cx = Math.floor(minX / HASH); cx <= Math.floor(maxX / HASH); cx += 1) {
    for (let cz = Math.floor(minZ / HASH); cz <= Math.floor(maxZ / HASH); cz += 1) {
      const k = keyOf(cx, cz);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(box);
    }
  }
  return box;
}
const EMPTY = [];
export const collidersAt = (x, z) => buckets.get(keyOf(Math.floor(x / HASH), Math.floor(z / HASH))) || EMPTY;

const hit = { hit: false, nx: 0, nz: 0 };
/**
 * Push a circle (pos has .x/.z, radius r) out of every solid box it overlaps and keep it inside the
 * map. Returns a shared { hit, nx, nz } with the last contact normal; read it before the next call.
 */
export function resolveCircle(pos, r) {
  hit.hit = false;
  for (let pass = 0; pass < 2; pass += 1) {
    const list = collidersAt(pos.x, pos.z);
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      const px = clamp(pos.x, b.minX, b.maxX);
      const pz = clamp(pos.z, b.minZ, b.maxZ);
      let dx = pos.x - px;
      let dz = pos.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        dx /= d;
        dz /= d;
        pos.x = px + dx * r;
        pos.z = pz + dz * r;
      } else {
        // centre is inside the box: leave by the nearest face
        const l = pos.x - b.minX;
        const rr = b.maxX - pos.x;
        const t = pos.z - b.minZ;
        const bt = b.maxZ - pos.z;
        const m = Math.min(l, rr, t, bt);
        dx = 0;
        dz = 0;
        if (m === l) { pos.x = b.minX - r; dx = -1; } else if (m === rr) { pos.x = b.maxX + r; dx = 1; } else if (m === t) { pos.z = b.minZ - r; dz = -1; } else { pos.z = b.maxZ + r; dz = 1; }
      }
      hit.hit = true;
      hit.nx = dx;
      hit.nz = dz;
    }
  }
  // map bounds: the sea wall to the west, the outer ring elsewhere
  const lo = CITY_MIN - 2;
  const hi = CITY_MAX + 2;
  if (pos.x < WEST_LIMIT + r) { pos.x = WEST_LIMIT + r; hit.hit = true; hit.nx = 1; hit.nz = 0; }
  if (pos.x > hi - r) { pos.x = hi - r; hit.hit = true; hit.nx = -1; hit.nz = 0; }
  if (pos.z < lo + r) { pos.z = lo + r; hit.hit = true; hit.nx = 0; hit.nz = 1; }
  if (pos.z > hi - r) { pos.z = hi - r; hit.hit = true; hit.nx = 0; hit.nz = -1; }
  return hit;
}
/** The west edge anything can reach: the far side of the beach, at the waterline. */
export const WEST_LIMIT = CITY_MIN - 46;

/** True when no building stands between two ground points (eye height ~1.5 m). */
export function lineOfSight(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(d / 6));
  for (let s = 1; s < steps; s += 1) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const list = collidersAt(x, z);
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      if (b.h > 2 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return false;
    }
  }
  return true;
}

// ---- Wanted, money and health rules ------------------------------------------------------------
export function starsForHeat(heat) {
  let level = 0;
  for (let s = 1; s <= MAX_STARS; s += 1) if (heat >= STAR_HEAT[s]) level = s;
  return level;
}
function syncWantedLevel() {
  const w = world.wanted;
  const previous = w.level;
  w.level = starsForHeat(w.heat);
  if (w.level !== previous) {
    w.flash = 1.2;
    emit('wantedChanged', { level: w.level, previous });
  }
}
/** Raise or lower crime heat; the wanted stars follow. */
export function addHeat(amount) {
  const w = world.wanted;
  w.heat = clamp(w.heat + amount, 0, STAR_HEAT[MAX_STARS] + 0.8);
  if (amount > 0) w.hiddenFor = 0;
  syncWantedLevel();
}
/** Force an exact star count (missions, screenshots, busted/wasted reset). */
export function setWanted(stars) {
  const w = world.wanted;
  w.heat = stars <= 0 ? 0 : STAR_HEAT[clamp(stars, 0, MAX_STARS)] + 0.3;
  w.hiddenFor = 0;
  syncWantedLevel();
}
/** Report a crime at a place. Systems call this; it adds the heat and tells listeners. */
export function reportCrime(type, x, z) {
  const heat = CRIME_HEAT[type] ?? 0.5;
  addHeat(heat);
  emit('crime', { type, x, z });
}
export function addMoney(amount) {
  const p = world.player;
  if (!p) return;
  p.money = Math.max(0, Math.round(p.money + amount));
  emit('money', { amount });
}
/** Hurt the player: armor soaks 70% while it lasts. At 0 health the player is wasted. */
export function damagePlayer(amount, cause = 'hit') {
  const p = world.player;
  if (!p || p.state === 'wasted' || p.state === 'busted' || world.mode === 'shot') return;
  let left = amount;
  if (p.armor > 0) {
    const soaked = Math.min(p.armor, amount * 0.7);
    p.armor -= soaked;
    left -= soaked;
  }
  p.health = Math.max(0, p.health - left);
  p.hurtFlash = 1;
  if (p.health <= 0) {
    p.state = 'wasted';
    p.stateTime = 0;
    emit('wasted', { cause });
  }
}
