import { describe, expect, it } from "vitest";
import { wrongDirections } from "@/extensions/portfolio/narrative";
import { explainNoi } from "../facts";
import { DANIEL, openFixture } from "./fixture";

// Narration checks that the figure check can't make: which way a figure moved, and drivers that
// add up to the change they explain.
describe("narration direction check", () => {
  const facts = { delta_usd: 2672003, top_gainer: "Chandler Tech Park", top_gainer_delta_usd: 188310, gains_least: "Elm Street Duplex Portfolio", gains_least_delta_usd: 4619, revenue_effect_usd: 2672003 };

  it("rejects a gain described as a loss (production QA, Elm Street)", () => {
    const text = "The top gainer is Chandler Tech Park with a $188,310 increase and the top loser is Elm Street Duplex Portfolio with a $4,619 decrease.";
    const wrong = wrongDirections(text, facts);
    expect(wrong).toContain("$4,619 is a gain");
    expect(wrong).toContain("names a top loser, but no property lost");
  });

  it("rejects a signed figure with the wrong sign", () => {
    expect(wrongDirections("Elm Street moves −$4,619.", facts)).toEqual(["−$4,619 is a gain"]);
  });

  it("accepts wording that matches the signs", () => {
    expect(wrongDirections("Scenario NOI rises by $2,672,003. Chandler Tech Park gains most, up $188,310; Elm Street Duplex Portfolio gains least, adding $4,619.", facts)).toEqual([]);
    expect(wrongDirections("Uptown Tower lost $22,184 and Frisco gained $19,129.", { mover_1_change_usd: -22184, mover_2_change_usd: 19129 })).toEqual([]);
  });

  it("leaves cost clauses to the figure check (expenses rising lowers NOI)", () => {
    expect(wrongDirections("Operating expenses rise by $50,000 a year.", { opex_effect_usd: -50000 })).toEqual([]);
  });

  it("allows a top loser when one lost", () => {
    expect(wrongDirections("The top loser is Elm Street, down $4,619.", { top_loser: "Elm Street", top_loser_delta_usd: -4619 })).toEqual([]);
  });
});

describe("NOI drivers", () => {
  it("add up to the NOI change, with the rest labelled as other income", async () => {
    const { db } = openFixture();
    const x = (await explainNoi({ db, ws: "base", actor: DANIEL }, { today: "2026-11-04" }))!;
    expect(x.month).toBe("2026-10");
    const sum = x.drivers.reduce((s, d) => s + d.delta_cents, 0);
    expect(sum).toBe(x.noi_cents - x.prior_noi_cents);
    expect(x.drivers.map((d) => d.label)).toContain("Other income");
    expect(x.drivers.map((d) => d.label)).not.toContain("Rent collected");
  });
});
