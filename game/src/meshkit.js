// meshkit.js: low-poly building blocks shared by the city, vehicles and characters.
// A GeometryBatch merges many coloured boxes/shapes into one draw call; canvas helpers make
// the procedural textures (glow sprites, window grids, sign atlases) so the game ships no images.
import * as THREE from '../vendor/three.module.min.js';

const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();
const tmpNormalMatrix = new THREE.Matrix3();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const unitBox = new THREE.BoxGeometry(1, 1, 1);

/** Collects transformed, vertex-coloured geometry and builds one merged BufferGeometry. */
export class GeometryBatch {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.uvs = [];
    this.indices = [];
    this.vertexCount = 0;
  }

  /** Append any geometry under a matrix, tinted one colour (multiplied by its own vertex colours if any). */
  addGeometry(geometry, matrix, color = 0xffffff) {
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const col = geometry.attributes.color;
    tmpColor.set(color);
    if (matrix) tmpNormalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i += 1) {
      tmpVec.fromBufferAttribute(pos, i);
      if (matrix) tmpVec.applyMatrix4(matrix);
      this.positions.push(tmpVec.x, tmpVec.y, tmpVec.z);
      if (nor) {
        tmpVec.fromBufferAttribute(nor, i);
        if (matrix) tmpVec.applyMatrix3(tmpNormalMatrix).normalize();
        this.normals.push(tmpVec.x, tmpVec.y, tmpVec.z);
      } else this.normals.push(0, 1, 0);
      if (col) this.colors.push(tmpColor.r * col.getX(i), tmpColor.g * col.getY(i), tmpColor.b * col.getZ(i));
      else this.colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
      if (uv) this.uvs.push(uv.getX(i), uv.getY(i));
      else this.uvs.push(0, 0);
    }
    const index = geometry.index;
    if (index) for (let i = 0; i < index.count; i += 1) this.indices.push(this.vertexCount + index.getX(i));
    else for (let i = 0; i < pos.count; i += 1) this.indices.push(this.vertexCount + i);
    this.vertexCount += pos.count;
    return this;
  }

  /** A box centred at (x, y, z) with size (sx, sy, sz), optionally turned about Y (rotY) and X (rotX). */
  addBox(x, y, z, sx, sy, sz, color, rotY = 0, rotX = 0, rotZ = 0) {
    tmpEuler.set(rotX, rotY, rotZ, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpMatrix.compose(tmpVec.set(x, y, z), tmpQuat, new THREE.Vector3(sx, sy, sz));
    return this.addGeometry(unitBox, tmpMatrix.clone(), color);
  }

  /**
   * A flat ground quad at height y covering [x0,x1] x [z0,z1], facing up, with UVs 0..1
   * (or world-scaled when uvScale > 0).
   */
  addGroundQuad(x0, z0, x1, z1, y, color, uvScale = 0) {
    tmpColor.set(color);
    const u1 = uvScale > 0 ? (x1 - x0) / uvScale : 1;
    const v1 = uvScale > 0 ? (z1 - z0) / uvScale : 1;
    this.positions.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
    for (let i = 0; i < 4; i += 1) {
      this.normals.push(0, 1, 0);
      this.colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    this.uvs.push(0, 0, 0, v1, u1, v1, u1, 0);
    const b = this.vertexCount;
    this.indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.vertexCount += 4;
    return this;
  }

  /**
   * A vertical wall quad from (x0, z0) to (x1, z1), y0..y1, with an explicit UV rectangle.
   * The visible side is on the left when walking from the first point to the second, and u runs
   * right-to-left for that viewer (pass u0 > u1 for readable text).
   */
  addWallQuad(x0, z0, x1, z1, y0, y1, color, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    tmpColor.set(color);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    this.positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
    for (let i = 0; i < 4; i += 1) {
      this.normals.push(-nx, 0, -nz);
      this.colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const b = this.vertexCount;
    this.indices.push(b, b + 2, b + 1, b, b + 3, b + 2);
    this.vertexCount += 4;
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

/** Matrix from position, Y rotation and scale: the common case for placing props. */
export function placeMatrix(x, y, z, rotY = 0, sx = 1, sy = sx, sz = sx) {
  tmpEuler.set(0, rotY, 0);
  tmpQuat.setFromEuler(tmpEuler);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tmpQuat, new THREE.Vector3(sx, sy, sz));
}

/** A canvas texture drawn by a callback (ctx, width, height). */
export function canvasTexture(width, height, draw, { repeat = false, srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.anisotropy = 8;
  return texture;
}

let glowTex = null;
/** A soft radial falloff, white centre to transparent edge: lamp halos, neon bloom, muzzle flash. */
export function glowTexture() {
  if (glowTex) return glowTex;
  glowTex = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  return glowTex;
}

/** An additive glow sprite of a colour and world size; used for sirens, headlights, markers. */
export function makeGlowSprite(color, size, opacity = 1) {
  const material = new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** A cloud of additive glow points (one draw call) at [x, y, z, r, g, b] entries. */
export function makeGlowPoints(entries, size) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(entries.length * 3);
  const col = new Float32Array(entries.length * 3);
  entries.forEach((e, i) => {
    pos.set([e[0], e[1], e[2]], i * 3);
    col.set([e[3], e[4], e[5]], i * 3);
  });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const material = new THREE.PointsMaterial({
    map: glowTexture(), size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  return points;
}
