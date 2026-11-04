import { describe, expect, it } from "vitest";
import { prefill } from "./prefill";
import type { FormField } from "./spec";

const fields: FormField[] = [
  { key: "title", label: "Work order", type: "text", required: true },
  { key: "status", label: "Status", type: "enum", options: [{ value: "New", label: "New" }] },
  { key: "priority", label: "Priority", type: "enum", options: ["Emergency", "Urgent", "Normal", "Low"].map((v) => ({ value: v, label: v })) },
  { key: "property_id", label: "Property", type: "ref", refEntity: "properties" },
  { key: "unit_id", label: "Unit", type: "ref", refEntity: "units" },
  { key: "permission_to_enter", label: "Permission to enter", type: "bool" },
  { key: "opened_at", label: "Opened", type: "datetime" },
];

describe("prefill", () => {
  it("takes single-value filters the form can hold", () => {
    const sp = new URLSearchParams("f.property_id=p01&f.priority=Urgent&f.permission_to_enter=true&q=leak&sort=-opened_at");
    expect(prefill(fields, sp)).toEqual({ property_id: "p01", priority: "Urgent", permission_to_enter: true });
  });

  it("skips multi-value, range and null filters, and enum values the form doesn't offer", () => {
    const sp = new URLSearchParams("f.priority=Urgent,Low&f.status=Completed&f.opened_at.min=2026-10-01&f.vendor_id.null=1&f.title=");
    expect(prefill(fields, sp)).toEqual({});
  });

  it("lets the parent record win over the list's filters", () => {
    const sp = new URLSearchParams("f.property_id=p09&f.priority=Low");
    expect(prefill(fields, sp, { property_id: "p01", unit_id: "p01-u1", lease_id: "ignored" })).toEqual({ property_id: "p01", unit_id: "p01-u1", priority: "Low" });
  });
});
