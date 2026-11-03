import { describe, expect, it } from "vitest";
import { abstractByRules, compareAbstract, fillTemplate, formatPhone, leaseDocument, normalizeContact, suggestMerge, type LeaseRecord } from "./lib";

describe("normalizeContact", () => {
  it("moves a phone number out of the email field", () => {
    const c = normalizeContact({ first_name: "Ana", last_name: "Ruiz", email: "512.555.0142", phone: "" });
    expect(c.find((x) => x.field === "email")?.after).toBe("");
    expect(c.find((x) => x.field === "phone")?.after).toBe("(512) 555-0142");
  });
  it("keeps a different phone on file and says so", () => {
    const c = normalizeContact({ first_name: "Ana", last_name: "Ruiz", email: "(512) 555-0142", phone: "737-555-1111" });
    expect(c.find((x) => x.field === "phone")?.after).toBe("(737) 555-1111");
    expect(c.find((x) => x.field === "phone")?.why).toMatch(/different number/);
  });
  it("normalises case and format, and leaves clean records alone", () => {
    expect(normalizeContact({ first_name: "JOSÉ", last_name: "núñez", email: " Jose@Mail.Example ", phone: "5125550142" }).map((x) => [x.field, x.after])).toEqual([
      ["email", "jose@mail.example"], ["phone", "(512) 555-0142"], ["first_name", "José"], ["last_name", "Núñez"],
    ]);
    expect(normalizeContact({ first_name: "Zoë", last_name: "Ødegaard", email: "zoe@mail.example", phone: "(512) 555-0142" })).toEqual([]);
  });
  it("rejects things that aren't phones", () => {
    expect(formatPhone("ana@mail.example")).toBeNull();
    expect(formatPhone("+1 512 555 0142")).toBe("(512) 555-0142");
  });
});

describe("suggestMerge", () => {
  it("keeps the older record but takes better values from the duplicate", () => {
    const s = suggestMerge(
      { first_name: "MARIA", last_name: "LOPEZ", email: "5125550142", phone: "(512) 555-0142", household_id: "hh1", preferred_channel: "Email" },
      { first_name: "Maria", last_name: "Lopez", email: "maria@mail.example", phone: "512-555-0142", household_id: "hh1", preferred_channel: "SMS" },
    );
    expect(s.choice.email).toBe("duplicate");
    expect(s.choice.first_name).toBe("duplicate");
    expect(s.choice.preferred_channel).toBe("keep");
    expect(s.confidence).toBeGreaterThan(0.9);
  });
});

const lease: LeaseRecord = {
  id: "L-1", kind: "Commercial", property: "South Congress Retail Row", unit: "101", tenant: "Bluebird Coffee LLC", residents: [],
  start_on: "2023-11-01", end_on: "2028-10-31", term_months: 60, rent_cents: 376500, deposit_cents: 753000, market_rent_cents: 380000,
  escalations: [{ on: "2024-11-01", pct: 3 }, { on: "2025-11-01", pct: 3 }], nnn_share_pct: 5.52, cam_cents: 101300, tax_cents: 40000, insurance_cents: 9000,
};

describe("lease abstraction", () => {
  it("reads every term back from the signed document with its page", () => {
    const ex = abstractByRules(leaseDocument(lease));
    const by = Object.fromEntries(ex.map((e) => [e.key, e]));
    expect(by.rent_cents.value).toBe(376500);
    expect(by.end_on.value).toBe("2028-10-31");
    expect(by.start_on.page).toBe(1);
    expect(by.rent_cents.page).toBe(2);
    expect(by.nnn_share_pct.value).toBe(5.52);
    expect(by.escalations.value).toMatch(/November 1, 2024, 3% increase; November 1, 2025/);
    expect(compareAbstract(ex, lease).every((c) => c.match !== false)).toBe(true);
  });
  it("flags a rent keyed 10x and an end date before the start", () => {
    const bad = { ...lease, kind: "Residential", rent_cents: 140000 * 10, market_rent_cents: 140000, end_on: "2022-10-31" };
    const cmp = compareAbstract(abstractByRules(leaseDocument(bad)), bad);
    const rent = cmp.find((c) => c.key === "rent_cents")!;
    expect(rent).toMatchObject({ match: false, document: 140000, record: 1400000, column: "rent_cents" });
    expect(cmp.find((c) => c.key === "end_on")).toMatchObject({ match: false, document: "2028-10-31" });
  });
});

describe("swapped lease dates", () => {
  it("reads the signed start and end back when the record has them swapped", () => {
    const bad = { ...lease, kind: "Residential", start_on: "2025-08-31", end_on: "2024-03-01", term_months: 18 };
    const cmp = compareAbstract(abstractByRules(leaseDocument(bad)), bad);
    expect(cmp.find((c) => c.key === "start_on")).toMatchObject({ match: false, document: "2024-03-01", record: "2025-08-31" });
    expect(cmp.find((c) => c.key === "end_on")).toMatchObject({ match: false, document: "2025-08-31", record: "2024-03-01" });
  });
});

describe("fillTemplate", () => {
  it("fills known fields and leaves unknown ones visible", () => {
    expect(fillTemplate("Hi {{first_name}}, {{balance}} due {{ due_date }} {{x}}", { first_name: "Ana", balance: "$12.50", due_date: "Nov 1" })).toBe("Hi Ana, $12.50 due Nov 1 {{x}}");
  });
});
