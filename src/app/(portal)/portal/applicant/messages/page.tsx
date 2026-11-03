import { portalCtx } from "@/extensions/owners/portal/context";
import { messagesIn, threadsFor } from "@/extensions/owners/portal/messages";
import { Messages } from "@/extensions/owners/portal/ui/Messages";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";

export default async function ApplicantMessages({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const c = await portalCtx("applicant");
  if (!c) return null;
  const { thread } = await searchParams;
  const threads = await threadsFor(c, "applicant");
  const active = threads.find((t) => t.id === thread) ?? null;
  return (
    <>
      <PortalTitle title="Messages" description="Questions about your application go straight to the leasing team." />
      <Messages base="/portal/applicant/messages" entity="applicants" me={c.me} threads={threads} active={active} messages={active ? await messagesIn(c, active.id, "applicant") : []} teamName="Leasing team" />
    </>
  );
}
