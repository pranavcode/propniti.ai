import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemble, applySuggestion, type ImportFile } from "./assemble";
import { KIND_SPECS } from "./fields";
import { detect, missingRequired, presetMapping, synonymMapping } from "./mapping";
import * as N from "./normalize";
import { findHeaderRow, parseDelimited, parseXlsx, readTable, toSheet } from "./parse";
import { PRESETS, TOOLS } from "./presets";
import { xlsx } from "./xlsx.fixture";

const TODAY = "2026-11-04";
const file = (id: string, text: string, tool?: Parameters<typeof detect>[1], over: Partial<ImportFile> = {}): ImportFile => {
  const sheet = toSheet(parseDelimited(text));
  const d = detect(sheet.headers, tool, sheet.rows.some((r) => r.section));
  return { id, name: `${id}.csv`, kind: d.kind, sheet, mapping: d.mapping, preset: d.preset?.id, excluded: [], ...over };
};

describe("parsing", () => {
  it("reads quoted fields, escaped quotes, embedded newlines, tabs and semicolons", () => {
    expect(parseDelimited('a,b\n"x, y","say ""hi"""\n"multi\nline",2')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["multi\nline", "2"]]);
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    // A quote inside a value is literal (5" pipe), not the start of a quoted field.
    expect(parseDelimited('item,size\npipe,5" long')).toEqual([["item", "size"], ["pipe", '5" long']]);
    expect(() => parseDelimited('a,b\n"open,1')).toThrow(/unclosed quote/);
  });

  it("skips report titles above the header, total rows, and reads property headings as sections", () => {
    const t = parseDelimited(["Rent Roll", "As of: 11/04/2026", "", "Unit,Tenant,Rent,Lease From", '"-> Maple Court - 55 Maple Ct, Austin, TX 78701"', "101,Ortiz,1425,02/01/2026", "Total Maple Court,,1425,", "-> Hyde Park Flats", "A1,Ramirez,1180,08/01/2026", "Grand Total,,2605,"].join("\n"));
    expect(findHeaderRow(t)).toBe(2);
    const s = toSheet(t);
    expect(s.headers).toEqual(["Unit", "Tenant", "Rent", "Lease From"]);
    expect(s.rows.map((r) => [r.cells[0], r.section])).toEqual([["101", "Maple Court - 55 Maple Ct, Austin, TX 78701"], ["A1", "Hyde Park Flats"]]);
    expect(s.skipped).toEqual({ titles: 2, totals: 2, sections: 2 });
  });

  it("reads an .xlsx with shared strings, inline strings, numbers and date-formatted cells", async () => {
    const book = await xlsx([["Property", "Unit", "Rent", "Lease From"], ["Maple Court", "101", 1425, { date: "2026-02-01" }], ["Maple Court", "102", 1395.5, { date: "2025-11-15" }]]);
    expect(await parseXlsx(book)).toEqual([["Property", "Unit", "Rent", "Lease From"], ["Maple Court", "101", "1425", "2026-02-01"], ["Maple Court", "102", "1395.5", "2025-11-15"]]);
    expect(await readTable("book.xlsx", book)).toHaveLength(3);
  });

  it("refuses files over the size cap and old .xls files with a clear message", async () => {
    await expect(readTable("big.csv", new Uint8Array(4 * 1024 * 1024))).rejects.toThrow(/up to 3 MB/);
    await expect(readTable("old.xls", new Uint8Array(10))).rejects.toThrow(/Save it as .xlsx or CSV/);
  });
});

