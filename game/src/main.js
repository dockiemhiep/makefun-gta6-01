// main.js: boots NEON TIDE: Port Solano and runs the game loop. Creates the renderer, builds the
// city and every system, moves between title, story card, play and pause, steps the simulation
// at a fixed 60 Hz and renders each animation frame. ?shot=<name> stages a screenshot instead.
import * as THREE from '../vendor/three.module.min.js';
import { world, reseed, on } from './world.js';
import { createPlayer, updatePlayer, placePlayerOnFoot } from './player.js';
import { updateVehicles } from './vehicles.js';
import { initTraffic, updateTraffic, populateTrafficAround } from './traffic.js';
import { initPedestrians, updatePedestrians, populatePedestriansAround } from './pedestrians.js';
import { initMissions, updateMissions, applyMissionProgress, STORY_INTRO } from './missions.js';
import { initHud, updateHud, setHudVisible, pushFeedLine } from './hud.js';
import { hasSavedGame, loadSavedGame, writeSavedGame, clearSavedGame } from './save.js';
import { showTitleScreen, showStoryCard, showPauseMenu, closeScreens } from './menus.js';
import { initPolice, updatePolice, clearPolice } from './police.js';
import { initPickups, updatePickups } from './pickups.js';
import { updateFollowCamera, setCameraShot, cameraRig, snapCameraBehind } from './camera.js';
import { initInput, wasKeyPressed, clearPressedInput, capturePointer, releasePointer } from './input.js';
import { initAudio, unlockAudio, toggleMute, isMuted, setEngine, updateAudio } from './audio.js';
import { initEffects, updateEffects } from './effects.js';
import { buildCity, updateCity } from './city.js';
import { buildSky, updateSky } from './sky.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const STARTING_MONEY = 250;
const params = new URLSearchParams(location.search);
const focus = new THREE.Vector3();
let savedMoney = -1;
let saveClock = 0;

function createRenderer() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function handleResize() {
  world.renderer.setSize(window.innerWidth, window.innerHeight, false);
  world.camera.aspect = window.innerWidth / window.innerHeight;
  world.camera.updateProjectionMatrix();
}

/** One fixed simulation tick: AI first, then physics, then everything that reacts to it. */
function simulateStep(dt) {
  world.time += dt;
  updateTraffic(dt);
  updatePolice(dt);
  if (world.mode === 'play') updatePlayer(dt);
  updateVehicles(dt);
  updatePedestrians(dt);
  updatePickups(dt);
  updateMissions(dt);
  updateEffects(dt);
  updateCity(dt);
}

/** The slow drifting camera behind the title screen and story card. */
function updateTitleCamera() {
  // glide up and down the boulevard above the traffic, clear of the palm crowns
  const t = world.time * 0.035;
  const z = 70 - Math.sin(t) * 60;
  setCameraShot(-306.5 + Math.sin(t * 0.7) * 1.5, 12.5 + Math.sin(t * 1.3) * 1.2, z, -288, 6, z - 75, 56);
}

/** Write the save; announce it in the feed only when asked and only when the write succeeded. */
function saveProgress(announce = false) {
  const p = world.player;
  const written = writeSavedGame({ money: p.money, missionsDone: world.mission.done });
  savedMoney = p.money;
  if (written && announce === true) pushFeedLine('Game saved', `${world.mission.done.length} of 2 jobs done`);
}

function beginPlay() {
  closeScreens();
  world.mode = 'play';
  cameraRig.override = null;
  snapCameraBehind(world.player.heading);
  setHudVisible(true);
  unlockAudio();
  capturePointer();
  document.getElementById('status').textContent = 'Game started';
}

function startNewGame() {
  unlockAudio();
  clearSavedGame();
  world.player.money = STARTING_MONEY;
  applyMissionProgress([]);
  world.mode = 'intro';
  showStoryCard(STORY_INTRO, () => { beginPlay(); saveProgress(); });
}

function continueGame() {
  const saved = loadSavedGame();
  if (!saved) return;
  world.player.money = saved.money;
  applyMissionProgress(saved.missionsDone);
  beginPlay();
  pushFeedLine('Welcome back, Mara', `${saved.missionsDone.length} of 2 jobs done`);
}

