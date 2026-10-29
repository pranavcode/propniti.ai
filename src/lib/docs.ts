import { Marked, type Tokens } from "marked";
import architecture from "../../content/docs/architecture.md?raw";
import spec from "../../content/docs/spec.md?raw";
import walkthrough from "../../content/docs/walkthrough.md?raw";

// Public snapshots of the three Claude Docs. Content lives in content/docs/*.md, images in
// public/docs/<slug>/; both are produced by scripts/docs-import.mjs (see README, "Docs").
export const DOCS = [
  {
    slug: "spec",
    title: "Product Specification",
    description: "What Propniti V1 does and for whom: personas, use cases, requirements, the agent's confidence policy and the release plan.",
    artifactIds: ["DXDBSKYjgKugTihapBFiwi", "65657bb1-596a-48d3-8a7d-2adb8ddbcb99"],
    markdown: spec,
  },
  {
    slug: "architecture",
    title: "Solution Architecture & Design",
    description: "How Propniti is built: portable domain services, an agent that acts only through their APIs, and the prototype on one Cloudflare Worker.",
    artifactIds: ["NhiYprgrxfwewnvc8NPjCX", "afbf4499-1e14-4619-99cb-37329da487e4"],
    markdown: architecture,
  },
  {
    slug: "walkthrough",
    title: "Prototype Walkthrough",
    description: "A step-by-step tour of the live prototype, one section per role, with screenshots from propniti.ai.",
    artifactIds: ["ENmSvNwUzX8WzaeaTCti8p", "6c50d029-0dd8-499c-992f-96ca296d3e31"],
    markdown: walkthrough,
  },
] as const;

export type DocSlug = (typeof DOCS)[number]["slug"];

// Date the snapshots were taken from Claude Docs.
export const SNAPSHOT_DATE = "2026-10-29";

export function getDoc(slug: string) {
  return DOCS.find((d) => d.slug === slug);
}

// GitHub-style heading slug: lower case, punctuation dropped, spaces and hyphen runs become one hyphen.
// scripts/docs-import.mjs uses the same rules to turn block-id links into heading links.
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

// Links to one of the three Claude Docs point at its page here; everything else is left alone.
export function rewriteDocHref(href: string): string {
  // The id may follow an optional "<title>-" prefix: claude.ai/[code/]artifact/[<title>-]<id>.
  const m = href.match(/^https:\/\/(?:preview\.)?claude\.ai\/(?:code\/)?artifact\/([^/?#]+)/);
  if (!m) return href;
  const doc = DOCS.find((d) => d.artifactIds.some((id) => m[1] === id || m[1].endsWith(`-${id}`)));
  return doc ? `/docs/${doc.slug}` : href;
}

// Image URLs carry their pixel size as a fragment ("/docs/x.png#2880x1800") so pages can reserve space.
export function parseImageSize(href: string): { src: string; width?: number; height?: number } {
  const m = href.match(/^(.*)#(\d+)x(\d+)$/);
  return m ? { src: m[1], width: Number(m[2]), height: Number(m[3]) } : { src: href };
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const htmlToText = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e] ?? "");

export type TocEntry = { depth: number; id: string; text: string };

export function renderDoc(markdown: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const seen = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const text = htmlToText(inner);
        const base = slugify(text);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        if (depth === 2 || depth === 3) toc.push({ depth, id, text });
        // Section numbers ("4.", "UC2.") take the sans-serif numerals used across the site.
        const label = inner.replace(/^((?:UC)?\d+\.)\s/, '<span class="doc-num">$1</span> ');
        return `<h${depth} id="${id}">${label}<a class="doc-anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const target = rewriteDocHref(href);
        const external = /^https?:\/\//.test(target);
        const t = title ? ` title="${escapeAttr(title)}"` : "";
        const rel = external ? ' rel="noopener noreferrer"' : "";
        return `<a href="${escapeAttr(target)}"${t}${rel}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, text }: Tokens.Image) {
        const { src, width, height } = parseImageSize(href);
        const size = width && height ? ` width="${width}" height="${height}"` : "";
        const img = `<img src="${escapeAttr(src)}" alt="${escapeAttr(text)}"${size} loading="lazy" decoding="async">`;
        // Diagrams scroll sideways in their own box on small screens instead of shrinking past legibility.
        const cls = src.endsWith(".svg") ? "doc-zoom doc-diagram" : "doc-zoom";
        return `<a class="${cls}" href="${escapeAttr(src)}">${img}</a>`;
      },
    },
  });
  const html = (marked.parse(markdown, { async: false }) as string)
    .replace(/<table>/g, '<div class="doc-table"><table>')
    .replace(/<\/table>/g, "</table></div>");
  return { html, toc };
}

const cache = new Map<string, ReturnType<typeof renderDoc>>();

export function renderedDoc(slug: DocSlug) {
  let r = cache.get(slug);
  if (!r) {
    r = renderDoc(getDoc(slug)!.markdown);
    cache.set(slug, r);
  }
  return r;
}
