// GitHub project pages add the repository name before public asset paths.
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const FIREWOOD_BASE = `${APP_BASE_PATH}/firewood`;

export const ASSETS = {
  models: {
    stumpMesh: `${FIREWOOD_BASE}/models/stump_mesh.glb`,
    stumpData: `${FIREWOOD_BASE}/models/stump_data.glb`,
    axStatic: `${FIREWOOD_BASE}/models/ax_static.glb`,
    axAnim: `${FIREWOOD_BASE}/models/ax_anim.glb`,
  },
  textures: {
    bark: `${FIREWOOD_BASE}/textures/outsidebark.jpg`,
    barkN: `${FIREWOOD_BASE}/textures/outsidebark_n.jpg`,
    top: `${FIREWOOD_BASE}/textures/top.jpg`,
    topN: `${FIREWOOD_BASE}/textures/top_n.jpg`,
    grain: `${FIREWOOD_BASE}/textures/insidegrain.jpg`,
    grainN: `${FIREWOOD_BASE}/textures/insidegrain_n.jpg`,
    gameplay: {
      barkColor: `${FIREWOOD_BASE}/gameplay/textures/bark/bark001_color.jpg`,
      barkNormal: `${FIREWOOD_BASE}/gameplay/textures/bark/bark001_normal.jpg`,
      barkRoughness: `${FIREWOOD_BASE}/gameplay/textures/bark/bark001_roughness.jpg`,
      treeEndDark: `${FIREWOOD_BASE}/gameplay/textures/tree-end/treeend003_color.jpg`,
      treeEndDarkNormal: `${FIREWOOD_BASE}/gameplay/textures/tree-end/treeend003_normal.jpg`,
      treeEndWarm: `${FIREWOOD_BASE}/gameplay/textures/tree-end/treeend005_color.jpg`,
      treeEndWarmNormal: `${FIREWOOD_BASE}/gameplay/textures/tree-end/treeend005_normal.jpg`,
      rockColor: `${FIREWOOD_BASE}/gameplay/textures/rock/rock_pitted_mossy_diff_1k.jpg`,
      rockNormal: `${FIREWOOD_BASE}/gameplay/textures/rock/rock_pitted_mossy_nor_gl_1k.jpg`,
      rockRoughness: `${FIREWOOD_BASE}/gameplay/textures/rock/rock_pitted_mossy_rough_1k.jpg`,
      fireDensity: `${FIREWOOD_BASE}/gameplay/textures/fire/fire-density.png`,
    },
  },
  video: {
    gobo: `${FIREWOOD_BASE}/video/gobo.mp4`,
  },
  sounds: {
    bg: `${FIREWOOD_BASE}/sounds/bg.mp3`,
    drop: `${FIREWOOD_BASE}/sounds/drop.mp3`,
    split: Array.from(
      { length: 6 },
      (_, i) => `${FIREWOOD_BASE}/sounds/split${i + 1}.mp3`,
    ),
    splitb: Array.from(
      { length: 10 },
      (_, i) => `${FIREWOOD_BASE}/sounds/splitb${i + 1}.mp3`,
    ),
    stack: Array.from(
      { length: 14 },
      (_, i) => `${FIREWOOD_BASE}/sounds/stack${i + 1}.mp3`,
    ),
    campfire: `${FIREWOOD_BASE}/gameplay/sounds/campfire-loop.mp3`,
  },
  basis: {
    transcoderPath: `${FIREWOOD_BASE}/basis/`,
  },
} as const;

export type AssetMap = typeof ASSETS;
