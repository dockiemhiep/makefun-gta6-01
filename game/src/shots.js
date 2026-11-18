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
import { showBanner, updateHud, pushFeedLine, clearFeedLines } from './hud.js';
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
  vehicle.input.throttle = speed > 0 ? 1 : 0;
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

/** Police gunfire toward a target for the frozen frame. */
function fireTracersAt(shooters, target) {
  for (const c of shooters) {
    const dx = target.pos.x - c.pos.x;
    const dz = target.pos.z - c.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const mx = c.pos.x + (dx / d) * 2.2;
    const mz = c.pos.z + (dz / d) * 2.2;
    spawnMuzzleFlash(mx, 1.25, mz);
    spawnTracer(mx, 1.25, mz, target.pos.x, 0.95, target.pos.z);
  }
}

/** 1 COVER: on foot beside the pink Kestrel GT on Marea Boulevard at sunset, a PSPD cruiser closing in. */
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
  placePlayerOnFoot(-310.9, 32.1, 2.45);
  // traffic rolling both ways and people out on the promenade and the hotel side
  spawnTrafficCarAt('taxi', 'x', 0, 6, -1);
  spawnTrafficCarAt('sedan', 'x', 0, -34, 1, 0x2f6fb5);
  spawnTrafficCarAt('van', 'x', 0, -44, -1, 0x1fa8a0);
  spawnTrafficCarAt('pickup', 'x', 0, -70, 1);
  spawnTrafficCarAt('sedan', 'z', 4, -280, 1, 0xe8e2d6);
  populateTrafficAround(-304, -60, 6, 40, 170);
  populatePedestriansAround(-304, 14, 30, 5, 110);
  for (const [x, z, h] of [[-313.5, 22, 0.2], [-314.6, 19.5, 3.3], [-295.2, 24, 0], [-294.6, 16, Math.PI], [-315, 8, 0], [-294.8, 12, 3.1], [-295.4, 29, 2.9]]) {
    spawnPedestrian(x, z, { heading: h });
  }
  runSimulation(simulateStep, 1.6);
  // the theft was seen: one star, and a cruiser rolling down the boulevard with its lights on
  setWanted(1);
  stagePoliceChase([{ x: -306.3, z: 9.5, heading: 0, speed: 7 }]);
  runSimulation(simulateStep, 0.07);
  world.wanted.seen = true;
  // nobody may stand between the lens and the hero
  for (const ped of world.peds) if (ped.pos.z > 29 && ped.pos.x < -300) ped.group.visible = false;
  posePlayerFigure('move', 0, 0.3);
  setCameraShot(-311.9, 1.8, 37.3, -303.5, 2.4, 14, 56);
}

/** 2 DRIVE: chase cam on the stolen Kestrel at speed down Sunset Strip, overtaking through traffic. */
function stageDrive(simulateStep) {
  const p = world.player;
  p.money = 1250;
  p.weapon = 'pistol';
  p.ammo = 18;
  const { vehicle } = stageMissionForShot('firstScore', 'deliver');
  clearVehiclesNear(-120, 0, 150);
  driveAtSpeed(vehicle, -168, -0.2, Math.PI / 2, 41, 0);
  spawnTrafficCarAt('taxi', 'z', 4, -142, 1);
  spawnTrafficCarAt('sedan', 'z', 4, -130, -1, 0xc23b3b);
  spawnTrafficCarAt('van', 'z', 4, -116, 1, 0xf4f0ea);
  spawnTrafficCarAt('pickup', 'z', 4, -84, -1);
  spawnTrafficCarAt('sedan', 'z', 4, -62, 1, 0x3f9a70);
  spawnTrafficCarAt('sport', 'z', 4, -30, -1, 0x19e3d6);
  spawnTrafficCarAt('sedan', 'x', 2, -30, 1);
  populatePedestriansAround(-140, 0, 34, 6, 90);
  runSimulation(simulateStep, 0.45);
  // a flick of the wheel between the taxi and the oncoming car, tyres smoking
  vehicle.heading += 0.1;
  vehicle.mesh.rotation.y = vehicle.heading;
  const bx = vehicle.pos.x - Math.sin(vehicle.heading) * 2.2;
  const bz = vehicle.pos.z - Math.cos(vehicle.heading) * 2.2;
  for (let i = 0; i < 4; i += 1) spawnSmoke(bx - i * 1.5, 0.35 + i * 0.12, bz + (i % 2 ? 0.9 : -0.9), false, 1.0 + i * 0.5);
  runSimulation(simulateStep, 0.034);
  world.mission.timer = 74;
  chaseCameraOn(vehicle, 6.1, 1.95, 1.1, 76, 30, 1.0);
  world.speedLines = 1;
}

