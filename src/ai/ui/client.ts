"use client";

import { useEffect, useRef, useState } from "react";
import type { TraceStep } from "@/components/app/ai";
import type { RunStatus } from "@/ai/types";

// Browser helpers for the AI pages: JSON calls that throw the server's error message, and the live
// run trace (server-sent events, falling back to polling when the stream can't open).

export async function api<T = Record<string, unknown>>(url: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export type StepJson = { id: string; idx: number; kind: TraceStep["kind"]; tool_key: string | null; input: unknown; output: unknown; latency_ms: number | null; ok: boolean; at: string };
export const toTrace = (s: StepJson): TraceStep => ({ idx: s.idx, kind: s.kind, toolKey: (s.tool_key ?? undefined) as TraceStep["toolKey"], input: s.input ?? undefined, output: s.output ?? undefined, latencyMs: s.latency_ms ?? undefined, ok: s.ok, at: s.at });

export type RunJson = { id: string; agent_key: string; status: RunStatus; trigger_kind: string; started_at: string; ended_at: string | null; model: string | null; tokens_in: number; tokens_out: number; cost_cents: number; summary: string | null; error: string | null; started_by: string | null };
export type ProposalJson = { id: string; source?: "live" | "precomputed" | "rules"; agent: string; title: string; why: string[]; evidence: { entity_type: string; entity_id: string; label: string; href?: string }[]; risk: "Low" | "Medium" | "High"; confidence: number; amount_cents: number | null; queue_state: string; assignee_role: string | null; model: string | null; run_id: string | null; created_at: string; href?: string; payload: Record<string, unknown>; decision?: string | null; decided_by?: string | null; action: string; entity_type: string; entity_id: string };

export function useRunStream(runId: string | null, initial?: { run: RunJson; steps: StepJson[]; proposals: ProposalJson[] }) {
  const [run, setRun] = useState<RunJson | null>(initial?.run ?? null);
  const [steps, setSteps] = useState<StepJson[]>(initial?.steps ?? []);
  const [proposals, setProposals] = useState<ProposalJson[]>(initial?.proposals ?? []);
  const [mode, setMode] = useState<"stream" | "poll" | "idle">("idle");
  const last = useRef(-1);

  useEffect(() => {
    if (!runId || (initial && initial.run.status !== "running")) return;
    let stopped = false;
    last.current = initial?.steps.at(-1)?.idx ?? -1;
    const add = (s: StepJson[]) => {
      const fresh = s.filter((x) => x.idx > last.current);
      if (!fresh.length) return;
      last.current = Math.max(last.current, ...fresh.map((x) => x.idx));
      setSteps((prev) => [...prev, ...fresh]);
    };
    const poll = async () => {
      await Promise.resolve();
      setMode("poll");
      while (!stopped) {
        try {
          const r = await api<{ run: RunJson; steps: StepJson[]; proposals: ProposalJson[] }>(`/api/ai/runs/${runId}?after=${last.current}`);
          add(r.steps);
          setRun(r.run);
          setProposals(r.proposals);
          if (r.run.status !== "running") break;
        } catch {
          // keep trying until the page closes
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
      setMode("idle");
    };
    if (typeof EventSource === "undefined") {
      void poll();
      return () => void (stopped = true);
    }
    const es = new EventSource(`/api/ai/runs/${runId}/stream`);
    es.onopen = () => setMode("stream");
    es.addEventListener("step", (e) => { add([JSON.parse((e as MessageEvent).data)]); });
    es.addEventListener("run", (e) => { const d = JSON.parse((e as MessageEvent).data); setRun(d.run); setProposals(d.proposals); });
    es.addEventListener("end", () => { es.close(); setMode("idle"); });
    es.onerror = () => {
      es.close();
      // The stream dropped (proxy, timeout or the run outlived it): carry on by polling.
      if (!stopped) void poll();
    };
    return () => { stopped = true; es.close(); };
  }, [runId, initial]);

  return { run, steps, proposals, mode, live: run?.status === "running" };
}

export const AGENT_LABEL: Record<string, string> = {
  collections: "Collections agent", leasing: "Leasing agent", renewals: "Renewals agent", maintenance_triage: "Maintenance triage agent", ap: "Payables agent",
  data_health: "Data Health agent", owner_reporting: "Owner Reporting agent", compliance: "Compliance agent", copilot: "Assistant",
};

// The AI badge source for a proposal (pass the proposal) or a stored model name.
export { proposalSource as sourceOf } from "@/ai/rules";
