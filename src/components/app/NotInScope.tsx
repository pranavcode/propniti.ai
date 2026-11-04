"use client";

import { usePathname } from "next/navigation";
import { EmptyState } from "@/components/app/states";
import { notFoundView } from "./not-found/view";

// Body of /app's not-found page. `lists` are the list routes this persona can read.
export function NotInScope({ scope, name, home, lists }: { scope: string; name: string; home: string; lists: string[] }) {
  const { record, list } = notFoundView(usePathname() ?? "", lists);
  return (
    <div className="px-4 pt-6 md:px-6">
      <EmptyState
        kind="filtered"
        title={record ? "This record isn't in your scope or doesn't exist" : "This page doesn't exist or isn't part of your role"}
        description={record
          ? `You're viewing as ${name}, who sees ${scope}. Check the link, or switch role from your avatar menu to see records outside that scope.`
          : `You're viewing as ${name}. Check the link, or switch role from your avatar menu.`}
        action={list ? { label: "Back to the list", href: list } : { label: "Go to your home", href: home }}
        secondary={list ? { label: "Go to your home", href: home } : undefined}
      />
    </div>
  );
}
