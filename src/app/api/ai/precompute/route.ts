import { z } from "zod";
import { inLakeside, PERSONAS } from "@/auth/personas";
import { generateBriefing, generateSummary, precomputeTargets } from "@/ai/summaries";
import { SYSTEM_ACTOR } from "@/ai/orchestrator";
import { getPlatform } from "@/lib/platform";
import { parseBody } from "@/lib/requests";
import { actorFor } from "@/server/permissions";

// Used only by scripts/ai-precompute.mjs against a local dev server: generates summaries and the
// home briefings with the configured model and stores them as base rows. Off unless
// PRECOMPUTE_TOKEN is set in the server's environment and the request carries it, or (Workers dev,
// where the worker can't see shell variables) it's a development server on localhost.
const Body = z.object({ items: z.array(z.object({ entity: z.string().max(40), id: z.string().max(80) })).max(25).default([]), briefings: z.boolean().default(false) });

function allowed(request: Request) {
  const token = process.env.PRECOMPUTE_TOKEN;
  const given = request.headers.get("x-precompute-token");
  if (!given || !/^(localhost|127\.0\.0\.1)$/.test(new URL(request.url).hostname)) return false;
  return token && token !== "unset" ? given === token : process.env.NODE_ENV === "development";
}

export async function GET(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Not found" }, { status: 404 });
  const db = getPlatform().db;
  return Response.json({ targets: await precomputeTargets({ db, ws: "base", actor: SYSTEM_ACTOR }) });
}

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await parseBody(request, Body, 32 * 1024);
  if (body instanceof Response) return body;
  const db = getPlatform().db;
  const data = { db, ws: "base", actor: SYSTEM_ACTOR };
  const rows = [];
  for (const it of body.items) {
    const s = await generateSummary(data, it.entity, it.id, { writeTo: "base" }).catch((e) => ({ error: String(e) }));
    if (s) rows.push(s);
  }
  if (body.briefings) {
    for (const p of PERSONAS.filter((x) => !x.portal && !inLakeside(x))) rows.push(await generateBriefing({ db, ws: "base", actor: await actorFor(db, null, p) }, p.id, { writeTo: "base" }));
  }
  return Response.json({ rows });
}
