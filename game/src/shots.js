// shots.js: deterministic screenshot staging behind ?shot=<name>&seed=1. Each scene sets the
// world state (player, cars, police, wanted level, mission, camera), runs the real simulation
// for a moment so the street is alive, then freezes and sets window.__shotReady = true.
// Scenes: cover (on foot by the Kestrel GT), drive (chase cam at speed), wanted (4-star pursuit),
// mission (First Score paid out at Benny's Garage), plus showroom, a development view.
import { world, setWanted, groundHeight } from './world.js';
import { spawnVehicle, placeVehicle } from './vehicles.js';
import { populateTrafficAround, spawnTrafficCarAt } from './traffic.js';
import { populatePedestriansAround, spawnPedestrian } from './pedestrians.js';
import { placePlayerOnFoot, enterVehicle } from './player.js';
import { stagePoliceChase } from './police.js';
import { stageMissionForShot, startMission } from './missions.js';
import { setCameraShot } from './camera.js';
import { showBanner, updateHud } from './hud.js';
import { animateFigure } from './characters.js';
import { spawnTracer, spawnMuzzleFlash, spawnSmoke, spawnSparks } from './effects.js';

/** Run the simulation for a number of seconds at the fixed step. */
function runSimulation(simulateStep, seconds) {
  const p = world.player;
  for (let i = 0; i < Math.round(seconds * 60); i += 1) {
    // staged scenes skip the player's own update, so keep the player on the car they drive:
    // traffic, pedestrians and the HUD all centre on the player's position
    if (p.vehicle) { p.pos.copy(p.vehicle.pos); p.heading = p.vehicle.heading; }
    simulateStep(1 / 60);
  }
}

/** Remove cars that would sit in the way of a composed frame. */
function clearVehiclesNear(x, z, radius) {
  for (const v of [...world.vehicles]) {
    if (v.marked || v === world.player.vehicle) continue;
    if (Math.hypot(v.pos.x - x, v.pos.z - z) < radius) {
      world.scene.remove(v.mesh);
      world.vehicles.splice(world.vehicles.indexOf(v), 1);
    }
  }
}

/** Put the player's figure in a mid-stride or armed stance for a still frame. */
function posePlayerFigure(pose, speed = 0, phase = 0.9) {
  const p = world.player;
  p.figure.phase = phase;
  p.speed = speed;
  animateFigure(p.figure, 0, speed, pose);
  p.group.rotation.y = p.heading;
  if (p.figure.gun) p.figure.gun.visible = p.weapon === 'pistol';
}

/** Seat the player in a car that is already moving at speed along its heading. */
function driveAtSpeed(vehicle, x, z, heading, speed, steer = 0) {
  enterVehicle(vehicle, true);
  placeVehicle(vehicle, x, z, heading, speed);
  world.player.pos.copy(vehicle.pos);
  vehicle.input.throttle = 1;
  vehicle.input.steer = steer;
}

/** Camera behind and above a car, looking past it down its heading. */
function chaseCameraOn(vehicle, back, height, side, fov, lookAhead = 14, lookHeight = 1.2) {
  const fx = Math.sin(vehicle.heading);
  const fz = Math.cos(vehicle.heading);
  setCameraShot(
    vehicle.pos.x - fx * back - fz * side, height, vehicle.pos.z - fz * back + fx * side,
    vehicle.pos.x + fx * lookAhead, lookHeight, vehicle.pos.z + fz * lookAhead, fov,
  );
}

