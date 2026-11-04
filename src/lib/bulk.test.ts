import { describe, expect, it, vi } from "vitest";
import { BULK_CHUNK, runBulk } from "./bulk";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("runBulk", () => {
  it("sends ids in chunks the action route accepts and adds up the results", async () => {
    const bodies: string[][] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)).ids as string[];
      bodies.push(sent);
      return Response.json({ ok: sent.length - 1, failed: 1, results: [] }, { status: 200 });
    });
    const progress: number[] = [];
    const out = await runBulk("work_orders", "work_orders.check_photos", ids(60), (done) => progress.push(done), fetcher as unknown as typeof fetch);
    expect(bodies.map((b) => b.length)).toEqual([BULK_CHUNK, BULK_CHUNK, 10]);
    expect(bodies.flat()).toEqual(ids(60));
    expect(fetcher.mock.calls[0][0]).toBe("/api/e/work_orders/actions/work_orders.check_photos");
    expect(out).toEqual({ ok: 57, failed: 3, total: 60 });
    expect(progress).toEqual([25, 50, 60]);
  });

  it("counts a refused chunk as skipped and stops on a request error", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => (++n === 1 ? Response.json({ ok: 0, failed: 25, results: [{ error: "Not now" }] }, { status: 409 }) : Response.json({ error: "Too many requests" }, { status: 429 })));
    await expect(runBulk("bills", "bills.approve", ids(60), () => {}, fetcher as unknown as typeof fetch)).rejects.toThrow("Too many requests");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
