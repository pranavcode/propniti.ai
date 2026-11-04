import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/platform/types";
import { agentCards } from "../views";
import { DANIEL, openFixture, WS } from "./fixture";

// /app/agents once showed "This page couldn't load": any one of its stats queries failing (D1 busy
// or timed out) threw the whole page. The cards now render from their settings with empty counts.
describe("agents page data", () => {
  it("still returns every agent when a stats query fails, marked as missing stats", async () => {
    const { db } = openFixture();
    const failing = new Proxy(db, {
      get(target, key) {
        if (key !== "prepare") return Reflect.get(target, key);
        return (q: string) => {
          if (q.includes("GROUP BY p.agent")) throw new Error("D1_ERROR: Network connection lost.");
          return target.prepare(q);
        };
      },
    }) as Db;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = await agentCards({ db, ws: WS, actor: DANIEL });
    const cards = await agentCards({ db: failing, ws: WS, actor: DANIEL });
    expect(cards.map((c) => c.key)).toEqual(ok.map((c) => c.key));
    expect(cards.every((c) => c.statsMissing && c.proposed === 0)).toBe(true);
    expect(ok.some((c) => c.statsMissing)).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[ai] agents page"), expect.anything());
    log.mockRestore();
  });
});
