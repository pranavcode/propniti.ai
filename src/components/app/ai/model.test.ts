import { describe, expect, it } from "vitest";
import { modelName } from "./model";

describe("modelName", () => {
  it("turns provider model ids into names people read", () => {
    expect(modelName("@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBe("Llama 3.3 70B");
    expect(modelName("@cf/meta/llama-4-scout-17b-16e-instruct")).toBe("Llama 4 Scout");
    expect(modelName("claude-sonnet-4-5")).toBe("Claude Sonnet 4.5");
    expect(modelName("claude-opus-5")).toBe("Claude Opus 5");
    expect(modelName("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5");
  });

  it("leaves names that are already readable, and unknown ids, as they are", () => {
    expect(modelName("Workers AI · llama-3.3-70b")).toBe("Workers AI · llama-3.3-70b");
    expect(modelName("gpt-5-mini")).toBe("gpt-5-mini");
    expect(modelName("@cf/qwen/qwen3-30b")).toBe("qwen3-30b");
  });
});
