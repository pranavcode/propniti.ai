// Copies the generated photos from ../research/images into public/img/<set>/ as a main WebP
// (at most 1600 px wide, never upscaled) plus a 400 px "-400" thumbnail, both at quality 72.
// Rerunnable: a file is rebuilt only when its source is newer. Usage: node scripts/seed-images.mjs [srcDir]
import { mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] ?? join(root, "..", "research", "images");
const out = join(root, "public", "img");

const SETS = [
  [/^p\d\d(-[a-z]+)?\.webp$/, "props"],
  [/^unit-/, "units"],
  [/^amenity-/, "amenities"],
  [/^wo-/, "wo"],
  [/^hero-/, "marketing"],
];

const fresh = (target, source) => existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs;

let built = 0;
let skipped = 0;
for (const name of readdirSync(src).filter((f) => f.endsWith(".webp")).sort()) {
  const set = SETS.find(([re]) => re.test(name))?.[1];
  if (!set) continue;
  const from = join(src, name);
  const dir = join(out, set);
  mkdirSync(dir, { recursive: true });
  const base = name.replace(/\.webp$/, "");
  for (const [width, file] of [[1600, `${base}.webp`], [400, `${base}-400.webp`]]) {
    const to = join(dir, file);
    if (fresh(to, from)) {
      skipped++;
      continue;
    }
    await sharp(from).resize({ width, withoutEnlargement: true }).webp({ quality: 72 }).toFile(to);
    built++;
  }
}

let bytes = 0;
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : (bytes += statSync(join(d, e.name)).size)));
walk(out);
console.log(`images: ${built} built, ${skipped} up to date, public/img = ${(bytes / 1048576).toFixed(1)} MB`);
