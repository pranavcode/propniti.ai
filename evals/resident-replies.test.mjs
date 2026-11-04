import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rulesAnnouncement, rulesReply } from "@/extensions/residents/ai";
import { gradeResidentText } from "./graders.mjs";

// evals/cases/resident-replies.json graded on what residents would receive without a model (the
// rules path every model draft falls back to). The same grader checks live drafts.
const cases = JSON.parse(readFileSync(new URL("./cases/resident-replies.json", import.meta.url), "utf8"));

describe("resident replies and announcements", () => {
  for (const c of cases) {
    it(c.id, () => {
      const text = c.kind === "reply" ? rulesReply(c.facts, c.lastIn).body : rulesAnnouncement(c.topic, c.property, []).body;
      const failed = gradeResidentText(c, text).checks.filter((x) => !x.ok).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`);
      expect(failed, text).toEqual([]);
    });
  }

  it("the grader catches what the prompts forbid", () => {
    const c = { facts: { balance_cents: 120000 }, expect: {} };
    const bad = (t) => gradeResidentText(c, t).checks.filter((x) => !x.ok).map((x) => x.name);
    expect(bad("We'll send someone right away about WO-10482.")).toEqual(["no uncommitted promise", "no internal work order id"]);
    expect(bad("Your balance is $1,250.00.")).toEqual(["figures only from facts"]);
    expect(bad("Don't hesitate to reach out!")).toEqual(["no stock phrases"]);
    expect(bad("Your balance is $1,200.00. Send the confirmation number and I'll check it.")).toEqual([]);
  });
});
