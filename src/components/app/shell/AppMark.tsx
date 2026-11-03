// The Propniti mark in app colours (deep teal tile), same geometry as the marketing LogoMark.
export function AppMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--primary)" />
      <g fill="none" stroke="var(--primary-foreground)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 49H52" />
        <path d="M15 49V34L25 25.5L35 34V49" />
        <path d="M35 49V14H49V49" />
      </g>
      <rect x="39.5" y="20" width="5" height="5" rx="1.2" fill="var(--primary-foreground)" />
      <rect x="39.5" y="29" width="5" height="5" rx="1.2" fill="oklch(0.85 0.1 85)" />
      <rect x="39.5" y="38" width="5" height="5" rx="1.2" fill="var(--primary-foreground)" />
    </svg>
  );
}
