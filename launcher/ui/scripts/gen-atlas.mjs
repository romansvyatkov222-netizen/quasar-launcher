import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Генератор атласа текстур Minecraft-блоков для voxel-фона лаунчера.
 * Кладёт N 16x16 тайлов в один PNG + пишет JSON-маппинг (имя -> индекс тайла).
 * Запуск: node scripts/gen-atlas.mjs (нужен sharp)
 */
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.warn("sharp не установлен — атлас не сгенерирован");
  process.exit(0);
}

const SRC = path.resolve("..", "mc-textures");
const OUT_DIR = path.resolve("src", "assets");
const TILE = 16;
const ATLAS_COLS = 4;

const BLOCKS = [
  "grass_block_side",
  "grass_block_top",
  "dirt",
  "stone",
  "oak_planks",
  "deepslate",
  "amethyst_block",
  "cobblestone",
  "glowstone",
  "mossy_cobblestone",
  "smooth_stone",
  "end_stone",
];

async function main() {
  const tiles = [];
  for (const name of BLOCKS) {
    const file = path.join(SRC, `${name}.png`);
    if (!existsSync(file)) {
      console.warn(`нет текстуры: ${name} — пропущен`);
      continue;
    }
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .resize(TILE, TILE, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    tiles.push({ name, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
  }

  if (tiles.length === 0) {
    console.warn("нет ни одной текстуры в ../mc-textures — атлас не сгенерирован (см. ui/scripts/gen-atlas.mjs)");
    process.exit(0);
  }

  const rows = Math.ceil(tiles.length / ATLAS_COLS);
  const W = ATLAS_COLS * TILE;
  const H = rows * TILE;
  const atlas = Buffer.alloc(W * H * 4);

  tiles.forEach((t, i) => {
    const cx = (i % ATLAS_COLS) * TILE;
    const cy = Math.floor(i / ATLAS_COLS) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const src = (y * TILE + x) * 4;
        const dst = ((cy + y) * W + (cx + x)) * 4;
        atlas.set(t.data.subarray(src, src + 4), dst);
      }
    }
  });

  await sharp(atlas, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, "block-atlas.png"));

  const mapping = Object.fromEntries(tiles.map((t, i) => [t.name, i]));
  writeFileSync(
    path.join(OUT_DIR, "block-atlas.json"),
    JSON.stringify({ cols: ATLAS_COLS, rows, tile: TILE, count: tiles.length, blocks: mapping }, null, 2),
  );
  console.log(`атлас: ${W}x${H}, тайлов: ${tiles.length}`);
}

main();
