// Aging buckets are ordered, so they share one hue from light (recent) to dark (oldest) rather than
// unrelated categorical colours.
export const AGING_RAMP = ["oklch(0.85 0.07 40)", "oklch(0.74 0.12 38)", "oklch(0.62 0.16 32)", "oklch(0.5 0.17 27)"] as const;

export const AGING_SERIES = [
  { key: "d0_30", label: "0–30 days" }, { key: "d31_60", label: "31–60 days" }, { key: "d61_90", label: "61–90 days" }, { key: "d90p", label: "90+ days" },
].map((s, i) => ({ ...s, format: "money" as const, color: AGING_RAMP[i] }));
