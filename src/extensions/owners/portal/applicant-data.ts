import "server-only";
import { APPLICANT_DOCS } from "../portal-actions";
import { row, rows, type PortalCtx } from "./context";

// Reads for the applicant portal, keyed by the applicant's own id. Screening internals (score,
// credit band, flags) are never selected: the applicant only sees whether screening is done.

export type Application = {
  id: string; stage: string; property_id: string; property: string; street: string; city: string; state: string; photos: string;
  unit: string; beds: number | null; baths: number | null; sqft: number | null; rent_cents: number | null; desired_move_in: string | null;
  fee_paid: number; submitted_at: string | null; decided_at: string | null; screening_done: string | null;
};

export async function applicantMe(c: PortalCtx) {
  return row<{ id: string; first_name: string; last_name: string; email: string }>(c, "SELECT a.id, a.first_name, a.last_name, a.email FROM {applicants} a WHERE a.id = ?", c.me);
}

export async function application(c: PortalCtx) {
  return row<Application>(c, `SELECT a.id, a.stage, a.property_id, p.name AS property, p.street, p.city, p.state, p.photos, u.number AS unit, ut.beds, ut.baths, u.sqft,
      coalesce(a.rent_cents, u.market_rent_cents) AS rent_cents, a.desired_move_in, a.fee_paid, a.submitted_at, a.decided_at,
      (SELECT max(s.completed_at) FROM {screening_results} s WHERE s.application_id = a.id) AS screening_done
    FROM {applications} a JOIN {properties} p ON p.id = a.property_id JOIN {units} u ON u.id = a.unit_id LEFT JOIN {unit_types} ut ON ut.id = u.unit_type_id
    WHERE a.applicant_id = ? ORDER BY coalesce(a.submitted_at, '9999') DESC LIMIT 1`, c.me);
}

export type Doc = { id: string; name: string; doc_type: string | null; uploaded_at: string };

export async function applicationDocs(c: PortalCtx, applicationId: string) {
  return rows<Doc>(c, "SELECT d.id, d.name, d.doc_type, d.uploaded_at FROM {documents} d WHERE d.entity_type = 'applications' AND d.entity_id = ? ORDER BY d.uploaded_at DESC LIMIT 50", applicationId);
}

// Each required document with the latest upload of that type, if any.
export function checklist(docs: Doc[]) {
  return APPLICANT_DOCS.map((type) => ({ type, doc: docs.find((d) => d.doc_type === type) ?? null }));
}

// Where the application is on the path: started → submitted → screening → review → decision → lease.
export const STEPS = ["Started", "Submitted", "Screening", "Review", "Decision", "Lease signing"] as const;
export function stepOf(stage: string) {
  if (["Approved", "Conditional", "Denied"].includes(stage)) return 4;
  if (stage === "Leased") return 5;
  const i = (STEPS as readonly string[]).indexOf(stage);
  return i < 0 ? 0 : i;
}

export const NEXT: Record<string, string> = {
  Started: "Finish and submit your application. Once it's in, screening usually takes 1–2 business days.",
  Submitted: "We've received your application. Screening (identity, income and rental history) is next.",
  Screening: "Screening is in progress. It usually takes 1–2 business days; we'll message you if anything else is needed.",
  Review: "Screening is complete and the leasing team is reviewing your application. Most decisions take 1–2 business days.",
  Approved: "You're approved. The leasing office will send your lease to sign and confirm your move-in date.",
  Conditional: "You're approved with conditions. The leasing office will message you with what's needed before the lease.",
  Denied: "We weren't able to approve this application. The leasing office will send a written notice with the reasons and your rights.",
  Leased: "Your lease is signed. The leasing office will send move-in instructions.",
  Withdrawn: "This application was withdrawn. You can apply again from our listings at any time.",
};
