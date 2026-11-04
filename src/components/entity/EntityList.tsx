"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableProps } from "@/components/app/data-table/DataTable";
import { useUrlState } from "@/hooks/use-url-state";
import { RecordSheet } from "./RecordSheet";
import type { FormField } from "./spec";

// Generic list page body: the DataTable plus the "New" sheet (opened by the button or ?new=1)
// and bulk actions, which run one record at a time through the actions API.

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

  const onBulkAction = async (key: string, ids: string[]) => {
    const res = await fetch(`/api/e/${table.entity}/actions/${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    if (!res) toast.error("Couldn't reach the server. Try again.");
    else if (out.ok) toast.success(`${out.ok} of ${ids.length} done${out.failed ? `, ${out.failed} skipped` : ""}`);
    else toast.error(out.error ?? out.results?.[0]?.error ?? "Nothing was changed");
    router.refresh();
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
