import "server-only";
import { cache } from "react";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { cachedCounts } from "./counts";
import { inboxCounts, type InboxCounts } from "./data";

// The signed-in persona's inbox counts, at most once per request for each kind of read. The badge
// takes the 30 s cache; the inbox page asks for fresh counts, because it lists and pages from them,
// and stores them in the cache. A later call in the same request reuses a fresh read.
const slot = cache((): { p: Promise<InboxCounts> | null; fresh: boolean } => ({ p: null, fresh: false }));

export function sessionInboxCounts(fresh = false): Promise<InboxCounts> {
  const s = slot();
  if (s.p && (s.fresh || !fresh)) return s.p;
  s.fresh = fresh;
  s.p = currentSession().then((x) => cachedCounts(x.ws, x.persona.id, () => inboxCounts({ db: getPlatform().db, ws: x.ws, actor: x.actor }), undefined, fresh));
  return s.p;
}
