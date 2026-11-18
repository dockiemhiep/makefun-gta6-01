// missions.js: the two story jobs of Port Solano (Benny's First Score and the Tidewater Heat Escape),
// their phases, timers, rewards and fail rules, the free-roam offers between them, the story intro
// card, and the 3D light-column beacon that marks world.marker.
import * as THREE from '../vendor/three.module.min.js';
import { world, on, emit, toast, addMoney, setWanted, dist, groundHeight } from './world.js';
import { spawnVehicle, removeVehicle, placeVehicle } from './vehicles.js';

export const STORY_INTRO = {
  title: 'NEON TIDE: PORT SOLANO',
  lines: [
    'Mara Quill is back in Port Solano after three quiet years.',
    'Benny Okafor still runs the garage on the east side, and he still owes her a favour.',
    'He has a first score lined up: a pink Kestrel GT, parked and waiting.',
    'Pull it off and the Tidewater crew will want her. So will the PSPD.',
  ],
  signoff: '"Wheels first, questions never." - Benny',
};

export const MISSIONS = {
  firstScore: {
    id: 'firstScore', title: 'First Score', giver: 'Benny', reward: 750, timeLimit: 120,
    brief: 'Lift the pink Kestrel GT off Sunset Strip and get it to my garage. Clock is ticking.',
  },
  heatEscape: {
    id: 'heatEscape', title: 'Heat Escape', giver: 'Tidewater', reward: 1500,
    brief: 'Show us you can run. Stir up the PSPD, then lose them at our dockside hideout.',
  },
};

const MISSION_ORDER = ['firstScore', 'heatEscape'];
const CLEAN_DELIVERY_BONUS = 250;
const REOFFER_DELAY = 4;
const LAY_LOW_TIME = 5;
const COLORS = { benny: '#ffb02e', tidewater: '#ff3d9a', car: '#ff3d9a', garage: '#ffe14a', hideout: '#25f0e0' };

let missionCar = null; // the marked Kestrel GT of First Score
let followedVehicle = null; // the vehicle world.marker is tracking, if any
let reofferIn = -1; // seconds until the next free-roam offer
let lastPlayedId = null;
let beacon = null;
let beaconColor = '';

// ---- Helpers -------------------------------------------------------------------------------
const mission = () => world.mission;
const isActive = () => mission().id !== null && mission().phase !== 'complete' && mission().phase !== 'failed';
const playerXZ = () => (world.player?.vehicle ? world.player.vehicle.pos : world.player?.pos);
const playerInMissionCar = () => !!missionCar && world.player?.vehicle === missionCar;

function setObjective(objective, timer = mission().timer) {
  mission().objective = objective;
  mission().timer = timer;
}
function pointMarkerAt(x, z, label, color) {
  followedVehicle = null;
  world.marker = { x, z, label, color };
}
function pointMarkerAtVehicle(vehicle, label, color) {
  followedVehicle = vehicle;
  world.marker = { x: vehicle.pos.x, z: vehicle.pos.z, label, color };
}
function clearMarker() {
  followedVehicle = null;
  world.marker = null;
}
function resetMissionState(fields) {
  const done = mission().done || [];
  world.mission = { id: null, title: '', objective: '', timer: -1, phase: null, giver: '', reward: 0, done, ...fields };
}

// ---- Free roam and offers ------------------------------------------------------------------
/** Where each job's contact waits: Benny on the promenade by the spawn, Tidewater by the park. */
function missionStartPoint(id) {
  const p = world.places;
  if (id === 'firstScore') return { x: p.spawn.x, z: p.spawn.z - 22, label: 'Benny · First Score', color: COLORS.benny };
  return { x: p.park.x, z: p.park.z + 28, label: 'Tidewater · Heat Escape', color: COLORS.tidewater };
}

function nextOfferedMissionId() {
  const done = mission().done;
  const open = MISSION_ORDER.find((id) => !done.includes(id));
  if (open) return open;
  return lastPlayedId === 'firstScore' ? 'heatEscape' : 'firstScore';
}

