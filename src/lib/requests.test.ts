import { describe, expect, it } from "vitest";
import { AskRequest, ValidateRequest, parseBody } from "./requests";
import { seed } from "./seed";

const post = (body: string) => new Request("http://x/api", { method: "POST", body });

describe("parseBody", () => {
  it("accepts a valid work order", async () => {
    const wo = seed().workOrders[0];
    const r = await parseBody(post(JSON.stringify({ workOrder: wo })), ValidateRequest);
    expect(r).not.toBeInstanceOf(Response);
  });

  it("rejects bad JSON, wrong shapes and oversized bodies", async () => {
    expect(((await parseBody(post("{"), ValidateRequest)) as Response).status).toBe(400);
    expect(((await parseBody(post(JSON.stringify({ workOrder: { id: 1 } })), ValidateRequest)) as Response).status).toBe(400);
    expect(((await parseBody(post(JSON.stringify({ question: "", state: seed() })), AskRequest)) as Response).status).toBe(400);
    expect(((await parseBody(post("x".repeat(300 * 1024)), AskRequest)) as Response).status).toBe(413);
  });
});
