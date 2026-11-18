// sky.js: the golden-hour look of Port Solano. A gradient sky dome with a low sun and streaky
// clouds, the warm key light with shadows that follows the player, teal fill light, haze fog,
// and the animated ocean with its sun glitter path.
import * as THREE from '../vendor/three.module.min.js';
import { WEST_LIMIT } from './world.js';

/** Unit vector pointing from the ground toward the sun: low over the ocean in the west. */
export const SUN_DIRECTION = new THREE.Vector3(-0.9, 0.2, 0.34).normalize();
export const FOG_COLOR = new THREE.Color(0xf29a72);
const SUN_COLOR = new THREE.Color(0xffb26b);

const sky = { dome: null, sun: null, ocean: null, time: 0 };

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;

const SKY_FRAGMENT = /* glsl */ `
varying vec3 vDir;
uniform vec3 sunDir;
uniform vec3 hazeColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float cloudNoise(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * valueNoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}
vec3 skyGradient(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(hazeColor, vec3(0.98, 0.36, 0.42), smoothstep(0.0, 0.2, h));
  c = mix(c, vec3(0.42, 0.30, 0.62), smoothstep(0.12, 0.46, h));
  c = mix(c, vec3(0.07, 0.20, 0.42), smoothstep(0.36, 0.95, h));
  return c;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyGradient(d);
  float sunAmount = max(dot(d, sunDir), 0.0);
  float toward = dot(normalize(d.xz + 1e-5), normalize(sunDir.xz)) * 0.5 + 0.5;
  // the side away from the sun runs cooler and teal
  c = mix(c * vec3(0.62, 0.86, 1.0) + vec3(0.0, 0.05, 0.08), c, smoothstep(0.1, 0.9, toward));
  c += vec3(1.0, 0.5, 0.18) * pow(sunAmount, 6.0) * 0.55;
  c += vec3(1.0, 0.78, 0.45) * pow(sunAmount, 80.0) * 1.2;
  c += vec3(1.0, 0.93, 0.78) * smoothstep(0.9990, 0.9996, sunAmount) * 6.0;
  // long streaky clouds, lit pink-gold from below
  vec2 cp = d.xz / (d.y + 0.22) * vec2(1.1, 3.4);
  float cloud = smoothstep(0.52, 0.86, cloudNoise(cp + vec2(3.0, 1.5)));
  cloud *= smoothstep(0.02, 0.22, d.y) * (1.0 - smoothstep(0.55, 0.9, d.y));
  vec3 cloudColor = mix(vec3(0.55, 0.30, 0.52), vec3(1.0, 0.62, 0.42), toward);
  cloudColor += vec3(1.0, 0.7, 0.4) * pow(sunAmount, 4.0) * 0.6;
  c = mix(c, cloudColor, cloud * 0.72);
  if (d.y < 0.0) c = mix(c, hazeColor, smoothstep(0.0, -0.04, d.y));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const OCEAN_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const OCEAN_FRAGMENT = /* glsl */ `
varying vec3 vWorld;
uniform float time;
uniform float shoreX;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 hazeColor;
uniform float fogNear;
uniform float fogFar;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec2 p = vWorld.xz;
  float t = time;
  vec3 n = normalize(vec3(
    sin(p.x * 0.31 + t * 1.2) * 0.05 + sin(p.y * 0.83 + p.x * 0.42 + t * 1.7) * 0.07 + sin(p.x * 2.1 - t * 2.1 + p.y * 1.3) * 0.05,
    1.0,
    sin(p.y * 0.47 + t * 1.1) * 0.05 + sin(p.x * 1.07 + p.y * 0.71 - t * 1.6) * 0.07 + sin(p.y * 2.6 + t * 2.4) * 0.04));
  float fresnel = pow(1.0 - max(dot(V, n), 0.0), 3.0);
  vec3 deep = vec3(0.02, 0.26, 0.33);
  vec3 shallow = vec3(0.07, 0.55, 0.58);
  float offshore = clamp((shoreX - p.x) / 70.0, 0.0, 1.0);
  vec3 c = mix(shallow, deep, offshore);
  c = mix(c, hazeColor * vec3(1.0, 0.86, 0.9), fresnel * 0.85);
  vec3 R = reflect(-V, n);
  float glitter = pow(max(dot(R, sunDir), 0.0), 42.0);
  c += sunColor * glitter * 3.2;
  // foam breathing along the shoreline
  float wash = shoreX - p.x + sin(p.y * 0.21 + t * 0.9) * 1.6 + sin(t * 0.6) * 1.2;
  float foam = smoothstep(4.5, 0.0, wash) + smoothstep(0.6, 0.0, abs(wash - 7.5 - sin(p.y * 0.4 + t) * 0.8)) * 0.5;
  c = mix(c, vec3(1.0, 0.93, 0.86), clamp(foam, 0.0, 1.0) * 0.85);
  float fogAmount = smoothstep(fogNear, fogFar, length(cameraPosition - vWorld));
  c = mix(c, hazeColor, fogAmount);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Build the dome, sun light, fill light, fog and ocean into the scene. */
export function buildSky(scene) {
  scene.fog = new THREE.Fog(FOG_COLOR, 90, 820);
  scene.background = FOG_COLOR;

  sky.dome = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: { sunDir: { value: SUN_DIRECTION }, hazeColor: { value: FOG_COLOR } },
      side: THREE.BackSide, depthWrite: false, fog: false,
    }),
  );
  sky.dome.renderOrder = -10;
  sky.dome.frustumCulled = false;
  scene.add(sky.dome);

  // teal sky fill from above, warm bounce from the ground
  scene.add(new THREE.HemisphereLight(0x8ec5ff, 0xff9e70, 1.25));

  const sun = new THREE.DirectionalLight(SUN_COLOR, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const reach = 95;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 20, far: 520 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  sky.sun = sun;

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(3200, 5200, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERTEX,
      fragmentShader: OCEAN_FRAGMENT,
      uniforms: {
        time: { value: 0 }, shoreX: { value: WEST_LIMIT - 2 }, sunDir: { value: SUN_DIRECTION }, sunColor: { value: SUN_COLOR },
        hazeColor: { value: FOG_COLOR }, fogNear: { value: 160 }, fogFar: { value: 1500 },
      },
    }),
  );
  ocean.position.set(WEST_LIMIT - 1600 + 6, -0.35, 0);
  scene.add(ocean);
  sky.ocean = ocean;
}

/** Keep the dome on the camera, the shadow box on the focus point, and the waves moving. */
export function updateSky(dt, camera, focus) {
  sky.time += dt;
  sky.dome.position.copy(camera.position);
  sky.ocean.material.uniforms.time.value = sky.time;
  // snap the shadow box to whole metres so shadow edges do not swim as the player moves
  const fx = Math.round(focus.x / 2) * 2;
  const fz = Math.round(focus.z / 2) * 2;
  sky.sun.target.position.set(fx, 0, fz);
  sky.sun.position.set(fx + SUN_DIRECTION.x * 260, SUN_DIRECTION.y * 260, fz + SUN_DIRECTION.z * 260);
}
