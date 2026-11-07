import { FileText } from "lucide-react";
import { portalCtx } from "@/extensions/owners/portal/context";
import { application, applicationDocs, checklist } from "@/extensions/owners/portal/applicant-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { DocUpload } from "@/extensions/owners/portal/ui/applicant/DocUpload";
import { NoApplication } from "@/extensions/owners/portal/ui/applicant/NoApplication";

const HINT: Record<string, string> = {
  "Photo ID": "Driver's license, state ID or passport",
  "Pay stub": "Your most recent pay stub",
  "Second pay stub": "The pay stub before that",
  "Employer letter": "A letter confirming your job and salary",
  "Bank statement": "Your latest monthly statement",
  "Guarantor letter": "Only if you have a guarantor, or the office asks for one",
};

// Required documents with their status, an upload for each, and everything received so far.
export default async function ApplicantDocuments() {
  const c = await portalCtx("applicant");
  if (!c) return null;
  const app = await application(c);
  if (!app) return <NoApplication />;
  const docs = await applicationDocs(c, app.id);
  const list = checklist(docs);
  const required = list.filter((x) => !x.optional);
  const missing = required.filter((x) => !x.doc).length;
  return (
    <>
      <PortalTitle title="Documents" description={missing ? `${missing} of ${required.length} still needed for your application at ${app.property}. PDFs and phone photos up to 4 MB both work. No paperwork handy? Use "Try a sample file".` : `We have everything we need for your application at ${app.property}.`} />
      <section aria-label="Required documents" className="overflow-hidden rounded-xl border bg-card">
        <ul className="divide-y">
          {list.map((x) => <DocUpload key={x.type} type={x.type} optional={x.optional} received={x.doc ? { name: x.doc.name, uploaded_at: x.doc.uploaded_at } : null} hint={HINT[x.type] ?? ""} />)}
        </ul>
      </section>
      <section aria-labelledby="got-h" className="mt-5 rounded-xl border bg-card">
        <h2 id="got-h" className="border-b px-4 py-3 text-[14px] font-semibold">Received ({docs.length})</h2>
        {docs.length ? (
          <ul className="divide-y">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{d.name}</span><span className="block text-[12px] text-muted-foreground">{d.doc_type ?? "Document"}</span></span>
                <time className="text-[12px] text-muted-foreground tabular-nums" dateTime={d.uploaded_at}>{new Date(d.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</time>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-6 text-[13px] text-muted-foreground">Nothing uploaded yet. Start with your photo ID.</p>}
      </section>
    </>
  );
}
