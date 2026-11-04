import type { Metadata } from "next";
import { KitPage } from "@/components/app/kit/KitPage";

// Living style guide for the app surface (/app/_kit; the folder is %5Fkit because "_" folders are
// private). Keep only page.tsx in this folder: vinext dev 404s client modules under a %-encoded path.
export const metadata: Metadata = { title: "Kit · Propniti", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <KitPage searchParams={await searchParams} />;
}
