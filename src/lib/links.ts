// Links from stored data (document URLs), checked on write and again on render: same-site paths
// or https only. A path may not start with "//" or "/\" (browsers read both as another host), and
// control characters are refused (browsers drop tabs and newlines, so "/\t/x" would become "//x").
export const SAFE_LINK = /^(?:\/(?![/\\])|https:\/\/)\P{Cc}*$/iu;
export const safeHref = (u: unknown) => (typeof u === "string" && SAFE_LINK.test(u) ? u : undefined);
