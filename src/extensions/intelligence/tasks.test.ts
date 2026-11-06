import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import { getAction } from "@/extensions/actions";
import type { Actor } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { getRow, list, updateRecord, type WriteCtx } from "@/server/query";
import { emptyDb, seed, WS } from "@/server/query.fixture";
import { runAction } from "@/app/api/e/_lib/actions";
import { demoNowIso } from "@/lib/clock";
import { createTask, myTasksQuery, relatedRecords } from "./my-tasks";

// My tasks: whose tasks, which view, scope, and the guarded status changes and create.
// The fixture's demo day (meta.as_of) is 2026-10-28.

let db: Db;
const NOW = Date.parse("2026-10-28T15:00:00Z");
const actor = (persona: string) => actorFor(db, WS, getPersona(persona)!);
const wctx = async (persona: string): Promise<WriteCtx> => ({ db, ws: WS, actor: await actor(persona), nowMs: NOW });
const mineIds = async (a: Actor, qs = "") => (await list({ db, ws: WS, actor: a }, "tasks", myTasksQuery(a, new URLSearchParams(qs)))).rows.map((r) => r.id);
const task = (id: string, o: { title?: string; assignee?: string | null; role?: string | null; pid?: string | null; due?: string | null; status?: string; source?: string; by?: string; entity?: [string, string]; created?: string }) =>
  db.prepare("INSERT INTO tasks (workspace_id, id, title, entity_type, entity_id, property_id, assignee_id, assignee_role, created_by, due_on, status, source, created_at) VALUES ('base', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, o.title ?? id, o.entity?.[0] ?? null, o.entity?.[1] ?? null, o.pid === undefined ? "p01" : o.pid, o.assignee === undefined ? "marcus" : o.assignee, o.role ?? null, o.by ?? "marcus", o.due === undefined ? "2026-10-30" : o.due, o.status ?? "Open", o.source ?? "Manual", o.created ?? "2026-10-20T10:00:00Z");

beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.batch([
    task("t-overdue", { due: "2026-10-20", entity: ["units", "p01-u1"] }),
    task("t-today", { pid: "p02", due: "2026-10-28", status: "In progress" }),
    task("t-later", { pid: "p03", due: "2026-11-05" }),
    task("t-nodate", { due: null }),
    task("t-done", { due: "2026-10-01", status: "Done" }),
    task("t-role", { assignee: null, role: "property_manager", due: "2026-11-01" }),
    task("t-lena", { assignee: "lena" }),
    task("t-atlanta", { pid: "p05" }),
    task("t-acct", { assignee: null, role: "accountant", pid: null, entity: ["vendors", "v01"] }),
    // Added from a vendor's record panel: vendors have no property, so neither does the task.
    task("t-vendor", { pid: null, entity: ["vendors", "v01"], due: "2026-11-02" }),
    task("t-agent", { assignee: null, role: "maintenance_supervisor", source: "Agent", by: "system", entity: ["work_orders", "WO-1"], created: "2026-10-27T09:00:00Z" }),
    db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, opened_at) VALUES ('base', 'WO-1', 'p01', 'Water heater leaking', 'Plumbing', 'Urgent', 'New', '2026-10-26T09:00:00Z')"),
    db.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, action, title, confidence, run_id, created_at) VALUES ('base', 'prop-1', 'maintenance_triage', 'work_orders', 'WO-1', 'work_orders.dispatch', 'Dispatch a plumber', 0.9, 'run-7', '2026-10-27T08:00:00Z')"),
  ]);
});

