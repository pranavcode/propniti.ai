// A work order's description is often its title again: portal requests store "<room> <what you
// typed>" and use the first sentence as the title; seeded ones read "<title> · #<unit>. <note>".
// Cards show the title, so this returns only what the description adds, or null.
export function extraDetail(title: string, description: string | null | undefined, opts: { keepUnit?: boolean } = {}) {
  let d = (description ?? "").trim();
  const t = title.trim();
  const at = t ? d.toLowerCase().indexOf(t.toLowerCase()) : -1;
  // A leading room or area ("Outside or common area ") may come before the title.
  if (at >= 0 && at <= 32) d = d.slice(at + t.length);
  const lead = /^[\s·.,:;–—-]+/;
  d = d.replace(lead, "");
  if (!opts.keepUnit) d = d.replace(/^#[^.\s][^.]{0,19}\.\s*/, "").replace(lead, "");
  return d ? d[0].toUpperCase() + d.slice(1) : null;
}
