import { currentSession } from "@/auth/session";
import { pageData } from "@/ai/ui/server";
import { registerWidget } from "@/extensions/widgets";
import { Briefing } from "./Briefing";

// The briefing as a home widget, for home pages that render widgetsFor(role). Module homes can
// also import <Briefing /> directly.
async function BriefingWidget() {
  const session = await currentSession();
  const { data } = await pageData();
  return <Briefing session={session} data={data} embedded />;
}

registerWidget({ key: "settings.briefing", title: "AI briefing", roles: ["admin", "platform_admin"], size: "full", component: BriefingWidget });
