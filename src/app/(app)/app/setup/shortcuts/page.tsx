import type { Metadata } from "next";
import { Keyboard } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page";
import { ShortcutSheet } from "./ShortcutSheet";

export const metadata: Metadata = { title: "Keyboard shortcuts · Propniti" };

export default function ShortcutsPage() {
  return (
    <>
      <PageHeader icon={<Keyboard />} title="Keyboard shortcuts" description="Everything you can do from the keyboard. Press G, then a letter, to jump to a page." />
      <PageBody>
        <ShortcutSheet />
      </PageBody>
    </>
  );
}
