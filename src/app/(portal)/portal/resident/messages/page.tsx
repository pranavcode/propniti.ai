import { portalCtx } from "@/extensions/owners/portal/context";
import { messagesIn, threadsFor } from "@/extensions/owners/portal/messages";
import { Messages } from "@/extensions/owners/portal/ui/Messages";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";

export default async function ResidentMessages({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const c = await portalCtx("resident");
  if (!c) return null;
  const { thread } = await searchParams;
  const threads = await threadsFor(c, "resident");
  const active = threads.find((t) => t.id === thread) ?? null;
  return (
    <>
      <PortalTitle title="Messages" description="Questions for the leasing office? Write here and the team replies in this thread." />
      <Messages base="/portal/resident/messages" entity="residents" me={c.me} threads={threads} active={active} messages={active ? await messagesIn(c, active.id, "resident") : []} teamName="Leasing office" />
    </>
  );
}
