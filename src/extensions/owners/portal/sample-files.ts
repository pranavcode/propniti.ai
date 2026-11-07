// The demo's sample uploads in /public/samples/portal: fictional people and companies, each page
// stamped SAMPLE. "Try a sample file" loads one into an upload field so visitors can walk a journey
// without their own paperwork. Shared by the browser (to fetch the file) and the server (to check
// the key and link staff to the same file).

export const SAMPLE_DOCS = {
  "photo-id": { docType: "Photo ID", file: "/samples/portal/sample-photo-id.png", name: "SAMPLE photo ID.png" },
  "pay-stub": { docType: "Pay stub", file: "/samples/portal/sample-pay-stub-oct.pdf", name: "SAMPLE pay stub, October.pdf" },
  "pay-stub-2": { docType: "Second pay stub", file: "/samples/portal/sample-pay-stub-sep.png", name: "SAMPLE pay stub, September.png" },
  "employer-letter": { docType: "Employer letter", file: "/samples/portal/sample-employer-letter.pdf", name: "SAMPLE employer letter.pdf" },
  "bank-statement": { docType: "Bank statement", file: "/samples/portal/sample-bank-statement.pdf", name: "SAMPLE bank statement.pdf" },
  "guarantor-letter": { docType: "Guarantor letter", file: "/samples/portal/sample-guarantor-letter.pdf", name: "SAMPLE guarantor letter.pdf" },
} as const;
export type SampleDocKey = keyof typeof SAMPLE_DOCS;
export const sampleForDocType = (docType: string) => (Object.keys(SAMPLE_DOCS) as SampleDocKey[]).find((k) => SAMPLE_DOCS[k].docType === docType) ?? null;

export const SAMPLE_PHOTOS = [
  { file: "/samples/portal/sample-leak-under-sink.jpg", name: "SAMPLE leak under sink.jpg", text: "Water is leaking under the kitchen sink and the cabinet floor is wet. It started this morning.", location: "Kitchen" },
  { file: "/samples/portal/sample-hvac-not-cooling.jpg", name: "SAMPLE AC unit.jpg", text: "The AC is running but blowing warm air since last night. The thermostat says 82.", location: "Whole apartment" },
] as const;

// The values printed on the sample declarations page, used to fill the form when no AI model is
// configured to read it (the dialog says the values came from the sample, not from AI).
export const SAMPLE_DECLARATIONS = {
  file: "/samples/portal/sample-renters-insurance-declarations.pdf", name: "SAMPLE renters insurance declarations.pdf",
  values: { carrier: "Sample Mutual Insurance Co.", policyNumber: "SMP-RI-2027-0412", liability: "300000", startsOn: "2026-11-01", expiresOn: "2027-11-01" },
} as const;

// Fetches a sample from /public as a File, as if the visitor had picked it.
export async function sampleFile(path: string, name: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("The sample file didn't load. Try again.");
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}
