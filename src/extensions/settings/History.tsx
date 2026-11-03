import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RelativeDate } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import type { QueryCtx } from "@/server/query";
import { parseJson, rows } from "./data";

// Change history for settings records, read from the audit trail (generic edits store the
// changed columns before and after; amendments store their input).

type Entry = { id: string; at: string; actor: string; role: string | null; action: string; entity_id: string; detail: string; before_json: string | null; after_json: string | null };

const fmt = (k: string, v: unknown) => {
  if (v == null || v === "") return "none";
  if (k.endsWith("_cents") && typeof v === "number") return `$${(v / 100).toLocaleString("en-US")}`;
  if (k === "always_human" || k === "enabled") return v ? "yes" : "no";
  return String(v).replace(/_/g, " ");
};

export async function ChangeHistory({ ctx, entityTypes, entityId, limit = 15, labels = {}, empty }: { ctx: QueryCtx; entityTypes: string[]; entityId?: string; limit?: number; labels?: Record<string, string>; empty: string }) {
  const params: unknown[] = [JSON.stringify(entityTypes)];
  if (entityId) params.push(entityId);
  const list = await rows<Entry>(ctx, `SELECT id, at, actor, role, action, entity_id, detail, before_json, after_json FROM {audit} WHERE entity_type IN (SELECT value FROM json_each(?))${entityId ? " AND entity_id = ?" : ""} ORDER BY at DESC LIMIT ${Math.min(50, limit)}`, params);
  if (!list.length) return <EmptyState compact kind="table" title="No changes yet" description={empty} />;
  return (
    <ol aria-label="Change history" className="divide-y rounded-lg border bg-card">
      {list.map((e) => {
        const before = parseJson<Record<string, unknown>>(e.before_json, {});
        const after = parseJson<Record<string, unknown>>(e.after_json, {});
        const keys = Object.keys(after).filter((k) => !["seq", "workspace_id", "deleted", "id"].includes(k)).slice(0, 4);
        return (
          <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13px]"><span className="font-medium">{e.actor}</span> <span className="text-muted-foreground">{e.before_json && keys.length ? `changed ${keys.map((k) => labels[k] ?? k.replace(/_cents$/, "").replace(/_/g, " ")).join(", ")}` : e.detail || e.action.replace(/[._]/g, " ")}</span></div>
              {e.before_json && keys.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
                  {keys.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1 tabular-nums">
                      <span className="text-muted-foreground">{labels[k] ?? k.replace(/_cents$/, "").replace(/_/g, " ")}:</span>
                      <span className="text-tone-danger line-through decoration-tone-danger/40">{fmt(k, before[k])}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span className="text-tone-success">{fmt(k, after[k])}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <RelativeDate value={e.at} />
              <Link href={`/app/settings/audit/${encodeURIComponent(e.id)}`} className="text-primary hover:underline">Details</Link>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
