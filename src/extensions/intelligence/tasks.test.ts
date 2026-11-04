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
    task("t-agent", { assignee: null, role: "maintenance_supervisor", source: "Agent", by: "system", entity: ["work_orders", "WO-1"], created: "2026-10-27T09:00:00Z" }),
    db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, opened_at) VALUES ('base', 'WO-1', 'p01', 'Water heater leaking', 'Plumbing', 'Urgent', 'New', '2026-10-26T09:00:00Z')"),
    db.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, action, title, confidence, run_id, created_at) VALUES ('base', 'prop-1', 'maintenance_triage', 'work_orders', 'WO-1', 'work_orders.dispatch', 'Dispatch a plumber', 0.9, 'run-7', '2026-10-27T08:00:00Z')"),
  ]);
});

describe("my tasks", () => {
  it("lists my open tasks and my role's unassigned ones, by due date, with a count per view", async () => {
    const marcus = await actor("marcus");
    expect(await mineIds(marcus)).toEqual(["t-nodate", "t-overdue", "t-today", "t-role", "t-later"]);
    const res = await list({ db, ws: WS, actor: marcus }, "tasks", myTasksQuery(marcus, new URLSearchParams()));
    expect(res.counts).toEqual({ overdue: 1, today: 1, upcoming: 3, done: 1 });
  });

  it("splits overdue, today, upcoming and done on the demo day", async () => {
    const marcus = await actor("marcus");
    expect(await mineIds(marcus, "due=overdue")).toEqual(["t-overdue"]);
    expect(await mineIds(marcus, "due=today")).toEqual(["t-today"]);
    expect(await mineIds(marcus, "due=upcoming")).toEqual(["t-nodate", "t-role", "t-later"]);
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

  it("adds one task for me on a double submit, audited, in my list", async () => {
    const ctx = await wctx("marcus");
    const body = { key, title: "Call the roofer", due_on: "2026-10-29", property_id: "p02" };
    expect((await Promise.all([createTask(ctx, body), createTask(ctx, body)])).map((r) => r.status).sort()).toEqual([200, 409]);
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