describe("normalization", () => {
  it("dates", () => {
    expect(N.date("02/01/2026")).toBe("2026-02-01");
    expect(N.date("2/1/26")).toBe("2026-02-01");
    expect(N.date("2026-2-1")).toBe("2026-02-01");
    expect(N.date("Feb 1, 2026")).toBe("2026-02-01");
    expect(N.date("1-Feb-2026")).toBe("2026-02-01");
    expect(N.date("46054")).toBe("2026-02-01"); // Excel serial
    expect(N.date("02/30/2026")).toBeNull();
    expect(N.date("soon")).toBeNull();
  });
  it("money", () => {
    expect(N.money("$1,425.00")).toBe(1425);
    expect(N.money("(25.50)")).toBe(-25.5);
    expect(N.money("-$10")).toBe(-10);
    expect(N.money("1425")).toBe(1425);
    expect(N.money("two thousand")).toBeNull();
    expect(N.money("TBD")).toBeNull();
  });
  it("phones, emails, states, ZIPs, units", () => {
    expect(N.phone("512.555.0141")).toBe("(512) 555-0141");
    expect(N.phone("+1 (512) 555-0141 x22")).toBe("(512) 555-0141");
    expect(N.phone("Mobile: (512) 555-0141, Home: (512) 555-0142")).toBe("(512) 555-0141");
    expect(N.phone("555-0141")).toBeNull();
    expect(N.email(" Ana@Example.com; b@example.com")).toBe("ana@example.com");
    expect(N.email("ravi.shah@example")).toBeNull();
    expect(N.state("Texas")).toBe("TX");
    expect(N.state("tx")).toBe("TX");
    expect(N.state("Tex")).toBeNull();
    expect(N.zip("2134")).toBe("02134");
    expect(N.zip("78701-1234")).toBe("78701");
    expect(N.unit("Unit 4B")).toBe("4B");
    expect(N.unit("#4b")).toBe("4B");
    expect(N.unit("Apt. 12")).toBe("12");
    expect(N.unit("01-104")).toBe("01-104");
  });
  it("names: Last, First; couples; suffixes; vacant markers", () => {
    expect(N.people("Okafor, Chinedu")).toEqual([{ first: "Chinedu", last: "Okafor" }]);
    expect(N.people("John & Jane Smith")).toEqual([{ first: "John", last: "Smith" }, { first: "Jane", last: "Smith" }]);
    expect(N.people("Smith, John; Lee, Ana")).toEqual([{ first: "John", last: "Smith" }, { first: "Ana", last: "Lee" }]);
    expect(N.people("Mary Ann Smith Jr")).toEqual([{ first: "Mary Ann", last: "Smith Jr" }]);
    expect(N.people("VACANT")).toEqual([]);
    expect(N.titleCase("JOHN O'NEILL-SMITH")).toBe("John O'Neill-Smith");
    expect(N.oddCase("JOHN SMITH")).toBe(true);
    expect(N.oddCase("DeShawn McDonald")).toBe(false);
  });
  it("statuses, percentages, booleans, tax ids, addresses", () => {
    expect(N.residentStatus("Notice-Unrented")).toBe("Notice");
    expect(N.residentStatus("Vacant-Unrented")).toBe("vacant");
    expect(N.leaseStatus("Current", "2026-01-01", "2026-12-31", TODAY)).toBe("Active");
    expect(N.leaseStatus("Current", "2025-01-01", "2025-12-31", TODAY)).toBe("Month-to-month");
    expect(N.leaseStatus("", "2026-12-01", "2027-11-30", TODAY)).toBe("Future");
    expect(N.pct("8%")).toBe(0.08);
    expect(N.pct("0.08")).toBe(0.08);
    expect(N.bool("Yes")).toBe(true);
    expect(N.taxLast4("12-3456789")).toBe("6789");
    expect(N.address("55 Maple Ct, Austin, TX 78701")).toEqual({ street: "55 Maple Ct", city: "Austin", state: "TX", zip: "78701" });
    expect(N.address("4310 Avenue B, Austin, Texas")).toEqual({ street: "4310 Avenue B", city: "Austin", state: "TX", zip: "" });
    expect(N.glFor("Pet rent")).toBe("gl-4310");
    expect(N.isRentCode("rent")).toBe(true);
    expect(N.isRentCode("petrent")).toBe(false);
  });
});

