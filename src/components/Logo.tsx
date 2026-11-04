// Propniti mark: a P built from two buildings (a tower stem and a block bowl) with a square window
// as the counter. Same artwork as public/favicon.svg and src/components/app/shell/AppMark.tsx.
export const MARK_PATH = "M15 11H27V53H15Z M30 11H40A10 10 0 0 1 50 21V40H30Z M35 20H45V30H35Z";

// Marketing surfaces put the mark on both light pages and the dark ink hero (the nav switches as it
// scrolls), so the colours follow the surrounding text colour: dark text gets the deep teal tile with a
// white P, light text gets the light teal tile with an ink P. The fill attributes are the light-page
// fallback for browsers without relative colour.
const TILE = "oklch(from currentColor clamp(0.47, (l - 0.6) * 10, 0.7) 0.09 194)";
const GLYPH = "oklch(from currentColor clamp(0.17, (0.6 - l) * 10, 1) 0.02 195)";

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#00696A" style={{ fill: TILE }} />
      <path d={MARK_PATH} fill="#FFFFFF" fillRule="evenodd" style={{ fill: GLYPH }} />
    </svg>
  );
}

export function Wordmark({ size = 28, text = "text-2xl" }: { size?: number; text?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className={`font-sans font-semibold leading-none tracking-[-0.035em] ${text}`}>Propniti</span>
    </span>
  );
}
