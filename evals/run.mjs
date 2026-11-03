// Live AI eval: sends each case in evals/cases/ to the app's real AI routes and grades the answers.
//   npm run eval                                   # against https://propniti.ai
//   BASE_URL=http://localhost:3001 npm run eval    # against a local server
//   EVAL_ONLY=extract npm run eval                 # only cases whose id contains "extract"
// Exits 1 when the pass rate is below MIN_PASS (default 0.8). Fallbacks to mock count as not passed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gradeAsk, gradeExtract, gradeMap, gradeParse, gradeValidate, isFallback, overriddenByRules } from "./graders.mjs";

const BASE_URL = (process.env.BASE_URL || "https://propniti.ai").replace(/\/$/, "");
const MIN_PASS = Number(process.env.MIN_PASS ?? 0.8);
const ONLY = process.env.EVAL_ONLY ?? "";
const GAP_MS = 3500; // the AI routes allow 20 calls a minute per IP
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT));
const cases = (area) => JSON.parse(read(`evals/cases/${area}.json`)).filter((c) => c.id.includes(ONLY));

let lastStart = 0;
async function call(path, init) {
  const wait = lastStart + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
  const res = await fetch(BASE_URL + path, { ...init, headers: { Origin: BASE_URL, ...init.headers }, signal: AbortSignal.timeout(120_000) });
  if (res.status === 429) {
    console.log("  rate limited; waiting 61 s");
    await new Promise((r) => setTimeout(r, 61_000));
    lastStart = 0;
    return call(path, init);
  }
  const body = await res.json().catch(() => ({ error: `non-JSON response (${res.status})` }));
  if (!res.ok) throw new Error(`${res.status}: ${body.error ?? "request failed"}`);
  return body;
}
const postJson = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Small RFC 4180 reader for the sample CSVs (quoted fields with commas).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field || row.length) endRow();
  return rows.filter((r) => r.some((f) => f.trim()));
}

async function main() {
  const status = await fetch(`${BASE_URL}/api/ai/status`).then((r) => r.json());
  const { state } = await fetch(`${BASE_URL}/api/state`, { headers: { Origin: BASE_URL } }).then((r) => r.json());
  console.log(`AI eval against ${BASE_URL} (provider: ${status.label})\n`);

  const areas = [
    ["Invoice reading", "extract", (c) => {
      const form = new FormData();
      form.append("file", new Blob([read(c.file)], { type: "image/png" }), c.file.split("/").pop());
      return call("/api/ai/extract", { method: "POST", body: form });
    }, gradeExtract],
    ["Invoice vs PO", "validate", (c) => {
      const wo = state.workOrders.find((w) => w.id === c.workOrder);
      return postJson("/api/ai/validate", { workOrder: { id: wo.id, title: wo.title, po: wo.po, submission: c.submission } });
    }, gradeValidate],
    ["Assistant", "ask", (c) => postJson("/api/ai/ask", { question: c.question, state }), (c, res) => gradeAsk(c, res, state)],
    ["Column mapping", "import-map", (c) => {
      const table = c.csv ? parseCsv(read(c.csv).toString()) : [c.headers, ...c.samples];
      return postJson("/api/ai/import-map", { headers: table[0], samples: table.slice(1, 6) });
    }, gradeMap],
    ["Pasted notes", "import-parse", (c) => postJson("/api/ai/import-parse", { text: c.text }), gradeParse],
  ];

  const results = [];
  for (const [label, area, send, grade] of areas) {
    const list = cases(area);
    if (!list.length) continue;
    console.log(`${label} (${list.length} cases)…`);
    for (const c of list) {
      const t0 = Date.now();
      let res, outcome, checks = [], error;
      try {
        res = await send(c);
      } catch (err) {
        error = err.message;
      }
      const latencyMs = Date.now() - t0;
      if (error) outcome = "error";
      else if (isFallback(res)) outcome = "fallback";
      else {
        const g = grade(c, res);
        checks = g.checks;
        outcome = (g.pass ?? checks.every((x) => x.ok)) ? "pass" : "fail";
      }
      const accuracy = checks.length ? checks.filter((x) => x.ok).length / checks.length : 0;
      const failed = checks.filter((x) => !x.ok).map((x) => (x.detail !== undefined ? `${x.name} (got ${x.detail})` : x.name));
      const notes = [];
      if (area === "validate" && res && overriddenByRules(res)) notes.push("model said approve; rules changed it to review");
      const reason = error ?? (outcome === "fallback" ? res.note : [...failed, ...notes].join("; "));
      results.push({ area: label, id: c.id, outcome, accuracy, source: res?.source ?? "-", latencyMs, reason, checks, response: res });
    }
    console.table(
      results.filter((r) => r.area === label).map((r) => ({ case: r.id, outcome: r.outcome, accuracy: `${Math.round(r.accuracy * 100)}%`, source: r.source, "latency s": (r.latencyMs / 1000).toFixed(1), reason: r.reason.slice(0, 90) })),
    );
  }

  const summary = Object.entries(Object.groupBy(results, (r) => r.area)).map(([area, rs]) => ({
    area,
    cases: rs.length,
    pass: rs.filter((r) => r.outcome === "pass").length,
    fail: rs.filter((r) => r.outcome === "fail").length,
    fallback: rs.filter((r) => r.outcome === "fallback").length,
    error: rs.filter((r) => r.outcome === "error").length,
    "pass rate": `${Math.round((rs.filter((r) => r.outcome === "pass").length / rs.length) * 100)}%`,
    accuracy: `${Math.round((rs.reduce((a, r) => a + r.accuracy, 0) / rs.length) * 100)}%`,
    "median latency s": (rs.map((r) => r.latencyMs).sort((a, b) => a - b)[Math.floor(rs.length / 2)] / 1000).toFixed(1),
  }));
  const passRate = results.filter((r) => r.outcome === "pass").length / results.length;
  console.log("\nSummary");
  console.table(summary);
  console.log(`Overall: ${results.filter((r) => r.outcome === "pass").length}/${results.length} passed (${Math.round(passRate * 100)}%), minimum ${Math.round(MIN_PASS * 100)}%`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = new URL("evals/results/", ROOT);
  mkdirSync(out, { recursive: true });
  writeFileSync(new URL(`${stamp}.json`, out), JSON.stringify({ baseUrl: BASE_URL, provider: status, ranAt: new Date().toISOString(), passRate, summary, results }, null, 2));
  writeFileSync(new URL("latest.md", out), markdown({ baseUrl: BASE_URL, provider: status.label, passRate, summary, results }));
  console.log(`Wrote evals/results/${stamp}.json and evals/results/latest.md`);
  process.exitCode = passRate >= MIN_PASS ? 0 : 1;
}

function markdown({ baseUrl, provider, passRate, summary, results }) {
  const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const table = (rows) => {
    const cols = Object.keys(rows[0]);
    return [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(" | ")} |`)].join("\n");
  };
  return `# Latest AI eval

Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC against ${baseUrl} (provider: ${provider}).
**${results.filter((r) => r.outcome === "pass").length}/${results.length} cases passed (${Math.round(passRate * 100)}%).**

${table(summary)}

## Cases

${table(results.map((r) => ({ area: r.area, case: r.id, outcome: r.outcome, accuracy: `${Math.round(r.accuracy * 100)}%`, source: r.source, "latency s": (r.latencyMs / 1000).toFixed(1), notes: r.reason || "" })))}
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
