// Writes the generated base dataset as SQL for D1: .seed/base.sql (chunked multi-row INSERTs,
// each statement under 60 KB, inside D1's 100 KB limit). Loading it also wipes every visitor
// overlay, which the owner-statement seq cutoff requires (plan §1).
//
//   node scripts/seed-d1.mjs
//   npx wrangler d1 migrations apply <DB> --remote          # 0001–0003 (or `cf d1 migrations apply <id>`)
//   npx wrangler d1 execute <DB> --remote --file .seed/base.sql --yes
//   npx wrangler d1 execute <DB> --remote --file .seed/ai-precompute.sql --yes   # when the AI lane has written it
//
// `cf` (the repo's Cloudflare CLI) has no `d1 execute --file`; wrangler's uses D1's bulk import API,
// which is the supported way to load a file this size. Run it at deploy time, never per request.
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { baseData, baseSql } = await jiti.import(join(root, "src/server/base.ts"));

const started = performance.now();
const base = baseData();
const out = join(root, ".seed", "base.sql");
mkdirSync(dirname(out), { recursive: true });
let statements = 0;
const chunks = [];
for (const s of baseSql(base)) {
  chunks.push(s);
  statements++;
}
writeFileSync(out, chunks.join("\n") + "\n");
const rows = Object.values(base.tables).reduce((n, t) => n + t.length, 0);
console.log(`.seed/base.sql: ${rows.toLocaleString("en-US")} rows in ${statements.toLocaleString("en-US")} statements, ${(statSync(out).size / 1048576).toFixed(1)} MB, ${Math.round(performance.now() - started)} ms`);
console.log(`base_version ${base.meta.base_version}, as_of ${base.meta.as_of}`);
if (existsSync(join(root, ".seed", "ai-precompute.sql"))) console.log("Also load .seed/ai-precompute.sql after base.sql.");