/** 1 COVER: on foot beside the pink Kestrel GT on Marea Boulevard at sunset, First Score under way. */
function stageCover(simulateStep) {
  const p = world.player;
  p.money = 1250;
  p.weapon = 'pistol';
  p.ammo = 24;
  p.armor = 60;
  startMission('firstScore', { quiet: true });
  const kestrel = world.vehicles.find((v) => v.marked);
  clearVehiclesNear(-305, 26, 30);
  placeVehicle(kestrel, -306.6, 28.6, Math.PI + 0.55, 0);
  kestrel.parked = true;
  world.mission.objective = 'Steal the pink Kestrel GT on Marea Blvd';
  placePlayerOnFoot(-310.7, 32.9, 2.5);
  // traffic rolling both ways and people out on the promenade and the hotel side
  spawnTrafficCarAt('taxi', 'x', 0, 9, -1);
  spawnTrafficCarAt('sedan', 'x', 0, -12, 1, 0x2f6fb5);
  spawnTrafficCarAt('van', 'x', 0, -44, -1, 0x1fa8a0);
  spawnTrafficCarAt('pickup', 'x', 0, -70, 1);
  spawnTrafficCarAt('sedan', 'z', 4, -280, 1, 0xe8e2d6);
  populateTrafficAround(-304, -60, 6, 40, 170);
  populatePedestriansAround(-304, 14, 30, 5, 110);
  for (const [x, z, h] of [[-313.5, 22, 0.2], [-314.6, 19.5, 3.3], [-295.2, 24, 0], [-294.6, 16, Math.PI], [-315, 8, 0], [-294.8, 12, 3.1]]) {
    spawnPedestrian(x, z, { heading: h });
  }
  runSimulation(simulateStep, 1.6);
  // nobody may stand between the lens and the hero
  for (const ped of world.peds) if (ped.pos.z > 29 && ped.pos.x < -300) ped.group.visible = false;
  posePlayerFigure('move', 0, 0.3);
  setCameraShot(-311.9, 1.8, 37.3, -303.5, 2.4, 14, 56);
}

/** 2 DRIVE: chase cam on the stolen Kestrel at speed down Sunset Strip, weaving through traffic. */
function stageDrive(simulateStep) {
  const p = world.player;
  p.money = 1250;
  p.weapon = 'pistol';
  p.ammo = 18;
  const { vehicle } = stageMissionForShot('firstScore', 'deliver');
  clearVehiclesNear(-120, 0, 150);
  driveAtSpeed(vehicle, -168, 1.1, Math.PI / 2, 41, 0.05);
  spawnTrafficCarAt('taxi', 'z', 4, -146, 1);
  spawnTrafficCarAt('van', 'z', 4, -117, 1, 0xf4f0ea);
  spawnTrafficCarAt('sedan', 'z', 4, -128, -1, 0xc23b3b);
  spawnTrafficCarAt('pickup', 'z', 4, -84, -1);
  spawnTrafficCarAt('sedan', 'z', 4, -62, 1, 0x3f9a70);
  spawnTrafficCarAt('sport', 'z', 4, -30, -1, 0x19e3d6);
  spawnTrafficCarAt('sedan', 'x', 2, -30, 1);
  populatePedestriansAround(-130, 0, 30, 6, 90);
  runSimulation(simulateStep, 0.5);
  world.mission.timer = 74;
  chaseCameraOn(vehicle, 6.4, 2.05, 0.9, 78, 30, 1.0);
  world.speedLines = 1;
}

/** 3 WANTED: four stars, PSPD cruisers boxing the player in at the boulevard junction. */
function stageWanted(simulateStep) {
  const p = world.player;
  p.money = 1250;
  p.weapon = 'pistol';
  p.ammo = 11;
  p.health = 64;
  p.armor = 30;
  stageMissionForShot('heatEscape', 'run');
  setWanted(4);
  clearVehiclesNear(-290, 0, 70);
  const getaway = spawnVehicle('sport', -282, 1.5, -Math.PI / 2, { color: 0xffa01f });
  driveAtSpeed(getaway, -283, 1.2, -Math.PI / 2 - 0.25, 21, -0.5);
  getaway.input.handbrake = true;
  const cruisers = stagePoliceChase([
    { x: -302.5, z: -15, heading: 0.35, speed: 12 },
    { x: -299.5, z: 17, heading: Math.PI - 0.4, speed: 12 },
    { x: -273.5, z: -2.6, heading: -Math.PI / 2, speed: 21 },
    { x: -275, z: 5.6, heading: -Math.PI / 2 + 0.12, speed: 20 },
    { x: -309, z: 3, heading: Math.PI / 2 - 0.3, speed: 5 },
    { x: -306, z: -44, heading: 0, speed: 16 },
  ]);
  spawnTrafficCarAt('taxi', 'x', 0, 52, -1);
  spawnTrafficCarAt('sedan', 'x', 0, -58, 1, 0x7a3fa0);
  populatePedestriansAround(-300, 0, 22, 8, 80);
  runSimulation(simulateStep, 0.35);
  world.wanted.seen = true;
  // gunfire from the cruisers and a clipped wing for the frozen frame
  for (const c of cruisers.slice(0, 3)) {
    spawnMuzzleFlash(c.pos.x, 1.3, c.pos.z + 0.9);
    spawnTracer(c.pos.x, 1.3, c.pos.z + 0.9, getaway.pos.x + 0.6, 1.0, getaway.pos.z);
  }
  spawnSparks(getaway.pos.x + 1.6, 0.8, getaway.pos.z + 0.6, 6);
  for (let i = 0; i < 3; i += 1) spawnSmoke(getaway.pos.x + 2.4 + i * 1.3, 0.4 + i * 0.3, getaway.pos.z - 0.8 + i * 0.5, false, 1.4 + i * 0.5);
  runSimulation(simulateStep, 0.034);
  setCameraShot(getaway.pos.x + 14.5, 4.4, getaway.pos.z + 6.4, getaway.pos.x - 9, 0.4, getaway.pos.z - 1.5, 64);
}

