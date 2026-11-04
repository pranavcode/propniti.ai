import type { ReactNode } from "react";
import type { Tone, View } from "@/entities/types";
import type { Help } from "@/lib/glossary";

// DataTable contract. Everything is plain data (server pages build it from an EntityDef with
// tableSpec() in ./spec.ts) except the optional render/callback props, which client pages may add.

export type Row = Record<string, unknown> & { id?: unknown; _title?: unknown; _subtitle?: unknown; _image?: unknown };

export type ColumnKind =
  | "text" | "number" | "money" | "pct" | "meter" | "date" | "datetime" | "relative" | "due"
  | "enum" | "ref" | "bool" | "image" | "health" | "json";

export type EnumOption = { value: string; tone: Tone; label?: string };

export type DataColumn = {
  key: string;
  label: string;
  kind?: ColumnKind;
  align?: "left" | "right";
  width?: number;
  sortable?: boolean;
  defaultHidden?: boolean;               // available in the column picker, off by default
  enum?: EnumOption[];
  // Link template for the cell ("/app/properties/{property_id}"). Ref columns show row[`${key}__label`].
  href?: string;
  // The title column: bold, with row._image thumbnail and row._subtitle under it.
  primary?: boolean;
  thumbnail?: boolean;
  moneyStyle?: "full" | "whole" | "compact";
  render?: (row: Row) => ReactNode;      // client-only escape hatch
  help?: Help;                           // definition shown by the header's ⓘ
};

export type FacetOption = { value: string; label?: string; count?: number; tone?: Tone };
export type Facet =
  | { key: string; label: string; kind: "enum" | "ref"; options: FacetOption[]; help?: Help }
  | { key: string; label: string; kind: "date" | "number" | "money"; help?: Help };

export type StatusTabs = { field: string; options: EnumOption[]; allLabel?: string };

export type BulkAction = { key: string; label: string; tone?: "default" | "danger"; confirm?: string };

// Natural-language filter (lane E implements the callback): returns the URL state to apply.
export type AiFilterResult = { q?: string; filters?: Record<string, string | string[]>; sort?: [string, "asc" | "desc"]; explanation?: string };
export type AiFilterFn = (text: string) => Promise<AiFilterResult>;

export type SavedView = View & { shared?: boolean; mine?: boolean; builtIn?: boolean };

export type EmptyCopy = { title: string; description?: string; action?: { label: string; href: string } };