describe("my tasks", () => {
  it("lists my open tasks and my role's unassigned ones, by due date, with a count per view", async () => {
    const marcus = await actor("marcus");
    expect(await mineIds(marcus)).toEqual(["t-nodate", "t-overdue", "t-today", "t-role", "t-vendor", "t-later"]);
    const res = await list({ db, ws: WS, actor: marcus }, "tasks", myTasksQuery(marcus, new URLSearchParams()));
    expect(res.counts).toEqual({ overdue: 1, today: 1, upcoming: 4, done: 1 });
  });

  it("splits overdue, today, upcoming and done on the demo day", async () => {
    const marcus = await actor("marcus");
    expect(await mineIds(marcus, "due=overdue")).toEqual(["t-overdue"]);
    expect(await mineIds(marcus, "due=today")).toEqual(["t-today"]);
    expect(await mineIds(marcus, "due=upcoming")).toEqual(["t-nodate", "t-role", "t-vendor", "t-later"]);
    expect(await mineIds(marcus, "due=done")).toEqual(["t-done"]);
  });

  it("keeps the person and scope fixed whatever the URL asks for", async () => {
    const marcus = await actor("marcus");
    // Another person's tasks, and tasks outside the scope, never show.
    expect(await mineIds(marcus, "f.assignee_key=lena")).not.toContain("t-lena");
    expect(await mineIds(marcus, "f.property_id=p05")).toEqual([]);
    expect(await getRow({ db, ws: WS, actor: marcus }, "tasks", "t-atlanta")).toBeNull();
    // Filters narrow within my tasks.
    expect(await mineIds(marcus, "f.property_id=p02")).toEqual(["t-today"]);
    // Org-wide accountant sees the role task with no property; the supervisor gets the agent's.
    expect(await mineIds(await actor("grace"))).toEqual(["t-acct"]);
    expect(await mineIds(await actor("tom"))).toEqual(["t-agent"]);
  });

  it("names the agent and the run behind an agent's task", async () => {
    const row = await getRow({ db, ws: WS, actor: await actor("tom") }, "tasks", "t-agent");
    expect(row).toMatchObject({ source: "Agent", agent: "maintenance_triage", run_id: "run-7" });
    expect(await getRow({ db, ws: WS, actor: await actor("marcus") }, "tasks", "t-overdue")).toMatchObject({ agent: null, run_id: null, created_by__label: null });
  });

  it("titles related records in scope and links them", async () => {
    const marcus = await actor("marcus");
    const rel = await relatedRecords({ db, ws: WS, actor: marcus }, [{ entity_type: "units", entity_id: "p01-u1" }, { entity_type: "units", entity_id: "p05-u1" }, { entity_type: "nope", entity_id: "x" }]);
    expect(rel["units:p01-u1"]).toMatchObject({ title: expect.any(String), href: "/app/units/p01-u1" });
    expect(rel["units:p05-u1"]).toMatchObject({ title: null, href: null });
    expect(rel["nope:x"]).toMatchObject({ label: "nope", href: null });
  });
});

describe("mark done and reopen", () => {
  const run = async (key: string, id: string, persona = "marcus") => runAction(await wctx(persona), getAction(key)!, id, {}).catch((e) => ({ status: e.status as number }));
  const count = async (sql: string) => (await db.prepare(sql).bind(WS).first<{ n: number }>())?.n;

  it("completes once on a double click, with audit and activity, then reopens", async () => {
    const statuses = (await Promise.all([run("tasks.complete", "t-overdue"), run("tasks.complete", "t-overdue")])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await db.prepare("SELECT status, completed_at FROM tasks WHERE workspace_id = ? AND id = 't-overdue'").bind(WS).first()).toEqual({ status: "Done", completed_at: demoNowIso(NOW) });
    expect(await count("SELECT count(*) AS n FROM audit WHERE workspace_id = ? AND action = 'tasks.complete' AND entity_id = 't-overdue'")).toBe(1);
    // On the task and on the unit it is about.
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE workspace_id = ? AND verb = 'task_completed'")).toBe(2);
    expect(await mineIds(await actor("marcus"), "due=done")).toEqual(["t-overdue", "t-done"]);

    expect((await Promise.all([run("tasks.reopen", "t-overdue"), run("tasks.reopen", "t-overdue")])).map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.prepare("SELECT status, completed_at FROM tasks WHERE workspace_id = ? AND id = 't-overdue'").bind(WS).first()).toEqual({ status: "Open", completed_at: null });
    // Base rows are never modified.
    expect(await db.prepare("SELECT status FROM tasks WHERE workspace_id = 'base' AND id = 't-overdue'").first()).toEqual({ status: "Open" });
  });

  it("lets a property-scoped person complete a task with no property, such as one on a vendor", async () => {
    expect((await run("tasks.complete", "t-vendor")).status).toBe(200);
    expect(await db.prepare("SELECT status FROM tasks WHERE workspace_id = ? AND id = 't-vendor'").bind(WS).first()).toEqual({ status: "Done" });
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE workspace_id = ? AND verb = 'task_completed' AND entity_type = 'vendors' AND entity_id = 'v01'")).toBe(1);
  });

  it("refuses tasks outside the scope and status edits through the generic API", async () => {
    expect((await run("tasks.complete", "t-atlanta")).status).toBe(404);
    expect((await run("tasks.reopen", "t-today")).status).toBe(409);
    await expect(updateRecord(await wctx("marcus"), "tasks", "t-today", { status: "Done" })).rejects.toMatchObject({ status: 400 });
    // Wording and dates stay editable.
    expect(await updateRecord(await wctx("marcus"), "tasks", "t-today", { priority: "High" })).toMatchObject({ priority: "High" });
  });
});

