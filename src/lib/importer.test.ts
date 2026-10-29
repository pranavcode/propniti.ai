import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMapping, existingUnitKeys, guessMapping, importPortfolio, parseCsv, parseDate, validateRows, widthProblems } from "./importer";
import { seed } from "./seed";

const sample = (f: string) => parseCsv(readFileSync(`public/samples/${f}`, "utf8"));

describe("parseCsv", () => {
  it("handles quotes, embedded commas, escaped quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("reads tab-separated text, even with commas in a header", () => {
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("Property\tAddress, line 1\tUnit\nA\t1 Main St\t2")[0]).toEqual(["Property", "Address, line 1", "Unit"]);
  });
  it("rejects unclosed or mid-value quotes and flags rows of the wrong width", () => {
    expect(() => parseCsv('a,b\n"oops,1\n2,3')).toThrow(/unclosed quote/);
    expect(() => parseCsv('a,b\nx"y,1')).toThrow(/middle of a value/);
    expect(widthProblems([["a", "b"], ["1", "2", "3"]])).toEqual(["Row 2 has 3 columns but the header has 2"]);
    expect(widthProblems([["a", "b"], ["1"]])).toEqual(["Row 2 has 1 columns but the header has 2"]);
  });
  it("prefers tabs when tabs and commas tie on the header line", () => {
    expect(parseCsv("Property\tAddress, line 1\nA\t1 Main St")[0]).toEqual(["Property", "Address, line 1"]);
  });
});

describe("guessMapping", () => {
  it("maps AppFolio-style headers", () => {
    const m = guessMapping(sample("appfolio-style-rent-roll.csv")[0]);
    expect(m).toMatchObject({ property: "Property", unit: "Unit", tenant: "Tenant", rent: "Rent", leaseStart: "Lease From", leaseEnd: "Lease To", email: "Email", phone: "Phone Number", address: "Property Address" });
  });
  it("maps Buildium-style headers", () => {
    const m = guessMapping(sample("buildium-style-export.csv")[0]);
    expect(m).toMatchObject({ property: "Rental name", unit: "Unit number", tenant: "Resident name", email: "Resident email", rent: "Rent amount", leaseStart: "Lease start date", leaseEnd: "Lease end date", owner: "Owner name" });
  });
});

describe("parseDate", () => {
  it("accepts ISO and US formats and rejects impossible dates", () => {
    expect(parseDate("2026-12-31")).toBe("2026-12-31");
    expect(parseDate("02/01/2026")).toBe("2026-02-01");
    expect(parseDate("2/1/26")).toBe("2026-02-01");
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("soon")).toBeNull();
  });
});

describe("validateRows + importPortfolio", () => {
  it("accepts a clean rent roll and imports it", () => {
    const t = sample("appfolio-style-rent-roll.csv");
    const checks = validateRows(applyMapping(t, guessMapping(t[0])));
    expect(checks.every((c) => c.errors.length === 0)).toBe(true);
    const { state, counts } = importPortfolio(seed(), checks.map((c) => c.row));
    expect(counts).toEqual({ properties: 2, tenancies: 6 });
    const maple = state.properties.find((p) => p.name === "Maple Court Apartments")!;
    expect(maple).toMatchObject({ units: 4, occupied: 4, address: "55 Maple Ct, Austin, TX" });
    const sara = state.tenancies.find((x) => state.users.find((u) => u.id === x.tenantId)?.name === "Sara Whitfield")!;
    expect(sara).toMatchObject({ rent: 1480, leaseEnd: "2026-12-05", status: "Renewal due" }); // within 45 days
  });

  it("keeps IDs unique when importing twice", () => {
    const t = sample("appfolio-style-rent-roll.csv");
    const rows = validateRows(applyMapping(t, guessMapping(t[0]))).map((c) => c.row).slice(0, 2);
    const once = importPortfolio(seed(), rows).state;
    const twice = importPortfolio(once, [{ ...rows[0], unit: "999" }]).state;
    expect(new Set(twice.tenancies.map((x) => x.id)).size).toBe(twice.tenancies.length);
    expect(new Set(twice.invoices.map((x) => x.id)).size).toBe(twice.invoices.length);
  });

  it("catches bad rent, duplicates, missing tenants and suspicious emails", () => {
    const t = sample("buildium-style-export.csv");
    const checks = validateRows(applyMapping(t, guessMapping(t[0])));
    expect(checks[0].errors).toEqual([]);
    expect(checks[1].warnings.join()).toMatch(/looks invalid/);
    expect(checks[2].errors.join()).toMatch(/not a positive amount/);
    expect(checks[3].errors.join()).toMatch(/Duplicate/);
    expect(checks[4].errors.join()).toMatch(/Tenant name is missing/);
  });

  it("flags rows already in the portfolio when a file is imported again", () => {
    const t = sample("appfolio-style-rent-roll.csv");
    const rows = validateRows(applyMapping(t, guessMapping(t[0]))).map((c) => c.row);
    const once = importPortfolio(seed(), rows).state;
    const recheck = validateRows(rows, existingUnitKeys(once));
    expect(recheck.every((c) => c.errors.some((e) => e.startsWith("Already in your portfolio")))).toBe(true);
    // Even if stale rows reach the import step, nothing is duplicated.
    const twice = importPortfolio(once, rows);
    expect(twice.counts.tenancies).toBe(0);
    expect(twice.state.tenancies.length).toBe(once.tenancies.length);
  });

  it("gives distinct IDs to names that slug the same, and types retail as commercial", () => {
    const rows = [
      { property: "A B", unit: "1", tenant: "X", rent: "100", owner: "O P" },
      { property: "A-B", unit: "1", tenant: "Y", rent: "100", owner: "O-P" },
      { property: "Cedar Plaza Retail", unit: "Suite A", tenant: "Z", rent: "100" },
    ];
    const { state } = importPortfolio(seed(), rows);
    const ids = state.properties.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.properties.find((p) => p.name === "A B")?.id).not.toBe(state.properties.find((p) => p.name === "A-B")?.id);
    expect(new Set(state.users.map((u) => u.id)).size).toBe(state.users.length);
    expect(state.properties.find((p) => p.name === "Cedar Plaza Retail")?.type).toBe("Commercial");
  });
});
