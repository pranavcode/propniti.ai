import Link from "next/link";
import { Wordmark } from "@/components/Logo";

export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`bg-[#1C1917] px-4 pb-10 text-[#A8A29E] ${className}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-6 border-t border-white/10 pt-10 text-sm">
        <div>
          <div className="text-[#F6F2EA]"><Wordmark size={36} text="text-4xl" /></div>
          <div className="mt-2">AI property operations for US portfolios.</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-6">
          <Link href="/login" className="hover:text-[#F6F2EA]">Sign in</Link>
          <Link href="/signup" className="hover:text-[#F6F2EA]">Get started</Link>
          <Link href="/demo" className="hover:text-[#F6F2EA]">Demo</Link>
          <Link href="/docs" className="hover:text-[#F6F2EA]">Docs</Link>
        </div>
        <div className="w-full text-xs text-[#78716C]">© 2026 Propniti</div>
      </div>
    </footer>
  );
}
