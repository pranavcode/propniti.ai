import { z } from "zod";
import { ShieldCheck, Upload } from "lucide-react";
import type { ActionContext, ActionResult, Row } from "@/entities/types";
import { notifyManager } from "@/extensions/owners/actions";
import { AS_OF } from "@/seed/constants";
import { effective, overlayUpsertSql } from "@/server/effective";
import { eventStmt } from "@/server/money";
import { nowIso } from "@/server/workspace";
import { registerAction } from "../actions";

// Renters insurance sent from the resident portal. The AI reads the declarations page (through
// /api/ai/extract), the resident checks and confirms every field, and the policy is filed on their
// lease as Pending verification. Staff verify it on the renters insurance list. The file itself is
// read and discarded, like every other upload; the document row records its name and which fields
// the AI read.

const RI_COLS = ["id", "deleted", "lease_id", "property_id", "carrier", "policy_number", "liability_cents", "starts_on", "expires_on", "status"];
export const PENDING = "Pending verification";
const FIELDS = ["carrier", "policyNumber", "liability", "startsOn", "expiresOn"] as const;

export const InsuranceInput = z.strictObject({
  carrier: z.string().trim().min(2).max(120),
  policyNumber: z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9 ./_-]+$/, "Use the policy number as printed"),
  liability: z.number().int().min(0).max(10_000_000),
  startsOn: z.iso.date(),
  expiresOn: z.iso.date(),
  fileName: z.string().trim().min(1).max(120),
  // Which fields the AI read and the resident kept unchanged, and who read them.
  aiFields: z.array(z.enum(FIELDS)).max(FIELDS.length).default([]),
  source: z.enum(["anthropic", "openai", "workers-ai", "mock", "manual"]).default("manual"),
});

const mimeOf = (name: string) => ({ pdf: "application/pdf", png: "image/png", webp: "image/webp" })[name.split(".").pop()?.toLowerCase() ?? ""] ?? "image/jpeg";
const one = <T = Row>(ctx: ActionContext, sql: string, ...binds: unknown[]) => ctx.db.prepare(sql).bind(ctx.ws, ...binds).first<T>();

async function submit(ctx: ActionContext, resident: Row, i: z.infer<typeof InsuranceInput>): Promise<ActionResult> {
  if (i.expiresOn <= AS_OF) return { status: 400, error: "That policy has already expired. Upload the current declarations page." };
  if (i.startsOn >= i.expiresOn) return { status: 400, error: "The policy has to start before it expires. Check the dates." };
  const lease = await one<{ id: string; property_id: string }>(ctx,
    `SELECT l.id, l.property_id FROM ${effective("leases")} AS l JOIN ${effective("residents")} AS r ON r.household_id = l.household_id
     WHERE r.id = ?2 AND l.status IN ('Active', 'Notice', 'Month-to-month', 'Future') ORDER BY l.start_on DESC LIMIT 1`, resident.id);
  if (!lease) return { status: 404, error: "We couldn't find a current lease to file this policy on." };
  // One record per lease and policy period: a resubmission corrects it while it's still pending.
  const id = `ri-${lease.id}-${i.expiresOn}`;
  const at = nowIso(ctx.nowMs);
  const [upsert] = await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO renters_insurance (workspace_id, id, lease_id, property_id, carrier, policy_number, liability_cents, starts_on, expires_on, status)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '${PENDING}')
      ON CONFLICT (workspace_id, id) DO UPDATE SET carrier = excluded.carrier, policy_number = excluded.policy_number, liability_cents = excluded.liability_cents, starts_on = excluded.starts_on
      WHERE renters_insurance.status = '${PENDING}' AND (renters_insurance.carrier, renters_insurance.policy_number, renters_insurance.liability_cents, renters_insurance.starts_on)
        IS NOT (excluded.carrier, excluded.policy_number, excluded.liability_cents, excluded.starts_on)`)
      .bind(ctx.ws, id, lease.id, lease.property_id, i.carrier, i.policyNumber, i.liability * 100, i.startsOn, i.expiresOn),
  ]);
  if (!upsert.meta.changes) {
    const cur = await one<{ status: string }>(ctx, "SELECT status FROM renters_insurance WHERE workspace_id = ?1 AND id = ?2", id);
    return { status: 409, error: cur?.status === PENDING ? "We already have these details. The office will verify them." : "That policy is already on file and verified." };
  }
  const name = `${String(resident.first_name ?? "")} ${String(resident.last_name ?? "")}`.trim() || "A resident";
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO documents (workspace_id, id, property_id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, extracted, uploaded_by, uploaded_at)
      VALUES (?1, ?2, ?3, 'renters_insurance', ?4, ?5, ?6, ?7, 'Renters insurance', ?8, 'resident', ?9, ?10, ?11)
      ON CONFLICT (workspace_id, id) DO UPDATE SET name = excluded.name, mime = excluded.mime, extracted = excluded.extracted, uploaded_at = excluded.uploaded_at`)
      .bind(ctx.ws, `doc-${id}`, lease.property_id, id, i.fileName, `/app/residents/insurance/${id}`, mimeOf(i.fileName), `Lease ${lease.id} › Insurance`,
        JSON.stringify({ source: i.source, read_by_ai: i.aiFields, confirmed_by_resident: true }), String(resident.id), at),
    eventStmt(ctx.db, ctx.ws, at, "renters_insurance.uploaded", "renters_insurance", id, lease.property_id, { lease_id: lease.id, expires_on: i.expiresOn }),
    notifyManager(ctx, lease.property_id, "Renters insurance to verify", `${name} sent a ${i.carrier} policy (${i.policyNumber}), valid to ${i.expiresOn}. Check it against the declarations page.`, "/app/residents/insurance?view=to-verify", ["renters_insurance", id]),
  ]);
  return { status: 200, message: "Received. Your policy shows as pending until the office verifies it." };
}

registerAction({
  key: "residents.submit_insurance",
  label: "Upload renters insurance",
  entity: "residents",
  roles: ["resident"],
  icon: Upload,
  input: InsuranceInput,
  handler: (ctx, row, i) => submit(ctx, row, i),
  help: { summary: "A resident sends their declarations page; the policy is filed on their lease as Pending verification until staff check it.", article: "renters-insurance" },
});

registerAction({
  key: "renters_insurance.verify",
  label: "Verify policy",
  entity: "renters_insurance",
  roles: ["principal", "regional_manager", "property_manager", "leasing_agent"],
  icon: ShieldCheck,
  bulk: true,
  when: (r) => r.status === PENDING,
  confirm: { title: "Mark this policy verified?", body: "Check the declarations page first: carrier, policy number, liability limit and dates." },
  async handler(ctx, row) {
    const soon = Date.parse(String(row.expires_on)) - Date.parse(AS_OF) <= 30 * 86_400_000;
    const [r] = await ctx.db.batch([
      ctx.db.prepare(overlayUpsertSql("renters_insurance", RI_COLS, { status: "?3" }, `e.status = '${PENDING}'`)).bind(ctx.ws, String(row.id), soon ? "Expiring" : "Active"),
    ]);
    return r.meta.changes ? { status: 200, message: `Policy ${String(row.policy_number)} verified.` } : { status: 409, error: "This policy isn't waiting for verification." };
  },
  help: { summary: "Confirms a resident-sent policy against its declarations page; it then counts as the lease's coverage.", article: "renters-insurance" },
});
