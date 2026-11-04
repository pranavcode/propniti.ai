import type { Kind } from "@/extensions/import/fields";
import { detect, presetScore } from "@/extensions/import/mapping";
import { PRESETS, TOOLS, toolLabel, type ToolKey } from "@/extensions/import/presets";

// Which tool exported a dropped file, and what it holds, without a model: the import's own preset
// and column matching over the header row, plus the tool's name in the file name when it is there.
// Layouts some tools share (DoorLoop and TenantCloud rent rolls differ by one letter) are reported
// as alternatives with a lower confidence, so the person picks.

export type FileHeaders = { id: string; name: string; headers: string[]; hasSection?: boolean };
export type Detection = {
  id: string; tool: ToolKey; kind: Kind; preset?: string;
  confidence: number; source: "rules" | "ai"; reason: string; alternatives: ToolKey[];
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
// "Yardi" alone could be Breeze or Voyager, so only the full names count.
const NAMES: [ToolKey, string[]][] = TOOLS.filter((t) => t.key !== "generic").map((t) => [t.key, [squash(t.label)]]);

export function toolInName(name: string): ToolKey | undefined {
  const n = squash(name);
  return NAMES.find(([, names]) => names.some((x) => n.includes(x)))?.[0];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function detectFile(f: FileHeaders): Detection {
  const named = toolInName(f.name);
  const d = detect(f.headers, named, !!f.hasSection);
  const nameNote = named ? `; the file name mentions ${toolLabel(named)}` : "";
  if (!d.preset) {
    return {
      id: f.id, tool: named ?? "generic", kind: d.kind, confidence: named ? 0.6 : 0.5, source: "rules", alternatives: [],
      reason: `No tool's usual layout matched, so the record type comes from the column names${nameNote}.`,
    };
  }
  let preset = d.preset;
  let top = presetScore(f.headers, preset);
  // A report from the tool the file is named after wins when it fits nearly as well.
  const byName = named && preset.tool !== named ? PRESETS.find((p) => p.tool === named && p.kind === preset.kind && presetScore(f.headers, p) >= top - 0.15) : undefined;
  if (byName) { preset = byName; top = presetScore(f.headers, byName); }
  // Other tools whose report of the same kind fits about as well.
  const close = [...new Set(PRESETS.filter((p) => p.tool !== preset.tool && p.kind === preset.kind && presetScore(f.headers, p) >= top - 0.05).map((p) => p.tool))];
  const hits = preset.columns.filter(([h]) => f.headers.some((x) => x.trim().toLowerCase() === h.toLowerCase())).length;
  const sure = named === preset.tool || !close.length;
  return {
    id: f.id, tool: preset.tool, kind: preset.kind, preset: preset.id, source: "rules",
    confidence: round(Math.min(0.97, Math.max(top, 0.6)) * (sure ? 1 : 0.65)),
    alternatives: sure ? [] : close,
    reason: `Headers match the typical ${toolLabel(preset.tool)} ${preset.report} layout (${hits} of ${preset.columns.length} columns)${nameNote}${sure ? "" : `; ${close.map(toolLabel).join(" and ")} export${close.length === 1 ? "s" : ""} the same columns`}.`,
  };
}

// The tool most files came from; hand-kept spreadsheets don't count unless that is all there is.
export function mainTool(ds: Pick<Detection, "tool">[]): ToolKey {
  const counts = new Map<ToolKey, number>();
  for (const d of ds) if (d.tool !== "generic") counts.set(d.tool, (counts.get(d.tool) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "generic";
}
