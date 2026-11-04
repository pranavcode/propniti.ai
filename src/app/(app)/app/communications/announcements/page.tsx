import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { getEntity } from "@/entities";
import { currentSession } from "@/auth/session";
import { ListView } from "@/components/entity/pages";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Announcements · Propniti" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// The generic announcements list, with the composer as the way to write a new one.
export default async function Page({ searchParams }: Props) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) sp.append(k, x);
  const session = await currentSession();
  const canWrite = ["principal", "regional_manager", "property_manager"].includes(session.actor.role);
  return (
    <div className="relative">
      {canWrite && <Button asChild size="sm" className="absolute top-4 right-4 z-10 md:top-6 md:right-6"><Link href="/app/communications/announcements/new"><Megaphone />New announcement</Link></Button>}
      <ListView def={getEntity("announcements")!} searchParams={sp} session={session} />
    </div>
  );
}
