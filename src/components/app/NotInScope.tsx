"use client";

import { usePathname } from "next/navigation";
import { EmptyState } from "@/components/app/states";

// Body of /app's not-found page. The list link is the parent path (/app/properties/p10 → /app/properties).
export function NotInScope({ scope, name, home }: { scope: string; name: string; home: string }) {
  const parent = (usePathname() ?? "").replace(/\/+$/, "").split("/").slice(0, -1).join("/");
  const list = parent.length > "/app".length ? parent : null;
  return (
    <main className="px-4 pt-6 md:px-6">
      <EmptyState
        kind="filtered"
        title="This record isn't in your scope or doesn't exist"
        description={`You're viewing as ${name}, who sees ${scope}. Check the link, or switch role from your avatar menu to see records outside that scope.`}
        action={list ? { label: "Back to the list", href: list } : { label: "Go to your home", href: home }}
        secondary={list ? { label: "Go to your home", href: home } : undefined}
      />
    </main>
  );
}
