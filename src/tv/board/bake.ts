// Scenery is built from hundreds of little `part` meshes (each with its outline hull), most with a colour of
// their own. Drawn one by one that is thousands of draw calls, far too many for a laptop, so static scenery is
// baked: meshes whose materials differ only in colour are merged into one mesh with the colours stored per
// vertex, in the root's own space. Anything marked `userData.live` (and lights, sprites, points, and meshes with
// a texture map) is carried over untouched so it can still move.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOK_UNIFORMS } from '../render/toon';

/** Marks an object (and everything under it) to be left alone by `bake`. */
export function live<T extends THREE.Object3D>(o: T): T {
  o.userData.live = true;
  return o;
}

function mergeable(mesh: THREE.Mesh): boolean {
  const m = mesh.material;
  if (Array.isArray(m)) return false;
  if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return false;
  if (m.name === 'outline') return true;
  if ((m as THREE.MeshToonMaterial).map) return false;
  if ((m as THREE.ShaderMaterial).isShaderMaterial) return false;
  return true;
}

type Hg = Record<string, THREE.IUniform>;

/**
 * What a material is apart from its colour, or null when it can't share a mesh with other colours (glowing or
 * see-through materials keep a mesh per material).
 */
function finishOf(m: THREE.Material): string | null {
  if (m.name === 'outline') return `outline:${String((m as THREE.ShaderMaterial).uniforms.thickness?.value)}`;
  const toon = m as THREE.MeshToonMaterial & { hg?: Hg };
  if (!toon.isMeshToonMaterial || !toon.hg || m.transparent || m.vertexColors) return null;
  if (toon.emissiveIntensity > 0 && toon.emissive.getHex() !== 0) return null;
  const bits: string[] = [Object.keys(m.defines ?? {}).sort().join(','), String(m.side)];
  for (const key of Object.keys(toon.hg).sort()) {
    const v: unknown = toon.hg[key]?.value;
    if (typeof v === 'number') bits.push(`${key}=${v}`);
    else if (v instanceof THREE.Vector3) bits.push(`${key}=${v.toArray().join('/')}`);
    else if (v instanceof THREE.Texture) bits.push(`${key}=${v.uuid}`);
  }
  return bits.join('|');
}

const OUTLINE_VERTEX = /* glsl */ `
uniform float thickness;
varying vec3 vInk;
#include <common>
#include <fog_pars_vertex>
void main() {
  vInk = color;
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vec3 n = normalize( mat3( modelMatrix ) * normal );
  world.xyz += n * thickness;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const OUTLINE_FRAGMENT = /* glsl */ `
uniform float hgOutline;
varying vec3 vInk;
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4( vInk * hgOutline, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const shared = new Map<string, THREE.Material>();
/** The one material that draws every colour of a finish (the colour comes from the vertices). */
function sharedMaterial(finish: string, like: THREE.Material): THREE.Material {
  let m = shared.get(finish);
  if (m) return m;
  if (like.name === 'outline') {
    m = new THREE.ShaderMaterial({
      name: 'outline',
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), thickness: { value: (like as THREE.ShaderMaterial).uniforms.thickness?.value as number }, hgOutline: LOOK_UNIFORMS.hgOutline },
      vertexShader: OUTLINE_VERTEX,
      fragmentShader: OUTLINE_FRAGMENT,
      side: THREE.BackSide,
      fog: true,
      vertexColors: true,
    });
  } else {
    const copy = like.clone() as THREE.MeshToonMaterial;
    // `clone` keeps the finish's uniforms but not its shader switches.
    copy.defines = { ...(like.defines ?? {}) };
    copy.color.set(0xffffff);
    copy.vertexColors = true;
    copy.needsUpdate = true;
    m = copy;
  }
  shared.set(finish, m);
  return m;
}

