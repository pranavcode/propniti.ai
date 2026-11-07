import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Each org reads its own base: hand-written SQL names it with baseOf(ws), baseSql() or ANY_BASE
// (src/server/effective.ts), never a literal 'base', which is Summit's. These files are the
// exceptions, each for a reason that holds for both orgs.
const ALLOWED: Record<string, string> = {
  "server/effective.ts": "defines the base workspaces and the shared reference tables",
  "server/query.ts": "the query layer's own effective(); the as-of fallback reads Summit's months",
  "server/base.ts": "loads both bases",
  "ai/data.ts": "the AI runtime's effective(), including the shared reference tables",
  "ai/orchestrator.ts": "clears sweep runs left in Summit's base",
  "ai/data-rules.ts": "data_rules is a shared reference table",
  "extensions/onboarding/server.ts": "data_rules is a shared reference table",
  "components/marketing/proof.ts": "the public site shows Summit's portfolio",
  "extensions/platform/console.ts": "the platform console reports across orgs",
};

const SRC = join(__dirname, "..");
const LITERAL = /workspace_id\s*(?:=|<>|!=|(?:NOT\s+)?IN\s*\([^)]*?)\s*'base'(?=[,)\s"`]|$)/i;

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") yield* sources(p); }
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$|\.fixture\.ts$/.test(e.name)) yield p;
  }
}

describe("base workspace reads", () => {
  it("name the org's base, not a literal 'base', outside the allowed files", () => {
    const found: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED[rel]) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => { if (LITERAL.test(line)) found.push(`${rel}:${i + 1}`); });
    }
    expect(found).toEqual([]);
  });
});
