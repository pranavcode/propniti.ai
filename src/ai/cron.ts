// Five-field cron ("m h dom mon dow", UTC) for agent schedules: *, lists, ranges and */n steps.

function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    const [lo, hi] = range === "*" ? [min, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), stepStr ? max : Number(range)];
    if (![lo, hi, step].every(Number.isFinite) || step < 1) throw new Error(`Bad cron field "${spec}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron needs 5 fields: "${expr}"`);
  const [m, h, dom, mon, dow] = parts;
  return { m: field(m, 0, 59), h: field(h, 0, 23), dom: field(dom, 1, 31), mon: field(mon, 1, 12), dow: field(dow, 0, 6), anyDom: dom === "*", anyDow: dow === "*" };
}

export function matches(expr: string, at: Date) {
  const c = parseCron(expr);
  if (!c.m.has(at.getUTCMinutes()) || !c.h.has(at.getUTCHours()) || !c.mon.has(at.getUTCMonth() + 1)) return false;
  const d = c.dom.has(at.getUTCDate());
  const w = c.dow.has(at.getUTCDay());
  // Standard cron: when both day fields are restricted, either may match.
  return c.anyDom && c.anyDow ? true : c.anyDom ? w : c.anyDow ? d : d || w;
}

// True when the schedule fired at some minute in (afterMs, nowMs]. Looks back at most a day.
export function dueBetween(expr: string, afterMs: number, nowMs: number) {
  const start = Math.max(afterMs, nowMs - 86_400_000);
  for (let t = Math.floor(nowMs / 60_000) * 60_000; t > start; t -= 60_000) if (matches(expr, new Date(t))) return true;
  return false;
}

// Next fire time after nowMs (searches a week ahead), for "next run" on the agent cards.
export function nextRun(expr: string, nowMs: number): number | null {
  try {
    for (let t = Math.floor(nowMs / 60_000) * 60_000 + 60_000, end = nowMs + 7 * 86_400_000; t <= end; t += 60_000) if (matches(expr, new Date(t))) return t;
  } catch {
    return null;
  }
  return null;
}
