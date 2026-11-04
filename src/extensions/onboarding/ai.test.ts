import { describe, expect, it } from "vitest";
import { DetectRequest, validateReply } from "./ai";

const req = DetectRequest.parse({ files: [
  { id: "f1", name: "export.csv", headers: ["Vendor name", "Trade", "Contact person", "Email address", "Phone"], samples: [["Cool Air HVAC", "HVAC", "Ray Ortiz", "ray@coolair.example", "214-555-0144"]] },
  { id: "f2", name: "rent_roll.csv", headers: ["Property", "Unit", "Tenant", "Rent"], samples: [] },
] });
type Reply = Parameters<typeof validateReply>[1];

describe("validateReply", () => {
  it("keeps a Workers AI reply that echoes the file name instead of the id", () => {
    // Llama 4 Scout's answer for the vendor file above, as logged from the live model.
    const reply: Reply = { files: [{ id: "export.csv", tool: "generic", record_type: "vendors", confidence: 0.8, reason: "Typical vendor information columns" }] };
    expect(validateReply(req, reply)).toEqual([{ id: "f1", tool: "generic", kind: "vendors", confidence: 0.8, reason: "Typical vendor information columns" }]);
  });

  it("ignores a name shared by two files, unknown files and repeat answers", () => {
    const twins = DetectRequest.parse({ files: [{ ...req.files[0], id: "a" }, { ...req.files[0], id: "b" }] });
    const one = { tool: "generic", record_type: "vendors", confidence: 0.5, reason: "x" };
    expect(validateReply(twins, { files: [{ id: "export.csv", ...one }] })).toEqual([]);
    expect(validateReply(req, { files: [{ id: "f9", ...one }, { id: "f2", ...one }, { id: "rent_roll.csv", ...one, tool: "appfolio" }] }).map((d) => [d.id, d.tool])).toEqual([["f2", "generic"]]);
  });
});