describe("new task", () => {
  const key = "6f1c1f8e-2a5b-4c3d-9e8f-0a1b2c3d4e5f";

  it("adds one task for me on a double submit or a retry, audited, in my list", async () => {
    const ctx = await wctx("marcus");
    const body = { key, title: "Call the roofer", due_on: "2026-10-29", property_id: "p02" };
    // A retry with the same key (say the first response was lost) gets the same task back.
    expect(await Promise.all([createTask(ctx, body), createTask(ctx, body)])).toEqual([{ status: 200, id: `task-${key}` }, { status: 200, id: `task-${key}` }]);
    expect(await createTask(ctx, body)).toEqual({ status: 200, id: `task-${key}` });
    expect((await db.prepare("SELECT count(*) AS n FROM tasks WHERE workspace_id = ? AND id = ?").bind(WS, `task-${key}`).first<{ n: number }>())?.n).toBe(1);
    // Someone else can't claim that key.
    expect(await createTask(await wctx("grace"), { key, title: "Mine now" })).toMatchObject({ status: 409 });
    expect(await db.prepare("SELECT assignee_id, created_by, source, status, property_id FROM tasks WHERE workspace_id = ? AND id = ?").bind(WS, `task-${key}`).first())
      .toEqual({ assignee_id: "marcus", created_by: "marcus", source: "Manual", status: "Open", property_id: "p02" });
    expect((await db.prepare("SELECT count(*) AS n FROM audit WHERE workspace_id = ? AND action = 'tasks.created'").bind(WS).first<{ n: number }>())?.n).toBe(1);
    expect(await mineIds(await actor("marcus"), "due=upcoming")).toContain(`task-${key}`);
  });

  it("keeps a scoped person's tasks inside their properties", async () => {
    expect(await createTask(await wctx("marcus"), { key, title: "No property" })).toMatchObject({ status: 400 });
    expect(await createTask(await wctx("marcus"), { key, title: "Elsewhere", property_id: "p05" })).toMatchObject({ status: 403 });
    expect(await createTask(await wctx("grace"), { key, title: "Year-end 1099 review" })).toMatchObject({ status: 200 });
    expect(await mineIds(await actor("grace"))).toContain(`task-${key}`);
  });
});

describe("snooze, reassign and bulk", () => {
  const run = async (key: string, id: string, input: unknown = {}, persona = "marcus") => runAction(await wctx(persona), getAction(key)!, id, getAction(key)!.input ? getAction(key)!.input!.parse(input) : input).catch((e) => ({ status: e.status as number }));
  const taskRow = (id: string) => db.prepare("SELECT status, due_on, assignee_id, assignee_role FROM tasks WHERE workspace_id = ? AND id = ?").bind(WS, id).first();

  it("snoozes to a later date once on a double click, with activity on the task and its record", async () => {
    const out = await Promise.all([run("tasks.snooze", "t-overdue", { due_on: "2026-11-10" }), run("tasks.snooze", "t-overdue", { due_on: "2026-11-10" })]);
    expect(out.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(out.find((r) => r.status === 200)).toMatchObject({ message: expect.stringMatching(/ to Nov 10, 2026$/) });
    expect(await taskRow("t-overdue")).toMatchObject({ status: "Open", due_on: "2026-11-10" });
    expect((await db.prepare("SELECT count(*) AS n FROM activity_events WHERE workspace_id = ? AND verb = 'task_snoozed'").bind(WS).first<{ n: number }>())?.n).toBe(2);
    // Today or earlier isn't a snooze; done tasks can't be snoozed.
    expect((await run("tasks.snooze", "t-today", { due_on: "2026-11-04" })).status).toBe(400);
    expect((await run("tasks.snooze", "t-done", { due_on: "2026-11-10" })).status).toBe(409);
  });

  it("reassigns only to active staff who work at the task's property", async () => {
    await db.batch([
      db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email) VALUES ('base', 's-ann', 'org1', 'Ann Lee', 'Assistant manager', 'a@x.example'), ('base', 's-bob', 'org1', 'Bob Diaz', 'Property manager', 'b@x.example')"),
      db.prepare("INSERT INTO role_assignments (workspace_id, id, staff_id, role, scope_kind, scope_id) VALUES ('base', 'ra-ann', 's-ann', 'property_manager', 'region', 'r-tx'), ('base', 'ra-bob', 's-bob', 'property_manager', 'property', 'p05')"),
    ]);
    expect(await run("tasks.reassign", "t-overdue", { assignee_id: "s-bob" })).toMatchObject({ status: 400 });
    expect((await Promise.all([run("tasks.reassign", "t-role", { assignee_id: "s-ann" }), run("tasks.reassign", "t-role", { assignee_id: "s-ann" })])).map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await taskRow("t-role")).toMatchObject({ assignee_id: "s-ann", assignee_role: null });
    // Ids are bound, not spliced into SQL: a quote in one is just part of the id.
    await db.batch([
      db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email) VALUES ('base', 's-o''neil', 'org1', 'Pat O''Neil', 'Leasing', 'p@x.example')"),
      db.prepare("INSERT INTO role_assignments (workspace_id, id, staff_id, role, scope_kind, scope_id) VALUES ('base', 'ra-pat', 's-o''neil', 'leasing_agent', 'org', NULL)"),
    ]);
    expect((await run("tasks.reassign", "t-today", { assignee_id: "s-o'neil" })).status).toBe(200);
    expect(await taskRow("t-today")).toMatchObject({ assignee_id: "s-o'neil" });
    // It leaves my list.
    expect(await mineIds(await actor("marcus"))).not.toContain("t-role");
  });

  it("offers done and snooze in bulk, each task keeping its own guard", async () => {
    expect(getAction("tasks.complete")!.bulk).toBe(true);
    expect(getAction("tasks.snooze")!.bulk).toBe(true);
    // The bulk route runs the action once per id, as here.
    const out = await Promise.all(["t-overdue", "t-today", "t-done"].map((id) => run("tasks.complete", id)));
    expect(out.map((r) => r.status)).toEqual([200, 200, 409]);
  });
});

