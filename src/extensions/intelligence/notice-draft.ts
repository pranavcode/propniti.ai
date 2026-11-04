import "server-only";
import type { Actor } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { demoNowIso } from "@/lib/clock";
import { effective } from "@/server/effective";
import { getRow } from "@/server/query";
import "@/ai/tools/write";
import { getTool } from "@/ai/tools/registry";
import type { RunContext } from "@/ai/types";
import { isNoticeTask, noticeRecipients, type Recipient } from "./notice";

// "Draft notice" on a notice-of-entry task: fills the notice from the unit, its residents and the
// task, then passes it through the messages.draft tool, which formats dates the way a letter does
// and refuses drafts that promise anything or state figures the record doesn't have. No model is
// called. A person reads, edits and sends it (tasks.send_notice); nothing is sent from here.

export type NoticeDraft = { recipients: Recipient[]; resident_id: string; channel: Recipient["channel"]; subject: string; body: string; entry_on: string; source: "rules" };
export type DraftResult = { status: 200; draft: NoticeDraft } | { status: 400 | 404 | 409; error: string };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function draftNotice(ctx: { db: Db; ws: string; actor: Actor; nowMs: number }, taskId: string): Promise<DraftResult> {
  const task = await getRow(ctx, "tasks", taskId);
  if (!task) return { status: 404, error: "Task not found" };
  if (!isNoticeTask(task)) return { status: 400, error: "This task isn't a notice of entry" };
  if (!["Open", "In progress"].includes(String(task.status))) return { status: 409, error: "This task is already done" };
  const unitId = String(task.entity_id);
  const unit = await ctx.db.prepare(`SELECT u.number, p.name AS property FROM ${effective("units")} u JOIN ${effective("properties")} p ON p.id = u.property_id WHERE u.id = ?2`).bind(ctx.ws, unitId).first<{ number: string; property: string }>();
  if (!unit) return { status: 404, error: "The unit on this task wasn't found" };
  const recipients = await noticeRecipients(ctx.db, ctx.ws, unitId);
  if (!recipients.length) return { status: 409, error: `No one lives in #${unit.number} now, so there's no one to notify` };
  const to = recipients[0];
  // Entry at least two days out, and never before the task's due date, so the notice gives more
  // than the 24 hours most leases require.
  const today = demoNowIso(ctx.nowMs).slice(0, 10);
  const due = String(task.due_on ?? today);
  const entry = addDays(due > today ? due : today, 2);
  const reason = String(task.title).split(":").slice(1).join(":").split(",")[0].trim() || "scheduled maintenance";
  const input = to.language === "es"
    ? { subject: `Aviso de entrada, ${unit.property} #${unit.number}`, body: `Hola ${to.first_name}, le avisamos que nuestro equipo entrará a ${unit.property} #${unit.number} el ${entry} entre las 9 a. m. y las 5 p. m. para ${reason}. No necesita estar en casa. Si ese horario no le funciona, responda a este mensaje y buscaremos otro.\n\nAtentamente,\n${ctx.actor.name}, ${unit.property}` }
    : { subject: `Notice of entry, ${unit.property} #${unit.number}`, body: `Hi ${to.first_name}, this is notice that our team will enter ${unit.property} #${unit.number} on ${entry} between 9 AM and 5 PM for ${reason}. You don't need to be home. If that time doesn't work, reply to this message and we'll find another.\n\nThanks,\n${ctx.actor.name}, ${unit.property}` };
  const tool = getTool("messages.draft")!;
  const run = { facts: new Map([[unitId, {}]]), drafts: new Map<string, { subject: string; body: string; channel: string; language: string }>() };
  try {
    await tool.run(run as unknown as RunContext, tool.input.parse({ entity_id: unitId, channel: to.channel, language: to.language, ...input }));
  } catch (e) {
    return { status: 409, error: e instanceof Error ? e.message : "The draft didn't pass the message checks" };
  }
  const d = run.drafts.get(unitId)!;
  return { status: 200, draft: { recipients, resident_id: to.id, channel: to.channel, subject: d.subject, body: d.body, entry_on: entry, source: "rules" } };
}
