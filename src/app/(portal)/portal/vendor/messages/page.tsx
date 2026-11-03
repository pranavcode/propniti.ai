import { portalCtx } from "@/extensions/owners/portal/context";
import { messagesIn, threadsFor } from "@/extensions/owners/portal/messages";
import { Messages } from "@/extensions/owners/portal/ui/Messages";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";

export default async function VendorMessages({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const c = await portalCtx("vendor");
  if (!c) return null;
  const { thread } = await searchParams;
  const threads = await threadsFor(c, "vendor");
  const active = threads.find((t) => t.id === thread) ?? null;
  return (
    <>
      <PortalTitle title="Messages" description="Questions about jobs, access or payments go to the maintenance team." />
      <Messages base="/portal/vendor/messages" entity="vendors" me={c.me} threads={threads} active={active} messages={active ? await messagesIn(c, active.id, "vendor") : []} />
    </>
  );
}
