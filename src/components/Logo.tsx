// Propniti mark: a home beside an office tower (residential + commercial),
// one lit window for the agent keeping watch. Same artwork as public/favicon.svg.
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <rect width="64" height="64" rx="15" fill="#1C1917" />
      <g fill="none" stroke="#F6F2EA" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 49H52" />
        <path d="M15 49V34L25 25.5L35 34V49" />
        <path d="M35 49V14H49V49" />
        <path d="M22 49V41H28V49" />
      </g>
      <rect x="39.5" y="20" width="5" height="5" rx="1.2" fill="#F6F2EA" />
      <rect x="39.5" y="29" width="5" height="5" rx="1.2" fill="#D6B88F" />
      <rect x="39.5" y="38" width="5" height="5" rx="1.2" fill="#F6F2EA" />
    </svg>
  );
}

export function Wordmark({ size = 28, text = "text-2xl" }: { size?: number; text?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className={`font-serif leading-none tracking-tight ${text}`}>Propniti</span>
    </span>
  );
}
