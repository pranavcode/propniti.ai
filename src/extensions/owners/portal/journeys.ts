// Where an applicant's or resident's item is on its path, as plain steps the portal draws. Each
// step has a state, a date when it happened, who owns it and what it means; `next` says what
// happens now and what, if anything, the person has to do. Pure functions over the record's own
// fields, so the portal page and the unit tests read the same rules.

export type StepState = "done" | "current" | "todo" | "stopped";
export type Step = { key: string; label: string; state: StepState; date: string | null; owner: string; detail: string };
export type Next = { title: string; body: string; you: string | null };
export type Journey = { steps: Step[]; next: Next };

// "2026-12-12" → "Dec 12, 2026", for dates inside sentences.
export const day = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// Milestones in order: the first one not reached is current; a `stopped` one ends the path.
function path(defs: { key: string; label: string; owner: string; reached: boolean; date?: string | null; detail: string; stopped?: boolean }[]): Step[] {
  let open = false;
  return defs.map((d) => {
    if (open) return { key: d.key, label: d.label, state: "todo", date: null, owner: d.owner, detail: d.detail };
    if (d.stopped) { open = true; return { key: d.key, label: d.label, state: "stopped", date: d.date ?? null, owner: d.owner, detail: d.detail }; }
    if (d.reached) return { key: d.key, label: d.label, state: "done", date: d.date ?? null, owner: d.owner, detail: d.detail };
    open = true;
    return { key: d.key, label: d.label, state: "current", date: null, owner: d.owner, detail: d.detail };
  });
}

// ---------------------------------------------------------------------------------------------
// Applicant: submitted → screening → decision → lease sent → lease signed → move-in scheduled
// ---------------------------------------------------------------------------------------------

export const REQUIRED_TO_SUBMIT = ["Photo ID", "Pay stub"] as const;

export type ApplicationFacts = {
  stage: string; submitted_at: string | null; fee_paid: number | boolean; docs: string[];
  screening: { completed_at: string | null; income_verified: number | boolean } | null;
  decided_at: string | null; decision_reason: string | null; lease_sent_at: string | null; lease_signed_at: string | null; move_in_on: string | null; desired_move_in: string | null;
};

const DECIDED = ["Approved", "Conditional", "Denied", "Leased"];

// What the applicant still has to send before they can submit.
export function missingToSubmit(a: Pick<ApplicationFacts, "fee_paid" | "docs">) {
  const out: string[] = REQUIRED_TO_SUBMIT.filter((d) => !a.docs.includes(d));
  if (!a.fee_paid) out.push("Application fee");
  return out;
}

// Background, credit and income checks: done once the screening report is back. Income is
// verified from the documents; without them it waits on the applicant.
export function screeningChecks(a: Pick<ApplicationFacts, "stage" | "screening" | "docs">) {
  const back = !!a.screening?.completed_at;
  const running = a.stage === "Screening";
  const state = (done: boolean): "done" | "running" | "waiting" => (done ? "done" : running ? "running" : "waiting");
  const incomeDocs = a.docs.some((d) => d === "Pay stub" || d === "Bank statement" || d === "Employer letter");
  return [
    { key: "background", label: "Background check", state: state(back) },
    { key: "credit", label: "Credit check", state: state(back) },
    { key: "income", label: "Income check", state: back && a.screening?.income_verified ? "done" as const : back && !incomeDocs ? "needs-docs" as const : state(back && !!a.screening?.income_verified) },
  ];
}

