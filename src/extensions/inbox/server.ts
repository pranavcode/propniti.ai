import "server-only";
import { cache } from "react";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { cachedCounts } from "./counts";
import { inboxCounts } from "./data";

// The signed-in persona's inbox counts, once per request (the layout's badge and the inbox page
// share it) and from the 30 s badge cache across requests.
export const sessionInboxCounts = cache(async () => {
  const s = await currentSession();
  return cachedCounts(s.ws, s.persona.id, () => inboxCounts({ db: getPlatform().db, ws: s.ws, actor: s.actor }));
});
