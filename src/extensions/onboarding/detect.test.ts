import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readTable, toSheet } from "@/extensions/import/parse";
import { PRESETS } from "@/extensions/import/presets";
import { detectFile, mainTool, type FileHeaders } from "./detect";

// Deterministic detection of the source tool and record type of each dropped file, from its header
// row and file name only. This is what runs when AI is off or unavailable.

async function sample(file: string, name = file): Promise<FileHeaders> {
  const sheet = toSheet(await readTable(file, new Uint8Array(readFileSync(`public/samples/${file}`))));
  return { id: file, name, headers: sheet.headers, hasSection: sheet.rows.some((r) => r.section) };
}
const csvSamples = readdirSync("public/samples").filter((f) => f.endsWith(".csv") && PRESETS.some((p) => p.file === f));

describe("detectFile (rules)", () => {
  it("names the tool and record type of every preset sample file", async () => {
    for (const file of csvSamples) {
      const preset = PRESETS.find((p) => p.file === file)!;
      const d = detectFile(await sample(file));
      expect({ file, tool: d.tool, kind: d.kind }).toEqual({ file, tool: preset.tool, kind: preset.kind });
      expect(d.source).toBe("rules");
      expect(d.confidence).toBeGreaterThan(0.5);
    }
  });

  it("finds the AppFolio rent roll under its property headings, from headers alone", async () => {
    const d = detectFile(await sample("appfolio-rent-roll.csv", "export (3).csv"));
    expect(d).toMatchObject({ tool: "appfolio", kind: "rent_roll", preset: "appfolio.rent-roll" });
    expect(d.reason).toMatch(/AppFolio Rent Roll/);
  });

  it("without a helpful file name, still places the record type and lists the tools it can't tell apart", async () => {
    let unsure = 0;
    for (const file of csvSamples) {
      const preset = PRESETS.find((p) => p.file === file)!;
      const d = detectFile(await sample(file, "export.csv"));
      expect(d.kind, file).toBe(preset.kind);
      if (d.tool !== preset.tool) {
        unsure++;
        expect(d.alternatives, file).toContain(preset.tool);
        expect(d.confidence, file).toBeLessThan(0.7);
      }
    }
    // DoorLoop and TenantCloud rent rolls differ by one letter ("Tenants" / "Tenant"), so a few stay unsure.
    expect(unsure).toBeLessThan(csvSamples.length / 4);
  });

  it("uses the file name to break a tie between near-identical layouts", () => {
    const headers = ["Property", "Unit", "Tenant", "Lease Start", "Lease End", "Rent", "Deposit", "Balance"];
    expect(detectFile({ id: "a", name: "doorloop rent roll.csv", headers }).tool).toBe("doorloop");
    expect(detectFile({ id: "b", name: "TenantCloud_rent_roll.csv", headers }).tool).toBe("tenantcloud");
    expect(detectFile({ id: "c", name: "TenantCloud_rent_roll.csv", headers }).reason).toMatch(/file name/);
  });

  it("falls back to matching column names for a hand-kept spreadsheet", () => {
    const d = detectFile({ id: "x", name: "our vendors.csv", headers: ["Vendor name", "Trade", "Contact person", "Email address", "Phone"] });
    expect(d).toMatchObject({ tool: "generic", kind: "vendors" });
    expect(d.preset).toBeUndefined();
    expect(d.reason).toMatch(/column names/);
    expect(d.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe("mainTool", () => {
  it("is the tool most files came from, ignoring spreadsheets", () => {
    const d = (tool: string) => ({ tool }) as Parameters<typeof mainTool>[0][number];
    expect(mainTool([d("generic"), d("buildium"), d("appfolio"), d("appfolio")])).toBe("appfolio");
    expect(mainTool([d("generic")])).toBe("generic");
    expect(mainTool([])).toBe("generic");
  });
});
