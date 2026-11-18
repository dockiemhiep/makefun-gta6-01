// city.js: generates Port Solano, an 8x8-block coastal neighbourhood, from a fixed seed.
// Roads with markings and crosswalks, pastel beach hotels, midtown shops, glass downtown towers,
// docks, neon signs, lit windows, palms, streetlights, the promenade, beach, pier and Ferris wheel.
// It also registers building colliders and the named places missions use.
import * as THREE from '../vendor/three.module.min.js';
import {
  world, BLOCKS, BLOCK, ROAD, CELL, HALF, CITY_MIN, CITY_MAX, WEST_LIMIT, roadCoord, nearestRoadIndex, addCollider, makeRng, clamp,
} from './world.js';
import { GeometryBatch, canvasTexture, makeGlowPoints, glowTexture, placeMatrix } from './meshkit.js';

export const STREETS_NS = ['Marea Blvd', 'Coral Ave', 'Lantern Ave', 'Sabal Ave', 'Meridian Ave', 'Cobalt Ave', 'Foundry Ave', 'Tern Ave', 'Eastline Rd'];
export const STREETS_EW = ['Northgate Rd', 'Vesper St', 'Orchid St', 'Bolero St', 'Sunset Strip', 'Gull St', 'Canal St', 'Harbor St', 'Dockside St'];

const FLOOR_H = 3.4;
const SHOP_H = 4.4;
const TILE_W = 25.6; // one facade texture tile: 8 windows wide, 8 floors tall
const PASTELS = [0xf7a8bd, 0x7fded3, 0xf9e2b8, 0xff9a78, 0xc9b0f5, 0x9fe6b4, 0xfdd06a, 0x8fc9f7, 0xffffff];
const BRICKS = [0xd9b79c, 0xc98f74, 0xe0cdb6, 0xb9a08f, 0xcfa3a0, 0xa9b7c2];
const GLASS_TINTS = [0xa8e4ea, 0xffd0aa, 0xcdbcff, 0xe6f2ff, 0x9fd0ff, 0xffb8c9];
const NEONS = [0xff3d9a, 0x25f0e0, 0xff8a1f, 0xffe14a, 0xb46bff];
const AWNINGS = [0xff4f8b, 0x1fc9c0, 0xff8c2e, 0xfff1d6, 0xf7c531];
const SIGN_WORDS = ['HOTEL MAREA', 'TIDE BAR', 'CLUB NOVA', 'LUCKY 9', 'ARCADE', 'TACOS 24H', 'PAWN + LOAN', 'SOLANO SURF',
  'NEON TIDE', 'LIQUOR', 'DINER', 'MOTEL', 'PALMERA', 'KARAOKE', "BENNY'S GARAGE", 'PSPD PRECINCT'];
const BLADE_WORDS = ['HOTEL', 'MAREA', 'NOVA', 'BAR', 'CLUB', 'MOTEL', 'SURF', 'TIDE'];

const city = { wheel: null, neonMaterial: null, time: 0 };
let rng = makeRng(20261118);
const rnd = (a = 1, b) => (b === undefined ? rng() * a : a + rng() * (b - a));
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const pickOne = (arr) => arr[Math.floor(rng() * arr.length)];
const maybe = (p) => rng() < p;

/** The rectangle of block (bi, bj), sidewalk included: bi counts west to east, bj north to south. */
export function blockRect(bi, bj) {
  return { x0: roadCoord(bi) + ROAD / 2, x1: roadCoord(bi + 1) - ROAD / 2, z0: roadCoord(bj) + ROAD / 2, z1: roadCoord(bj + 1) - ROAD / 2 };
}
const blockIndexOf = (c) => clamp(Math.floor((c + HALF) / CELL), 0, BLOCKS - 1);

/** District of a block: sets its building style, heights and how much neon it carries. */
export function districtOfBlock(bi, bj) {
  if (bi <= 1) return 'beach';
  if (bj >= 6) return 'docks';
  if (bi >= 3 && bi <= 6 && bj >= 2 && bj <= 5) return 'downtown';
  return 'midtown';
}
const DISTRICT_NAMES = { beach: 'Marea Beach', docks: 'The Docks', downtown: 'Downtown', midtown: 'Old Solano', coast: 'Solano Shore' };
/** Display name of the district at a point, for the HUD. */
export function districtNameAt(x, z) {
  if (x < CITY_MIN) return DISTRICT_NAMES.coast;
  return DISTRICT_NAMES[districtOfBlock(blockIndexOf(x), blockIndexOf(z))];
}
/** Display name of the nearest street at a point, for the HUD. */
export function streetNameAt(x, z) {
  const i = nearestRoadIndex(x);
  const j = nearestRoadIndex(z);
  return Math.abs(x - roadCoord(i)) < Math.abs(z - roadCoord(j)) ? STREETS_NS[i] : STREETS_EW[j];
}

