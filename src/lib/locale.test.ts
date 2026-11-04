import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Numbers and dates without a locale take the server's default, so a host set to en-IN wrote
// "$10,89,793". Every toLocale*/Intl call names "en-US".
function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe("number and date formatting", () => {
  it("always names the en-US locale", () => {
    const root = join(__dirname, "..", "..");
    const offenders = [...sources(join(root, "src"))]
      .map((p) => relative(root, p))
      .filter((p) => /\.toLocale(String|DateString|TimeString)\(\s*(\)|undefined|\{)|Intl\.\w+\(\s*(\)|undefined|\{)/.test(readFileSync(join(root, p), "utf8")));
    expect(offenders).toEqual([]);
  });
});