/** Free-roam state: no active job, the beacon on the next job's contact point. */
export function offerNextMission() {
  reofferIn = -1;
  const id = nextOfferedMissionId();
  const allDone = MISSION_ORDER.every((m) => mission().done.includes(m));
  const hint = allDone
    ? 'Replay a job for cash, or just cause trouble'
    : id === 'firstScore' ? 'Meet Benny on the promenade' : 'Meet the Tidewater crew by the park';
  resetMissionState({ objective: hint, offered: id });
  const start = missionStartPoint(id);
  pointMarkerAt(start.x, start.z, start.label, start.color);
}

function checkMissionStartContact() {
  const id = mission().offered;
  const pos = playerXZ();
  const state = world.player?.state;
  if (!id || !pos || (state !== 'foot' && state !== 'drive')) return;
  const start = missionStartPoint(id);
  if (dist(pos.x, pos.z, start.x, start.z) <= 4) startMission(id);
}

// ---- Mission flow --------------------------------------------------------------------------
export function startMission(id, { quiet = false } = {}) {
  const def = MISSIONS[id];
  if (!def) return;
  reofferIn = -1;
  lastPlayedId = id;
  resetMissionState({ id, title: def.title, giver: def.giver, reward: def.reward });
  if (id === 'firstScore') beginStealPhase();
  else beginHeatPhase();
  if (!quiet) {
    emit('missionStart', { id, title: def.title });
    toast(def.title, def.brief, 'mission');
  }
}

/** Fresh or reused marked Kestrel GT, parked at its spot on Sunset Strip. */
function spawnMarkedScoreCar() {
  const spot = world.places.scoreCar;
  const usable = missionCar && !missionCar.removed && !missionCar.dead && world.player?.vehicle !== missionCar;
  if (usable) placeVehicle(missionCar, spot.x, spot.z, spot.heading);
  else missionCar = spawnVehicle('sport', spot.x, spot.z, spot.heading, { color: 0xff2e88, parked: true });
  missionCar.marked = true;
  return missionCar;
}

function beginStealPhase() {
  spawnMarkedScoreCar();
  mission().phase = 'steal';
  setObjective('Steal the pink Kestrel GT on Sunset Strip', -1);
  pointMarkerAtVehicle(missionCar, 'Kestrel GT', COLORS.car);
}

function beginDeliverPhase() {
  const g = world.places.garage;
  if (mission().phase === 'steal') mission().timer = MISSIONS.firstScore.timeLimit;
  mission().phase = 'deliver';
  setObjective("Deliver the Kestrel to Benny's Garage");
  pointMarkerAt(g.x, g.z, "Benny's Garage", COLORS.garage);
}

function beginRecoverCarPhase() {
  mission().phase = 'recover';
  setObjective('Get back in the Kestrel GT');
  pointMarkerAtVehicle(missionCar, 'Kestrel GT', COLORS.car);
}

function updateFirstScore(dt) {
  const m = mission();
  if (!missionCar || missionCar.removed) { failMission('The Kestrel is gone'); return; }
  if (missionCar.dead) { failMission('The Kestrel is wrecked'); return; }
  if (m.phase === 'steal') {
    if (playerInMissionCar()) beginDeliverPhase();
    return;
  }
  m.timer = Math.max(0, m.timer - dt);
  if (m.timer <= 0) { failMission('Out of time'); return; }
  if (m.phase === 'recover' && playerInMissionCar()) beginDeliverPhase();
  else if (m.phase === 'deliver' && !playerInMissionCar()) beginRecoverCarPhase();
  else if (m.phase === 'deliver') {
    const g = world.places.garage;
    const close = dist(missionCar.pos.x, missionCar.pos.z, g.x, g.z) <= 7;
    if (close && Math.abs(missionCar.speed) < 4) completeMission();
  }
}

function beginHeatPhase() {
  mission().phase = 'heat';
  setObjective('Get the PSPD on you: reach 3 wanted stars', -1);
  clearMarker();
  if (world.wanted.level >= 3) beginRunPhase();
}

