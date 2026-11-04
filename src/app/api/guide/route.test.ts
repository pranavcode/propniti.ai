import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openFixture } from "@/ai/__tests__/fixture";
import { PERMISSIONS } from "@/auth/personas";

// GET /api/guide on the AI test fixture: p01 and p02 in Austin (Marcus's scope), p10 in Atlanta.
const fx = openFixture();
vi.mock("@/lib/platform", () => ({ getPlatform: () => ({ db: fx.db }) }));
const { GET } = await import("./route");

const get = async (persona: string) => {
  const res = await GET(new Request("http://x/api/guide", { headers: { cookie: `pn_as=${persona}` } }));
  return { status: res.status, body: await res.json() };
};

beforeAll(() => {
  const p = (id: string, property: string) => fx.raw.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, confidence, queue_state, created_at) VALUES ('base', ?, 'collections', 'leases', 'l1', ?, 'leases.send_reminder', 'Remind', 0.9, 'needs_you', '2026-11-03')").run(id, property);
  p("pr1", "p01");
  p("pr2", "p01");
  p("pr3", "p10");
  p("pr4", "p01");
  fx.raw.prepare("INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, decided_at) VALUES ('base', 'd1', 'pr4', 'Approved', 'marcus', '2026-11-03')").run();
  fx.raw.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, confidence, queue_state, created_at) VALUES ('base', 'pr5', 'collections', 'leases', 'l1', 'p01', 'leases.send_reminder', 'Auto', 0.9, 'auto_handled', '2026-11-03')").run();
  const issue = (id: string, property: string, severity: string) => fx.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity) VALUES ('base', ?, 'properties.address_format', 'properties', ?, ?, '2026-11-01', ?)").run(id, property, property, severity);
  issue("di-c1", "p01", "critical");
  issue("di-c2", "p10", "critical");
  issue("di-w1", "p01", "warn");
  const task = (id: string, assignee: string, due: string, status = "Open") => fx.raw.prepare("INSERT INTO tasks (workspace_id, id, title, property_id, assignee_id, due_on, status, created_at) VALUES ('base', ?, 'Call back', 'p01', ?, ?, ?, '2026-10-20')").run(id, assignee, due, status);
  task("t1", "marcus", "2026-10-30");
  task("t2", "marcus", "2026-10-31");
  task("t3", "marcus", "2026-10-31", "Done");
  task("t4", "daniel", "2026-10-30");
});

afterEach(() => { PERMISSIONS.leasing_agent.intelligence = "read"; });

describe("GET /api/guide", () => {
  it("refuses portal personas", async () => {
    expect((await get("owner")).status).toBe(403);
    expect((await get("resident")).status).toBe(403);
  });

  it("counts within the persona's properties: open needs-you proposals, 31+ day balances and critical issues", async () => {
    // p01: Sep (64 days) and Oct (34 days) rent for l1, Oct for l2. p10 (90+ days) is outside Marcus's scope.
    expect((await get("marcus")).body).toMatchObject({ approvals: 2, pastDue: { cents: 400000, properties: 1 }, dataIssues: { critical: 1 } });
    expect((await get("daniel")).body).toMatchObject({ approvals: 3, pastDue: { cents: 700000, properties: 2 }, dataIssues: { critical: 2 } });
  });

  it("counts the persona's own open overdue tasks and conversations waiting on a reply", async () => {
    expect((await get("marcus")).body).toMatchObject({ tasks: { overdue: 2, today: 0 }, replies: 0 });
    expect((await get("daniel")).body.tasks).toEqual({ overdue: 1, today: 0 });
  });

  it("leaves out past-due balances for a role that can't see charges", async () => {
    const { status, body } = await get("lena");
    expect(status).toBe(200);
    expect(body.pastDue).toBeNull();
  });

  it("leaves out approvals for a role without the intelligence module, as the nav does", async () => {
    PERMISSIONS.leasing_agent.intelligence = "none";
    expect((await get("lena")).body.approvals).toBeNull();
  });
});
