"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableProps } from "@/components/app/data-table/DataTable";
import { useUrlState } from "@/hooks/use-url-state";
import { runBulk } from "@/lib/bulk";
import { RecordSheet } from "./RecordSheet";
import type { FormField } from "./spec";

// Generic list page body: the DataTable plus the "New" sheet (opened by the button or ?new=1)
// and bulk actions, which run through the actions API in chunks ("Select all matching" first
// asks the server for the ids).

export function EntityList({ create, routeBase, ...table }: Omit<DataTableProps, "onBulkAction" | "toolbar"> & {
  create?: { fields: FormField[] };
  routeBase: string;
}) {
  const router = useRouter();
  const { params, set } = useUrlState();
  const [openLocal, setOpenLocal] = useState(false);
  const open = openLocal || (!!create && params.get("new") === "1");
  const setOpen = (o: boolean) => {
    setOpenLocal(o);
    if (!o && params.get("new")) set({ new: null });
  };
  const label = table.label ?? { one: "record", many: "records" };

  const onBulkAction = async (key: string, target: string[] | "matching", progress: (done: number, of: number) => void) => {
    let ids = target === "matching" ? null : target;
    if (!ids) {
      const qs = new URLSearchParams([...params].filter(([k]) => !["page", "size", "cols", "tab", "new", "cursor"].includes(k)));
      const res = await fetch(`/api/e/${table.entity}/ids?${qs}`, { cache: "no-store" }).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as { ids: string[] } | null) : null;
      if (!body) throw new Error(`Couldn't load the matching ${label.many.toLowerCase()}. Try again.`);
      ids = body.ids;
    }
    const all = ids;
    try {
      const out = await runBulk(table.entity, key, all, (done) => progress(done, all.length));
      if (!out.ok) throw new Error(out.firstError ?? "Nothing was changed");
      return `${out.ok} of ${out.total} done${out.failed ? `, ${out.failed} skipped` : ""}`;
    } finally {
      router.refresh();
    }
  };

  return (
    <>
      <DataTable
        {...table}
        onBulkAction={table.bulkActions?.length ? onBulkAction : undefined}
        toolbar={create ? <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />New {label.one.toLowerCase()}</Button> : undefined}
      />
      {create && <RecordSheet entity={table.entity} label={label} mode="create" fields={create.fields} open={open} onOpenChange={setOpen} routeBase={routeBase} />}
    </>
  );
}
