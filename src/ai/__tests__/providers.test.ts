import { describe, expect, it } from "vitest";
import { firstJson } from "../providers/workers";

describe("JSON-plan replies", () => {
  it("takes the first object when the model writes two steps", () => {
    expect(firstJson('{"tool":"ledger__lookup","input":{"lease_id":"L-1"}}assistant\n\n{"tool":"x","input":{}}')).toEqual({ tool: "ledger__lookup", input: { lease_id: "L-1" } });
  });
  it("handles braces inside strings and fenced replies", () => {
    expect(firstJson('```json\n{"final":"Use {curly} braces"}\n```')).toEqual({ final: "Use {curly} braces" });
  });
  it("rejects replies without JSON", () => {
    expect(() => firstJson("I think the answer is 4")).toThrow();
  });
});
