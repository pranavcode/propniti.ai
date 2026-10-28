import { connection } from "next/server";
import { configuredProvider } from "@/lib/llm";

export async function GET() {
  await connection(); // read env at request time, not at build
  const p = configuredProvider();
  return Response.json({ source: p?.source ?? "mock", label: p?.label ?? "Mock data" });
}