// ---- Procedural textures ---------------------------------------------------------------------
function drawFacadePair(kind) {
  const S = 512;
  const N = 8;
  const cell = S / N;
  const lit = [];
  const local = makeRng(kind.length * 977 + 5);
  const columnTones = Array.from({ length: N }, () => local());
  const map = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = kind === 'glass' ? '#31485a' : kind === 'brick' ? '#efe6dc' : '#fbf6ee';
    ctx.fillRect(0, 0, S, S);
    if (kind === 'brick') {
      for (let i = 0; i < 2600; i += 1) {
        ctx.fillStyle = `rgba(${local() < 0.5 ? '90,60,50' : '255,240,225'},${0.05 + local() * 0.08})`;
        ctx.fillRect(local() * S, Math.floor(local() * 64) * 8, 14, 7);
      }
    }
    for (let fy = 0; fy < N; fy += 1) {
      for (let fx = 0; fx < N; fx += 1) {
        const x = fx * cell;
        const y = fy * cell;
        let wx = x + 10; let wy = y + 12; let ww = 44; let wh = 38;
        if (kind === 'glass') { wx = x + 2; wy = y + 2; ww = 60; wh = 60; }
        if (kind === 'brick') { wx = x + 17; wy = y + 13; ww = 30; wh = 38; }
        const isLit = local() < (kind === 'glass' ? 0.1 : 0.28);
        const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
        if (isLit) {
          g.addColorStop(0, '#ffe7b8'); g.addColorStop(1, '#ffc27a');
        } else if (kind === 'glass') {
          // curtain wall: each column of panes keeps one tone so towers read as glass, not a checkerboard
          const tone = columnTones[fx];
          g.addColorStop(0, tone < 0.5 ? '#1d5674' : '#236281'); g.addColorStop(1, tone < 0.5 ? '#3f8aa3' : '#4a96ad');
        } else {
          // unlit glass mirrors the sky: deep teal above, a little dusk warmth below
          g.addColorStop(0, '#1f5a78'); g.addColorStop(1, local() < 0.2 ? '#8a6f78' : '#3a7f93');
        }
        ctx.fillStyle = g;
        ctx.fillRect(wx, wy, ww, wh);
        if (kind !== 'glass') {
          ctx.fillStyle = 'rgba(40,30,40,0.55)';
          ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(wx - 3, wy + wh, ww + 6, 4); // sill
        }
        lit.push({ wx, wy, ww, wh, isLit, tone: local() });
      }
      if (kind === 'deco') {
        ctx.fillStyle = 'rgba(0,0,0,0.13)';
        ctx.fillRect(0, fy * cell + cell - 5, S, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(0, fy * cell + cell - 2, S, 2);
      }
    }
  }, { repeat: true });
  const emissive = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    for (const w of lit) {
      if (!w.isLit) continue;
      ctx.fillStyle = w.tone < 0.08 ? '#ff5fa8' : w.tone < 0.16 ? '#46e6d6' : w.tone < 0.55 ? '#ffb057' : '#ffd58a';
      ctx.fillRect(w.wx, w.wy, w.ww, w.wh);
    }
  }, { repeat: true });
  return { map, emissive };
}

