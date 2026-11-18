// shots.js: deterministic screenshot staging behind ?shot=<name>&seed=1. Each scene sets the
// world state (player, cars, police, wanted level, mission, camera), runs the real simulation
// for a moment so the street is alive, then freezes and sets window.__shotReady = true.
import { world, setWanted, lanePoint, roadCoord, LANE, PARK } from './world.js';
import { spawnVehicle, placeVehicle } from './vehicles.js';
import { populateTrafficAround, spawnTrafficCarAt } from './traffic.js';
import { populatePedestriansAround, spawnPedestrian } from './pedestrians.js';
import { placePlayerOnFoot, enterVehicle } from './player.js';
import { stagePoliceChase } from './police.js';
import { stageMissionForShot, startMission } from './missions.js';
import { setCameraShot, snapCameraBehind, cameraRig } from './camera.js';
import { showBanner, updateHud } from './hud.js';

/** Run the simulation for a number of seconds at the fixed step. */
function runSimulation(simulateStep, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) simulateStep(1 / 60);
}

/** Free roam on the boulevard at sunset: the first frame to get right. */
function stageBoulevard(simulateStep) {
  placePlayerOnFoot(-309, 20, 0.4);
  populateTrafficAround(-304, 0, 12, 20, 160);
  populatePedestriansAround(-306, 10, 26, 4, 120);
  runSimulation(simulateStep, 2);
  setCameraShot(-316, 3.4, 34, -300, 3.2, -10, 58);
}

/** Every car model side by side on the boulevard: a development view for checking the models. */
function stageShowroom(simulateStep) {
  placePlayerOnFoot(-309, 31, 2.6);
  ['sport', 'sedan', 'taxi', 'police', 'van', 'pickup'].forEach((kind, i) => {
    const car = spawnVehicle(kind, -306 + i * 3.4, 24 - i * 0.4, 2.5 + i * 0.1, { parked: true });
    if (kind === 'police') car.sirenOn = true;
  });
  runSimulation(simulateStep, 0.5);
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'rear') setCameraShot(-300, 2.4, 14, -299, 0.8, 24, 60);
  else setCameraShot(-301, 2.2, 34, -298, 0.8, 23, 60);
}

const SCENES = { boulevard: stageBoulevard, showroom: stageShowroom };

/** Stage the named scene, then mark the page ready for capture. */
export function stageShot(name, simulateStep) {
  const scene = SCENES[name] || stageBoulevard;
  scene(simulateStep);
  world.shotFocus = world.player.pos;
  updateHud(0);
  world.frozen = true;
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}

export const SHOT_NAMES = Object.keys(SCENES);
// staging helpers used as scenes are added
export const stagingTools = { setWanted, lanePoint, roadCoord, LANE, PARK, spawnVehicle, placeVehicle, spawnTrafficCarAt, spawnPedestrian, enterVehicle, stagePoliceChase, stageMissionForShot, startMission, snapCameraBehind, cameraRig, showBanner };
