// Model ids as people read them: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" → "Llama 3.3 70B".
// Names that already read well (they contain a space) and unknown ids pass through, minus any
// "@cf/<vendor>/" prefix.
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function modelName(id: string): string {
  if (/\s/.test(id)) return id;
  const m = id.replace(/^@cf\/[^/]+\//, "");
  let r = /^llama-(\d+(?:\.\d+)?)-(\d+)b\b/i.exec(m);
  if (r) return `Llama ${r[1]} ${r[2]}B`;
  r = /^llama-(\d+(?:\.\d+)?)-([a-z]+)/i.exec(m);
  if (r) return `Llama ${r[1]} ${cap(r[2])}`;
  r = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(m);
  if (r) return `Claude ${cap(r[1])} ${r[2]}${r[3] ? `.${r[3]}` : ""}`;
  return m;
}
