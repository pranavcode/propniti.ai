import type { FieldType, Tone } from "@/entities/types";

// Plain field description for forms and inline edit (built from FieldDef on the server by
// fieldSpecs() in ./spec.ts). Money is dollars; dates are "YYYY-MM-DD".
export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  enum?: { value: string; tone: Tone; label?: string }[];
  options?: { value: string; label: string }[];   // ref fields: choices in scope
  required?: boolean;
  editable?: boolean;
  format?: "compact" | "full" | "pct" | "relative";
  help?: string;
  placeholder?: string;
};
