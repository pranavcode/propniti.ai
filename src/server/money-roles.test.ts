import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { ActionContext } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { disposeDeposit, movePayment, payRent, recordPayment } from "./money";
import { actorFor } from "./permissions";
import { emptyDb, seed, WS } from "./query.fixture";

// Defence in depth: each money function checks the caller's role and property scope itself, so a
// caller that skips the action registry (an agent after approval, a new route) gets the same answer.

let db: Db;
const as = async (persona: string): Promise<ActionContext> => ({ db, ws: WS, actor: await actorFor(db, WS, getPersona(persona)!), nowMs: Date.parse("2026-10-28T15:00:00Z") });
const transfers = () => db.prepare("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?").bind(WS).first<{ n: number }>().then((r) => r?.n);

beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.batch([
    db.prepare("INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-p01-0001', 'h-p01-u2', 'p01', 'Jordan', 'Lee', 'j@x.example')"),
    db.prepare("INSERT INTO base_balances (account_id, cleared_cents) VALUES ('ba-oe01-trust', 5000000), ('ba-oe02-trust', 5000000), ('ba-oe01-dep', 500000)"),
    db.prepare("UPDATE leases SET move_out_on = '2026-10-15' WHERE id = 'l-p01-u2'"),
    db.prepare("INSERT INTO deposits (workspace_id, id, lease_id, property_id, bank_account_id, amount_cents, received_on, status) VALUES ('base', 'dep-1', 'l-p01-u2', 'p01', 'ba-oe01-dep', 150000, '2026-01-01', 'Held')"),
  ]);
});

describe("money functions check role and scope themselves", () => {
  const pay = { amountCents: 10000, method: "Check" as const, reference: "1001", idempotencyKey: "idem-test-0001" };

  it("record payment: receivables staff in scope only", async () => {
    for (const p of ["lena", "tom", "resident", "vendor"]) expect((await recordPayment(await as(p), { ...pay, chargeId: "c-p01-u2" })).status).toBe(403);
    expect((await recordPayment(await as("marcus"), { ...pay, chargeId: "c-p05-u2" })).status).toBe(403);
    expect(await transfers()).toBe(0);
    expect((await recordPayment(await as("marcus"), { ...pay, chargeId: "c-p01-u2" })).status).toBe(200);
  });

  it("pay rent: the resident on their own household's charge, or receivables staff in scope", async () => {
    for (const p of ["lena", "tom", "owner", "vendor"]) expect((await payRent(await as(p), "c-p01-u2")).status).toBe(403);
    expect((await payRent(await as("marcus"), "c-p05-u2")).status).toBe(403);
    expect((await payRent(await as("resident"), "c-p02-u2")).status).toBe(403);
    expect(await transfers()).toBe(0);
    expect((await payRent(await as("resident"), "c-p01-u2")).status).toBe(200);
  });

  it("deposit disposition: receivables staff in scope only", async () => {
    for (const p of ["lena", "tom", "resident"]) expect((await disposeDeposit(await as(p), "dep-1", [])).status).toBe(403);
    expect(await transfers()).toBe(0);
  });

  it("move payment: accounting approvers in scope only", async () => {
    await db.prepare("INSERT INTO charges (workspace_id, id, lease_id, household_id, property_id, unit_id, gl_account_id, description, period, due_on, amount_cents) VALUES ('base', 'c-p01-u2-nov', 'l-p01-u2', 'h-p01-u2', 'p01', 'p01-u2', 'gl-4000', 'Rent', '2026-11', '2026-11-01', 145000)").run();
    for (const p of ["marcus", "lena", "tom", "owner"]) expect((await movePayment(await as(p), "pay-p01-u1", "c-p01-u2")).status).toBe(403);
    const before = await db.prepare("SELECT count(*) AS n FROM payments WHERE workspace_id = ?").bind(WS).first<{ n: number }>();
    expect(before?.n).toBe(0);
    expect((await movePayment(await as("grace"), "pay-p01-u1", "c-p01-u2")).status).toBe(200);
  });
});
