import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { ask, threadMessages, threads } from "../assistant";
import { setModelForTests } from "../providers";
import { MARCUS, openFixture, WS } from "./fixture";

// Saved conversations for the ⌘J panel and /app/copilot: each persona reopens only their own
// threads in their own workspace, restored turns carry what the live reply showed, and proposals
// show their current decision without running anything again.

afterEach(() => setModelForTests(undefined));

const marcus = getPersona("marcus")!;
const lena = getPersona("lena")!;
const resident = getPersona("resident")!;

async function conversation() {
  setModelForTests(null);
  const f = openFixture();
  const data = { db: f.db, ws: WS, actor: MARCUS };
  const first = await ask({ data, persona: marcus, question: "Who is late on rent?" });
  const second = await ask({ data, persona: marcus, question: "Send reminders to residents 30+ days late", threadId: first.threadId });
  return { ...f, data, first, second };
}

describe("assistant history", () => {
  it("restores a thread's turns in order, rendering like the live replies", async () => {
    const { data, first, second } = await conversation();
    expect(second.threadId).toBe(first.threadId);
    const t = (await threadMessages(data, "marcus", first.threadId))!;
    expect(t.thread).toMatchObject({ id: first.threadId, title: "Who is late on rent?" });
    expect(t.more).toBe(false);
    expect(t.turns.map((x) => x.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(t.turns[0]).toEqual({ role: "user", text: "Who is late on rent?" });
    for (const [i, live] of [[1, first], [3, second]] as const) {
      const turn = t.turns[i];
      if (turn.role !== "assistant") throw new Error("expected an answer");
      const { reply } = turn;
      expect(reply).toMatchObject({ threadId: live.threadId, messageId: live.messageId, runId: live.runId, mode: live.mode, answer: live.answer, source: live.source, model: live.model, live: live.live, note: live.note });
      expect(reply.table).toEqual(live.table);
      expect(reply.citations).toEqual(live.citations);
      expect(reply.trace).toEqual(live.trace);
      expect(reply.proposals.map((p) => p.id)).toEqual(live.proposals.map((p) => p.id));
    }
  });

  it("shows a proposal's decision made since, without running it again", async () => {
    const { data, raw, second } = await conversation();
    expect(second.proposals.length).toBe(2);
    const [a, b] = second.proposals;
    raw.prepare("INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, note, decided_at) VALUES (?, 'dec-1', ?, 'Approved', 'marcus', '', '2026-11-04T10:00:00Z')").run(WS, a.id);
    const t = (await threadMessages(data, "marcus", second.threadId))!;
    const turn = t.turns[3];
    if (turn.role !== "assistant") throw new Error("expected an answer");
    expect(turn.reply.proposals.find((p) => p.id === a.id)?.decision).toBe("Approved");
    expect(turn.reply.proposals.find((p) => p.id === b.id)?.decision ?? null).toBeNull();
    expect(raw.prepare("SELECT count(*) AS n FROM ai_decisions").get()!.n).toBe(1);
    expect(raw.prepare("SELECT count(*) AS n FROM messages").get()!.n).toBe(0);
  });

  it("lists and opens only the persona's own threads", async () => {
    const { data, first } = await conversation();
    expect((await threads(data, "marcus")).map((t) => t.id)).toEqual([first.threadId]);
    expect(await threads(data, "lena")).toEqual([]);
    expect(await threadMessages(data, "lena", first.threadId)).toBeNull();
    // Portal personas follow the same rule.
    expect(await threads(data, resident.id)).toEqual([]);
    expect(await threadMessages(data, resident.id, first.threadId)).toBeNull();
    // Asking with someone else's thread id starts a new thread instead of joining theirs.
    const r = await ask({ data, persona: lena, question: "How do I post a late fee?", threadId: first.threadId });
    expect(r.threadId).not.toBe(first.threadId);
    expect((await threadMessages(data, "marcus", first.threadId))!.turns).toHaveLength(4);
  });

  it("keeps workspaces apart", async () => {
    const { data, first } = await conversation();
    const other = { ...data, ws: "another-visitor-workspace-0001" };
    expect(await threads(other, "marcus")).toEqual([]);
    expect(await threadMessages(other, "marcus", first.threadId)).toBeNull();
  });

  it("returns null for a thread that no longer exists", async () => {
    const { data } = await conversation();
    expect(await threadMessages(data, "marcus", "thr-gone")).toBeNull();
  });

  it("loads only the last messages of a long thread", async () => {
    const { data, raw, first } = await conversation();
    const add = raw.prepare("INSERT INTO assistant_messages (workspace_id, id, thread_id, role, content, at) VALUES (?, ?, ?, ?, ?, '2026-11-04T10:00:00Z')");
    for (let i = 0; i < 40; i++) add.run(WS, `m-${i}`, first.threadId, i % 2 ? "assistant" : "user", `message ${i}`);
    const t = (await threadMessages(data, "marcus", first.threadId, 30))!;
    expect(t.more).toBe(true);
    expect(t.turns).toHaveLength(30);
    const last = t.turns.at(-1)!;
    expect(last.role === "assistant" && last.reply.answer).toBe("message 39");
    expect(t.turns[0]).toEqual({ role: "user", text: "message 10" });
  });

  it("caps the thread list", async () => {
    const { data, raw } = await conversation();
    const add = raw.prepare("INSERT INTO assistant_threads (workspace_id, id, user_id, title, created_at, updated_at) VALUES (?, ?, 'marcus', ?, '2026-11-04T09:00:00Z', ?)");
    for (let i = 0; i < 15; i++) add.run(WS, `thr-${i}`, `Thread ${i}`, `2026-11-04T09:${String(10 + i).padStart(2, "0")}:00Z`);
    const list = await threads(data, "marcus", 10);
    expect(list).toHaveLength(10);
  });
});
