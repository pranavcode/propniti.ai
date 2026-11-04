import { Bell } from "lucide-react";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { settingsSession } from "@/extensions/settings/pages";
import { count, prefsData } from "@/extensions/settings/data";
import { CHANNELS, NOTIFICATION_TYPES } from "@/extensions/settings/notifications";
import { NotificationMatrix } from "@/extensions/settings/ui/forms";

export const metadata = { title: "Notifications · Propniti" };

export default async function NotificationsSettingsPage() {
  const { session, ctx } = await settingsSession();
  const me = session.persona;
  const [data, unread] = await Promise.all([
    prefsData(ctx, me.id),
    count(ctx, "SELECT count(*) AS n FROM {notifications} WHERE user_id = ? AND read_at IS NULL", [me.record?.id ?? me.id]),
  ]);
  const saved = (data.notifications ?? {}) as { types?: Record<string, Record<string, boolean>>; digest?: string };
  const initial = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.key, { ...t.default, ...(saved.types?.[t.key] ?? {}) }]));
  return (
    <>
      <PageHeader icon={<Bell />} title="Notifications" description={`Where ${me.name.split(" ")[0]} hears about what needs attention. These settings are yours; other people's aren't affected.`}
        meta={<span>{unread} unread in the bell</span>} />
      <PageBody>
        <Section title="By type and channel" description="Changes save as you make them. SMS goes to the phone on your user record.">
          <NotificationMatrix types={NOTIFICATION_TYPES.map(({ key, label, description }) => ({ key, label, description }))} channels={CHANNELS.map((c) => ({ ...c }))} initial={initial} digest={saved.digest ?? "Daily 7:00"} />
        </Section>
      </PageBody>
    </>
  );
}
