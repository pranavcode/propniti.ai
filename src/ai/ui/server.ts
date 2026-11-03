import "server-only";
import { after } from "next/server";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import type { DataCtx } from "../data";
import { maybeSweep } from "../sweep";

// Server components: the persona's data context (their workspace, or the shared base before their
// first change), and the "run on visit" sweep check.
export async function pageData(): Promise<{ data: DataCtx; persona: Awaited<ReturnType<typeof currentSession>>["persona"] }> {
  const s = await currentSession();
  const db = getPlatform().db;
  maybeSweep(db, (p) => after(p));
  const actor = s.persona.portal && s.actor.propertyIds === "all" ? { ...s.actor, propertyIds: [] } : s.actor;
  return { data: { db, ws: s.ws ?? "base", actor }, persona: s.persona };
}
