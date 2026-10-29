import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS, parseImageSize, renderDoc, rewriteDocHref, slugify } from "./docs";

describe("slugify", () => {
  it("drops punctuation and joins words with single hyphens", () => {
    expect(slugify("4. Property manager (Maya Patel)")).toBe("4-property-manager-maya-patel");
    expect(slugify("Solution Architecture & Design")).toBe("solution-architecture-design");
    expect(slugify("6. Tenant (Jasmine Brooks, Riverside Lofts #204)")).toBe("6-tenant-jasmine-brooks-riverside-lofts-204");
    expect(slugify("Café — résumé")).toBe("cafe-resume");
  });
});

describe("rewriteDocHref", () => {
  it("sends Claude Docs links for the three docs to their pages", () => {
    expect(rewriteDocHref("https://claude.ai/artifact/NhiYprgrxfwewnvc8NPjCX")).toBe("/docs/architecture");
    expect(rewriteDocHref("https://claude.ai/code/artifact/Product-Spec-DXDBSKYjgKugTihapBFiwi")).toBe("/docs/spec");
    expect(rewriteDocHref("https://claude.ai/artifact/6c50d029-0dd8-499c-992f-96ca296d3e31#x")).toBe("/docs/walkthrough");
  });

  it("leaves other links alone", () => {
    expect(rewriteDocHref("https://propniti.ai/demo")).toBe("https://propniti.ai/demo");
    expect(rewriteDocHref("https://claude.ai/artifact/SomeOtherDoc123")).toBe("https://claude.ai/artifact/SomeOtherDoc123");
    expect(rewriteDocHref("#uc1-read-invoices")).toBe("#uc1-read-invoices");
  });
});

describe("parseImageSize", () => {
  it("reads the size fragment", () => {
    expect(parseImageSize("/docs/a.png#2880x1800")).toEqual({ src: "/docs/a.png", width: 2880, height: 1800 });
    expect(parseImageSize("/docs/a.png")).toEqual({ src: "/docs/a.png" });
  });
});

describe("renderDoc", () => {
  it("gives headings unique ids, a table of contents and scrollable tables", () => {
    const { html, toc } = renderDoc("## Setup\n\n### Setup\n\n## 2. Next\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done");
    expect(toc.map((t) => t.id)).toEqual(["setup", "setup-1", "2-next"]);
    expect(html).toContain('<h2 id="2-next"><span class="doc-num">2.</span> Next');
    expect(html).toContain('<div class="doc-table"><table>');
    expect(html).toContain('type="checkbox"');
  });

  it("sizes images and rewrites doc links", () => {
    const { html } = renderDoc("![A chart](/docs/x/flow.svg#760x316) [arch](https://claude.ai/artifact/NhiYprgrxfwewnvc8NPjCX)");
    expect(html).toContain('<img src="/docs/x/flow.svg" alt="A chart" width="760" height="316"');
    expect(html).toContain('class="doc-zoom doc-diagram"');
    expect(html).toContain('<a href="/docs/architecture">arch</a>');
  });
});

// Checks on the committed snapshots: links and images must resolve.
describe.each(DOCS.map((d) => [d.slug, d] as const))("content/docs/%s.md", (_, doc) => {
  const { html } = renderDoc(doc.markdown);
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));

  it("has in-page links that all land on a heading", () => {
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) expect(ids, `#${id}`).toContain(id);
  });

  it("links only to existing doc pages", () => {
    for (const [, slug] of html.matchAll(/href="\/docs\/([a-z-]+)"/g)) expect(DOCS.map((d) => d.slug)).toContain(slug);
  });

  it("has every image in public/ with a size", () => {
    for (const [tag, src] of html.matchAll(/<img src="([^"]+)"[^>]*>/g)) {
      expect(existsSync(join(process.cwd(), "public", src)), src).toBe(true);
      expect(tag).toMatch(/width="\d+" height="\d+"/);
    }
  });
});
