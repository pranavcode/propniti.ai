import { afterEach, describe, expect, it, vi } from "vitest";
import { setModelForTests } from "@/ai/providers";
import { openFixture, WS } from "@/ai/__tests__/fixture";
import type { Db } from "@/lib/platform/types";

// GET /api/ai/assistant/about (the card "Ask about this" opens with) and the assistant route's
// streamed progress (application/x-ndjson): status lines, then the reply.

const platform: { db?: Db } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));
const about = await import("../assistant/about/route");
const assistant = await import("../assistant/route");

afterEach(() => setModelForTests(undefined));

const headers = (persona: string) => ({ cookie: `pn_as=${persona}; pn_ws=${WS}`, host: "x", origin: "http://x", "cf-connecting-ip": `t-${Math.random()}` });
const card = (persona: string, entity: string, id: string) => about.GET(new Request(`http://x/api/ai/assistant/about?entity=${entity}&id=${encodeURIComponent(id)}`, { headers: headers(persona) }));

function setup() {
  setModelForTests(null);
  const f = openFixture();
  f.raw.exec("UPDATE work_orders SET vendor_id = 'v01', estimate_cents = 57800 WHERE id = 'WO-10001'");
  platform.db = f.db;
  return f;
}

describe("about card route", () => {
  it("returns the record card and questions for a record in scope", async () => {
    setup();
    const res = await card("marcus", "work_orders", "WO-10001");
    expect(res.status).toBe(200);
    const c = await res.json();
    expect(c).toMatchObject({ type: "Work order", title: "Kitchen sink leaking under cabinet", status: "New" });
    expect(c.questions).toContain("Is the $578 estimate normal for this job?");
  });

  it("answers 404 for a missing record or one outside the persona's scope", async () => {
    setup();
    expect((await card("marcus", "work_orders", "WO-missing")).status).toBe(404);
    expect((await card("marcus", "nope", "x")).status).toBe(404);
    // A portal persona sees no property-wide records through the assistant.
    expect((await card("applicant", "work_orders", "WO-10001")).status).toBe(404);
  });
});

describe("assistant route streaming", () => {
  it("streams status lines and then the reply when asked for ndjson", async () => {
    setup();
    const res = await assistant.POST(new Request("http://x/api/ai/assistant", {
      method: "POST",
      headers: { ...headers("marcus"), "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ question: "Why is this taking long?", context: { entity: "work_orders", id: "WO-10001", title: "Kitchen sink leaking under cabinet" } }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ status: "Reading WO-10001…" });
    const last = lines.at(-1);
    expect(last.reply.answer).toContain("Kitchen sink leaking under cabinet");
    expect(last.reply.answer).not.toMatch(/\b(p01|u1|v01)\b/);
  });

  it("still answers with plain JSON by default", async () => {
    setup();
    const res = await assistant.POST(new Request("http://x/api/ai/assistant", { method: "POST", headers: { ...headers("marcus"), "content-type": "application/json" }, body: JSON.stringify({ question: "Who is late on rent?" }) }));
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).answer).toMatch(/late/);
  });
});
