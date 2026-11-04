import Link from "@/components/Link";
import { Wordmark } from "@/components/Logo";
import { PILLARS } from "./content";

const cols: [string, [string, string][]][] = [
  ["Product", [...PILLARS.map((p) => [p.name, `/product/${p.slug}`] as [string, string]), ["Agents", "/product/agents"]]],
  ["Company", [["Pricing", "/pricing"], ["Security", "/security"], ["Book a demo", "/book-demo"], ["Docs", "/docs"]]],
  ["Demo", [["Try the live demo", "/login"], ["Public listings", "/listings"]]],
];

export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`bg-[oklch(0.2_0.03_208)] px-4 pb-10 pt-16 text-[oklch(0.78_0.025_200)] sm:px-6 ${className}`}>
      <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <div className="text-white"><Wordmark size={32} text="text-3xl" /></div>
          <p className="mt-4 max-w-xs text-[14px] leading-relaxed">Property management software that checks, explains and corrects the data behind your money decisions.</p>
        </div>
        {cols.map(([title, items]) => (
          <div key={title}>
            <h2 className="text-[13px] font-medium text-white">{title}</h2>
            <ul className="mt-4 flex flex-col gap-2.5 text-[14px]">
              {items.map(([l, h]) => (
                <li key={h}><Link href={h} className="hover:text-white">{l}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-14 flex max-w-7xl flex-wrap justify-between gap-4 border-t border-white/10 pt-6 text-[13px]">
        <span>© 2026 Propniti</span>
        <span>The demo runs on fictional properties, people and companies.</span>
      </div>
    </footer>
  );
}
