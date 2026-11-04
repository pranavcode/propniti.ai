import type { Metadata } from "next";
import { InboxPage } from "@/extensions/residents/inbox/InboxPage";

export const metadata: Metadata = { title: "Messages · Propniti" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Unified inbox (residents lane): conversations with residents, vendors and owners.
export default async function Page({ searchParams }: Props) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return <InboxPage status={one("status")} kind={one("kind")} unread={one("unread") === "1"} q={one("q")} page={Number(one("page")) || 1} selected={one("t")} property={one("property")} />;
}
