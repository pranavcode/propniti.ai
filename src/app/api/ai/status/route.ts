import { connection } from "next/server";
import { configuredProvider } from "@/lib/llm";
import { modelInfo } from "@/ai/providers";
import { lastSweep } from "@/ai/orchestrator";
import { getPlatform } from "@/lib/platform";

// Which model answers (or "rules"), and when the agents last swept. Read at request time.
export async function GET() {
  await connection();
  const p = configuredProvider();
  const m = modelInfo();
  const last = await lastSweep(getPlatform().db).catch(() => null);
  return Response.json({ source: p?.source ?? "mock", label: p?.label ?? "Mock data", provider: m.provider, model: m.model, modelLabel: m.label, lastSweepAt: last ? new Date(last).toISOString() : null });
}
