import type { Metadata } from "next";
import { TodayPage } from "@/extensions/residents/today/TodayPage";

export const metadata: Metadata = { title: "Today · Propniti" };

// The property manager's home (residents lane). /app renders the same page for that role.
export default function Page() {
  return <TodayPage />;
}
