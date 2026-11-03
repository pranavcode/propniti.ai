import "server-only";
import { getPlatform } from "@/lib/platform";
import roster from "@/seed/roster.json";

export type Proof = { properties: number; units: number; metros: number; issues: number | null; hoursSaved: number | null; months: number | null };

const props = roster as { metro: string; units: number }[];
const FALLBACK: Proof = {
  properties: props.length,
  units: props.reduce((s, p) => s + p.units, 0),
  metros: new Set(props.map((p) => p.metro)).size,
  issues: null,
  hoursSaved: null,
  months: null,
};

// Reads the shared demo portfolio (workspace 'base'), so the strip shows the same numbers a
// visitor finds after signing in. Any failure (no database, base not loaded yet) falls back to the
// roster and hides the figures we can't back up.
export async function loadProof(): Promise<Proof> {
  try {
    const db = getPlatform().db;
    const row = await db
      .prepare(
        `SELECT
          (SELECT count(*) FROM properties WHERE workspace_id = 'base' AND deleted = 0) AS properties,
          (SELECT count(*) FROM units WHERE workspace_id = 'base' AND deleted = 0) AS units,
          (SELECT count(*) FROM data_issues WHERE workspace_id = 'base' AND deleted = 0) AS issues,
          (SELECT sum(ai_minutes_saved) FROM metrics_monthly WHERE workspace_id = 'base') AS minutes,
          (SELECT count(DISTINCT month) FROM metrics_monthly WHERE workspace_id = 'base') AS months`,
      )
      .first<{ properties: number; units: number; issues: number; minutes: number | null; months: number }>();
    if (!row || !row.properties) return FALLBACK;
    return {
      properties: row.properties,
      units: row.units || FALLBACK.units,
      metros: FALLBACK.metros,
      issues: row.issues || null,
      hoursSaved: row.minutes ? Math.round(row.minutes / 60) : null,
      months: row.months || null,
    };
  } catch {
    return FALLBACK;
  }
}
