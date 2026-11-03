// Five-field cron ("m h dom mon dow", UTC) for agent schedules: *, lists, ranges and */n steps.
// Every number is range-checked, so a saved schedule can never make a sweep build huge sets.

export type Cron = { m: Set<number>; h: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; anyDom: boolean; anyDow: boolean };

const INT = /^\d{1,2}$/;

function field(spec: string, min: number, max: number): Set<number> {
  if (spec.length > 60) throw new Error(`Cron field too long: "${spec.slice(0, 20)}…"`);
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepStr, extra] = part.split("/");
    if (extra !== undefined || (stepStr !== undefined && !INT.test(stepStr))) throw new Error(`Bad cron field "${spec}"`);
    const step = stepStr ? Number(stepStr) : 1;
    let lo: number, hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else {
      const ends = range.split("-");
      if (ends.length > 2 || !ends.every((x) => INT.test(x))) throw new Error(`Bad cron field "${spec}"`);
      lo = Number(ends[0]);
      hi = ends.length === 2 ? Number(ends[1]) : stepStr ? max : lo;
    }
    if (step < 1 || lo < min || hi > max || lo > hi) throw new Error(`Cron field "${spec}" must stay within ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron needs 5 fields: "${expr.slice(0, 60)}"`);
  const [m, h, dom, mon, dow] = parts;
  return { m: field(m, 0, 59), h: field(h, 0, 23), dom: field(dom, 1, 31), mon: field(mon, 1, 12), dow: field(dow, 0, 6), anyDom: dom === "*", anyDow: dow === "*" };
}

export function matches(c: Cron, at: Date) {
  if (!c.m.has(at.getUTCMinutes()) || !c.h.has(at.getUTCHours()) || !c.mon.has(at.getUTCMonth() + 1)) return false;
  const d = c.dom.has(at.getUTCDate());
  const w = c.dow.has(at.getUTCDay());
  // Standard cron: when both day fields are restricted, either may match.
  return c.anyDom && c.anyDow ? true : c.anyDom ? w : c.anyDow ? d : d || w;
}

// True when the schedule fired at some minute in (afterMs, nowMs]. Looks back at most a day.
export function dueBetween(expr: string, afterMs: number, nowMs: number) {
  const c = parseCron(expr);
  const start = Math.max(afterMs, nowMs - 86_400_000);
  for (let t = Math.floor(nowMs / 60_000) * 60_000; t > start; t -= 60_000) if (matches(c, new Date(t))) return true;
  return false;
}

// Next fire time after nowMs (searches a week ahead), for "next run" on the agent cards.
export function nextRun(expr: string, nowMs: number): number | null {
  let c: Cron;
  try {
    c = parseCron(expr);
  } catch {
    return null;
  }
  for (let t = Math.floor(nowMs / 60_000) * 60_000 + 60_000, end = nowMs + 7 * 86_400_000; t <= end; t += 60_000) if (matches(c, new Date(t))) return t;
  return null;
}
