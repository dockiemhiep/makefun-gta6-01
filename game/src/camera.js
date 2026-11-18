// camera.js: the third-person follow camera. On foot it orbits the player with the mouse;
// in a car it swings behind the nose as a chase cam that pulls back and widens with speed.
// It shortens its boom when a building is in the way and shakes on impacts.
import * as THREE from '../vendor/three.module.min.js';
import { world, collidersAt, clamp, angleDiff, groundHeight } from './world.js';
import { consumeMouseDelta } from './input.js';

export const cameraRig = { yaw: 0.6, pitch: 0.2, distance: 6.5, fov: 58, override: null };
const target = new THREE.Vector3();
const desired = new THREE.Vector3();

/** How far along a boom from (x, z) at this yaw the camera can go before it enters a building. */
function clearBoomLength(x, z, dirX, dirZ, length) {
  for (let d = 1; d <= length; d += 0.75) {
    const px = x + dirX * d;
    const pz = z + dirZ * d;
    const list = collidersAt(px, pz);
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      if (b.h > 3 && px > b.minX - 0.4 && px < b.maxX + 0.4 && pz > b.minZ - 0.4 && pz < b.maxZ + 0.4) return Math.max(1.2, d - 0.9);
    }
  }
  return length;
}

/** Yaw the camera looks along: the player aims and walks relative to this. */
export const cameraYaw = () => cameraRig.yaw;

/** Jump the camera behind a heading (respawns, entering a car, screenshots). */
export function snapCameraBehind(heading, pitch = 0.2) {
  cameraRig.yaw = heading;
  cameraRig.pitch = pitch;
}

/** Follow the player (or their car). Call once per rendered frame. */
export function updateFollowCamera(dt) {
  const player = world.player;
  const camera = world.camera;
  if (!player || cameraRig.override) return;
  const mouse = consumeMouseDelta();
  const vehicle = player.vehicle;
  cameraRig.yaw -= mouse.x * 0.0026;
  cameraRig.pitch = clamp(cameraRig.pitch + mouse.y * 0.002, -0.12, 0.9);
  let distance = 6.2;
  let height = 1.75;
  let fov = 58;
  if (vehicle) {
    const speed = Math.abs(vehicle.speed);
    // ease back behind the car unless the player is steering the view
    const steerBack = Math.abs(mouse.x) > 0 ? 0 : clamp(speed / 12, 0.15, 1) * 2.6;
    const behind = vehicle.speed < -2 ? vehicle.heading + Math.PI : vehicle.heading;
    cameraRig.yaw += angleDiff(behind, cameraRig.yaw) * Math.min(1, dt * steerBack);
    cameraRig.pitch += (0.13 - cameraRig.pitch) * Math.min(1, dt * 1.5);
    distance = 7.4 + speed * 0.06;
    height = 1.35;
    fov = 58 + clamp(speed / 46, 0, 1) * 16;
    target.set(vehicle.pos.x, vehicle.pos.y + height, vehicle.pos.z);
  } else {
    target.set(player.pos.x, player.pos.y + height, player.pos.z);
  }
  const fx = Math.sin(cameraRig.yaw);
  const fz = Math.cos(cameraRig.yaw);
  const flat = Math.cos(cameraRig.pitch) * distance;
  const boom = clearBoomLength(target.x, target.z, -fx, -fz, flat);
  const scale = boom / flat;
  desired.set(target.x - fx * boom, target.y + Math.sin(cameraRig.pitch) * distance * scale + 0.4, target.z - fz * boom);
  desired.y = Math.max(desired.y, groundHeight(desired.x, desired.z) + 0.5);
  camera.position.lerp(desired, Math.min(1, dt * (vehicle ? 9 : 14)));
  if (world.camShake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * world.camShake;
    camera.position.y += (Math.random() - 0.5) * world.camShake * 0.6;
    world.camShake *= Math.exp(-dt * 7);
  }
  camera.lookAt(target.x + fx * 4, target.y + 0.2 - Math.sin(cameraRig.pitch) * 1.5, target.z + fz * 4);
  cameraRig.fov += (fov - cameraRig.fov) * Math.min(1, dt * 3);
  if (Math.abs(camera.fov - cameraRig.fov) > 0.05) {
    camera.fov = cameraRig.fov;
    camera.updateProjectionMatrix();
  }
}

/** Place the camera exactly, for staged screenshots: position, look-at point and field of view. */
export function setCameraShot(px, py, pz, lx, ly, lz, fov = 58) {
  cameraRig.override = true;
  world.camera.position.set(px, py, pz);
  world.camera.fov = fov;
  world.camera.updateProjectionMatrix();
  world.camera.lookAt(lx, ly, lz);
}
