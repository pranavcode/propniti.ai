import type { Metadata } from "next";
import { Kit } from "@/components/app/Kit";

// Hidden component proof page (/app/_kit; the folder is %5Fkit because "_" folders are private).
// Keep only page.tsx in this folder: vinext dev 404s client modules under a %-encoded path.
// Proves shadcn/Radix, cmdk, TanStack Table and Recharts render under both Next and vinext.
export const metadata: Metadata = { title: "Kit · Propniti", robots: { index: false } };

export default function KitPage() {
  return <Kit />;
}
