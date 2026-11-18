// main.js: boots NEON TIDE and runs the game loop. Creates the renderer, builds the city,
// then steps the simulation at a fixed 60 Hz and renders every animation frame.
import * as THREE from '../vendor/three.module.min.js';
import { world, reseed } from './world.js';
import { buildSky, updateSky } from './sky.js';
import { buildCity, updateCity } from './city.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);

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

function boot() {
  reseed(Number(params.get('seed')) || 1);
  world.renderer = createRenderer();
  world.scene = new THREE.Scene();
  world.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 3200);
  buildSky(world.scene);
  buildCity(world.scene);

  // first look: a fixed camera on the boulevard until the player exists
  world.camera.position.set(-318, 4.2, 44);
  world.camera.lookAt(-296, 5, -40);

  window.addEventListener('resize', () => {
    world.renderer.setSize(window.innerWidth, window.innerHeight, false);
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
  });

  let last = performance.now();
  let pending = 0;
  const focus = new THREE.Vector3(-300, 0, 0);
  function frame(now) {
    pending = Math.min(pending + (now - last) / 1000, 0.1);
    last = now;
    while (pending >= STEP) {
      world.time += STEP;
      updateCity(STEP);
      pending -= STEP;
    }
    updateSky(STEP, world.camera, focus);
    world.renderer.render(world.scene, world.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__world = world;
  window.__shotReady = true;
}

boot();
