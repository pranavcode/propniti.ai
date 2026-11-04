import "server-only";
import { notFound } from "next/navigation";
import { getEntity, type EntityKey } from "@/entities";
import { currentSession, type Session } from "@/auth/session";
import { ListView, RecordView } from "@/components/entity/pages";
import { EmptyState } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { getRow, type QueryCtx } from "@/server/query";

// Shared pieces for the settings pages. Entity lists and records under /app/settings are static
// routes (so they sit inside the settings frame) that render the generic list and record views.

type SP = Promise<Record<string, string | string[] | undefined>>;

export const toParams = (sp: Record<string, string | string[] | undefined>) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) out.append(k, x);
  return out;
};

export async function settingsSession(): Promise<{ session: Session; ctx: QueryCtx }> {
  const session = await currentSession();
  return { session, ctx: { db: getPlatform().db, ws: session.ws, actor: session.actor } };
}

export function NoAccess({ what = "Organization settings" }: { what?: string }) {
  return (
    <div className="p-6">
      <EmptyState kind="table" title={`${what} aren't part of your role`} description="Admins change org settings; principals and regional managers can read them. Switch role from your avatar menu to see this page as an admin." action={{ label: "Your notification settings", href: "/app/settings/notifications" }} secondary={{ label: "Go to your home", href: "/app" }} />
    </div>
  );
}

export const listPage = (key: EntityKey) => async function SettingsList({ searchParams }: { searchParams: SP }) {
  const def = getEntity(key);
  if (!def) notFound();
  return <ListView def={def} searchParams={toParams(await searchParams)} session={await currentSession()} />;
};

// Tab title from the record itself: "Approval policy Maintenance spend · org default · Propniti".
export const recordMetadata = (key: EntityKey) => async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const def = getEntity(key);
  const { id } = await params;
  if (!def) return { title: "Propniti" };
  const { ctx } = await settingsSession();
  const row = await getRow(ctx, key, decodeURIComponent(id)).catch(() => null);
  // Missing or unreadable: the not-found page (metadata streams, so browsers still see 200).
  if (!row) notFound();
  const title = row?.[def.titleField];
  return { title: `${def.label.one} ${typeof title === "string" && title ? title.slice(0, 60) : id} · Propniti` };
};

export const recordPage = (key: EntityKey) => async function SettingsRecord({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const def = getEntity(key);
  if (!def) notFound();
  const { id } = await params;
  return <RecordView def={def} id={decodeURIComponent(id)} searchParams={toParams(await searchParams)} session={await currentSession()} />;
};
