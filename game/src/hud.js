// hud.js: the heads-up display drawn over the 3D view. Money, wanted stars, weapon and ammo,
// health and armor bars, mission title/timer, the objective line, speedometer, banners and toasts,
// and the MINIMAP: a top-down 2D canvas of roads, the player arrow, traffic, police blips and
// the mission marker, turning with the view.
import {
  world, on, BLOCKS, ROAD, HALF, CITY_MIN, CITY_MAX, WEST_LIMIT, roadCoord, clamp, MAX_STARS,
} from './world.js';
import { streetNameAt, districtNameAt, blockRect } from './city.js';
import { vehicleInReach } from './player.js';
import { cameraYaw } from './camera.js';

const STAR_PATH = 'M12 1.6l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.7 5.6 21.2 7 14.1 1.7 9.1l7.2-.9z';
const WEAPON_ICONS = {
  fists: '<svg viewBox="0 0 44 26" aria-hidden="true"><path d="M8 7h5V4h6v3h2V3h6v4h2V5h6v13c0 4-3 6-7 6H15c-4 0-7-3-7-7z"/></svg>',
  pistol: '<svg viewBox="0 0 44 26" aria-hidden="true"><path d="M3 5h34v2h3v6H24c-1 3-3 4-6 4h-2l-3 8H5l3-10H3z"/></svg>',
};
const el = {};
const shown = {};
let minimapContext = null;
let minimapSize = 0;
let bannerTimer = 0;
let hudVisible = false;

/** Set an element's text only when it changed (keeps the DOM quiet at 60 fps). */
function setText(key, value) {
  if (shown[key] === value) return;
  shown[key] = value;
  el[key].textContent = value;
}
function setShown(key, visible) {
  if (shown[`v:${key}`] === visible) return;
  shown[`v:${key}`] = visible;
  el[key].hidden = !visible;
}
function setClass(key, name, active) {
  const k = `c:${key}:${name}`;
  if (shown[k] === active) return;
  shown[k] = active;
  el[key].classList.toggle(name, active);
}