describe("notice of entry", () => {
  beforeEach(async () => {
    await db.batch([
      task("t-notice", { title: "Send notice of entry: pest treatment, 101", entity: ["units", "p01-u1"], due: "2026-11-05" }),
      task("t-notice-vacant", { title: "Send notice of entry: pest treatment, 103", entity: ["units", "p01-u3"], due: "2026-11-05" }),
    ]);
  });

  it("drafts a notice through the message checks, without a model", async () => {
    const { draftNotice } = await import("./notice-draft");
    const r = await draftNotice(await wctx("marcus"), "t-notice");
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.draft).toMatchObject({ resident_id: "res-p01-u1", channel: "Email", entry_on: "2026-11-07", source: "rules", subject: "Notice of entry, The Lofts at Riverside #101" });
    // Letter-style date from the tool, never the stored form.
    expect(r.draft.body).toContain("Nov 7, 2026");
    expect(r.draft.body).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(r.draft.body).toContain("pest treatment");
    expect(await draftNotice(await wctx("marcus"), "t-notice-vacant")).toMatchObject({ status: 409 });
    expect(await draftNotice(await wctx("marcus"), "t-overdue")).toMatchObject({ status: 400 });
    expect(await draftNotice(await wctx("marcus"), "t-atlanta")).toMatchObject({ status: 404 });
  });

  it("sends once: the message is recorded and the task is done", async () => {
    const input = { resident_id: "res-p01-u1", channel: "Email", subject: "Notice of entry", body: "Hi Res, we will enter #101 on Nov 7, 2026 for pest treatment." };
    const send = async () => runAction(await wctx("marcus"), getAction("tasks.send_notice")!, "t-notice", input).catch((e) => ({ status: e.status as number }));
    expect((await Promise.all([send(), send()])).map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.prepare("SELECT count(*) AS n FROM messages WHERE workspace_id = ? AND template_id = 'tpl-entry-notice'").bind(WS).first<{ n: number }>())?.n).toBe(1);
    expect((await db.prepare("SELECT count(*) AS n FROM message_threads WHERE workspace_id = ?").bind(WS).first<{ n: number }>())?.n).toBe(1);
    expect(await db.prepare("SELECT party_id, entity_id FROM message_threads WHERE workspace_id = ?").bind(WS).first()).toEqual({ party_id: "res-p01-u1", entity_id: "p01-u1" });
    expect(await db.prepare("SELECT status FROM tasks WHERE workspace_id = ? AND id = 't-notice'").bind(WS).first()).toEqual({ status: "Done" });
    // Only to a resident of that unit.
    expect((await runAction(await wctx("marcus"), getAction("tasks.send_notice")!, "t-notice-vacant", { ...input, resident_id: "res-p01-u1" })).status).toBe(400);
  });
});

describe("reassign options", () => {
  it("lists active staff who work at my properties", async () => {
    await db.batch([
      db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email, active) VALUES ('base', 's-ann', 'org1', 'Ann Lee', 'Assistant manager', 'a@x.example', 1), ('base', 's-bob', 'org1', 'Bob Diaz', 'Property manager', 'b@x.example', 1), ('base', 's-cy', 'org1', 'Cy Old', 'Former', 'c@x.example', 0)"),
      db.prepare("INSERT INTO role_assignments (workspace_id, id, staff_id, role, scope_kind, scope_id) VALUES ('base', 'ra-ann', 's-ann', 'property_manager', 'region', 'r-tx'), ('base', 'ra-bob', 's-bob', 'property_manager', 'property', 'p05'), ('base', 'ra-cy', 's-cy', 'property_manager', 'property', 'p01')"),
    ]);
    const { staffOptions } = await import("./my-tasks");
    expect((await staffOptions({ db, ws: WS, actor: await actor("marcus") })).map((s) => s.id)).toEqual(["s-ann"]);
  });
});
