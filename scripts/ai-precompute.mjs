// Precomputes AI record summaries and the home briefings with the real model, so first views
// show AI text without a live call. Writes .seed/ai-precompute.sql (base rows, labelled with the
// model and time) for the D1 base load.
//
// 1. Start a local server with a model available and a token, for example
//      PRECOMPUTE_TOKEN=local doppler run --project brahma --config dev -- npm run dev
//    (OPENAI_API_KEY from Doppler; or ANTHROPIC_API_KEY; or `npm run dev:vinext` for Workers AI
//    through the remote binding). Keys stay in the environment; nothing here stores them.
// 2. BASE_URL=http://localhost:3000 PRECOMPUTE_TOKEN=local node scripts/ai-precompute.mjs
//
// Resumable: records already in the output file are skipped. LIMIT caps the record count (300).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.PRECOMPUTE_TOKEN;
const LIMIT = Number(process.env.LIMIT ?? 300);
const OUT = new URL("../.seed/ai-precompute.sql", import.meta.url);
if (!TOKEN) {
  console.error("Set PRECOMPUTE_TOKEN (the same value the server was started with).");
  process.exit(1);
}

const headers = { "x-precompute-token": TOKEN, "content-type": "application/json" };
const call = async (method, body) => {
  const res = await fetch(`${BASE_URL}/api/ai/precompute`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const insert = (r) =>
  `INSERT INTO ai_summaries (workspace_id, id, entity_type, entity_id, summary, facts, model, generated_at) VALUES ('base', ${q(`sum-${r.entity_type}-${r.entity_id}`)}, ${q(r.entity_type)}, ${q(r.entity_id)}, ${q(r.summary)}, ${q(JSON.stringify(r.facts))}, ${q(r.model)}, ${q(r.generated_at)}) ON CONFLICT (workspace_id, id) DO UPDATE SET summary = excluded.summary, facts = excluded.facts, model = excluded.model, generated_at = excluded.generated_at;`;

const lines = existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter((l) => l.startsWith("INSERT")) : [];
const done = new Set(lines.map((l) => l.match(/'(sum-[^']+)'/)?.[1]));
const { targets } = await call("GET");
const todo = targets.slice(0, LIMIT).filter((t) => !done.has(`sum-${t.entity}-${t.id}`));
console.log(`${targets.length} targets, ${done.size} already done, ${todo.length} to go against ${BASE_URL}`);

const save = () => {
  mkdirSync(new URL("../.seed/", import.meta.url), { recursive: true });
  writeFileSync(OUT, `-- AI summaries and briefings, generated ${new Date().toISOString()} by scripts/ai-precompute.mjs\n${lines.join("\n")}\n`);
};
let models = new Set();
for (let i = 0; i < todo.length; i += 5) {
  const { rows } = await call("POST", { items: todo.slice(i, i + 5) });
  for (const r of rows) if (!r.error) { lines.push(insert(r)); models.add(r.model); }
  save();
  console.log(`  ${Math.min(i + 5, todo.length)}/${todo.length}`);
}
const { rows: briefings } = await call("POST", { briefings: true });
for (const r of briefings) { lines.push(insert(r)); models.add(r.model); }
save();
console.log(`Wrote ${lines.length} rows to .seed/ai-precompute.sql (models: ${[...models].join(", ") || "none"})`);
if (models.has("rules")) console.log("Some rows fell back to rules: check the server log for model errors.");