/** Build the HUD's DOM once and subscribe to the events that raise banners and toasts. */
export function initHud() {
  const root = document.getElementById('hud');
  const stars = Array.from({ length: MAX_STARS }, () => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`).join('');
  root.innerHTML = `
    <div class="hud-vignette" data-el="vignette"></div>
    <div class="hud-mission hud-panel" data-el="mission">
      <div class="hud-mission-tag" data-el="missionTag">Mission</div>
      <span class="hud-mission-title" data-el="missionTitle"></span><span class="hud-timer" data-el="timer"></span>
    </div>
    <div class="hud-top-right">
      <div class="hud-money" data-el="money">$0</div>
      <div class="hud-stars hud-panel" data-el="stars" role="img" aria-label="Wanted level 0 of 5">${stars}</div>
      <div class="hud-weapon hud-panel"><span data-el="weaponIcon"></span><span class="hud-weapon-name" data-el="weaponName"></span><span class="hud-ammo" data-el="ammo"></span></div>
    </div>
    <div class="hud-feed" data-el="feed"></div>
    <div class="hud-bottom-left">
      <div class="minimap-frame">
        <canvas data-el="minimap" aria-label="Minimap"></canvas>
        <div class="minimap-north" data-el="north">N</div>
        <div class="hud-place"><b data-el="street"></b><span data-el="district"></span></div>
      </div>
      <div class="hud-bars">
        <div class="hud-bar health" role="img" aria-label="Health"><i data-el="health"></i></div>
        <div class="hud-bar armor" role="img" aria-label="Armor"><i data-el="armor"></i></div>
      </div>
    </div>
    <div class="hud-speed hud-panel" data-el="speedBox">
      <span class="hud-speed-value" data-el="speed">0</span><span class="hud-speed-unit">mph</span>
      <div class="hud-car" data-el="car"></div>
      <div class="hud-car-health"><i data-el="carHealth"></i></div>
    </div>
    <div class="hud-prompt hud-panel" data-el="prompt"></div>
    <div class="hud-objective" data-el="objective"></div>
    <div class="hud-arrest hud-panel" data-el="arrest">Hands up! PSPD arrest<i data-el="arrestBar"></i></div>
    <div class="hud-banner" data-el="banner"><div class="hud-banner-title" data-el="bannerTitle"></div><div class="hud-banner-sub" data-el="bannerSub"></div></div>
    <div class="hud-crosshair" data-el="crosshair"></div>
    <div class="hud-state" data-el="state"><div class="hud-state-title" data-el="stateTitle"></div><div class="hud-state-sub" data-el="stateSub"></div></div>`;
  root.querySelectorAll('[data-el]').forEach((node) => { el[node.dataset.el] = node; });
  el.starIcons = [...el.stars.querySelectorAll('svg')];
  for (const key of ['banner', 'state', 'arrest', 'prompt', 'crosshair', 'speedBox', 'mission']) setShown(key, false);
  minimapContext = el.minimap.getContext('2d');

  on('toast', ({ title, sub, kind }) => {
    if (kind === 'mission' || kind === 'success' || kind === 'fail') showBanner(title, sub, kind);
    else pushFeedLine(title, sub);
  });
  on('wantedChanged', ({ level, previous }) => {
    if (level > previous) pushFeedLine(`Wanted: ${level} star${level > 1 ? 's' : ''}`, 'PSPD responding');
    else if (level === 0) pushFeedLine('You lost the heat', '');
  });
}

/** Show or hide the whole play HUD (hidden behind the title screen). */
export function setHudVisible(visible) {
  hudVisible = visible;
  document.getElementById('hud').hidden = !visible;
}

/** A large centre banner: mission start, MISSION COMPLETE, MISSION FAILED. seconds = 0 keeps it up. */
export function showBanner(title, sub = '', kind = 'mission', seconds = 4.5) {
  el.banner.className = `hud-banner ${kind}`;
  el.bannerTitle.textContent = title;
  el.bannerSub.textContent = sub;
  shown['v:banner'] = true;
  el.banner.hidden = false;
  bannerTimer = seconds > 0 ? seconds : Infinity;
}

/** A small line in the feed under the weapon box: pickups, thefts, wanted changes. */
export function pushFeedLine(title, sub = '') {
  const line = document.createElement('div');
  line.textContent = title;
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    line.append(small);
  }
  el.feed.prepend(line);
  while (el.feed.children.length > 3) el.feed.lastChild.remove();
  setTimeout(() => line.remove(), 4200);
}

const formatMoney = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
function formatTimer(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- Minimap -----------------------------------------------------------------------------------
function resizeMinimap() {
  const size = Math.round(el.minimap.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
  if (size && size !== minimapSize) {
    minimapSize = size;
    el.minimap.width = size;
    el.minimap.height = size;
  }
}

/** Draw the top-down map centred on the player and turned so the view direction points up. */
export function drawMinimap() {
  resizeMinimap();
  const ctx = minimapContext;
  const S = minimapSize;
  const p = world.player;
  if (!S || !p) return;
  const driving = !!p.vehicle;
  const metres = driving ? 250 : 190; // how much of the world the map spans
  const k = S / metres;
  // the camera's own forward direction on the ground, so "up" on the map is what the view faces
  const cam = world.camera.matrixWorld.elements;
  const viewAngle = Math.hypot(cam[8], cam[10]) > 0.01 ? Math.atan2(-cam[8], -cam[10]) : cameraYaw();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2a2740';
  ctx.fillRect(0, 0, S, S);
  ctx.translate(S / 2, S * 0.56);
  ctx.rotate(viewAngle + Math.PI);
  ctx.scale(k, k);
  ctx.translate(-p.pos.x, -p.pos.z);

  // sea, beach and promenade to the west
  ctx.fillStyle = '#12727e';
  ctx.fillRect(WEST_LIMIT - 400, CITY_MIN - 400, 400, CITY_MAX - CITY_MIN + 800);
  ctx.fillStyle = '#d9b98a';
  ctx.fillRect(WEST_LIMIT, CITY_MIN - 60, CITY_MIN - 10 - WEST_LIMIT, CITY_MAX - CITY_MIN + 120);
  // asphalt under everything, then the blocks on top leave the road grid showing
  ctx.fillStyle = '#8f93ad';
  ctx.fillRect(CITY_MIN - 10, CITY_MIN - 10, CITY_MAX - CITY_MIN + 20, CITY_MAX - CITY_MIN + 20);
  const bi0 = clamp(Math.floor((p.pos.x - metres + HALF) / (HALF * 2 / BLOCKS)), 0, BLOCKS - 1);
  const bi1 = clamp(Math.floor((p.pos.x + metres + HALF) / (HALF * 2 / BLOCKS)), 0, BLOCKS - 1);
  const bj0 = clamp(Math.floor((p.pos.z - metres + HALF) / (HALF * 2 / BLOCKS)), 0, BLOCKS - 1);
  const bj1 = clamp(Math.floor((p.pos.z + metres + HALF) / (HALF * 2 / BLOCKS)), 0, BLOCKS - 1);
  for (let bi = bi0; bi <= bi1; bi += 1) {
    for (let bj = bj0; bj <= bj1; bj += 1) {
      const r = blockRect(bi, bj);
      ctx.fillStyle = bi === 2 && bj === 3 ? '#3f8f58' : '#3a3658';
      ctx.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
    }
  }
  // road centre lines give the grid some life
  ctx.strokeStyle = 'rgba(255,225,120,0.55)';
  ctx.lineWidth = 0.7;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  for (let i = 0; i <= BLOCKS; i += 1) {
    const c = roadCoord(i);
    ctx.moveTo(c, CITY_MIN); ctx.lineTo(c, CITY_MAX);
    ctx.moveTo(CITY_MIN, c); ctx.lineTo(CITY_MAX, c);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // pickups, traffic and police
  for (const pickup of world.pickups) {
    if (pickup.hiddenUntil > 0) continue;
    ctx.fillStyle = pickup.kind === 'cash' ? '#7dffb0' : pickup.kind === 'health' ? '#ff5a7e' : pickup.kind === 'armor' ? '#5ad1ff' : '#ffb02e';
    ctx.fillRect(pickup.x - 2, pickup.z - 2, 4, 4);
  }
  const blink = Math.floor(world.time * 5) % 2 === 0;
  for (const v of world.vehicles) {
    if (v === p.vehicle) continue;
    if (Math.abs(v.pos.x - p.pos.x) > metres || Math.abs(v.pos.z - p.pos.z) > metres) continue;
    ctx.save();
    ctx.translate(v.pos.x, v.pos.z);
    ctx.rotate(-v.heading);
    if (v.isPolice) {
      ctx.fillStyle = blink ? '#ff3048' : '#4a8bff';
      ctx.fillRect(-4, -6, 8, 12);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-4, -6, 8, 12);
    } else {
      ctx.fillStyle = v.marked ? '#ff3d9a' : v.driver === 'traffic' ? '#f4f0ea' : '#a9a6c0';
      ctx.fillRect(-2.4, -4.4, 4.8, 8.8);
    }
    ctx.restore();
  }
  for (const ped of world.peds) {
    if (!ped.isCop || ped.state === 'dead') continue;
    ctx.fillStyle = blink ? '#4a8bff' : '#ff3048';
    ctx.beginPath(); ctx.arc(ped.pos.x, ped.pos.z, 3.4, 0, Math.PI * 2); ctx.fill();
  }

  // the objective marker, pinned to the map edge when it is out of range
  const marker = world.marker;
  if (marker) {
    const dx = marker.x - p.pos.x;
    const dz = marker.z - p.pos.z;
    const limit = metres * 0.42;
    const far = Math.max(Math.abs(dx), Math.abs(dz)) > limit;
    const f = far ? limit / Math.max(Math.abs(dx), Math.abs(dz)) : 1;
    const mx = p.pos.x + dx * f;
    const mz = p.pos.z + dz * f;
    const pulse = 1 + Math.sin(world.time * 5) * 0.15;
    ctx.save();
    ctx.translate(mx, mz);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = marker.color || '#ffe14a';
    ctx.strokeStyle = '#140c1e';
    ctx.lineWidth = 2;
    const size = (far ? 7 : 9) * pulse;
    ctx.fillRect(-size, -size, size * 2, size * 2);
    ctx.strokeRect(-size, -size, size * 2, size * 2);
    ctx.restore();
  }

  // the player arrow, always at the centre
  ctx.save();
  ctx.translate(p.pos.x, p.pos.z);
  ctx.rotate(-p.heading);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ff3d9a';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, 11); ctx.lineTo(7.5, -8); ctx.lineTo(0, -4); ctx.lineTo(-7.5, -8); ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // keep the N tick on the frame pointing north
  const northAngle = -(viewAngle + Math.PI) - Math.PI / 2;
  el.north.style.transform = `translate(-50%, 0) translate(${Math.cos(northAngle) * -11}em, ${(Math.sin(northAngle) * 11 + 11).toFixed(2)}em)`;
}

/** Refresh every HUD readout from the world. Call once per rendered frame. */
export function updateHud(dt) {
  const p = world.player;
  if (!p || !hudVisible) return;
  const w = world.wanted;
  const m = world.mission;
  setText('money', formatMoney(p.money));
  const starKey = `${w.level}`;
  if (shown.stars !== starKey) {
    shown.stars = starKey;
    el.starIcons.forEach((icon, i) => icon.classList.toggle('lit', i < w.level));
    el.stars.setAttribute('aria-label', `Wanted level ${w.level} of 5`);
  }
  setClass('stars', 'searching', w.level > 0 && !w.seen && w.hiddenFor > 1);
  if (shown.weapon !== p.weapon) {
    shown.weapon = p.weapon;
    el.weaponIcon.innerHTML = WEAPON_ICONS[p.weapon];
    el.weaponName.textContent = p.weapon === 'pistol' ? 'Pistol' : 'Fists';
  }
  setText('ammo', p.weapon === 'pistol' ? String(p.ammo) : '');
  setClass('ammo', 'low', p.weapon === 'pistol' && p.ammo <= 6);
  el.health.style.transform = `scaleX(${clamp(p.health / 100, 0, 1).toFixed(3)})`;
  el.armor.style.transform = `scaleX(${clamp(p.armor / 100, 0, 1).toFixed(3)})`;
  setText('street', streetNameAt(p.pos.x, p.pos.z));
  setText('district', districtNameAt(p.pos.x, p.pos.z));

  // mission title, timer and objective
  setShown('mission', !!m.id);
  if (m.id) {
    setText('missionTag', m.giver ? `Mission · ${m.giver}` : 'Mission');
    setText('missionTitle', m.title);
    setText('timer', m.timer >= 0 ? formatTimer(m.timer) : '');
    setClass('timer', 'urgent', m.timer >= 0 && m.timer < 20);
  }
  let objective = m.objective || '';
  if (world.marker && objective) {
    const metres = Math.round(Math.hypot(world.marker.x - p.pos.x, world.marker.z - p.pos.z));
    if (metres > 12) objective += `  ·  ${metres} m`;
  }
  setText('objective', objective);
  setShown('objective', !!objective && p.state !== 'busted' && p.state !== 'wasted');

  // driving readout or the enter-car prompt
  const vehicle = p.vehicle;
  setShown('speedBox', !!vehicle);
  if (vehicle) {
    setText('speed', String(Math.round(Math.abs(vehicle.speed) * 2.237)));
    setText('car', vehicle.name);
    el.carHealth.style.transform = `scaleX(${clamp(vehicle.hp / vehicle.spec.hp, 0, 1).toFixed(2)})`;
  }
  const reach = vehicleInReach();
  setShown('prompt', !!reach || (!!vehicle && Math.abs(vehicle.speed) < 2 && world.time < 30));
  if (reach) {
    const verb = reach.owned ? 'Enter' : reach.driver === 'traffic' ? 'Jack' : 'Steal';
    const key = `${verb}:${reach.id}`;
    if (shown.prompt !== key) { shown.prompt = key; el.prompt.innerHTML = `<kbd>E</kbd>${verb} ${reach.name}`; }
  } else if (vehicle && shown.prompt !== 'exit') { shown.prompt = 'exit'; el.prompt.innerHTML = '<kbd>E</kbd>Exit vehicle'; }
  setShown('crosshair', p.weapon === 'pistol' && !vehicle && p.state === 'foot');

  // wanted pulse, hurt flash, arrest meter
  const heat = w.level > 0;
  setClass('vignette', 'heat', heat && p.hurtFlash <= 0.05);
  setClass('vignette', 'alt', heat && Math.floor(world.time * 2.5) % 2 === 0);
  setClass('vignette', 'hurt', p.hurtFlash > 0.05);
  el.vignette.style.opacity = p.hurtFlash > 0.05 ? p.hurtFlash.toFixed(2) : heat ? (0.25 + w.level * 0.1).toFixed(2) : '0';
  const arrest = w.arrest || 0;
  setShown('arrest', arrest > 0.05 && p.state !== 'busted');
  if (arrest > 0.05) el.arrestBar.style.transform = `scaleX(${clamp(arrest, 0, 1).toFixed(2)})`;

  // busted / wiped-out overlay
  const down = p.state === 'busted' || p.state === 'wasted';
  setShown('state', down);
  if (down) {
    setClass('state', 'wasted', p.state === 'wasted');
    setText('stateTitle', p.state === 'busted' ? 'Busted' : 'Wiped out');
    setText('stateSub', p.state === 'busted' ? 'The PSPD takes its cut.' : 'Mercy Clinic patches you up.');
  }
  if (bannerTimer > 0 && bannerTimer !== Infinity) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) setShown('banner', false);
  }
  drawMinimap();
}
