import { portalCtx } from "@/extensions/owners/portal/context";
import { messagesIn, threadsFor } from "@/extensions/owners/portal/messages";
import { Messages } from "@/extensions/owners/portal/ui/Messages";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";

export default async function OwnerMessages({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const c = await portalCtx("owner");
  if (!c) return null;
  const { thread } = await searchParams;
  const threads = await threadsFor(c, "owner");
  const active = threads.find((t) => t.id === thread) ?? null;
  return (
    <>
      <PortalTitle title="Messages" description="Talk to your asset manager and the accounting team." />
      <Messages base="/portal/owner/messages" entity="owners" me={c.me} threads={threads} active={active} messages={active ? await messagesIn(c, active.id, "owner") : []} />
    </>
  );
}
