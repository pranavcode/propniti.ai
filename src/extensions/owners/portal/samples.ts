import "server-only";
import type { AskReply, Lookup } from "./ask";
import { rows, type PortalCtx } from "./context";

// The seeded sample conversations for this portal persona (src/seed/samples), answered by the
// portal's own answerer over the demo data. Shown in Ask AI before the visitor asks anything.
export type SampleThread = { id: string; title: string; turns: { q: string; a: AskReply }[] };

export async function portalSamples(c: PortalCtx): Promise<SampleThread[]> {
  const threads = await rows<{ id: string; title: string }>(c, "SELECT id, title FROM {assistant_threads} WHERE user_id = ? AND id LIKE 'smp-%' ORDER BY updated_at DESC", c.persona.id);
  if (!threads.length) return [];
  const msgs = await rows<{ thread_id: string; role: string; content: string; plan: string | null; citations: string; model: string | null }>(
    c, "SELECT thread_id, role, content, plan, citations, model FROM {assistant_messages} WHERE thread_id IN (SELECT value FROM json_each(?)) ORDER BY seq", JSON.stringify(threads.map((t) => t.id)),
  );
  return threads.map((t) => {
    const ms = msgs.filter((m) => m.thread_id === t.id);
    const turns: SampleThread["turns"] = [];
    for (let i = 0; i + 1 < ms.length; i += 2) {
      const plan = JSON.parse(ms[i + 1].plan ?? "{}") as { trace?: Lookup[] };
      turns.push({ q: ms[i].content, a: { answer: ms[i + 1].content, facts: {}, trace: plan.trace ?? [], links: JSON.parse(ms[i + 1].citations || "[]"), source: "rules" } });
    }
    return { id: t.id, title: t.title, turns };
  });
}
