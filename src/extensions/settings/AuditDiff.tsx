import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getEntity } from "@/entities";
import type { TabProps } from "@/extensions/tabs";
import { EmptyState } from "@/components/app/states";

// Audit entry → field-by-field before/after. Generic edits store only the changed columns; named
// actions store their input as "after".

const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function AuditDiff({ row }: TabProps) {
  const before = asObj(row.before_json);
  const after = asObj(row.after_json);
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !["seq", "workspace_id", "deleted"].includes(k));
  const target = typeof row.entity_type === "string" ? getEntity(row.entity_type) : undefined;
  const label = (k: string) => Object.entries(target?.fields ?? {}).find(([key, f]) => (f.column ?? key) === k)?.[1].label ?? k.replace(/_/g, " ");
  const money = (k: string) => k.endsWith("_cents");
  const fmt = (k: string, v: unknown) => (money(k) && typeof v === "number" ? `$${(v / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : show(v));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        {row.agent ? <span className="inline-flex items-center gap-1 rounded bg-tone-ai/10 px-1.5 py-0.5 text-tone-ai"><Sparkles className="size-3" />{String(row.agent)}{row.model ? ` · ${String(row.model)}` : ""}</span> : null}
        <span>{show(row.detail)}</span>
        {target && typeof row.entity_id === "string" && <Link href={`${target.route}/${encodeURIComponent(row.entity_id)}`} className="text-primary hover:underline">Open {target.label.one.toLowerCase()} {row.entity_id}</Link>}
      </div>
      {!keys.length ? (
        <EmptyState compact kind="table" title="No field changes recorded" description="This entry records an event, such as an approval or a run, rather than an edit." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">Field</th><th className="px-3 py-2 font-medium">Before</th><th className="px-3 py-2 font-medium">After</th></tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const b = before?.[k], a = after?.[k];
                const changed = show(b) !== show(a);
                return (
                  <tr key={k} className="border-t align-top">
                    <th scope="row" className="px-3 py-1.5 text-left font-medium capitalize">{label(k)}</th>
                    <td className={`px-3 py-1.5 font-mono text-[12px] break-all ${changed && before ? "bg-tone-danger/5 text-tone-danger line-through decoration-tone-danger/40" : "text-muted-foreground"}`}>{before ? fmt(k, b) : "—"}</td>
                    <td className={`px-3 py-1.5 font-mono text-[12px] break-all ${changed ? "bg-tone-success/5 text-tone-success" : ""}`}>{after ? fmt(k, a) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
