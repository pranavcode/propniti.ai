import { getEntity, INTERNAL_ROLES } from "@/entities";
import { PERSONAS } from "@/auth/personas";
import { ListView } from "@/components/entity/pages";
import { NoAccess, settingsSession, toParams } from "@/extensions/settings/pages";
import { rows } from "@/extensions/settings/data";
import { canInvite, canSettings } from "@/extensions/settings/nav";
import { InviteUser } from "@/extensions/settings/ui/forms";

export const metadata = { title: "Users · Propniti" };

const roleLabel = (r: string) => PERSONAS.find((p) => p.role === r)?.title ?? r.replace(/_/g, " ");

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { session, ctx } = await settingsSession();
  if (!canSettings(session.actor.role)) return <NoAccess />;
  const canEdit = canInvite(session.actor.role);
  const [regions, props] = canEdit
    ? await Promise.all([
      rows<{ id: string; name: string }>(ctx, "SELECT id, name FROM {regions} ORDER BY name"),
      rows<{ id: string; name: string; metro: string }>(ctx, "SELECT id, name, metro FROM {properties} ORDER BY metro, name"),
    ])
    : [[], []];
  return (
    <div className="relative">
      {canEdit && (
        <div className="absolute top-4 right-4 z-10 md:top-6 md:right-6">
          <InviteUser
            roles={INTERNAL_ROLES.filter((r) => r !== "platform_admin" && (r !== "admin" || session.actor.role === "admin")).map((r) => ({ value: r, label: roleLabel(r) }))}
            regions={regions.map((r) => ({ value: r.id, label: r.name }))}
            properties={props.map((p) => ({ value: p.id, label: `${p.name} · ${p.metro}` }))}
          />
        </div>
      )}
      <ListView def={getEntity("staff")!} searchParams={toParams(await searchParams)} session={session} />
    </div>
  );
}
