// Deterministic graders for the live AI eval. Each takes the case and the route's JSON response
// and returns { checks: [{ name, ok, detail? }] }. A case passes when every check passes;
// its accuracy is the share of checks that pass. No model is used to grade.

const lc = (s) => String(s ?? "").toLowerCase();
const squash = (s) => lc(s).replace(/[\s#:]+/g, "");
const contains = (got, want) => squash(got).includes(squash(want));
const cents = (n) => Math.round(Number(n) * 100);
const money = (s) => Number(String(s ?? "").replace(/[^0-9.-]/g, ""));

// A response that says the real model wasn't used is a "fallback", not a pass or a fail.
export function isFallback(res) {
  return res?.source === "mock" || /not configured/i.test(res?.note ?? "");
}

// /api/ai/extract: fields read from the document, and the app's consistency checks on them.
export function gradeExtract(c, res) {
  const e = c.expect;
  const inv = res.invoice ?? {};
  const appChecks = res.checks ?? [];
  const appCheck = (part) => appChecks.find((x) => x.label.includes(part));
  const fieldChecks = (want) => [
    ...(want.vendor ? [{ name: "vendor", ok: contains(inv.vendor, want.vendor), detail: inv.vendor }] : []),
    ...(want.invoiceNumber ? [{ name: "invoice number", ok: contains(inv.invoiceNumber, want.invoiceNumber), detail: inv.invoiceNumber }] : []),
    ...(want.total !== undefined ? [{ name: "total", ok: cents(inv.total) === cents(want.total), detail: inv.total }] : []),
  ];

  if (e.flaggedOrCorrect) {
    const flagged = appChecks.filter((x) => !x.ok).map((x) => x.label);
    const fields = fieldChecks(e.flaggedOrCorrect);
    const correct = fields.every((f) => f.ok);
    return { checks: [{ name: "flagged or read correctly", ok: flagged.length > 0 || correct, detail: flagged.length ? `flagged: ${flagged.join("; ")}` : `all green; ${fields.map((f) => `${f.name}=${f.detail}`).join(", ")}` }] };
  }

  const checks = [];
  if (e.isInvoice !== undefined) checks.push({ name: "is invoice", ok: inv.isInvoice === e.isInvoice, detail: inv.isInvoice });
  checks.push(...fieldChecks(e));
  if (e.lineItems !== undefined) checks.push({ name: "line items", ok: (inv.lineItems ?? []).length === e.lineItems, detail: (inv.lineItems ?? []).length });
  for (const p of e.checksOk ?? []) checks.push({ name: `check ok: ${p}`, ok: appCheck(p)?.ok === true });
  for (const p of e.checksFlagged ?? []) checks.push({ name: `check flagged: ${p}`, ok: appCheck(p)?.ok === false });
  return { checks };
}

// /api/ai/validate: the final decision (after the rule override) and that issues are listed.
export function gradeValidate(c, res) {
  const checks = [{ name: "decision", ok: c.expect.decision.includes(res.decision), detail: res.decision }];
  if (c.expect.issues) checks.push({ name: "issues listed", ok: (res.issues ?? []).length > 0, detail: (res.issues ?? []).length });
  return { checks };
}

// True when the model itself said approve and the rule check turned it into review.
export const overriddenByRules = (res) => (res?.issues ?? []).some((i) => i.startsWith("Policy check:"));

// Capitalised word runs ("John Smith") whose words appear nowhere in the portfolio data.
const NOT_NAMES = new Set(
  "the a an and or but if for to of in on at by with from as this that these those it its consider overall portfolio occupancy summary suggest suggested suggestion recommend recommendations next action actions property properties unit units tenant tenants owner owners vendor vendors lease leases rent invoice invoices work order orders meeting total i we you they our your their focus review send schedule offer reach january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday us usd hvac llc inc tx ca austin san diego texas california"
    .split(" "),
);
export function unknownNames(text, state) {
  const vocab = new Set(lc(JSON.stringify(state)).match(/[a-z]+/g));
  const out = [];
  for (const m of String(text ?? "").matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)) {
    // Drop common words ("Consider John Smith" -> "John Smith"); flag 2+ remaining words all unknown.
    const words = m[0].split(/\s+/).filter((w) => !NOT_NAMES.has(lc(w)));
    if (words.length >= 2 && words.every((w) => !vocab.has(lc(w)))) out.push(words.join(" "));
  }
  return out;
}

// /api/ai/ask: computed figures present, the "computed" note on fact answers, no invented names.
export function gradeAsk(c, res, state) {
  const e = c.expect;
  const answer = res.answer ?? "";
  const checks = [];
  for (const m of e.mentions ?? []) checks.push({ name: `mentions ${m}`, ok: lc(answer).includes(lc(m)) });
  if (e.computedNote) checks.push({ name: "note says computed", ok: /computed/i.test(res.note ?? ""), detail: res.note });
  if (e.nonEmpty) checks.push({ name: "non-empty answer", ok: answer.trim().length > 20 });
  if (e.noUnknownNames) {
    const unknown = unknownNames(answer, state);
    checks.push({ name: "no names outside the data", ok: unknown.length === 0, detail: unknown.join(", ") });
  }
  return { checks };
}

// /api/ai/import-map: each of the 10 fields mapped to the expected header (or left unmapped).
// Passes at 90%+ with the four required fields right.
export function gradeMap(c, res) {
  const mapping = res.mapping ?? {};
  const fields = Object.entries(c.expect).map(([f, want]) => {
    const got = mapping[f] ?? null;
    return { name: f, ok: got === want, detail: `${got} (want ${want})` };
  });
  const share = fields.filter((f) => f.ok).length / fields.length;
  const required = ["property", "unit", "tenant", "rent"].every((f) => fields.find((x) => x.name === f)?.ok);
  return { checks: fields, pass: share >= 0.9 && required };
}

// /api/ai/import-parse: the right number of rows, and each expected row's key fields.
export function gradeParse(c, res) {
  const rows = res.rows ?? [];
  const checks = [{ name: "row count", ok: rows.length === c.expect.length, detail: rows.length }];
  for (const want of c.expect) {
    const row = rows.find((r) => contains(r.tenant, want.tenant));
    checks.push({ name: `${want.tenant}: found`, ok: !!row });
    const unit = (s) => squash(s).replace(/^(unit|apt|suite)/, "");
    if (want.unit) checks.push({ name: `${want.tenant}: unit`, ok: !!row && unit(row.unit) === unit(want.unit), detail: row?.unit });
    if (want.rent) checks.push({ name: `${want.tenant}: rent`, ok: !!row && money(row.rent) === want.rent, detail: row?.rent });
    if (want.property) checks.push({ name: `${want.tenant}: property`, ok: !!row && contains(row.property, want.property), detail: row?.property });
    if (want.leaseEnd) checks.push({ name: `${want.tenant}: lease end`, ok: row?.leaseEnd === want.leaseEnd, detail: row?.leaseEnd });
  }
  return { checks };
}
