import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openFixture, WS } from "@/ai/__tests__/fixture";
import { setModelForTests } from "@/ai/providers";
import { demoNowIso } from "@/lib/clock";
import type { Db, RateLimiter } from "@/lib/platform/types";

// POST /apply/<listing>/submit: the application is always saved; the Leasing Agent scores it at
// once only within the AI rate limit and the workspace's hourly cap on event runs. Otherwise the
// event waits for the 15-minute sweep.

const platform: { db?: Db; limiter?: RateLimiter; writeLimiter?: RateLimiter } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));
const later: (() => Promise<unknown>)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => later.push(fn) }));
const route = await import("@/app/(public)/apply/[listingId]/submit/route");

const allow: RateLimiter = { limit: async () => ({ success: true }) };
const deny: RateLimiter = { limit: async () => ({ success: false }) };

function setup() {
  const f = openFixture();
  f.raw.exec(`
    INSERT INTO meta (key, value) VALUES ('base_version', 'v1');
    UPDATE workspaces SET base_version = 'v1';
    INSERT INTO unit_types (workspace_id, id, property_id, name, beds, sqft) VALUES ('base', 'ut1', 'p01', 'A1', 1, 700);
    UPDATE units SET unit_type_id = 'ut1', sqft = 700 WHERE id = 'u2';
    INSERT INTO listings (workspace_id, id, property_id, unit_id, headline, rent_cents, status, listed_on) VALUES ('base', 'L1', 'p01', 'u2', 'Bright 1 bed', 150000, 'Active', '2026-10-01');
  `);
  platform.db = f.db;
  platform.limiter = allow;
  platform.writeLimiter = allow;
  return f;
}

const body = {
  personal: { first_name: "Ada", last_name: "Park", email: "ada@park.example", phone: "(512) 555-0142", move_in: "2026-12-01", lease_months: 12, adults: 1 },
  residence: { street: "1 Oak St", city: "Austin", state: "TX", zip: "78704", since: "2024-01", rent: 1200, evicted: "no" },
  income: { employment: "Employed", employer: "Acme", monthly_income: 6000, credit: "Good" },
  documents: { files: [{ kind: "Photo ID", name: "id.png", size: 100, type: "image/png" }, { kind: "Proof of income", name: "pay.pdf", size: 100, type: "application/pdf" }] },
  consent: { screening: true, accurate: true, signature: "Ada Park" },
};
const submit = () =>
  route.POST(new Request("http://x/apply/L1/submit", { method: "POST", body: JSON.stringify(body), headers: { origin: "http://x", host: "x", "cf-connecting-ip": "1.2.3.4", cookie: `pn_ws=${WS}` } }), { params: Promise.resolve({ listingId: "L1" }) });

const pending = (raw: ReturnType<typeof openFixture>["raw"]) => raw.prepare("SELECT count(*) AS n FROM events WHERE type = 'application.submitted' AND processed_at IS NULL").get() as { n: number };

beforeEach(() => {
  later.length = 0;
  setModelForTests(null);
});
afterEach(() => setModelForTests(undefined));

describe("public application submit", () => {
  it("scores the application at once within the AI limit", async () => {
    const { raw } = setup();
    expect((await submit()).status).toBe(200);
    expect(later.length).toBe(1);
    await Promise.all(later.map((fn) => fn()));
    expect(pending(raw).n).toBe(0);
  });

  it("saves the application and leaves scoring to the sweep when the AI limit is spent", async () => {
    const { raw } = setup();
    platform.limiter = deny;
    const res = await submit();
    expect(res.status).toBe(200);
    expect((await res.json()).applicationId).toMatch(/^app_/);
    expect(later.length).toBe(0);
    expect(pending(raw).n).toBe(1);
  });

  it("caps runs the public site starts per workspace an hour", async () => {
    const { raw } = setup();
    const now = demoNowIso();
    const ins = raw.prepare("INSERT INTO agent_runs (workspace_id, id, agent_key, trigger_kind, started_by, status, started_at) VALUES (?, ?, 'leasing', 'event', 'system', 'done', ?)");
    for (let i = 0; i < 10; i++) ins.run(WS, `run-${i}`, now);
    expect((await submit()).status).toBe(200);
    expect(later.length).toBe(0);
    expect(pending(raw).n).toBe(1);
  });
});