describe("presets", () => {
  it("cover every source tool with a rent roll, and every record kind somewhere", () => {
    for (const t of TOOLS) expect(PRESETS.some((p) => p.tool === t.key && p.kind === "rent_roll"), t.key).toBe(true);
    for (const k of Object.keys(KIND_SPECS)) expect(PRESETS.some((p) => p.kind === k), k).toBe(true);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))("%s: its own headers pick it and map every known column", (_, preset) => {
    const headers = preset.columns.map(([h]) => h);
    const d = detect(headers, preset.tool, preset.sample.grouped);
    expect(d.preset?.id).toBe(preset.id);
    expect(d.kind).toBe(preset.kind);
    for (const [h, f] of preset.columns) if (f) expect(d.mapping[f]?.col, `${h} → ${f}`).toBe(headers.indexOf(h));
    expect(missingRequired(preset.kind, d.mapping, preset.sample.grouped)).toEqual([]);
  });

  it("maps a preset's columns regardless of order, case and extra columns", () => {
    const af = PRESETS.find((p) => p.id === "appfolio.rent-roll")!;
    const headers = ["Notes", ...af.columns.map(([h]) => h.toUpperCase()).reverse(), "Property"];
    const m = presetMapping(headers, af);
    expect(m.tenant?.col).toBe(headers.indexOf("TENANT"));
    expect(m.tenant?.source).toBe("preset");
  });

  it("falls back to synonyms and close spellings for unknown layouts", () => {
    const headers = ["Bldg", "Apt", "Lessee", "Monthly Rent", "Lease Expires On", "Lease Begin", "Email Addr"];
    const m = synonymMapping(headers, "rent_roll");
    expect(m.unit).toMatchObject({ col: 1, source: "synonym" });
    expect(m.tenant).toMatchObject({ col: 2, source: "synonym" });
    expect(m.rent).toMatchObject({ col: 3, source: "synonym" });
    expect(m.leaseStart).toMatchObject({ col: 5, source: "synonym" });
    expect(m.email?.source).toBe("similar");
    expect(m.property).toBeUndefined();
    expect(missingRequired("rent_roll", m)).toEqual(["Property name"]);
  });

  it("detects the record kind of generic files", () => {
    expect(detect(["Property", "Unit", "First Name", "Last Name", "Email"]).kind).toBe("residents");
    expect(detect(["Vendor", "Trade", "Phone", "1099"]).kind).toBe("vendors");
    expect(detect(["Owner Name", "Company", "Email", "Fee %"]).kind).toBe("owners");
    expect(detect(["Property", "Unit", "Tenant", "0-30", "31-60", "61-90", "90+", "Total"]).kind).toBe("balances");
    expect(detect(["Property", "Unit", "Sq Ft", "Market Rent", "Status"]).kind).toBe("units");
    expect(detect(["Property", "Street", "City", "State", "Zip"]).kind).toBe("properties");
    expect(detect(["Property", "Unit", "Tenant", "Rent", "Lease Start", "Lease End"]).kind).toBe("rent_roll");
  });
});

const ROLL = `Property Name,Property Address,Unit #,Resident,Email,Phone,Monthly Rent,Lease From,Lease To,Owner
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",101,Maria Gonzalez,maria@example.com,512.555.0141,"$1,385.00",03/01/2026,02/28/2027,Bluebonnet Fund
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",#102,"Wu, Derek",derek@example,(512) 555-0187,"$1,410.00",2026-06-01,2027-05-31,Bluebonnet Fund
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",103,VACANT,,,"$1,395.00",,,Bluebonnet Fund
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",104,TOM BECKER,tom@example.com,,TBD,2026-01-01,2026-12-31,Bluebonnet Fund
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",105,Ana Ruiz,ana@example.com,,1400,2026-02-01,2025-01-31,Bluebonnet Fund
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",101,Maria Gonzalez,maria@example.com,512.555.0141,"$1,385.00",03/01/2026,02/28/2027,Bluebonnet Fund
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",Unit 106,Leo Park,leo@example.com,,14000,2026-04-01,2027-03-31,Bluebonnet Fund
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",107,Sam Hill,sam@example.com,,1450,2026-04-01,,Bluebonnet Fund
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",108,Ivy Chen,ivy@example.com,,1350,2026-05-01,2027-04-30,Bluebonnet Fund`;