export function applicantJourney(a: ApplicationFacts): Journey {
  const s = a.stage;
  const decided = DECIDED.includes(s);
  const denied = s === "Denied";
  const signed = !!a.lease_signed_at || s === "Leased";
  // decision_reason is set only for a conditional approval or a denial, so a signed lease with one
  // was approved with conditions.
  const conditional = s === "Conditional" || (s === "Leased" && !!a.decision_reason);
  const decisionLabel = conditional ? "Approved with conditions" : denied ? "Not approved" : decided ? "Approved" : "Decision";
  const decisionDetail = conditional ? `Conditions: ${a.decision_reason ?? "the leasing office will message you with what's needed."}`
    : denied ? (a.decision_reason ? `Reason given: ${a.decision_reason}` : "The leasing office sends a written notice with the reasons.")
    : decided ? "Your application was approved." : "The managing broker decides, usually within 1–2 business days of screening.";
  const steps = path([
    { key: "submitted", label: "Submitted", owner: "You", reached: s !== "Started", date: a.submitted_at, detail: s === "Started" ? "Upload your photo ID and a pay stub, pay the fee, then submit." : "We have your application." },
    { key: "screening", label: "Screening", owner: "Leasing team", reached: ["Review", ...DECIDED].includes(s) || !!a.screening?.completed_at && s !== "Submitted", date: a.screening?.completed_at ?? null, detail: "Background, credit and income checks." },
    { key: "decision", label: decisionLabel, owner: "Managing broker", reached: decided, stopped: denied, date: a.decided_at, detail: decisionDetail },
    { key: "lease_sent", label: "Lease sent", owner: "Leasing team", reached: !!a.lease_sent_at || signed, date: a.lease_sent_at, detail: "Your lease, ready to read and e-sign here." },
    { key: "lease_signed", label: "Lease signed", owner: "You", reached: signed, date: a.lease_signed_at, detail: "Signed electronically in this portal." },
    { key: "move_in", label: "Move-in scheduled", owner: "Leasing team", reached: !!a.move_in_on, date: a.move_in_on, detail: a.move_in_on ? "Keys and move-in inspection on this day." : "The office confirms your move-in day." },
  ]);
  if (s === "Withdrawn") for (const st of steps) if (st.state === "current") st.state = "todo";
  return { steps, next: applicantNext(a) };
}

function applicantNext(a: ApplicationFacts): Next {
  const s = a.stage;
  if (s === "Withdrawn") return { title: "Application withdrawn", body: "You can apply again from our listings at any time.", you: null };
  if (s === "Started") {
    const missing = missingToSubmit(a);
    return missing.length
      ? { title: "Not submitted yet", body: "Finish and submit your application. Once it's in, screening usually takes 1–2 business days.", you: `Still needed: ${missing.join(", ")}.` }
      : { title: "Ready to submit", body: "Everything needed is here. Submit and the leasing team starts screening.", you: "Submit your application." };
  }
  if (s === "Submitted") return { title: "Application received", body: "The leasing team starts your background, credit and income checks within 1 business day.", you: null };
  if (s === "Screening") {
    const needs = screeningChecks(a).some((c) => c.state === "needs-docs");
    return { title: "Screening in progress", body: "Background, credit and income checks usually take 1–2 business days.", you: needs ? "Upload a pay stub or bank statement so we can verify your income." : null };
  }
  if (s === "Review") return { title: "Waiting on a decision", body: "Screening is done. The managing broker is reviewing your application; most decisions take 1–2 business days.", you: null };
  if (s === "Denied") return { title: "We couldn't approve this application", body: `${a.decision_reason ? `Reason given: ${a.decision_reason}. ` : ""}You'll get a written adverse action notice with the screening company's contact details. You can ask them for a free copy of your report within 60 days and dispute anything that's wrong.`, you: null };
  if (s === "Leased" || a.lease_signed_at) {
    return a.move_in_on
      ? { title: "Move-in is scheduled", body: "Bring a photo ID. The office walks the home with you and hands over keys.", you: null }
      : { title: "Lease signed", body: "The leasing office confirms your move-in day next.", you: null };
  }
  if (a.lease_sent_at) return { title: "Your lease is ready to sign", body: "Read it carefully. Signing here is a binding electronic signature.", you: "Read and sign your lease." };
  return s === "Conditional"
    ? { title: "Approved with conditions", body: `${a.decision_reason ? `Conditions: ${a.decision_reason}. ` : ""}The leasing office sends your lease once the conditions are met.`, you: a.docs.includes("Guarantor letter") ? null : "If a guarantor is a condition, upload their signed letter." }
    : { title: "You're approved", body: "The leasing office prepares your lease and sends it here to sign.", you: null };
}

// ---------------------------------------------------------------------------------------------
// Resident: maintenance request
// ---------------------------------------------------------------------------------------------

export type RequestFacts = { status: string; opened_at: string; scheduled_at: string | null; completed_at: string | null; reached: Record<string, string>; rated: { stars: number; at: string } | null };

const TRIAGED = ["Triaged", "Assigned", "On hold", "Scheduled", "In progress", "Submitted", "Completed", "Paid"];
const SCHEDULED = ["Scheduled", "In progress", "Submitted", "Completed", "Paid"];
const STARTED = ["In progress", "Submitted", "Completed", "Paid"];
const FINISHED = ["Completed", "Paid"];