function beginRunPhase() {
  const h = world.places.hideout;
  mission().phase = 'run';
  setObjective('Reach the Tidewater Hideout with the heat on', -1);
  pointMarkerAt(h.x, h.z, 'Hideout', COLORS.hideout);
}

function beginLayLowPhase() {
  mission().phase = 'layLow';
  setObjective('Lay low: stay inside until the heat dies', LAY_LOW_TIME);
}

function updateHeatEscape(dt) {
  const m = mission();
  const h = world.places.hideout;
  const pos = playerXZ();
  if (!pos) return;
  const d = dist(pos.x, pos.z, h.x, h.z);
  if (m.phase === 'heat') {
    if (world.wanted.level >= 3) beginRunPhase();
  } else if (m.phase === 'run') {
    if (d <= 8) beginLayLowPhase();
    else if (world.wanted.level < 1) failMission('You lost them too early');
  } else if (m.phase === 'layLow') {
    if (d > 12) { beginRunPhase(); return; }
    m.timer = Math.max(0, m.timer - dt);
    if (m.timer <= 0) {
      setWanted(0);
      completeMission();
    }
  }
}

export function completeMission() {
  const m = mission();
  const def = MISSIONS[m.id];
  if (!def || m.phase === 'complete') return;
  let bonus = 0;
  if (def.id === 'firstScore' && missionCar && !missionCar.dead && missionCar.hp >= missionCar.spec.hp * 0.7) bonus = CLEAN_DELIVERY_BONUS;
  const total = def.reward + bonus;
  addMoney(total);
  if (!m.done.includes(def.id)) m.done.push(def.id);
  releaseMissionCar(false);
  m.phase = 'complete';
  setObjective(def.id === 'firstScore' ? 'Benny pays cash. Nice driving.' : 'Tidewater owes you one. The heat is gone.', -1);
  clearMarker();
  emit('missionComplete', { id: def.id, title: def.title, reward: total, bonus });
  const sub = bonus ? `${def.title}  +$${def.reward}  · clean delivery +$${bonus}` : `${def.title}  +$${total}`;
  toast('MISSION COMPLETE', sub, 'success');
  reofferIn = REOFFER_DELAY;
}

export function failMission(reason = 'Mission failed') {
  const m = mission();
  if (!isActive()) return;
  const id = m.id;
  releaseMissionCar(true);
  m.phase = 'failed';
  setObjective(reason, -1);
  clearMarker();
  emit('missionFailed', { id, reason });
  toast('MISSION FAILED', reason, 'fail');
  reofferIn = REOFFER_DELAY;
}

/** Unmark the Kestrel; on failure, remove it unless the player is sitting in it (or it is a wreck). */
function releaseMissionCar(removeIfIdle) {
  if (!missionCar) return;
  missionCar.marked = false;
  if (removeIfIdle && !missionCar.removed && !missionCar.dead && !playerInMissionCar()) removeVehicle(missionCar);
  missionCar = null;
}

/** Restore completed jobs from a save and re-offer the right next one. */
export function applyMissionProgress(doneIds) {
  const known = Array.isArray(doneIds) ? doneIds.filter((id) => MISSIONS[id]) : [];
  mission().done.length = 0;
  for (const id of known) if (!mission().done.includes(id)) mission().done.push(id);
  lastPlayedId = known.length ? known[known.length - 1] : null;
  if (!isActive()) offerNextMission();
}

/**
 * Screenshot staging: freeze a mission in a phase. ('firstScore', 'deliver') returns { vehicle } for
 * the lead to seat the player in; ('firstScore' | 'heatEscape', 'complete') shows the payout state;
 * ('heatEscape', 'run' | 'layLow') puts the beacon on the hideout. No logic runs while world.mode is 'shot'.
 */
