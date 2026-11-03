import "server-only";
import type { Answer, Lookup } from "../ask";
import type { PortalCtx } from "../context";
import { NEXT, application, applicationDocs, checklist } from "../applicant-data";

const where = (stage: string) => (stage === "Started" ? "You haven't submitted your application yet." : `Your application is at the ${stage.toLowerCase()} stage.`);

// The applicant's questions about their own application: what's left, timing, documents, fee.
// Timelines are typical ranges, never a promise of an outcome.

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

export async function answerApplicant(c: PortalCtx, q: string): Promise<Answer> {
  const app = await application(c);
  const trace: Lookup[] = [{ label: "Your application", detail: app ? `${app.id} at ${app.property}, unit ${app.unit}: ${app.stage}` : "none found" }];
  if (!app) {
    return { answer: "I couldn't find an application for you yet. You can browse available homes and apply online; once you apply, its status shows here.", facts: {}, trace, links: [{ label: "Browse homes", href: "/listings" }] };
  }
  const docs = await applicationDocs(c, app.id);
  const list = checklist(docs);
  const missing = list.filter((x) => !x.doc).map((x) => x.type);
  trace.push({ label: "Documents on file", detail: docs.length ? docs.map((d) => d.doc_type ?? d.name).join(", ") : "none yet" });
  const links = [{ label: "Documents", href: "/portal/applicant/documents" }, { label: "Message the leasing team", href: "/portal/applicant/messages" }];
  const facts = { stage: app.stage, submitted: day(app.submitted_at), missing, fee_paid: !!app.fee_paid };

  if (/document|upload|need|pay ?stub|id\b|paperwork/i.test(q)) {
    return { answer: missing.length ? `We still need ${missing.length} document${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. You can upload them on the Documents page.` : "We have every document we need. Nothing else to upload right now.", facts, trace, links };
  }
  if (/fee|pay|cost|charge/i.test(q)) {
    return { answer: app.fee_paid ? "Your application fee is paid. There's nothing else to pay until your lease is signed." : "Your application fee hasn't been paid yet. You can pay it by card on the Pay page; screening starts once it's paid.", facts, trace, links: app.fee_paid ? links : [{ label: "Pay the fee", href: "/portal/applicant/pay" }, ...links] };
  }
  if (/when|hear|long|decision|status|approved|next/i.test(q)) {
    const since = app.submitted_at ? ` You submitted it on ${day(app.submitted_at)}.` : "";
    return { answer: `${where(app.stage)}${since} ${NEXT[app.stage] ?? ""}${missing.length && !["Approved", "Denied", "Leased", "Withdrawn"].includes(app.stage) ? ` Sending the remaining documents (${missing.join(", ")}) helps us finish sooner.` : ""}`.trim(), facts, trace, links };
  }
  return {
    answer: `Here's where things stand for ${app.property}, unit ${app.unit}: ${where(app.stage)} ${missing.length ? `Still needed: ${missing.join(", ")}.` : "All documents are in."} Ask me what's left, when you'll hear back, or about the application fee.`,
    facts, trace, links,
  };
}
