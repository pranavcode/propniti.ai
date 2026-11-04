import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { ask } from "../assistant";
import { setModelForTests, type ChatModel } from "../providers";
import { MARCUS, openFixture, WS } from "./fixture";

afterEach(() => setModelForTests(undefined));

// A model that would get the facts wrong if it were allowed to word them.
const wrongModel: ChatModel = {
  info: { provider: "anthropic", model: "claude-opus-5", label: "Scripted", native: true },
  chat: async () => ({ text: "No residents are late.", calls: [], usage: { tokensIn: 1, tokensOut: 1, costCents: 0, latencyMs: 1 } }),
  structured: async (schema) => ({ value: schema.parse({ suggestions: ["Offer Ana Ruiz a payment plan", "Waive $500 for Jordan"] }), usage: { tokensIn: 1, tokensOut: 1, costCents: 0, latencyMs: 1 } }),
};

describe("assistant", () => {
  it("answers fact questions from the computed result; the model only adds suggestions", async () => {
    setModelForTests(wrongModel);
    const { db } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "Who is late on rent?" });
    expect(r.answer).toMatch(/^2 residents are\s+late, owing \$6,600 in total\. Jordan Lee/);
    expect(r.answer).not.toMatch(/No residents/);
    expect(r.answer).toContain("Offer Ana Ruiz a payment plan");
    expect(r.answer).not.toContain("Waive $500");
    expect(r.trace.map((t) => t.tool)).toEqual(["ledger.delinquency"]);
    expect(r.table?.rows).toHaveLength(2);
    expect(r.note).toMatch(/Figures computed from your data/);
  });

  it("turns an action request into proposals that wait for confirmation", async () => {
    setModelForTests(null);
    const { db, raw } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "Send reminders to residents 30+ days late" });
    expect(r.mode).toBe("actions");
    expect(r.proposals.map((p) => p.queue_state)).toEqual(["needs_you", "needs_you"]);
    expect(raw.prepare("SELECT count(*) AS n FROM messages").get()!.n).toBe(0);
  });

  it("answers help questions from help articles with links", async () => {
    setModelForTests(null);
    const { db } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "How do I post a late fee?" });
    expect(r.mode).toBe("help");
    expect(r.citations[0]).toMatchObject({ help: "post-late-fee" });
  });
});

describe("assistant lookups (production QA)", () => {
  it("lists only leases with no renewal offer when asked for leases without one", async () => {
    setModelForTests(null);
    const { db, raw } = openFixture();
    raw.prepare("INSERT INTO leases (workspace_id, id, property_id, unit_id, household_id, status, start_on, end_on, rent_cents) VALUES ('base', 'l4', 'p01', 'u2', 'h2', 'Active', '2025-12-02', '2026-12-01', 120000)").run();
    raw.prepare("INSERT INTO renewal_offers (workspace_id, id, lease_id, property_id, term_months, rent_cents, current_rent_cents, status) VALUES ('base', 'ro1', 'l1', 'p01', 12, 145000, 140000, 'Sent')").run();
    const data = { db, ws: WS, actor: MARCUS };
    const all = await ask({ data, persona: getPersona("marcus")!, question: "Which leases expire in the next 60 days?" });
    expect(all.table?.rows.map((r) => r.id)).toEqual(["l4", "l1"]);
    const r = await ask({ data, persona: getPersona("marcus")!, question: "Which leases expire in the next 60 days without a renewal offer?" });
    expect(r.table?.rows.map((x) => x.id)).toEqual(["l4"]);
    expect(r.answer).toMatch(/^1 active lease without a renewal offer ends by 2027-01-03/);
  });

  it("finds the scoring article for 'how does scoring work', not work-order articles", async () => {
    setModelForTests(null);
    const { db, raw } = openFixture();
    const add = raw.prepare("INSERT INTO help_articles (workspace_id, id, title, body, tags, updated_at) VALUES ('base', ?, ?, ?, ?, '2026-10-01')");
    add.run("screening-applicant-scores", "Understand screening and applicant scores", "The applicant score on the application combines only income, rental history and the screening outcome.", '["screening","applicant score","fair housing"]');
    add.run("photo-checks", "How the AI photo check works", "Before a work order is paid, the AI compares the before and after photos.", '["work orders","photos"]');
    add.run("approve-pay-work-order", "Approve and pay a work order", "Open the work order and approve the vendor's invoice to pay it.", '["work orders","payables"]');
    for (const question of ["How does application scoring work?", "how does scoring work"]) {
      const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("lena")!, question });
      expect(r.mode, question).toBe("help");
      expect(r.citations[0], question).toMatchObject({ help: "screening-applicant-scores" });
    }
  });
});
