// Entity defs for the communications module. Call registerEntity() from "../registry" for each def.
// Owned by the communications module lane; see AGENTS.md "v2 lanes and ownership".
// Documents is written by lane C as the reference pattern; the communications lane adds threads,
// templates and announcements.
import { FileText } from "lucide-react";
import { OPS, STAFF } from "../common";
import { registerEntity } from "../registry";

registerEntity({
  key: "documents",
  table: "documents",
  label: { one: "Document", many: "Documents" },
  icon: FileText,
  module: "communications",
  nav: { section: "operations", group: "Communications", order: 60 },
  route: "/app/documents",
  titleField: "name",
  subtitle: (r) => [r.doc_type, r.filed_to].filter(Boolean).join(" · "),
  scopePath: "documents.property_id",
  fields: {
    name: { type: "text", label: "Document", required: true, search: true, sortable: true, list: { default: true, width: 300 } },
    doc_type: { type: "enum", label: "Type", facet: true, sortable: true, list: { default: true }, enum: [
      { value: "Lease", tone: "neutral" }, { value: "Invoice", tone: "neutral" }, { value: "W-9", tone: "neutral" }, { value: "COI", tone: "neutral" },
      { value: "Notice", tone: "neutral" }, { value: "Inspection report", tone: "neutral" }, { value: "Statement", tone: "neutral" }, { value: "Photo", tone: "neutral" }, { value: "Other", tone: "neutral" },
    ] },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, sortable: true, list: { default: true } },
    filed_to: { type: "text", label: "Filed to", search: true, list: { default: true } },
    classified_by: { type: "text", label: "Filed by", facet: true, list: { default: true }, editable: [],
      help: { summary: "Who filed it: a person, or the document classifier agent with its confidence.", article: "document-filing" } },
    classify_confidence: { type: "number", label: "Filing confidence", format: "pct", sortable: true, list: { default: false, align: "right" }, editable: [] },
    needs_review: { type: "bool", label: "Needs review", facet: true, list: { default: false },
      sql: "(documents.classified_by IS NOT NULL AND documents.classify_confidence IS NOT NULL AND documents.classify_confidence < 0.8)" },
    uploaded_at: { type: "datetime", label: "Uploaded", sortable: true, list: { default: true }, editable: [] },
    uploaded_by: { type: "text", label: "Uploaded by", editable: [] },
    mime: { type: "text", label: "File type" },
    url: { type: "text", label: "File", required: true, editable: [] },
    entity_type: { type: "text", label: "Record type", facet: true },
    entity_id: { type: "text", label: "Record" },
    extracted: { type: "json", label: "Extracted fields" },
  },
  relations: [{ name: "property", entity: "properties", fk: "property_id", kind: "one" }],
  list: {
    defaultSort: ["uploaded_at", "desc"],
    statusTabs: "doc_type",
    savedViews: [
      { key: "needs-review", label: "AI-filed, needs review", filters: { needs_review: "true" }, sort: ["classify_confidence", "asc"] },
      { key: "leases", label: "Leases", filters: { doc_type: "Lease" } },
      { key: "invoices", label: "Invoices", filters: { doc_type: "Invoice" } },
    ],
  },
  detail: {
    facts: ["doc_type", "property_id", "filed_to", "classified_by", "classify_confidence", "uploaded_at"],
    tabs: [{ key: "overview", label: "Overview", fields: ["name", "doc_type", "property_id", "filed_to", "entity_type", "entity_id", "classified_by", "classify_confidence", "uploaded_by", "uploaded_at", "mime", "url", "extracted"] }],
    related: ["property"],
  },
  capabilities: { notes: true, activity: true, aiSummary: true },
  ai: {
    facts: (r) => ({ document: String(r.name), type: (r.doc_type as string) ?? null, filed_to: (r.filed_to as string) ?? null, confidence: r.classify_confidence == null ? null : Number(r.classify_confidence) }),
    agents: ["document_classifier"],
  },
  permissions: { read: [...STAFF, "owner"], create: [...OPS, "leasing_agent", "accountant", "maintenance_supervisor", "broker"], update: [...OPS, "accountant", "broker"], delete: [...OPS] },
  writes: "generic",
  dataRules: ["documents.import_swapped_columns"],
  help: { summary: "Leases, invoices, W-9s, insurance certificates and notices, filed to the record they belong to, by a person or the document classifier.", article: "documents" },
});
