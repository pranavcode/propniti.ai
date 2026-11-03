import type { Metadata } from "next";
import { Composer } from "@/extensions/residents/announcements/Composer";

export const metadata: Metadata = { title: "New announcement · Propniti" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function Page({ searchParams }: Props) {
  const sp = await searchParams;
  return <Composer id={sp.id} run={sp.run} src={sp.src} property={sp.property} />;
}