/** 4 MISSION: the Kestrel delivered inside the marker at Benny's Garage, payout banner up. */
function stageMission(simulateStep) {
  const p = world.player;
  p.money = 250;
  p.weapon = 'pistol';
  p.ammo = 24;
  const { vehicle } = stageMissionForShot('firstScore', 'deliver');
  const garage = world.places.garage;
  clearVehiclesNear(garage.x, garage.z, 40);
  driveAtSpeed(vehicle, garage.x + 0.6, garage.z + 2.5, Math.PI - 0.3, 0);
  vehicle.input.throttle = 0;
  spawnPedestrian(garage.x - 2.6, garage.z + 0.6, { heading: 1.2, idle: true });
  spawnPedestrian(garage.x + 5.5, garage.z - 4.4, { heading: -0.6, idle: true });
  spawnVehicle('pickup', garage.x - 15, garage.z - 2.5, Math.PI, { parked: true, color: 0xe0b040 });
  spawnVehicle('van', garage.x + 17, garage.z - 2, Math.PI + 0.1, { parked: true, color: 0x1fa8a0 });
  spawnTrafficCarAt('taxi', 'z', 7, garage.x - 30, 1);
  runSimulation(simulateStep, 0.4);
  // keep the delivery marker lit under the car while the payout shows
  const marker = { ...world.marker };
  stageMissionForShot('firstScore', 'complete');
  world.marker = marker;
  world.mission.id = 'firstScore';
  world.mission.title = 'First Score';
  world.mission.giver = 'Benny';
  world.mission.objective = 'Delivered. Benny pays cash: $750 + $250 clean bonus';
  world.mission.timer = 47;
  runSimulation(simulateStep, 0.05);
  showBanner('MISSION COMPLETE', 'First Score  +$750  ·  clean delivery +$250', 'success', 0);
  setCameraShot(garage.x + 6.2, 2.5, garage.z + 11.5, garage.x - 1.2, 1.9, garage.z - 5, 60);
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

const SCENES = { cover: stageCover, drive: stageDrive, wanted: stageWanted, mission: stageMission, showroom: stageShowroom };
export const SHOT_NAMES = Object.keys(SCENES);

/** Stage the named scene, then freeze the simulation and mark the page ready for capture. */
export function stageShot(name, simulateStep) {
  const scene = SCENES[name] || stageCover;
  scene(simulateStep);
  const p = world.player;
  if (p.vehicle) {
    // the HUD and minimap read the player's own position: keep it on the car
    p.pos.copy(p.vehicle.pos);
    p.heading = p.vehicle.heading;
    p.speed = p.vehicle.speed;
  }
  p.pos.y = groundHeight(p.pos.x, p.pos.z);
  world.shotFocus = p.vehicle ? p.vehicle.pos : p.pos;
  world.frozen = true;
  updateHud(0);
  // two frames later the composed scene is on screen
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}
