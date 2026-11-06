import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersona } from "@/auth/personas";
import { suggest } from "@/extensions/import/ai";
import { detectWithModel } from "@/extensions/onboarding/ai";
import { ask } from "../assistant";
import { guarded } from "../http";
import { nlFilter } from "../nlfilter";
import { currentModel, MODEL_DOWN, MODEL_FALLBACK, ModelError, setModelForTests, type ChatModel } from "../providers";
import { generateSummary } from "../summaries";
import { MARCUS, openFixture, WS } from "./fixture";

// A provider error carries request ids and key fragments. People see a plain sentence; run traces
// keep a short reason; the server log keeps the whole error.
const SECRET = "sk-ant-api03-Zx9SECRETKEY";
const REQ = "req_011CVsecretRequestId";
const raw = () => new Error(`401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key ${SECRET}"},"request_id":"${REQ}"}`);
const failing: ChatModel = {
  info: { provider: "anthropic", model: "claude-opus-5", label: "Scripted", native: true },
  chat: async () => { throw raw(); },
  structured: async () => { throw raw(); },
};
const leaks = (v: unknown) => /sk-ant|SECRETKEY|req_011|x-api-key|authentication_error|401/.test(JSON.stringify(v));

afterEach(() => {
  setModelForTests(undefined);
  vi.restoreAllMocks();
});

describe("model provider errors", () => {
  it("are logged in full and replaced by a short reason", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setModelForTests(failing);
    const err = await currentModel()!.structured((await import("zod")).z.object({}), "s", "u").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as Error).message).toBe("model unavailable");
    expect(log.mock.calls.some((c) => c.some((a) => String(a instanceof Error ? a.message : a).includes(SECRET)))).toBe(true);
  });

  it("never reach the assistant's reply or the run trace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setModelForTests(failing);
    const { db, raw: sqlite } = openFixture();
    const data = { db, ws: WS, actor: MARCUS };
    // Rules answer + model suggestions, and a free question for the model's tool loop.
    for (const question of ["Who is late on rent?", "Which vendor should I call about the boiler at The Lofts?"]) {
      const r = await ask({ data, persona: getPersona("marcus")!, question });
      expect(leaks(r)).toBe(false);
      expect(r.note).toBe(MODEL_FALLBACK);
    }
    const steps = sqlite.prepare("SELECT output FROM agent_steps WHERE workspace_id = ?").all(WS);
    expect(steps.some((s) => String(s.output).includes("model unavailable"))).toBe(true);
    expect(leaks(steps)).toBe(false);
    expect(leaks(sqlite.prepare("SELECT error, summary FROM agent_runs WHERE workspace_id = ?").all(WS))).toBe(false);
    expect(leaks(sqlite.prepare("SELECT content, plan FROM assistant_messages WHERE workspace_id = ?").all(WS))).toBe(false);
  });

  it("never reach summaries, AI filters, import suggestions or file detection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setModelForTests(failing);
    const { db } = openFixture();
    const data = { db, ws: WS, actor: MARCUS };
    const summary = await generateSummary(data, "properties", "p01");
    expect(summary).toMatchObject({ source: "rules" });
    const filter = await nlFilter(data, "work_orders", "open plumbing jobs");
    expect(filter.live).toBe(false);
    const imp = await suggest({ files: [{ id: "f1", kind: "units", headers: ["Unit"], unmapped: [], mapped: {}, samples: [], flagged: [] }] });
    expect(imp).toMatchObject({ live: false, note: expect.stringMatching(/AI service returned an error/) });
    const det = await detectWithModel({ files: [{ id: "f1", name: "units.csv", headers: ["Unit"], samples: [] }] });
    expect(det.live).toBe(false);
    for (const out of [summary, filter, imp, det]) expect(leaks(out)).toBe(false);
  });

  it("reach a route as one plain sentence", async () => {
    const res = await guarded(async () => { throw new ModelError("model timed out"); });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: MODEL_DOWN });
  });
});