/** 3 WANTED: four stars on the Heat Escape job, PSPD cruisers boxing the Kestrel in at the boulevard junction. */
function stageWanted(simulateStep) {
  const p = world.player;
  p.money = 1250;
  p.weapon = 'pistol';
  p.ammo = 11;
  p.health = 64;
  p.armor = 30;
  placePlayerOnFoot(-290, 0.6, -Math.PI / 2);
  clearVehiclesNear(-290, 0, 70);
  spawnTrafficCarAt('taxi', 'x', 0, 52, -1);
  spawnTrafficCarAt('sedan', 'x', 0, -62, 1, 0x7a3fa0);
  populatePedestriansAround(-300, 0, 26, 8, 80);
  runSimulation(simulateStep, 1.2);
  stageMissionForShot('heatEscape', 'run');
  setWanted(4);
  const G = { x: -290, z: 0.6 };
  const getaway = spawnVehicle('sport', G.x, G.z, 0, { color: 0xff2e88 });
  driveAtSpeed(getaway, G.x, G.z, -Math.PI / 2 - 0.3, 19, -0.6);
  getaway.input.handbrake = true;
  const cruisers = stagePoliceChase([
    { x: G.x + 2.6, z: G.z - 3.7, heading: -Math.PI / 2 + 0.25, speed: 18 },
    { x: G.x + 3.5, z: G.z + 6.2, heading: -Math.PI / 2 - 0.2, speed: 18 },
    { x: -301.5, z: -11, heading: 0.5, speed: 9 },
    { x: -299, z: 13.5, heading: Math.PI - 0.5, speed: 9 },
    { x: -308.5, z: 2.2, heading: Math.PI / 2, speed: 2 },
    { x: -306, z: -40, heading: 0, speed: 14 },
  ]);
  runSimulation(simulateStep, 0.05);
  world.wanted.seen = true;
  fireTracersAt(cruisers.slice(2, 5), getaway);
  spawnSparks(getaway.pos.x + 1.2, 0.8, getaway.pos.z - 1.6, 8);
  for (let i = 0; i < 4; i += 1) spawnSmoke(getaway.pos.x + 2.6 + i * 1.2, 0.4 + i * 0.25, getaway.pos.z + 0.9 - i * 0.3, false, 1.2 + i * 0.5);
  runSimulation(simulateStep, 0.034);
  clearFeedLines();
  pushFeedLine('Wanted: 4 stars', 'PSPD responding');
  // look a little north of west: the Ferris wheel sits behind the action and the sun stays at the frame edge
  setCameraShot(getaway.pos.x + 9.5, 3.3, getaway.pos.z + 3.6, getaway.pos.x - 10, 0.5, getaway.pos.z - 2.5, 66);
}

/** 4 MISSION: the Kestrel delivered inside the marker at Benny's Garage, payout banner up. */
function stageMission(simulateStep) {
  const p = world.player;
  p.money = 1250;
  p.weapon = 'pistol';
  p.ammo = 24;
  const { vehicle } = stageMissionForShot('firstScore', 'deliver');
  const garage = world.places.garage;
  clearVehiclesNear(garage.x, garage.z, 40);
  driveAtSpeed(vehicle, garage.x + 0.4, garage.z + 2.2, Math.PI - 0.28, 0);
  // Benny and his mechanics come out to look the car over
  spawnPedestrian(garage.x - 2.7, garage.z + 1.2, { heading: 1.5, idle: true });
  spawnPedestrian(garage.x + 3.4, garage.z - 0.6, { heading: -1.2, idle: true });
  spawnPedestrian(garage.x - 5.2, garage.z - 3.4, { heading: 0.6, idle: true });
  spawnVehicle('pickup', garage.x - 11.5, garage.z - 3, Math.PI, { parked: true, color: 0xe0b040 });
  spawnVehicle('van', garage.x + 12, garage.z - 2.4, Math.PI + 0.1, { parked: true, color: 0x1fa8a0 });
  spawnTrafficCarAt('taxi', 'z', 7, garage.x - 30, 1);
  runSimulation(simulateStep, 0.4);
  // keep the delivery marker lit under the car while the payout shows
  const marker = { ...world.marker };
  stageMissionForShot('firstScore', 'complete');
  world.marker = marker;
  world.mission.id = 'firstScore';
  world.mission.title = 'First Score';
  world.mission.giver = 'Benny';
  world.mission.timer = -1;
  runSimulation(simulateStep, 0.05);
  clearFeedLines();
  pushFeedLine('+$1,000', 'First Score paid');
  showBanner('MISSION COMPLETE', 'First Score  +$750  ·  clean delivery +$250', 'success', 0);
  // far enough back that the garage sign sits whole between the payout banner and the car
  setCameraShot(garage.x + 4.5, 2.2, garage.z + 15, garage.x - 1, 4.9, garage.z - 5, 60);
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
