import type { Format } from "./types";

// Download URLs for a report or statement: the route plus its params and format=…
// (the Download menu adds brand=0|1 for XLSX and PDF).
export function downloadHrefs(path: string, params: Record<string, string | undefined>): Record<Format, string> {
  const at = (format: Format) => {
    const sp = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    sp.set("format", format);
    return `${path}?${sp}`;
  };
  return { csv: at("csv"), xlsx: at("xlsx"), pdf: at("pdf") };
}
