import "server-only";
import { APPLICANT_DOCS, OPTIONAL_DOCS } from "../portal-actions";
import { row, rows, type PortalCtx } from "./context";
import { applicantJourney } from "./journeys";

// Reads for the applicant portal, keyed by the applicant's own id. Screening internals (score,
// credit band, flags) are never selected: the applicant only sees whether screening is done and
// whether their income was verified, plus the reason the broker chose to share with them.

export type Application = {
  id: string; stage: string; property_id: string; property: string; street: string; city: string; state: string; photos: string;
  unit: string; beds: number | null; baths: number | null; sqft: number | null; rent_cents: number | null; desired_move_in: string | null;
  fee_paid: number; submitted_at: string | null; decided_at: string | null; screening_done: string | null; income_verified: number | null;
  decision_reason: string | null; lease_sent_at: string | null; lease_signed_at: string | null; move_in_on: string | null;
};

export async function applicantMe(c: PortalCtx) {
  return row<{ id: string; first_name: string; last_name: string; email: string }>(c, "SELECT a.id, a.first_name, a.last_name, a.email FROM {applicants} a WHERE a.id = ?", c.me);
}

export async function application(c: PortalCtx) {
  return row<Application>(c, `SELECT a.id, a.stage, a.property_id, p.name AS property, p.street, p.city, p.state, p.photos, u.number AS unit, ut.beds, ut.baths, u.sqft,
      coalesce(a.rent_cents, u.market_rent_cents) AS rent_cents, a.desired_move_in, a.fee_paid, a.submitted_at, a.decided_at,
      a.decision_reason, a.lease_sent_at, a.lease_signed_at, a.move_in_on,
      (SELECT max(s.completed_at) FROM {screening_results} s WHERE s.application_id = a.id) AS screening_done,
      (SELECT max(s.income_verified) FROM {screening_results} s WHERE s.application_id = a.id AND s.completed_at IS NOT NULL) AS income_verified
    FROM {applications} a JOIN {properties} p ON p.id = a.property_id JOIN {units} u ON u.id = a.unit_id LEFT JOIN {unit_types} ut ON ut.id = u.unit_type_id
    WHERE a.applicant_id = ? ORDER BY coalesce(a.submitted_at, '9999') DESC LIMIT 1`, c.me);
}

export type Doc = { id: string; name: string; doc_type: string | null; uploaded_at: string };

export async function applicationDocs(c: PortalCtx, applicationId: string) {
  return rows<Doc>(c, "SELECT d.id, d.name, d.doc_type, d.uploaded_at FROM {documents} d WHERE d.entity_type = 'applications' AND d.entity_id = ? ORDER BY d.uploaded_at DESC LIMIT 50", applicationId);
}

// The tracker for this application (see journeys.ts), from its own fields and documents.
export const journeyOf = (app: Application, docs: Doc[]) => applicantJourney({
  stage: app.stage, submitted_at: app.submitted_at, fee_paid: app.fee_paid, docs: docs.map((d) => d.doc_type ?? ""),
  screening: app.screening_done ? { completed_at: app.screening_done, income_verified: app.income_verified ?? 0 } : null,
  decided_at: app.decided_at, decision_reason: app.decision_reason, lease_sent_at: app.lease_sent_at, lease_signed_at: app.lease_signed_at, move_in_on: app.move_in_on, desired_move_in: app.desired_move_in,
});

// Each document with the latest upload of that type, if any. Optional ones (a guarantor's letter)
// never count as missing.
export function checklist(docs: Doc[]) {
  return [...APPLICANT_DOCS, ...OPTIONAL_DOCS].map((type) => ({ type, optional: (OPTIONAL_DOCS as readonly string[]).includes(type), doc: docs.find((d) => d.doc_type === type) ?? null }));
}
