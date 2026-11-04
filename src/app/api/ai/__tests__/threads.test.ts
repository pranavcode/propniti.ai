import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersona } from "@/auth/personas";
import { ask } from "@/ai/assistant";
import { setModelForTests } from "@/ai/providers";
import { MARCUS, openFixture, WS } from "@/ai/__tests__/fixture";
import type { Db } from "@/lib/platform/types";

// GET /api/ai/assistant/threads and /threads/<id>: the ⌘J panel's recent list and restore.

const platform: { db?: Db } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));
const list = await import("../assistant/threads/route");
const one = await import("../assistant/threads/[id]/route");

afterEach(() => setModelForTests(undefined));

const get = (url: string, persona: string, ws: string | null = WS) =>
  new Request(`http://x${url}`, { headers: { cookie: [`pn_as=${persona}`, ws && `pn_ws=${ws}`].filter(Boolean).join("; "), host: "x" } });
const open = (id: string, persona: string, ws: string | null = WS) => one.GET(get(`/api/ai/assistant/threads/${id}`, persona, ws), { params: Promise.resolve({ id }) });

async function setup() {
  setModelForTests(null);
  const f = openFixture();
  platform.db = f.db;
  const r = await ask({ data: { db: f.db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "Who is late on rent?" });
  return { ...f, threadId: r.threadId };
}

describe("assistant thread routes", () => {
  it("list the persona's own recent threads", async () => {
    const { threadId } = await setup();
    const mine = await (await list.GET(get("/api/ai/assistant/threads?limit=10", "marcus"))).json();
    expect(mine.threads.map((t: { id: string }) => t.id)).toEqual([threadId]);
    expect(Object.keys(mine.threads[0]).sort()).toEqual(["id", "sample", "title", "updated_at"]);
    expect(mine.threads[0].sample).toBe(false);
    expect((await (await list.GET(get("/api/ai/assistant/threads", "lena"))).json()).threads).toEqual([]);
    expect((await (await list.GET(get("/api/ai/assistant/threads", "resident"))).json()).threads).toEqual([]);
    expect((await (await list.GET(get("/api/ai/assistant/threads", "marcus", null))).json()).threads).toEqual([]);
  });

  it("open a thread only for its owner, in its workspace", async () => {
    const { threadId } = await setup();
    const res = await open(threadId, "marcus");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.turns.map((t: { role: string }) => t.role)).toEqual(["user", "assistant"]);
    expect(body.turns[1].reply.answer).toMatch(/late/);
    expect((await open(threadId, "lena")).status).toBe(404);
    expect((await open(threadId, "resident")).status).toBe(404);
    expect((await open(threadId, "marcus", null)).status).toBe(404);
  });

  it("answer 404 for a thread cleared by the nightly reset", async () => {
    await setup();
    const res = await open("thr-gone", "marcus");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it("cap the message window", async () => {
    const { raw, threadId } = await setup();
    const add = raw.prepare("INSERT INTO assistant_messages (workspace_id, id, thread_id, role, content, at) VALUES (?, ?, ?, 'user', ?, '2026-11-04T10:00:00Z')");
    for (let i = 0; i < 120; i++) add.run(WS, `m-${i}`, threadId, `q ${i}`);
    const r = await (await one.GET(get(`/api/ai/assistant/threads/${threadId}?limit=500`, "marcus"), { params: Promise.resolve({ id: threadId }) })).json();
    expect(r.turns.length).toBe(100);
    expect(r.more).toBe(true);
    const d = await (await open(threadId, "marcus")).json();
    expect(d.turns.length).toBe(30);
  });
});
