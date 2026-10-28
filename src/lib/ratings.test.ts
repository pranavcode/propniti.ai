import { describe, expect, it } from "vitest";
import { lowRatings, ratingSummary, upsertRating } from "./ratings";
import { seed } from "./seed";

describe("ratings", () => {
  it("averages ratings per subject", () => {
    expect(ratingSummary(seed().ratings, { kind: "pm", id: "u-pm" })).toMatchObject({ avg: 4, count: 2 });
    expect(ratingSummary(seed().ratings, { kind: "vendor", id: "v3" })).toMatchObject({ avg: null, count: 0 });
  });

  it("replaces a person's earlier rating for the same subject and job", () => {
    const base = seed().ratings;
    const next = upsertRating(base, { id: "x", by: "u-pm", subject: { kind: "vendor", id: "v2" }, stars: 4, comment: "Better", ref: "WO-1031", ts: "now" });
    expect(next.length).toBe(base.length);
    expect(ratingSummary(next, { kind: "vendor", id: "v2" }).avg).toBe(4);
  });

  it("flags 1-2 star ratings", () => {
    expect(lowRatings(seed().ratings).map((r) => r.id)).toEqual(["r9"]);
  });
});