function drawShopPair() {
  const W = 1024;
  const H = 128;
  const local = makeRng(4242);
  const shops = [];
  const map = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#2a2430';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 8; i += 1) {
      const x = i * 128;
      const glow = pickFrom(local, ['#ffcf8a', '#ffb36b', '#ff7fb5', '#5fe8dc', '#fff0c8', '#ffd76b']);
      ctx.fillStyle = '#17131d';
      ctx.fillRect(x + 4, 30, 120, 94);
      const g = ctx.createLinearGradient(0, 34, 0, 120);
      g.addColorStop(0, glow); g.addColorStop(1, '#3b2b3a');
      ctx.fillStyle = g;
      ctx.fillRect(x + 8, 34, 78, 82);
      ctx.fillStyle = 'rgba(20,10,25,0.75)';
      for (let k = 0; k < 4; k += 1) ctx.fillRect(x + 14 + k * 18, 70 + local() * 20, 12, 46); // goods in the window
      ctx.fillStyle = '#3c3140';
      ctx.fillRect(x + 92, 44, 28, 80); // door
      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x + 96, 50, 20, 40);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#efe6dc';
      ctx.fillRect(x, 0, 128, 6);
      shops.push({ x, glow });
    }
  }, { repeat: true });
  const emissive = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const s of shops) {
      const g = ctx.createLinearGradient(0, 34, 0, 120);
      g.addColorStop(0, s.glow); g.addColorStop(1, '#000');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(s.x + 8, 34, 78, 82);
      ctx.fillRect(s.x + 96, 50, 20, 40);
    }
  }, { repeat: true });
  return { map, emissive };
}
const pickFrom = (r, arr) => arr[Math.floor(r() * arr.length)];
const cssColor = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/** One atlas with 16 horizontal neon signs (left half) and 8 vertical blade signs (right half). */
function drawNeonSignAtlas() {
  return canvasTexture(2048, 1024, (ctx) => {
    ctx.clearRect(0, 0, 2048, 1024);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    SIGN_WORDS.forEach((word, i) => {
      const x = (i % 2) * 512;
      const y = Math.floor(i / 2) * 128;
      const color = cssColor(NEONS[i % NEONS.length]);
      ctx.fillStyle = 'rgba(18,8,30,0.92)';
      ctx.fillRect(x + 6, y + 8, 500, 112);
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.strokeRect(x + 14, y + 16, 484, 96);
      let size = 74;
      ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      while (ctx.measureText(word).width > 440) { size -= 4; ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`; }
      ctx.fillStyle = color;
      ctx.fillText(word, x + 256, y + 68);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillText(word, x + 256, y + 68);
    });
    BLADE_WORDS.forEach((word, i) => {
      const x = 1024 + i * 128;
      const color = cssColor(NEONS[(i + 1) % NEONS.length]);
      ctx.fillStyle = 'rgba(18,8,30,0.94)';
      ctx.fillRect(x + 8, 6, 112, 1012);
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.strokeRect(x + 16, 14, 96, 996);
      const step = Math.min(170, 940 / word.length);
      ctx.font = '900 96px "Arial Black", "Helvetica Neue", Arial, sans-serif';
      const top = 512 - (step * (word.length - 1)) / 2;
      for (let k = 0; k < word.length; k += 1) {
        ctx.shadowBlur = 16;
        ctx.fillStyle = color;
        ctx.fillText(word[k], x + 64, top + k * step);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillText(word[k], x + 64, top + k * step);
      }
    });
  });
}

function noiseTexture(base, speck, count, size = 256) {
  const local = makeRng(count);
  return canvasTexture(size, size, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < count; i += 1) {
      ctx.fillStyle = `rgba(${speck},${local() * 0.16})`;
      const s = 1 + local() * 3;
      ctx.fillRect(local() * size, local() * size, s, s);
    }
  }, { repeat: true });
}

function pavingTexture() {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#d9c7b4';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(90,70,70,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 2; i += 1) {
      ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(128, i * 64); ctx.stroke();
    }
  }, { repeat: true });
}

// ---- Build state -----------------------------------------------------------------------------
let batches;
let glowEntries;
let lampPlacements;
let palmPlacements;

/** Walk one side of a rectangle with the outside on the left (see GeometryBatch.addWallQuad). */
function sideSegment(r, side, out = 0) {
  if (side === 'n') return [r.x0, r.z0 - out, r.x1, r.z0 - out];
  if (side === 's') return [r.x1, r.z1 + out, r.x0, r.z1 + out];
  if (side === 'e') return [r.x1 + out, r.z0, r.x1 + out, r.z1];
  return [r.x0 - out, r.z1, r.x0 - out, r.z0];
}

function addGlow(x, y, z, hex, strength = 1) {
  const c = new THREE.Color(hex);
  glowEntries.push([x, y, z, c.r * strength, c.g * strength, c.b * strength]);
}

/** A horizontal neon sign from the atlas on a wall side, plus its bloom. */
function addNeonSign(r, side, signIndex, width, y, t = 0.5) {
  const [ax, az, bx, bz] = sideSegment(r, side, 0.35);
  const len = Math.hypot(bx - ax, bz - az);
  if (len < width + 1) return;
  const mid = clamp(t, (width / 2 + 0.5) / len, 1 - (width / 2 + 0.5) / len);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const cx = ax + ux * len * mid;
  const cz = az + uz * len * mid;
  const u0 = (signIndex % 2) * 0.25;
  const v1 = 1 - Math.floor(signIndex / 2) / 8;
  const h = width / 4;
  batches.signs.addWallQuad(cx - ux * width / 2, cz - uz * width / 2, cx + ux * width / 2, cz + uz * width / 2, y, y + h, 0xffffff, u0 + 0.25, v1 - 0.125, u0, v1);
  addGlow(cx, y + h / 2, cz, NEONS[signIndex % NEONS.length], 0.55);
}

/** A vertical two-faced blade sign standing off a wall near one end of a side. */
function addBladeSign(r, side, bladeIndex, y0, height) {
  const [ax, az, bx, bz] = sideSegment(r, side, 0);
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  // outward normal is to the left of the walk: (uz, -ux)
  const nx = uz;
  const nz = -ux;
  const px = ax + ux * 2;
  const pz = az + uz * 2;
  const w = height / 8;
  const u0 = 0.5 + bladeIndex * 0.0625;
  const x0 = px + nx * 0.3; const z0 = pz + nz * 0.3; const x1 = px + nx * (0.3 + w); const z1 = pz + nz * (0.3 + w);
  batches.signs.addWallQuad(x0, z0, x1, z1, y0, y0 + height, 0xffffff, u0 + 0.0625, 0, u0, 1);
  batches.signs.addWallQuad(x1, z1, x0, z0, y0, y0 + height, 0xffffff, u0 + 0.0625, 0, u0, 1);
  addGlow((x0 + x1) / 2, y0 + height * 0.5, (z0 + z1) / 2, NEONS[(bladeIndex + 1) % NEONS.length], 0.7);
}

/**
 * One building: textured walls with lit windows, an optional shopfront band, roof clutter,
 * neon trim, signs on its street sides, and a collider.
 */
function addBuilding({ x0, z0, x1, z1, floors, style, tint, shop = true, streetSides = [], neon = 0.4, signChance = 0.5, signIndex = -1 }) {
  const r = { x0, z0, x1, z1 };
  const base = 0.15;
  const bodyBase = shop ? SHOP_H : base;
  const top = bodyBase + floors * FLOOR_H;
  const batch = batches[style];
  for (const side of ['n', 's', 'e', 'w']) {
    const [ax, az, bx, bz] = sideSegment(r, side);
    const len = Math.hypot(bx - ax, bz - az);
    const u0 = rndInt(0, 7) / 8;
    const v0 = rndInt(0, 7) / 8;
    batch.addWallQuad(ax, az, bx, bz, bodyBase, top, tint, u0, v0, u0 + len / TILE_W, v0 + floors / 8);
    if (shop) {
      const s0 = rndInt(0, 7) / 8;
      batches.shop.addWallQuad(ax, az, bx, bz, base, SHOP_H, 0xffffff, s0, 0, s0 + len / 32, 1);
    }
  }
  // roof, parapet and clutter
  const roofColor = style === 'glass' ? 0x39404e : 0x4a4148;
  batches.solid.addGroundQuad(x0, z0, x1, z1, top, roofColor);
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const trim = new THREE.Color(tint).multiplyScalar(0.82).getHex();
  batches.solid.addBox(cx, top + 0.4, z0 + 0.2, w, 0.8, 0.4, trim).addBox(cx, top + 0.4, z1 - 0.2, w, 0.8, 0.4, trim)
    .addBox(x0 + 0.2, top + 0.4, cz, 0.4, 0.8, d, trim).addBox(x1 - 0.2, top + 0.4, cz, 0.4, 0.8, d, trim);
  const units = rndInt(1, 3);
  for (let i = 0; i < units; i += 1) {
    const s = rnd(1.6, 3.4);
    batches.solid.addBox(cx + rnd(-w / 3, w / 3), top + s * 0.35, cz + rnd(-d / 3, d / 3), s, s * 0.7, s * 1.2, 0x8c8791);
  }
  if (floors >= 14) {
    const mast = rnd(8, 18);
    batches.solid.addBox(cx, top + mast / 2, cz, 0.35, mast, 0.35, 0x6c6570);
    addGlow(cx, top + mast, cz, 0xff3030, 1.2);
  }
  // neon trim around the crown
  if (maybe(neon)) {
    const color = pickOne(NEONS);
    const y = top - 0.5;
    batches.neon.addBox(cx, y, z0 - 0.12, w + 0.3, 0.32, 0.22, color).addBox(cx, y, z1 + 0.12, w + 0.3, 0.32, 0.22, color)
      .addBox(x0 - 0.12, y, cz, 0.22, 0.32, d + 0.3, color).addBox(x1 + 0.12, y, cz, 0.22, 0.32, d + 0.3, color);
    if (floors >= 14) for (const [gx, gz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) addGlow(gx, y, gz, color, 0.5);
  }
  // street-facing dressing: signs, blades, awnings
  for (const side of streetSides) {
    const along = side === 'n' || side === 's' ? w : d;
    if (shop && (signIndex >= 0 || maybe(signChance))) {
      addNeonSign(r, side, signIndex >= 0 ? signIndex : rndInt(0, 13), Math.min(9, along - 2), SHOP_H - 0.9, rnd(0.3, 0.7));
    }
    if (shop && floors >= 3 && maybe(signChance * 0.55)) addBladeSign(r, side, rndInt(0, 7), SHOP_H + 1, Math.min(11, floors * FLOOR_H - 2));
    if (shop && maybe(0.6)) {
      const color = pickOne(AWNINGS);
      const span = along * rnd(0.3, 0.5);
      const off = rnd(-along * 0.2, along * 0.2);
      if (side === 'n') batches.solid.addBox(cx + off, 3.1, z0 - 0.8, span, 0.14, 1.7, color, 0, -0.3);
      if (side === 's') batches.solid.addBox(cx + off, 3.1, z1 + 0.8, span, 0.14, 1.7, color, 0, 0.3);
      if (side === 'w') batches.solid.addBox(x0 - 0.8, 3.1, cz + off, 1.7, 0.14, span, color, 0, 0, -0.3);
      if (side === 'e') batches.solid.addBox(x1 + 0.8, 3.1, cz + off, 1.7, 0.14, span, color, 0, 0, 0.3);
    }
  }
  addCollider(x0, z0, x1, z1, top);
  return { top, cx, cz };
}

function addPalm(x, z, scale = 1, solid = true) {
  palmPlacements.push({ x, z, scale, rot: rnd(Math.PI * 2) });
  if (solid) addCollider(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 1);
}

/** A streetlight at (x, z) whose arm reaches along heading h. */
function addStreetLamp(x, z, h) {
  lampPlacements.push({ x, z, h });
  const hx = x + Math.sin(h) * 2;
  const hz = z + Math.cos(h) * 2;
  addGlow(hx, 6.85, hz, 0xffc27a, 0.9);
  batches.pools.addGroundQuad(hx - 6, hz - 6, hx + 6, hz + 6, 0.22, 0xffb060);
  addCollider(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 1);
}

// ---- Ground, roads, coast ----------------------------------------------------------------------
function buildGround(scene) {
  const span = CITY_MAX - CITY_MIN;
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 120, span + 120).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: noiseTexture('#4a444f', '200,190,210', 2600), roughness: 0.92 }),
  );
  asphalt.material.map.repeat.set((span + 120) / 14, (span + 120) / 14);
  asphalt.position.set(CITY_MIN + (span + 120) / 2, 0, 0);
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  const marks = batches.marks;
  const YELLOW = 0xf2c230;
  const WHITE = 0xe8e2da;
  for (let i = 0; i <= BLOCKS; i += 1) {
    const c = roadCoord(i);
    for (let j = 0; j < BLOCKS; j += 1) {
      const a = roadCoord(j) + ROAD / 2 + 4.5;
      const b = roadCoord(j + 1) - ROAD / 2 - 4.5;
      // double yellow centre and white parking-strip lines, on the north-south then the east-west road
      for (const off of [-0.22, 0.22]) {
        marks.addGroundQuad(c + off - 0.08, a, c + off + 0.08, b, 0.03, YELLOW);
        marks.addGroundQuad(a, c + off - 0.08, b, c + off + 0.08, 0.03, YELLOW);
      }
      for (const off of [-4.75, 4.75]) {
        for (let s = a + 1; s < b - 3; s += 7) {
          marks.addGroundQuad(c + off - 0.07, s, c + off + 0.07, s + 4, 0.03, WHITE);
          marks.addGroundQuad(s, c + off - 0.07, s + 4, c + off + 0.07, 0.03, WHITE);
        }
      }
    }
    // zebra crossings on all four approaches of every junction of this road
    for (let j = 0; j <= BLOCKS; j += 1) {
      const d = roadCoord(j);
      for (let s = -6.6; s <= 6.6; s += 1.65) {
        for (const sign of [-1, 1]) {
          const m = d + sign * (ROAD / 2 + 2.4);
          marks.addGroundQuad(c + s - 0.4, m - 1.5, c + s + 0.4, m + 1.5, 0.03, WHITE);
          marks.addGroundQuad(m - 1.5, c + s - 0.4, m + 1.5, c + s + 0.4, 0.03, WHITE);
        }
      }
    }
  }

  // sidewalk slabs for every block, raised a kerb's height
  const walk = batches.sidewalk;
  const KERB = 0xb5a79b;
  const slab = (x0, z0, x1, z1) => {
    walk.addGroundQuad(x0, z0, x1, z1, 0.15, 0xffffff, 4);
    const r = { x0, z0, x1, z1 };
    for (const side of ['n', 's', 'e', 'w']) {
      const [ax, az, bx, bz] = sideSegment(r, side);
      batches.solid.addWallQuad(ax, az, bx, bz, 0, 0.15, KERB);
    }
  };
  for (let bi = 0; bi < BLOCKS; bi += 1) for (let bj = 0; bj < BLOCKS; bj += 1) { const r = blockRect(bi, bj); slab(r.x0, r.z0, r.x1, r.z1); }
  // the outer ring's sidewalks and the seaside promenade
  slab(CITY_MIN - 60, CITY_MIN - 60, CITY_MAX + 60, CITY_MIN);
  slab(CITY_MIN - 60, CITY_MAX, CITY_MAX + 60, CITY_MAX + 60);
  slab(CITY_MAX, CITY_MIN, CITY_MAX + 60, CITY_MAX);
  slab(CITY_MIN - 10, CITY_MIN, CITY_MIN, CITY_MAX);
}

function buildCoast(scene) {
  // beach: one sloped sand sheet from the promenade down under the waterline
  const x0 = CITY_MIN - 10;
  const x1 = WEST_LIMIT - 30;
  const zSpan = CITY_MAX + 60;
  const sandGeometry = new THREE.BufferGeometry();
  sandGeometry.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0.15, -zSpan, x0, 0.15, zSpan, x1, -0.9, zSpan, x1, -0.9, -zSpan], 3));
  sandGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 60, 6, 60, 6, 0], 2));
  sandGeometry.setIndex([0, 2, 1, 0, 3, 2]);
  sandGeometry.computeVertexNormals();
  const sand = new THREE.Mesh(sandGeometry, new THREE.MeshStandardMaterial({ map: noiseTexture('#eecfa2', '150,100,60', 4000), roughness: 1 }));
  sand.receiveShadow = true;
  scene.add(sand);

  const solid = batches.solid;
  // low sea wall with a neon teal handrail along the promenade
  solid.addBox(x0 + 0.2, 0.45, 0, 0.4, 0.6, CITY_MAX * 2, 0xe9dccb);
  batches.neon.addBox(x0 + 0.2, 0.8, 0, 0.12, 0.08, CITY_MAX * 2, 0x25f0e0);
  // beach umbrellas, loungers and lifeguard towers
  const cone = new THREE.ConeGeometry(1.7, 0.75, 8);
  for (let i = 0; i < 46; i += 1) {
    const x = rnd(x0 - 30, x0 - 5);
    const z = rnd(-290, 290);
    const y = 0.15 - (x0 - x) * 0.016;
    solid.addBox(x, y + 1.1, z, 0.08, 2.2, 0.08, 0xf4f0ea);
    solid.addGeometry(cone, placeMatrix(x, y + 2.3, z, rnd(3)), pickOne(AWNINGS));
    solid.addBox(x + 1.3, y + 0.25, z + 0.4, 0.7, 0.12, 1.9, pickOne([0xffffff, 0x25c9c0, 0xff6fa3]));
  }
  for (const z of [-190, -30, 150]) {
    const x = x0 - 16;
    const y = 0.15 - 16 * 0.016;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid.addBox(x + dx, y + 1.2, z + dz, 0.16, 2.4, 0.16, 0xfaf3e6);
    solid.addBox(x, y + 2.5, z, 2.8, 0.16, 2.8, 0xfaf3e6).addBox(x, y + 3.5, z, 2.3, 1.9, 2.3, pickOne([0xff6fa3, 0x25c9c0, 0xffc13d]));
    solid.addBox(x, y + 4.6, z, 2.9, 0.16, 2.9, 0xfaf3e6);
    addCollider(x - 1.4, z - 1.4, x + 1.4, z + 1.4, 5);
  }
  // promenade palms and lamps
  for (let z = -292; z <= 292; z += 14.6) {
    addPalm(x0 + 2.2, z + rnd(-1, 1), rnd(0.9, 1.25));
    if (Math.round(z) % 3 === 0) addPalm(x0 - 8 - rnd(6), z + 7, rnd(0.8, 1.1), false);
  }
  for (let z = -285; z <= 285; z += 30) addStreetLamp(CITY_MIN - 0.9, z, Math.PI / 2);

  // the pier and its Ferris wheel
  const pierZ = -38;
  const pierStart = WEST_LIMIT + 6;
  const pierEnd = WEST_LIMIT - 120;
  solid.addBox((pierStart + pierEnd) / 2, 1.0, pierZ, pierStart - pierEnd, 0.5, 13, 0x9a7b62);
  for (let x = pierStart; x >= pierEnd; x -= 12) for (const dz of [-5.5, 5.5]) solid.addBox(x, -0.2, pierZ + dz, 0.6, 2.6, 0.6, 0x6e5646);
  batches.neon.addBox((pierStart + pierEnd) / 2, 2.3, pierZ - 6.4, pierStart - pierEnd, 0.1, 0.1, 0xff3d9a)
    .addBox((pierStart + pierEnd) / 2, 2.3, pierZ + 6.4, pierStart - pierEnd, 0.1, 0.1, 0xff3d9a);
  solid.addBox(pierEnd + 34, 3.2, pierZ, 14, 4, 10, 0xf7a8bd).addBox(pierEnd + 34, 5.5, pierZ, 15, 0.5, 11, 0x25c9c0);

  const wheelX = pierEnd + 14;
  const R = 26;
  const wheel = new THREE.Group();
  const rimMaterial = new THREE.MeshBasicMaterial({ color: 0xff4fa3, toneMapped: false });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a4a66, roughness: 0.6 });
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.4, 6, 48), rimMaterial));
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, 0.22, 6, 40), new THREE.MeshBasicMaterial({ color: 0x25f0e0, toneMapped: false })));
  const spokes = new GeometryBatch();
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    spokes.addBox(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0, R, 0.22, 0.22, 0xffffff, 0, 0, a);
    spokes.addBox(Math.cos(a) * R, Math.sin(a) * R - 1.2, 0, 2.2, 2, 2.4, AWNINGS[i % AWNINGS.length]);
  }
  wheel.add(new THREE.Mesh(spokes.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
  const wheelHolder = new THREE.Group();
  wheelHolder.position.set(wheelX, R + 5, pierZ);
  wheelHolder.rotation.y = Math.PI / 2.6;
  wheelHolder.add(wheel);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, R + 6, 0.9), steel);
    leg.position.set(side * 7, -(R + 6) / 2 + 0.5, 0);
    leg.rotation.z = side * 0.24;
    wheelHolder.add(leg);
  }
  scene.add(wheelHolder);
  city.wheel = wheel;
  addGlow(wheelX, R + 5, pierZ, 0xff4fa3, 0.6);
}

// ---- Blocks ------------------------------------------------------------------------------------
const SPECIAL_BLOCKS = { '2,3': 'park', '6,6': 'garage', '0,7': 'hideout', '4,1': 'station', '3,5': 'hospital' };

function buildPark(r) {
  batches.grass.addGroundQuad(r.x0 + 5, r.z0 + 5, r.x1 - 5, r.z1 - 5, 0.18, 0xffffff, 6);
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  batches.sidewalk.addGroundQuad(cx - 3, r.z0 + 5, cx + 3, r.z1 - 5, 0.2, 0xffffff, 4).addGroundQuad(r.x0 + 5, cz - 3, r.x1 - 5, cz + 3, 0.2, 0xffffff, 4);
  const basin = new THREE.CylinderGeometry(5, 5.4, 0.9, 16);
  batches.solid.addGeometry(basin, placeMatrix(cx, 0.6, cz), 0xe9dccb);
  batches.solid.addGeometry(new THREE.CylinderGeometry(4.5, 4.5, 0.1, 16), placeMatrix(cx, 1.0, cz), 0x35c9d6);
  batches.solid.addBox(cx, 1.9, cz, 0.7, 2.4, 0.7, 0xe9dccb);
  batches.neon.addGeometry(new THREE.TorusGeometry(5.2, 0.08, 4, 24).rotateX(Math.PI / 2), placeMatrix(cx, 1.1, cz), 0x25f0e0);
  addGlow(cx, 1.6, cz, 0x25f0e0, 0.8);
  addCollider(cx - 4.6, cz - 4.6, cx + 4.6, cz + 4.6, 1.5);
  for (let i = 0; i < 18; i += 1) {
    const x = rnd(r.x0 + 7, r.x1 - 7);
    const z = rnd(r.z0 + 7, r.z1 - 7);
    if (Math.abs(x - cx) < 6 || Math.abs(z - cz) < 6) continue;
    addPalm(x, z, rnd(0.9, 1.4));
  }
  for (const [dx, dz] of [[-9, -4.2], [9, 4.2], [-9, 4.2], [9, -4.2]]) batches.solid.addBox(cx + dx, 0.55, cz + dz, 2.4, 0.14, 0.7, 0x7a5a48).addBox(cx + dx, 0.35, cz + dz, 2.0, 0.4, 0.2, 0x4c4450);
}

function addContainers(x0, z0, x1, z1, count) {
  const colors = [0xd9542b, 0x1f9aa0, 0xe83e6c, 0x2f6fb5, 0xf2b632, 0xeeeeee];
  for (let i = 0; i < count; i += 1) {
    const alongX = maybe(0.5);
    const w = alongX ? 12 : 2.6;
    const d = alongX ? 2.6 : 12;
    const x = rnd(x0 + w / 2, x1 - w / 2);
    const z = rnd(z0 + d / 2, z1 - d / 2);
    const stack = rndInt(1, 2);
    for (let s = 0; s < stack; s += 1) batches.solid.addBox(x, 0.15 + 1.3 + s * 2.6, z, w, 2.55, d, pickOne(colors));
    addCollider(x - w / 2, z - d / 2, x + w / 2, z + d / 2, stack * 2.6);
  }
}

/** Benny's Garage: a low workshop with lit bay doors on a yard open to the south. */
function buildGarage(r) {
  const b = { x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z0 + 30 };
  addBuilding({ ...b, floors: 2, style: 'brick', tint: 0xcf6a4a, shop: false, neon: 1 });
  for (let i = 0; i < 3; i += 1) {
    const x = b.x0 + 9 + i * 17;
    batches.neon.addWallQuad(x + 6, b.z1 + 0.06, x - 6, b.z1 + 0.06, 0.2, 4.6, 0xffb057);
    batches.solid.addWallQuad(x + 5.6, b.z1 + 0.1, x - 5.6, b.z1 + 0.1, 0.2, 4.2, 0x2b2530);
    addGlow(x, 2.6, b.z1 + 1.2, 0xffb057, 0.8);
  }
  addNeonSign(b, 's', 14, 16, 5.6, 0.5);
  addContainers(r.x0 + 1, r.z1 - 10, r.x0 + 16, r.z1 - 1, 2);
  world.places.garage = { x: (r.x0 + r.x1) / 2, z: b.z1 + 9, label: "Benny's Garage" };
}

/** The Tidewater hideout: a dockside warehouse behind stacked containers. */
function buildHideout(r) {
  const b = { x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x0 + 44, z1: r.z0 + 34 };
  addBuilding({ ...b, floors: 3, style: 'brick', tint: 0x7fa6a8, shop: false, neon: 1 });
  batches.neon.addWallQuad(b.x0 + 26, b.z1 + 0.06, b.x0 + 14, b.z1 + 0.06, 0.2, 4.8, 0x25f0e0);
  batches.solid.addWallQuad(b.x0 + 25.6, b.z1 + 0.1, b.x0 + 14.4, b.z1 + 0.1, 0.2, 4.4, 0x1e2a30);
  addGlow(b.x0 + 20, 2.6, b.z1 + 1.2, 0x25f0e0, 0.9);
  addContainers(r.x1 - 14, r.z0 + 4, r.x1 - 1, r.z1 - 4, 4);
  addContainers(r.x0 + 30, r.z1 - 12, r.x1 - 16, r.z1 - 2, 2);
  world.places.hideout = { x: b.x0 + 20, z: b.z1 + 10, label: 'Tidewater Hideout' };
}

function buildBlock(bi, bj) {
  const r = blockRect(bi, bj);
  const special = SPECIAL_BLOCKS[`${bi},${bj}`];
  const district = districtOfBlock(bi, bj);
  // lamps: two per block edge, arm over the road
  for (const t of [15, 45]) {
    addStreetLamp(r.x0 + t, r.z0 + 0.9, Math.PI);
    addStreetLamp(r.x0 + t, r.z1 - 0.9, 0);
    addStreetLamp(r.x0 + 0.9, r.z0 + t, -Math.PI / 2);
    addStreetLamp(r.x1 - 0.9, r.z0 + t, Math.PI / 2);
  }
  // palms: the boulevard, Sunset Strip, and a scatter through the beach district
  if (bi === 0) for (const t of [6, 24, 36, 54]) addPalm(r.x0 + 1.7, r.z0 + t, rnd(1.0, 1.35));
  if (bj === 3) for (const t of [7, 30, 53]) addPalm(r.x0 + t, r.z1 - 1.7, rnd(0.95, 1.3));
  if (bj === 4) for (const t of [7, 30, 53]) addPalm(r.x0 + t, r.z0 + 1.7, rnd(0.95, 1.3));
  if (district === 'beach' && bj !== 3 && bj !== 4) for (const t of [10, 50]) { if (maybe(0.7)) addPalm(r.x0 + t, r.z0 + 1.7, rnd(0.85, 1.2)); if (maybe(0.7)) addPalm(r.x1 - 1.7, r.z0 + t, rnd(0.85, 1.2)); }

  if (special === 'park') { buildPark(r); world.places.park = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }; return; }
  if (special === 'garage') { buildGarage(r); return; }
  if (special === 'hideout') { buildHideout(r); return; }

  const lot = { x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 4 };
  let nx = 2;
  let nz = 2;
  if (district === 'downtown') { const pattern = rndInt(0, 2); nx = pattern === 0 ? 1 : pattern === 1 ? 2 : 1; nz = pattern === 0 ? 1 : pattern === 1 ? 1 : 2; }
  if (district === 'docks') { nx = maybe(0.5) ? 2 : 1; nz = nx === 2 ? 1 : 2; }
  if (district === 'beach' && maybe(0.4)) nx = 3;
  const splitX = [lot.x0];
  for (let i = 1; i < nx; i += 1) splitX.push(lot.x0 + ((lot.x1 - lot.x0) * i) / nx + rnd(-3, 3));
  splitX.push(lot.x1);
  const splitZ = [lot.z0];
  for (let j = 1; j < nz; j += 1) splitZ.push(lot.z0 + ((lot.z1 - lot.z0) * j) / nz + rnd(-3, 3));
  splitZ.push(lot.z1);
  let dressed = false;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const gap = district === 'downtown' ? rnd(1, 3) : rnd(0, 1.2);
      const b = { x0: splitX[i] + (i === 0 ? 0 : gap), x1: splitX[i + 1] - (i === nx - 1 ? 0 : gap), z0: splitZ[j] + (j === 0 ? 0 : gap), z1: splitZ[j + 1] - (j === nz - 1 ? 0 : gap) };
      const streetSides = [];
      if (i === 0) streetSides.push('w');
      if (i === nx - 1) streetSides.push('e');
      if (j === 0) streetSides.push('n');
      if (j === nz - 1) streetSides.push('s');
      const spec = { ...b, streetSides };
      if (district === 'beach') Object.assign(spec, { floors: rndInt(3, 7), style: 'deco', tint: pickOne(PASTELS), neon: 0.75, signChance: 0.8 });
      else if (district === 'midtown') Object.assign(spec, { floors: rndInt(4, 11), style: maybe(0.6) ? 'brick' : 'deco', tint: maybe(0.6) ? pickOne(BRICKS) : pickOne(PASTELS), neon: 0.35, signChance: 0.5 });
      else if (district === 'downtown') Object.assign(spec, { floors: rndInt(14, 36), style: maybe(0.8) ? 'glass' : 'deco', tint: pickOne(GLASS_TINTS), neon: 0.85, signChance: 0.45 });
      else Object.assign(spec, { floors: rndInt(2, 4), style: 'brick', tint: pickOne(BRICKS), shop: maybe(0.3), neon: 0.25, signChance: 0.3 });
      if (district === 'docks' && maybe(0.35)) { addContainers(b.x0, b.z0, b.x1, b.z1, rndInt(3, 6)); continue; }
      if (special === 'station' && !dressed) { Object.assign(spec, { signIndex: 15, style: 'brick', tint: 0x9fb4c9, floors: 5 }); dressed = true; }
      addBuilding(spec);
    }
  }
  if (special === 'station') world.places.station = { x: (r.x0 + r.x1) / 2, z: r.z1 - 2, label: 'PSPD Precinct' };
  if (special === 'hospital') world.places.hospital = { x: (r.x0 + r.x1) / 2, z: r.z0 + 2, label: 'Mercy Clinic' };
}

/** Towers beyond the outer ring road: no gameplay, they close the horizon into a skyline. */
function buildSkylineRing() {
  const ring = (x0, z0, x1, z1, alongX) => {
    const start = alongX ? x0 : z0;
    const end = alongX ? x1 : z1;
    for (let s = start; s < end - 20;) {
      const size = rnd(22, 38);
      const depth = rnd(24, 40);
      const floors = rndInt(8, 40);
      const b = alongX ? { x0: s, x1: s + size, z0: z0 < 0 ? z1 - depth : z0, z1: z0 < 0 ? z1 : z0 + depth } : { z0: s, z1: s + size, x0, x1: x0 + depth };
      addBuilding({ ...b, floors, style: maybe(0.65) ? 'glass' : 'brick', tint: maybe(0.65) ? pickOne(GLASS_TINTS) : pickOne(BRICKS), shop: false, neon: 0.6 });
      s += size + rnd(3, 9);
    }
  };
  ring(CITY_MIN, CITY_MIN - 52, CITY_MAX + 50, CITY_MIN - 8, true);
  ring(CITY_MIN, CITY_MAX + 8, CITY_MAX + 50, CITY_MAX + 52, true);
  ring(CITY_MAX + 8, CITY_MIN, CITY_MAX + 52, CITY_MAX, false);
}

function buildPalmGeometry() {
  const batch = new GeometryBatch();
  // a gently leaning trunk in four tapering rings, wider at the foot
  let x = 0;
  for (let i = 0; i < 4; i += 1) {
    const lean = i * 0.05;
    const trunk = new THREE.CylinderGeometry(0.3 - (i + 1) * 0.035, 0.3 - i * 0.035 + (i === 0 ? 0.1 : 0), 2.2, 7);
    batch.addGeometry(trunk, new THREE.Matrix4().makeRotationZ(-lean).setPosition(x, 1.1 + i * 2.1, 0), i % 2 ? 0x9a7a5c : 0x8f6e52);
    x += Math.sin(lean) * 2.1;
  }
  const crownY = 8.5;
  for (let i = 0; i < 11; i += 1) {
    const a = (i / 11) * Math.PI * 2 + (i % 2) * 0.2;
    const green = i % 2 ? 0x2f7d46 : 0x3f9a50;
    // each frond is a chain of three thinning blades: rising, level, then drooping
    const segments = [[2.0, i % 2 ? -0.5 : -0.25, 0.95, green], [1.9, 0.3, 0.72, green], [1.6, 1.0, 0.4, 0x57ad55]];
    let px = x; let py = crownY; let pz = 0;
    for (const [len, pitch, width, color] of segments) {
      const fx = Math.sin(a) * Math.cos(pitch);
      const fy = -Math.sin(pitch);
      const fz = Math.cos(a) * Math.cos(pitch);
      batch.addBox(px + fx * len / 2, py + fy * len / 2, pz + fz * len / 2, width, 0.06, len + 0.15, color, a, pitch);
      px += fx * len; py += fy * len; pz += fz * len;
    }
  }
  batch.addGeometry(new THREE.SphereGeometry(0.5, 6, 5), placeMatrix(x, crownY, 0), 0x6a4f3a);
  return batch.build();
}

function buildLampGeometry() {
  const batch = new GeometryBatch();
  batch.addBox(0, 3.5, 0, 0.2, 7, 0.2, 0x3b3644).addBox(0, 7, 1, 0.14, 0.14, 2.2, 0x3b3644).addBox(0, 6.95, 2, 0.5, 0.16, 0.95, 0x2c2832);
  return batch.build();
}

function instanceProps(scene, geometry, material, placements, toMatrix, shadows = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  placements.forEach((p, i) => mesh.setMatrixAt(i, toMatrix(p)));
  mesh.castShadow = shadows;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/** Generate the whole city into the scene. Deterministic: the same city on every run. */
export function buildCity(scene) {
  rng = makeRng(20261118);
  batches = {};
  for (const name of ['solid', 'neon', 'deco', 'brick', 'glass', 'shop', 'signs', 'marks', 'sidewalk', 'grass', 'pools']) batches[name] = new GeometryBatch();
  glowEntries = [];
  lampPlacements = [];
  palmPlacements = [];

  buildGround(scene);
  buildCoast(scene);
  for (let bi = 0; bi < BLOCKS; bi += 1) for (let bj = 0; bj < BLOCKS; bj += 1) buildBlock(bi, bj);
  buildSkylineRing();
  world.places.spawn = { x: CITY_MIN - 3.5, z: 14, heading: 0.5 };
  world.places.scoreCar = { x: -118, z: 6.3, heading: Math.PI / 2 };

  const facade = (kind, roughness) => {
    const pair = drawFacadePair(kind);
    return new THREE.MeshStandardMaterial({ map: pair.map, emissiveMap: pair.emissive, emissive: 0xffffff, emissiveIntensity: 1.5, vertexColors: true, roughness });
  };
  const shopPair = drawShopPair();
  const materials = {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    neon: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    deco: facade('deco', 0.8),
    brick: facade('brick', 0.9),
    glass: facade('glass', 0.28),
    shop: new THREE.MeshStandardMaterial({ map: shopPair.map, emissiveMap: shopPair.emissive, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.6 }),
    signs: new THREE.MeshBasicMaterial({ map: drawNeonSignAtlas(), transparent: true, alphaTest: 0.08, toneMapped: false }),
    marks: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    sidewalk: new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.95 }),
    grass: new THREE.MeshStandardMaterial({ map: noiseTexture('#4f9a52', '20,60,20', 5000), roughness: 1 }),
    pools: new THREE.MeshBasicMaterial({ map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  city.neonMaterial = materials.neon;
  for (const [name, batch] of Object.entries(batches)) {
    if (!batch.vertexCount) continue;
    const mesh = new THREE.Mesh(batch.build(), materials[name]);
    mesh.name = `city-${name}`;
    mesh.castShadow = ['solid', 'deco', 'brick', 'glass', 'shop'].includes(name);
    mesh.receiveShadow = !['neon', 'signs', 'pools'].includes(name);
    mesh.frustumCulled = false;
    if (name === 'pools') mesh.renderOrder = 2;
    scene.add(mesh);
  }
  instanceProps(scene, buildPalmGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), palmPlacements,
    (p) => placeMatrix(p.x, p.x < CITY_MIN - 10 ? 0.15 - (CITY_MIN - 10 - p.x) * 0.016 : 0.15, p.z, p.rot, p.scale));
  instanceProps(scene, buildLampGeometry(), materials.solid, lampPlacements, (p) => placeMatrix(p.x, 0.15, p.z, p.h), false);
  scene.add(makeGlowPoints(glowEntries, 16));
}

/** Per-frame city animation: the Ferris wheel turns. */
export function updateCity(dt) {
  city.time += dt;
  if (city.wheel) city.wheel.rotation.z += dt * 0.12;
}