export function stageMissionForShot(id, phase) {
  if (!MISSIONS[id]) return {};
  if (isActive()) releaseMissionCar(true);
  startMission(id, { quiet: true });
  if (id === 'firstScore') {
    if (phase === 'deliver') {
      beginDeliverPhase();
      mission().timer = 74;
    } else if (phase === 'complete') {
      completeMission();
    }
    return { vehicle: missionCar };
  }
  if (phase === 'run' || phase === 'layLow') {
    setWanted(3);
    beginRunPhase();
    if (phase === 'layLow') { beginLayLowPhase(); mission().timer = 3.2; }
  } else if (phase === 'complete') {
    completeMission();
  }
  return {};
}

// ---- Beacon ----------------------------------------------------------------------------------
function glowMaterial(opacity) {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    toneMapped: false, fog: false, side: THREE.DoubleSide,
  });
}

function buildObjectiveBeacon() {
  const group = new THREE.Group();
  // the column is a tinted shaft that fades out toward the top, so it reads against a bright sky
  const fade = document.createElement('canvas');
  fade.width = 4;
  fade.height = 128;
  const fadeContext = fade.getContext('2d');
  const gradient = fadeContext.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,1)');
  fadeContext.fillStyle = gradient;
  fadeContext.fillRect(0, 0, 4, 128);
  const columnMaterial = glowMaterial(0.5);
  columnMaterial.map = new THREE.CanvasTexture(fade);
  columnMaterial.blending = THREE.NormalBlending;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 22, 24, 1, true), columnMaterial);
  column.position.y = 11;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 40).rotateX(-Math.PI / 2), glowMaterial(0.7));
  ring.position.y = 0.08;
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0).scale(1, 1.5, 1), glowMaterial(0.9));
  diamond.position.y = 3.4;
  for (const mesh of [column, ring, diamond]) mesh.renderOrder = 5;
  group.add(column, ring, diamond);
  group.visible = false;
  world.scene.add(group);
  return { group, column, ring, diamond };
}

function animateObjectiveBeacon() {
  if (!beacon) return;
  const marker = world.marker;
  if (followedVehicle && marker) {
    if (followedVehicle.removed) clearMarker();
    else { marker.x = followedVehicle.pos.x; marker.z = followedVehicle.pos.z; }
  }
  const m = world.marker;
  beacon.group.visible = !!m;
  if (!m) return;
  if (m.color !== beaconColor) {
    beaconColor = m.color;
    for (const mesh of [beacon.column, beacon.ring, beacon.diamond]) mesh.material.color.set(m.color);
  }
  const t = world.time;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  beacon.group.position.set(m.x, groundHeight(m.x, m.z), m.z);
  beacon.column.material.opacity = 0.42 + 0.16 * pulse;
  beacon.column.scale.set(0.92 + 0.12 * pulse, 1, 0.92 + 0.12 * pulse);
  const ringScale = 0.85 + 0.35 * ((t * 0.8) % 1);
  beacon.ring.scale.set(ringScale, 1, ringScale);
  beacon.ring.material.opacity = 0.75 * (1 - ((t * 0.8) % 1)) + 0.15;
  beacon.diamond.visible = !!followedVehicle;
  beacon.diamond.position.y = 3.4 + 0.35 * Math.sin(t * 2.4);
  beacon.diamond.rotation.y = t * 1.8;
}

// ---- Lifecycle -------------------------------------------------------------------------------
export function initMissions() {
  if (!world.mission.done) world.mission.done = [];
  beacon = buildObjectiveBeacon();
  on('busted', () => failMission('Busted by the PSPD'));
  on('wasted', () => failMission('Wasted'));
  offerNextMission();
}

export function updateMissions(dt) {
  if (world.mode === 'play' && world.player) {
    if (isActive()) {
      if (mission().id === 'firstScore') updateFirstScore(dt);
      else updateHeatEscape(dt);
    } else if (reofferIn >= 0) {
      reofferIn -= dt;
      if (reofferIn <= 0) offerNextMission();
    } else if (mission().id === null) {
      checkMissionStartContact();
    }
  }
  animateObjectiveBeacon();
}
