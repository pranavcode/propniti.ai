import type { Metadata } from "next";
import { ResidentsDashboard } from "@/extensions/residents/dashboard/ResidentsDashboard";

export const metadata: Metadata = { title: "Residents and leases · Propniti" };

export default function Page() {
  return <ResidentsDashboard />;
}
