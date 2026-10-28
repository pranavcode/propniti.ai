import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import { DemoProvider } from "@/lib/store";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Propniti — AI property operations",
  description: "AI agents that chase rent, validate vendor invoices and keep every lease on track, with a human approving every payment.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#F6F2EA] font-sans text-[#1C1917]">
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
