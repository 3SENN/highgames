// What the Atelier kit provides, so the builds leave it out (docs/apps.md › The kit). Atelier adds an import map to the
// game's pages that points `three`, kit 1's three.js add-ons and `atelier-kit/…` at the kit it serves, so the game and
// the companion runtime share one three.js (the version Atelier's companions are built with). Add-ons the kit doesn't
// serve are bundled with the game; they import `three`, which stays the kit's.

/** Kit 1's add-ons (atelier/scripts/kit/build.mjs › ADDONS). Within a major, the kit never removes one. */
export const KIT_ADDONS: readonly string[] = [
  'loaders/GLTFLoader.js',
  'libs/meshopt_decoder.module.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
  'controls/OrbitControls.js',
];

/** Rollup's `external`: true for what Atelier's import map serves from the kit. */
export function fromKit(id: string): boolean {
  if (id === 'three' || id.startsWith('atelier-kit/')) return true;
  const addon = /^three\/(?:addons|examples\/jsm)\/(.+)$/.exec(id);
  return addon !== null && KIT_ADDONS.includes(addon[1] as string);
}