describe("assemble", () => {
  it("normalizes a rent roll into properties, units, leases and people, with row issues", () => {
    const f = file("f1", ROLL, "generic");
    expect(f.kind).toBe("rent_roll");
    const a = assemble([f], [], TODAY);
    const msg = (line: number) => a.issues.filter((i) => i.line === line).map((i) => `${i.severity}: ${i.message}`);
    expect(msg(3)).toEqual(['warning: Email "derek@example" looks invalid; left blank']);
    expect(msg(5)).toEqual(['error: Monthly rent "TBD" isn\'t an amount', "error: No rent amount"]);
    expect(msg(6)).toEqual(["error: Lease ends (2025-01-31) before it starts (2026-02-01)"]);
    expect(msg(7)).toEqual(["warning: Exact copy of row 2; skipped"]);
    expect(msg(8)).toEqual(["warning: Rent 14000.00 is more than 3× the file's median (1410.00); check for a typo"]);
    expect(msg(9)).toEqual(["warning: No lease end date: imported as month-to-month"]);
    const p = a.payload;
    expect(p.properties).toMatchObject([{ name: "Eastside Commons", street: "2105 E Cesar Chavez St", city: "Austin", state: "TX", zip: "78702", owner: "Bluebonnet Fund" }]);
    expect(p.units.map((u) => [u.number, u.status])).toEqual([["101", "Occupied"], ["102", "Occupied"], ["103", "Vacant"], ["106", "Occupied"], ["107", "Occupied"], ["108", "Occupied"]]);
    expect(p.units.find((u) => u.number === "103")!.marketRent).toBe(1395);
    expect(p.leases.map((l) => l.unit)).toEqual(["101", "102", "106", "107", "108"]);
    expect(p.leases[1]!.people).toEqual([{ first: "Derek", last: "Wu", email: undefined, phone: "(512) 555-0187" }]);
    expect(p.leases[0]).toMatchObject({ start: "2026-03-01", end: "2027-02-28", rent: 1385, status: "Active", people: [{ first: "Maria", last: "Gonzalez", phone: "(512) 555-0141" }] });
    expect(p.leases.find((l) => l.unit === "107")!.status).toBe("Month-to-month");
    expect(a.cleanup.f1).toMatchObject({ "Unit numbers cleaned (Unit 4B, #4B → 4B)": 2, "Names written Last, First split": 1 });
    // ALL-CAPS names come back as a rules suggestion, not a silent change.
    expect(a.suggestions).toEqual([expect.objectContaining({ kind: "replace", field: "tenant", from: "TOM BECKER", to: "Tom Becker", source: "rules" })]);
  });

  it("applies accepted fixes and exclusions, then the same input gives the same records", () => {
    const f = file("f1", ROLL, "generic");
    const a = assemble([f], [], TODAY);
    let state = { files: [f], edits: [] as Parameters<typeof assemble>[1] };
    state = applySuggestion(a.suggestions[0]!, state.files, state.edits);
    state = applySuggestion({ id: "x", file: "f1", field: "rent", kind: "replace", from: "TBD", to: "1500", line: 5, reason: "", confidence: 1, source: "ai", rows: 1 }, state.files, state.edits);
    state = applySuggestion({ id: "y", file: "f1", field: "leaseEnd", kind: "exclude", line: 6, reason: "", confidence: 1, source: "rules", rows: 1 }, state.files, state.edits);
    const b = assemble(state.files, state.edits, TODAY);
    expect(b.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(b.payload.leases.find((l) => l.unit === "104")).toMatchObject({ rent: 1500, people: [{ first: "Tom", last: "Becker" }] });
    expect(b.payload.leases.some((l) => l.unit === "105")).toBe(false);
    expect(assemble(state.files, state.edits, TODAY).payload).toEqual(b.payload);
  });

  it("suggests swapping lease date columns when most rows end before they start", () => {
    const f = file("f1", "Property,Unit,Tenant,Rent,Lease Start,Lease End\nA,1,Al Bo,900,2027-01-31,2026-02-01\nA,2,Cy Do,900,2027-03-31,2026-04-01\nA,3,Ed Fa,900,2027-05-31,2026-06-01");
    const a = assemble([f], [], TODAY);
    const swap = a.suggestions.find((s) => s.kind === "swap")!;
    expect(swap).toMatchObject({ field: "leaseStart", other: "leaseEnd", rows: 3 });
    const fixed = applySuggestion(swap, [f], []);
    expect(assemble(fixed.files, [], TODAY).issues).toEqual([]);
  });

  it("reads Yardi-style charge rows: rent from the rent code, the rest as recurring charges", () => {
    const text = `Property,Unit,Resident,Name,Market Rent,Charge Code,Amount,Resident Deposit,Move In,Lease Expiration,Balance
Sonoran Flats,101,t0001,"Diaz, Elena",1500,rent,1450,500,01/15/2026,01/31/2027,0
,,,,,petrent,35,,,,
,,,,,parking,50,,,,
Sonoran Flats,102,,VACANT,1525,,,,,,
Sonoran Flats,103,t0002,Omar Haddad,1500,rent,1475,500,03/01/2026,02/28/2027,220.50`;
    const f = file("v", text, "yardi_voyager");
    expect(f.preset).toBe("yardi_voyager.rent-roll-with-lease-charges");
    const a = assemble([f], [], TODAY);
    expect(a.issues).toEqual([]);
    expect(a.payload.leases.map((l) => [l.unit, l.rent, l.deposit, l.start, l.externalId])).toEqual([["101", 1450, 500, "2026-01-15", "t0001"], ["103", 1475, 500, "2026-03-01", "t0002"]]);
    expect(a.payload.recurring.map((r) => [r.unit, r.label, r.amount])).toEqual([["101", "petrent", 35], ["101", "parking", 50]]);
    expect(a.payload.units.find((u) => u.number === "102")).toMatchObject({ status: "Vacant", marketRent: 1525 });
    expect(a.payload.balances).toEqual([expect.objectContaining({ unit: "103", buckets: [220.5, 0, 0, 0] })]);
  });

  it("uses a section heading or a chosen default when a file has no property column", () => {
    const grouped = file("g", "Unit,Tenant,Rent,Lease From,Lease To\n\"-> Maple Court - 55 Maple Ct, Austin, TX 78701\"\n101,Ortiz,1425,02/01/2026,01/31/2027");
    expect(assemble([grouped], [], TODAY).payload.properties).toMatchObject([{ name: "Maple Court", street: "55 Maple Ct", city: "Austin", state: "TX" }]);
    const plain = file("p", "Unit,Tenant,Rent,Lease From,Lease To\n101,Ortiz,1425,02/01/2026,01/31/2027", undefined, { defaultProperty: "Hyde Park Flats" });
    expect(assemble([plain], [], TODAY).payload.leases[0]!.property).toBe("hyde park flats");
  });

  it("joins a tenant directory to the rent roll and flags duplicates across rows", () => {
    const roll = file("r", "Property,Unit,Tenant,Rent,Lease From,Lease To\nA,1,Ana Lee,900,2026-01-01,2026-12-31\nA,1,Bo Kim,950,2026-02-01,2027-01-31");
    const dir = file("d", "Property,Unit,First Name,Last Name,Email,Phone\nA,1,Ana,Lee,ana@example.com,5125550100\nA,2,Cy,Do,cy@example.com,\nA,2,Cy,Do,cy@example.com,");
    const a = assemble([dir, roll], [], TODAY);
    expect(a.issues.map((i) => `${i.file}:${i.line} ${i.message}`)).toEqual(["r:3 Unit 1 already has a current lease on row 2. Exclude one of the two rows.", "d:4 Cy Do is also on row 3; skipped"]);
    expect(a.payload.leases[0]!.people[0]).toMatchObject({ first: "Ana", email: "ana@example.com", phone: "(512) 555-0100" });
    expect(a.payload.residents.map((r) => r.first)).toEqual(["Cy"]);
  });

  it("owners keep only the last 4 tax digits; vendors default the trade; balances use aging columns", () => {
    const owners = file("o", "Name,Company Name,Emails,Phone Numbers,Address,Tax ID,Management Fee\nHelen Park,Park Family Holdings LLC,helen@example.com,602-555-0100,\"1 Main St, Phoenix, AZ 85004\",12-3456789,7.5%", "appfolio");
    const vendors = file("v", "Vendor Name,Type,Contact,Email,Phone,1099\nDesert Air HVAC,,Luis Mora,luis@example.com,6025550111,Yes", "yardi_breeze");
    const bal = file("b", "Property,Unit,Tenant,Total,0-30,31-60,61-90,90+\nA,1,Ana Lee,300,100,200,0,0\nA,2,Bo Kim,-50,,,,\nA,3,Cy Do,0,0,0,0,0", "rent_manager");
    const a = assemble([owners, vendors, bal], [], TODAY);
    expect(a.payload.owners).toEqual([expect.objectContaining({ name: "Helen Park", entity: "Park Family Holdings LLC", state: "AZ", taxLast4: "6789", feePct: 0.075, phone: "(602) 555-0100" })]);
    expect(a.payload.vendors).toEqual([expect.objectContaining({ company: "Desert Air HVAC", trade: "General", is1099: true, status: "Active" })]);
    expect(a.payload.balances.map((b) => [b.unit, b.buckets])).toEqual([["1", [100, 200, 0, 0]]]);
    expect(a.issues.map((i) => i.message)).toEqual(["Credit balance (-50.00) isn't imported; record it as a credit on the lease"]);
  });
});

describe("sample files", () => {
  it.each(PRESETS.map((p) => [p.file, p] as const))("%s is read, matched to its preset and imports without errors", async (_, preset) => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), "public/samples", preset.file)));
    const sheet = toSheet(await readTable(preset.file, bytes));
    const d = detect(sheet.headers, preset.tool, sheet.rows.some((r) => r.section));
    expect(d.preset?.id).toBe(preset.id);
    const f: ImportFile = { id: "s", name: preset.file, kind: d.kind, sheet, mapping: d.mapping, preset: d.preset?.id, excluded: [] };
    const a = assemble([f], [], TODAY);
    expect(a.issues.filter((i) => i.severity === "error")).toEqual([]);
    const total = Object.values(a.payload).reduce((s, list) => s + list.length, 0);
    expect(total).toBeGreaterThan(0);
  });
});