function openTitleScreen() {
  world.mode = 'title';
  setHudVisible(false);
  releasePointer();
  clearPolice();
  const spawn = world.places.spawn;
  placePlayerOnFoot(spawn.x, spawn.z, spawn.heading);
  world.player.health = 100;
  showTitleScreen({ saved: hasSavedGame() ? loadSavedGame() : null, onNewGame: startNewGame, onContinue: continueGame });
}

function pauseGame() {
  if (world.mode !== 'play') return;
  world.mode = 'paused';
  releasePointer();
  saveProgress();
  setEngine(false);
  setHudVisible(false);
  showPauseMenu({ muted: isMuted(), onResume: resumeGame, onToggleMute: toggleMute, onQuit: openTitleScreen });
}

function resumeGame() {
  if (world.mode !== 'paused') return;
  closeScreens();
  world.mode = 'play';
  setHudVisible(true);
  capturePointer();
}

function handleGlobalKeys() {
  if (wasKeyPressed('KeyM')) pushFeedLine(toggleMute() ? 'Sound off' : 'Sound on');
  if (wasKeyPressed('KeyP') || wasKeyPressed('Escape')) {
    if (world.mode === 'play') pauseGame();
    else if (world.mode === 'paused') resumeGame();
  }
}

function boot() {
  reseed(Number(params.get('seed')) || 1);
  world.renderer = createRenderer();
  world.scene = new THREE.Scene();
  world.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 3200);
  buildSky(world.scene, world.renderer);
  buildCity(world.scene);
  initEffects(world.scene);
  initInput(world.renderer.domElement);
  initAudio();
  initHud();
  initPedestrians();
  createPlayer();
  initTraffic();
  initPickups();
  initPolice();
  initMissions();

  on('missionComplete', () => saveProgress(true));
  on('respawn', () => saveProgress());
  window.addEventListener('resize', handleResize);
  world.renderer.domElement.addEventListener('click', () => { if (world.mode === 'play') { capturePointer(); unlockAudio(); } });
  document.addEventListener('pointerlockchange', () => {
    // Esc drops pointer lock before any key event arrives: treat that as a pause
    if (!document.pointerLockElement && world.mode === 'play' && world.hadPointerLock) pauseGame();
    world.hadPointerLock = !!document.pointerLockElement;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

  const shot = params.get('shot');
  if (shot) {
    world.mode = 'shot';
    setHudVisible(true);
    stageShot(shot, simulateStep);
  } else {
    const spawn = world.places.spawn;
    populateTrafficAround(spawn.x, spawn.z, 18, 30, 190);
    populatePedestriansAround(spawn.x, spawn.z, 30, 6, 140);
    openTitleScreen();
  }

  let last = performance.now();
  let pending = 0;
  function frame(now) {
    const elapsed = Math.min((now - last) / 1000, 0.1);
    last = now;
    handleGlobalKeys();
    if (world.mode !== 'paused' && !world.frozen) {
      pending += elapsed;
      let stepped = false;
      while (pending >= STEP) {
        simulateStep(STEP);
        pending -= STEP;
        if (!stepped) { clearPressedInput(); stepped = true; }
      }
    } else clearPressedInput();
    const p = world.player;
    if (world.mode === 'title' || world.mode === 'intro') updateTitleCamera();
    else updateFollowCamera(elapsed);
    const anchor = cameraRig.override ? world.camera.position : (p.vehicle ? p.vehicle.pos : p.pos);
    focus.set(anchor.x, 0, anchor.z);
    updateSky(elapsed, world.camera, world.shotFocus || focus);
    if (world.mode === 'play') {
      const v = p.vehicle;
      setEngine(!!v, v ? Math.abs(v.speed) / v.spec.maxSpeed : 0, v ? Math.abs(v.input.throttle) : 0);
      saveClock += elapsed;
      if (saveClock > 12 && p.money !== savedMoney) { saveClock = 0; saveProgress(); }
    }
    updateAudio(elapsed);
    updateHud(elapsed);
    world.renderer.render(world.scene, world.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__world = world;
}

boot();
