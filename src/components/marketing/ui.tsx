/* eslint-disable @next/next/no-img-element -- image optimisation is off on Workers; files are pre-sized webp */
import Link from "@/components/Link";
import { ArrowRight } from "lucide-react";

// Marketing tokens. Teal matches the app's --primary (oklch 0.47 0.085 195); neutrals lean toward
// the same hue so marketing and app read as one brand.
export const MK_VARS = {
  "--mk-bg": "oklch(0.985 0.003 200)",
  "--mk-bg-2": "oklch(0.958 0.008 200)",
  "--mk-line": "oklch(0.9 0.008 200)",
  "--mk-text": "oklch(0.2 0.018 220)",
  "--mk-muted": "oklch(0.44 0.016 220)",
  "--mk-teal": "oklch(0.47 0.085 195)",
  "--mk-teal-deep": "oklch(0.36 0.07 198)",
  "--mk-teal-tint": "oklch(0.94 0.03 192)",
  "--mk-ink": "oklch(0.2 0.03 208)",
  "--mk-ink-2": "oklch(0.25 0.035 206)",
  "--mk-on-ink": "oklch(0.96 0.01 200)",
  "--mk-on-ink-muted": "oklch(0.78 0.025 200)",
  "--mk-mint": "oklch(0.84 0.09 185)",
  "--mk-signal": "oklch(0.78 0.14 72)",
} as React.CSSProperties;

type Tone = "primary" | "secondary" | "light" | "outline-light";
const TONES: Record<Tone, string> = {
  primary: "bg-(--mk-teal) text-white hover:bg-(--mk-teal-deep)",
  secondary: "bg-white text-(--mk-text) ring-1 ring-(--mk-line) hover:bg-(--mk-bg-2)",
  light: "bg-white text-(--mk-ink) hover:bg-(--mk-teal-tint)",
  "outline-light": "text-(--mk-on-ink) ring-1 ring-white/30 hover:bg-white/10",
};

export function ButtonLink({ href, children, tone = "primary", arrow = false, className = "" }: { href: string; children: React.ReactNode; tone?: Tone; arrow?: boolean; className?: string }) {
  return (
    <Link
      href={href}
      className={`group inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-medium transition-[background-color,transform] duration-200 ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mk-mint) ${TONES[tone]} ${className}`}
    >
      {children}
      {arrow && <ArrowRight aria-hidden className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />}
    </Link>
  );
}

export function SectionHead({ title, lede, dark = false, center = false, id }: { title: React.ReactNode; lede?: React.ReactNode; dark?: boolean; center?: boolean; id?: string }) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <h2 id={id} className={`text-balance text-[clamp(2rem,4.2vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.03em] ${dark ? "text-(--mk-on-ink)" : ""}`}>{title}</h2>
      {lede && <p className={`mt-5 text-pretty text-[17px] leading-relaxed ${dark ? "text-(--mk-on-ink-muted)" : "text-(--mk-muted)"} ${center ? "mx-auto max-w-2xl" : "max-w-2xl"}`}>{lede}</p>}
    </div>
  );
}

// A real app screenshot, framed like a browser window without the fake traffic lights.
export function Shot({ src, alt, className = "", priority = false, width = 2880, height = 1800 }: { src: string; alt: string; className?: string; priority?: boolean; width?: number; height?: number }) {
  return (
    <div className={`overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgb(0_0_0/0.12),0_8px_8px_-4px_rgb(0_0_0/0.12)] ring-1 ring-black/10 ${className}`}>
      <img src={src} alt={alt} width={width} height={height} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" className="block h-auto w-full" />
    </div>
  );
}

export function Photo({ src, alt, className = "", sizes = "100vw", priority = false }: { src: string; alt: string; className?: string; sizes?: string; priority?: boolean }) {
  const small = src.replace(/\.webp$/, "-400.webp");
  return (
    <img
      src={src}
      srcSet={`${small} 400w, ${src} 1344w`}
      sizes={sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={`block h-full w-full object-cover ${className}`}
    />
  );
}

export function SampleTag({ dark = false, children = "Sample data" }: { dark?: boolean; children?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${dark ? "bg-white/10 text-(--mk-on-ink-muted)" : "bg-(--mk-bg-2) text-(--mk-muted)"}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-(--mk-signal)" />
      {children}
    </span>
  );
}