export function requestJourney(r: RequestFacts): Journey {
  const s = r.status;
  const first = (...st: string[]) => st.map((x) => r.reached[x]).filter(Boolean).sort()[0] ?? null;
  const steps = path([
    { key: "submitted", label: "Submitted", owner: "You", reached: true, date: r.opened_at, detail: "We have your request." },
    { key: "triaged", label: "Triaged", owner: "Maintenance team", reached: TRIAGED.includes(s), date: first("Triaged", "Assigned", "On hold"), detail: "The team confirms the trade and urgency." },
    { key: "scheduled", label: "Scheduled", owner: "Maintenance team", reached: SCHEDULED.includes(s), date: r.scheduled_at ?? first("Scheduled"), detail: "A visit is booked." },
    { key: "in_progress", label: "In progress", owner: "Technician", reached: STARTED.includes(s), date: first("In progress"), detail: "The work has started." },
    { key: "done", label: "Done", owner: "Technician", reached: FINISHED.includes(s), date: r.completed_at ?? first("Completed"), detail: "The repair is finished." },
    { key: "rated", label: "Rated", owner: "You", reached: !!r.rated, date: r.rated?.at ?? null, detail: r.rated ? `You gave ${r.rated.stars} of 5.` : "Tell us how it went." },
  ]);
  if (s === "Cancelled") return { steps: steps.map((x) => (x.state === "current" ? { ...x, state: "stopped", label: "Cancelled", detail: "This request was cancelled." } : x)), next: { title: "Cancelled", body: "Message the office if the problem is back.", you: null } };
  const next: Next = s === "New" ? { title: "Waiting for the team", body: "The maintenance team reviews new requests within 1 business day, sooner for urgent ones.", you: null }
    : s === "On hold" ? { title: "On hold", body: "The repair needs an approval or parts first. We'll message you when it moves.", you: null }
    : ["Triaged", "Assigned"].includes(s) ? { title: s === "Assigned" ? "Assigned, waiting for a time" : "Triaged", body: s === "Assigned" ? "The technician or vendor confirms a visit time." : "The team is finding the right technician.", you: null }
    : s === "Scheduled" ? { title: "Visit booked", body: "Someone will come at the time shown. If you said it's OK, they can let themselves in.", you: null }
    : STARTED.includes(s) && !FINISHED.includes(s) ? { title: "Work in progress", body: "The technician is on it.", you: null }
    : r.rated ? { title: "Done", body: "Thanks for the rating.", you: null }
    : { title: "Done", body: "Is everything working again?", you: "Rate the repair." };
  return { steps, next };
}

// ---------------------------------------------------------------------------------------------
// Resident: renters insurance — missing → uploaded → verified or rejected
// ---------------------------------------------------------------------------------------------

export type InsuranceFacts = { status: string; review_note: string | null; uploaded_at: string | null; expires_on: string } | null;

export function insuranceJourney(p: InsuranceFacts, daysLeft: number | null): Journey {
  const uploaded = !!p && p.status !== "Lapsed";
  const verified = !!p && ["Active", "Expiring", "Waived"].includes(p.status);
  const rejected = p?.status === "Rejected";
  const steps = path([
    { key: "uploaded", label: uploaded ? "Uploaded" : "Missing", owner: "You", reached: uploaded, date: p?.uploaded_at ?? null, detail: "Your insurer's declarations page." },
    { key: "review", label: rejected ? "Rejected" : verified ? "Verified" : "Office review", owner: "Leasing office", reached: verified, stopped: rejected, date: null, detail: rejected ? `Reason: ${p?.review_note ?? "the details didn't match the declarations page."}` : "The office checks it against the declarations page." },
  ]);
  const next: Next = !p ? { title: "No policy on file", body: "Your lease requires renters insurance.", you: "Upload your declarations page." }
    : p.status === "Lapsed" ? { title: "Your policy lapsed", body: "Your lease requires active coverage.", you: "Upload your new declarations page." }
    : rejected ? { title: "The office couldn't verify this policy", body: p.review_note ? `Reason: ${p.review_note}` : "The details didn't match the declarations page.", you: "Upload the correct declarations page." }
    : p.status === "Pending verification" ? { title: "Waiting for the office", body: "The office verifies new policies within 1 business day. Until then it shows as pending.", you: null }
    : daysLeft != null && daysLeft <= 30 ? { title: "Verified, renewing soon", body: `Your policy ends in ${daysLeft} days.`, you: "Upload the renewal declarations page when you have it." }
    : { title: "Verified", body: "Your coverage meets the lease requirement.", you: null };
  return { steps, next };
}

