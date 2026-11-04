import Link from "@/components/Link";
import { ChevronRight, Megaphone } from "lucide-react";
import { EmptyState } from "@/components/app/states";
import { pageCtx, scopeIn, sql, one } from "../server";
import { ComposerForm } from "./ComposerForm";

// Announcement composer: pick a property, describe it (or start from a notice template), let AI
// draft it, edit, then send now or schedule. Recipients are the property's current and notice
// residents, counted live.

export async function Composer({ id, run, src, property }: { id?: string; run?: string; src?: string; property?: string }) {
  const ctx = await pageCtx();
  if (!["principal", "regional_manager", "property_manager"].includes(ctx.actor.role)) {
    return <main className="p-6"><EmptyState title="Announcements are sent by property managers" description="Switch role from your avatar menu to write one." action={{ label: "Back to announcements", href: "/app/communications/announcements" }} /></main>;
  }
  const s = scopeIn(ctx.actor, "p.id");
  const [props, templates] = await Promise.all([
    sql<{ id: string; name: string; recipients: number }>(ctx, `SELECT p.id, p.name, (SELECT count(*) FROM {residents} r WHERE r.property_id = p.id AND r.status IN ('Current', 'Notice')) AS recipients FROM {properties} p WHERE ${s.sql} ORDER BY p.name LIMIT 100`, s.binds),
    sql<{ id: string; name: string; subject: string; body: string }>(ctx, "SELECT id, name, subject, body FROM {templates} WHERE category = 'Notices' AND language = 'en' ORDER BY name LIMIT 20"),
  ]);
  const a = id ? await one(ctx, "SELECT * FROM {announcements} WHERE id = ?", [id]) : null;
  const pid = a ? JSON.parse(String(a.audience ?? "{}")).property_ids?.[0] : property;
  if (a && (!pid || !props.some((p) => p.id === pid))) return <main className="p-6"><EmptyState title="Announcement not found" description="It may belong to a property outside your scope." action={{ label: "Back to announcements", href: "/app/communications/announcements" }} /></main>;
  if (a && a.status === "Sent") return <main className="p-6"><EmptyState title="This announcement was already sent" action={{ label: "Open it", href: `/app/communications/announcements/${encodeURIComponent(String(a.id))}` }} /></main>;

  return (
    <main className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6">
      <div>
        <div className="flex items-center gap-1 text-[12px] text-muted-foreground"><Link href="/app/communications/announcements" className="hover:text-foreground hover:underline">Announcements</Link><ChevronRight className="size-3" />{a ? "Draft" : "New"}</div>
        <h1 className="mt-0.5 flex items-center gap-2 text-[20px] font-semibold tracking-tight"><Megaphone className="size-5 text-muted-foreground" />{a ? String(a.title) : "New announcement"}</h1>
        <p className="text-[12.5px] text-muted-foreground">One message to every current and on-notice resident of a property. Sending is simulated in this demo.</p>
      </div>
      <ComposerForm key={`${a?.id ?? "new"}-${run ?? ""}`}
        properties={props.map((p) => ({ id: p.id, name: p.name, recipients: Number(p.recipients) }))}
        templates={templates.map((t) => ({ id: String(t.id), name: String(t.name), subject: String(t.subject ?? ""), body: String(t.body) }))}
        draft={a ? { id: String(a.id), title: String(a.title), body: String(a.body), channels: JSON.parse(String(a.channels ?? "[]")), propertyId: String(pid), status: String(a.status), sendAt: (a.send_at as string) ?? null } : null}
        provenance={run ? { runId: run, source: src === "live" ? "live" : "rules" } : null}
        initialProperty={pid ?? props[0]?.id ?? ""}
      />
    </main>
  );
}
