// Dashboard kit contract: plain data, so server pages can pass it straight to the client cards.

export type ValueFormat = "money" | "count" | "pct" | "days";
export type ChartKind = "line" | "area" | "bar" | "stacked" | "hbar" | "donut" | "funnel" | "heatmap";
export type ChartSeries = { key: string; label: string; format?: ValueFormat; color?: string; dashed?: boolean }; // dashed: targets, budgets
export type ChartPoint = Record<string, string | number | null>;
