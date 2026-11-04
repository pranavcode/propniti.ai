import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Term } from "@/components/app/Term";
import { HELP_ARTICLES } from "@/seed/help";
import { MORE_HELP_ARTICLES } from "@/seed/help-more";
import { GLOSSARY, helpFor, lookupTerm } from "./glossary";

describe("glossary lookup", () => {
  it("matches terms and aliases ignoring case and spacing", () => {
    expect(lookupTerm("Economic occupancy")?.term).toBe("Economic occupancy");
    expect(lookupTerm("  economic   OCCUPANCY ")?.term).toBe("Economic occupancy");
    expect(lookupTerm("Vacancy loss MTD")?.term).toBe("Vacancy loss");
    expect(lookupTerm("Returned (NSF)")?.term).toBe("NSF");
  });

  it("leaves plain words alone", () => {
    for (const word of ["Units", "Status", "Date", "Property", "Policy", "Amount", "", undefined]) expect(lookupTerm(word)).toBeUndefined();
  });

  it("lets a field's own help win and keeps the glossary article", () => {
    expect(helpFor("NOI", "Our own words")).toEqual({ summary: "Our own words", article: "noi" });
    expect(helpFor("Plain label", { summary: "Field help", article: "x" })).toEqual({ summary: "Field help", article: "x" });
    expect(helpFor("Plain label")).toBeUndefined();
  });

  it("has unique keys and links only to articles that exist", () => {
    const keys = GLOSSARY.flatMap((e) => [e.term, ...(e.aliases ?? [])].map((k) => k.toLowerCase()));
    expect(new Set(keys).size).toBe(keys.length);
    const slugs = new Set([...HELP_ARTICLES, ...MORE_HELP_ARTICLES].map((a) => a.id));
    for (const e of GLOSSARY) if (e.article) expect(slugs, e.term).toContain(e.article);
    for (const e of GLOSSARY) expect(e.summary.length, e.term).toBeLessThan(260);
  });
});

describe("<Term>", () => {
  const html = (props: Parameters<typeof Term>[0]) => renderToStaticMarkup(createElement(Term, props));

  it("renders a focusable trigger always described by the definition", () => {
    const out = html({ children: "Economic occupancy" });
    expect(out).toMatch(/<button[^>]*type="button"/);
    expect(out).toContain('data-term="Economic occupancy"');
    expect(out).toContain("decoration-dotted");
    expect(out).not.toContain('role="tooltip"');
    const id = out.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(out).toMatch(new RegExp(`id="${id}"[^>]*>${lookupTerm("Economic occupancy")!.summary.slice(0, 40)}`));
  });

  it("decorates a plain label when it has its own help", () => {
    expect(html({ children: "Lease rent" })).toBe("Lease rent");
    expect(html({ children: "Lease rent", help: "Rent on the signed lease" })).toContain('data-term="Lease rent"');
  });

  it("renders plain text when there is no definition", () => {
    expect(html({ children: "Units" })).toBe("Units");
  });

  it("names an icon-only trigger for screen readers", () => {
    expect(html({ term: "SLA", iconOnly: true })).toContain('aria-label="What SLA means"');
  });
});
