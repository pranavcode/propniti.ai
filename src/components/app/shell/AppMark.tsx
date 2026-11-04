import { MARK_PATH } from "@/components/Logo";

// The Propniti mark in app tokens, so it follows light and dark mode.
export function AppMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--primary)" />
      <path d={MARK_PATH} fill="var(--primary-foreground)" fillRule="evenodd" />
    </svg>
  );
}
