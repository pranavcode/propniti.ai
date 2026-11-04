import type { Assembled, ImportFile } from "./assemble";
import { KIND_SPECS, similarity, type FieldKey } from "./fields";
import { key, oddCase } from "./normalize";

// What the browser sends to the model, built by code: each file's headers, its first few rows and
// up to 30 cells that rules flagged. Every cell is cut to 60 characters. The rest of the file stays
// on the device. Mirrors AI_CAPS in ./ai.ts (the server enforces the same caps).

const CAPS = { files: 6, sampleRows: 5, columns: 60, cellChars: 60, flagged: 30 };
const cut = (s: string) => s.slice(0, CAPS.cellChars);
const NAMES: FieldKey[] = ["tenant", "firstName", "lastName", "ownerName", "contactName"];

export type AiFile = { id: string; kind: ImportFile["kind"]; headers: string[]; unmapped: number[]; mapped: Record<string, number>; samples: { line: number; cells: string[] }[]; flagged: { line: number; field: string; value: string; why: string }[] };

export function buildAiRequest(files: ImportFile[], a: Assembled): { files: AiFile[] } {
  const people = files.flatMap((f) => (["tenant", "firstName"] as FieldKey[]).flatMap((field) => {
    const m = f.mapping[field];
    return m ? f.sheet.rows.map((r) => ({ f, line: r.line, field, name: r.cells[m.col] ?? "" })).filter((x) => x.name) : [];
  })).slice(0, 400); // the pairwise check below stays cheap in the browser
  return {
    files: files.slice(0, CAPS.files).map((f) => {
      const headers = f.sheet.headers.slice(0, CAPS.columns).map((h) => h.slice(0, 80));
      const mapped = Object.fromEntries(Object.entries(f.mapping).filter(([, m]) => m && m.col < CAPS.columns).map(([k, m]) => [k, m!.col]));
      const used = new Set(Object.values(mapped));
      const flagged: AiFile["flagged"] = [];
      const flag = (line: number, field: FieldKey, why: string) => {
        const col = f.mapping[field]?.col;
        const row = f.sheet.rows.find((r) => r.line === line);
        if (col == null || !row || flagged.length >= CAPS.flagged || flagged.some((x) => x.line === line && x.field === field)) return;
        flagged.push({ line, field, value: cut(row.cells[col] ?? ""), why: why.slice(0, 120) });
      };
      for (const i of a.issues) if (i.file === f.id && i.field) flag(i.line, i.field, i.message);
      for (const field of NAMES) {
        const col = f.mapping[field]?.col;
        if (col != null && KIND_SPECS[f.kind].fields.includes(field)) for (const r of f.sheet.rows) if (oddCase(r.cells[col] ?? "")) flag(r.line, field, "Name casing");
      }
      const unitCol = f.mapping.unit?.col;
      if (unitCol != null) for (const r of f.sheet.rows) if (/[^A-Za-z0-9-]/.test(r.cells[unitCol] ?? "")) flag(r.line, "unit", "Unit written with a prefix or symbol");
      // Same person spelled two ways (another file or row): a likely duplicate.
      for (const p of people.filter((x) => x.f.id === f.id)) {
        const twin = people.find((q) => q !== p && q.name[0]?.toLowerCase() === p.name[0]?.toLowerCase() && key(q.name) !== key(p.name) && similarity(key(q.name), key(p.name)) >= 0.8);
        if (twin) flag(p.line, p.field, `Looks like "${cut(twin.name)}" (${twin.f.name} row ${twin.line})`);
      }
      return {
        id: f.id, kind: f.kind, headers, mapped,
        unmapped: headers.map((_, i) => i).filter((i) => !used.has(i)),
        samples: f.sheet.rows.slice(0, CAPS.sampleRows).map((r) => ({ line: r.line, cells: r.cells.slice(0, CAPS.columns).map(cut) })),
        flagged,
      };
    }),
  };
}

// Expected reply size: a fixed part plus room for a match per unmapped column and a fix per
// flagged cell (about 40 and 60 tokens each), capped at the reply's own limits.
export const outTokens = (files: { unmapped: number[]; flagged: unknown[] }[]) =>
  Math.min(6000, 250 + files.reduce((s, f) => s + 40 * f.unmapped.length + 60 * f.flagged.length, 0));