// ---------------------------------------------------------------------------------------------
// Resident: renewal — offer → accepted, countered or declined → signed
// ---------------------------------------------------------------------------------------------

export type OfferFacts = { status: string; sent_at: string | null; responded_at: string | null; expires_on: string | null; signed_at: string | null; resident_note: string | null; term_months: number };

// The latest round decides: once one term is accepted the others are declined automatically.
export function renewalJourney(offers: OfferFacts[]): Journey | null {
  if (!offers.length) return null;
  const pick = offers.find((o) => o.status === "Accepted") ?? offers.find((o) => o.status === "Sent") ?? offers.find((o) => o.status === "Countered") ?? offers[0];
  const answered = ["Accepted", "Countered", "Declined"].includes(pick.status);
  const answer = pick.status === "Accepted" ? `Accepted ${pick.term_months} months` : pick.status === "Countered" ? "Countered" : pick.status === "Declined" ? "Declined" : pick.status === "Expired" ? "Expired" : "Your answer";
  const steps = path([
    { key: "offer", label: "Offer", owner: "Leasing office", reached: true, date: pick.sent_at, detail: "Renewal terms from the office." },
    { key: "answer", label: answer, owner: "You", reached: answered && pick.status !== "Countered", stopped: pick.status === "Declined" || pick.status === "Expired" || pick.status === "Countered", date: pick.responded_at,
      detail: pick.status === "Countered" ? `You asked: ${pick.resident_note ?? "different terms"}.` : pick.status === "Declined" ? "You're not renewing." : "Accept, counter or decline." },
    { key: "signed", label: "Signed", owner: "You", reached: !!pick.signed_at, date: pick.signed_at, detail: "Your renewal, e-signed here." },
  ]);
  const next: Next = pick.status === "Sent" ? { title: "Your renewal offer is ready", body: pick.expires_on ? `Respond by ${day(pick.expires_on)}.` : "Respond when you're ready.", you: "Accept, counter or decline." }
    : pick.status === "Countered" ? { title: "Counter-offer sent", body: "The office reviews your counter and sends updated terms here, usually within 2 business days.", you: null }
    : pick.status === "Accepted" && !pick.signed_at ? { title: "Accepted, ready to sign", body: "Sign your renewal to lock in the new terms.", you: "Sign your renewal." }
    : pick.status === "Accepted" ? { title: "Renewal signed", body: "You're all set for another term.", you: null }
    : pick.status === "Declined" ? { title: "Not renewing", body: "Give your move-out notice so the office can schedule the inspection.", you: "Give notice with your move-out date." }
    : { title: "This offer expired", body: "Message the office for a new one.", you: null };
  return { steps, next };
}

// ---------------------------------------------------------------------------------------------
// Resident: move-out — notice given → inspection scheduled → deposit disposition
// ---------------------------------------------------------------------------------------------

export type MoveOutFacts = { notice_on: string | null; move_out_on: string | null; inspection_on: string | null; inspection_status: string | null; disposition: { status: string; sent_on: string | null; due_on: string; refund_cents: number } | null };

export function moveOutJourney(m: MoveOutFacts): Journey | null {
  if (!m.notice_on) return null;
  const sent = m.disposition?.status === "Sent" || m.disposition?.status === "Disputed";
  const steps = path([
    { key: "notice", label: "Notice given", owner: "You", reached: true, date: m.notice_on, detail: m.move_out_on ? `Moving out ${day(m.move_out_on)}.` : "Move-out date to confirm." },
    { key: "inspection", label: "Inspection scheduled", owner: "Property team", reached: !!m.inspection_on, date: m.inspection_on, detail: m.inspection_status === "Completed" ? "Walk-through done." : "A walk-through of the home on or after move-out." },
    { key: "deposit", label: "Deposit disposition", owner: "Accounting", reached: sent, date: m.disposition?.sent_on ?? null, detail: sent ? "Itemized statement sent." : "An itemized statement of your deposit." },
  ]);
  const next: Next = !m.inspection_on ? { title: "Notice received", body: "The property team schedules your move-out inspection and confirms it here.", you: null }
    : !sent ? { title: "Inspection scheduled", body: `Leave the home empty and clean. Your deposit statement follows within the state deadline${m.disposition?.due_on ? ` (by ${day(m.disposition.due_on)})` : ""}.`, you: "Leave a forwarding address in Messages." }
    : { title: "Deposit statement sent", body: "Questions about a deduction? Message the office.", you: null };
  return { steps, next };
}