function colourOf(m: THREE.Material): THREE.Color {
  if (m.name === 'outline') return (m as THREE.ShaderMaterial).uniforms.color?.value as THREE.Color;
  return (m as THREE.MeshToonMaterial).color;
}

interface Bucket {
  material: THREE.Material;
  finish: string | null;
  cast: boolean;
  receive: boolean;
  order: number;
  parts: THREE.BufferGeometry[];
}

/**
 * Returns a new group that draws the same picture as `root` with a handful of meshes. `root` is consumed (its
 * live children move over). The result takes `root`'s position, rotation and scale.
 */
export function bake(root: THREE.Object3D): THREE.Group {
  const out = new THREE.Group();
  out.name = root.name || 'baked';
  const keepPos = root.position.clone();
  const keepQuat = root.quaternion.clone();
  const keepScale = root.scale.clone();
  // Bake in the root's own space.
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  const parent = root.parent;
  parent?.remove(root);
  root.updateMatrixWorld(true);

  const buckets = new Map<string, Bucket>();
  const carry: THREE.Object3D[] = [];
  const visit = (o: THREE.Object3D): void => {
    if (o !== root && (o.userData.live || !o.visible)) {
      if (o.visible) carry.push(o);
      return;
    }
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      if (!mergeable(mesh)) {
        carry.push(o);
        return;
      }
      const material = mesh.material as THREE.Material;
      const finish = finishOf(material);
      const key = `${finish ?? material.uuid}:${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}:${mesh.renderOrder}`;
      let b = buckets.get(key);
      if (!b) {
        b = { material, finish, cast: mesh.castShadow, receive: mesh.receiveShadow, order: mesh.renderOrder, parts: [] };
        buckets.set(key, b);
      }
      const src = mesh.geometry;
      const g = new THREE.BufferGeometry();
      const flat = src.index ? src.toNonIndexed() : src;
      const position = (flat.getAttribute('position') as THREE.BufferAttribute).clone();
      g.setAttribute('position', position);
      const n = flat.getAttribute('normal') as THREE.BufferAttribute | undefined;
      if (n) g.setAttribute('normal', n.clone());
      else g.computeVertexNormals();
      g.applyMatrix4(mesh.matrixWorld);
      if (mesh.matrixWorld.determinant() < 0) {
        // A mirrored part: flip the winding back.
        const nn = g.getAttribute('normal') as THREE.BufferAttribute;
        for (let i = 0; i < position.count; i += 3) {
          for (const a of [position, nn]) {
            const x = a.getX(i + 1);
            const y = a.getY(i + 1);
            const z = a.getZ(i + 1);
            a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
            a.setXYZ(i + 2, x, y, z);
          }
        }
      }
      if (finish !== null) {
        const c = colourOf(material);
        const colours = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {
          colours[i * 3] = c.r;
          colours[i * 3 + 1] = c.g;
          colours[i * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      }
      if (flat !== src) flat.dispose();
      b.parts.push(g);
    } else if ((o as THREE.Light).isLight || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) {
      carry.push(o);
      return;
    }
    for (const c of [...o.children]) visit(c);
  };
  visit(root);

  for (const b of buckets.values()) {
    const merged = b.parts.length === 1 ? (b.parts[0] as THREE.BufferGeometry) : mergeGeometries(b.parts, false);
    if (!merged) continue;
    if (b.parts.length > 1) for (const p of b.parts) p.dispose();
    const mesh = new THREE.Mesh(merged, b.finish !== null ? sharedMaterial(b.finish, b.material) : b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.renderOrder = b.order;
    if (b.material.name === 'outline') {
      mesh.name = 'outline';
      mesh.raycast = () => {};
    }
    out.add(mesh);
  }
  for (const o of carry) {
    const m = o.matrixWorld.clone();
    o.removeFromParent();
    m.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  out.position.copy(keepPos);
  out.quaternion.copy(keepQuat);
  out.scale.copy(keepScale);
  parent?.add(out);
  return out;
}
