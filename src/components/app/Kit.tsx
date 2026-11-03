"use client";

import { useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import { Building2, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Prop = { id: string; name: string; metro: string; units: number; occupancy: number };
const rows: Prop[] = [
  { id: "p01", name: "The Lofts at Riverside", metro: "Austin", units: 186, occupancy: 0.95 },
  { id: "p08", name: "Uptown Tower at McKinney", metro: "Dallas", units: 312, occupancy: 0.93 },
  { id: "p15", name: "Midtown Peachtree", metro: "Atlanta", units: 280, occupancy: 0.91 },
];
const columns: ColumnDef<Prop>[] = [
  { accessorKey: "name", header: "Property" },
  { accessorKey: "metro", header: "Metro" },
  { accessorKey: "units", header: () => <div className="text-right">Units</div>, cell: ({ getValue }) => <div className="text-right">{getValue<number>()}</div> },
  { accessorKey: "occupancy", header: "Occupancy", cell: ({ getValue }) => <Badge variant="secondary">{Math.round(getValue<number>() * 100)}%</Badge> },
];
const noi = [
  { month: "May", noi: 412 }, { month: "Jun", noi: 431 }, { month: "Jul", noi: 425 },
  { month: "Aug", noi: 447 }, { month: "Sep", noi: 452 }, { month: "Oct", noi: 468 },
];
const chartConfig = { noi: { label: "NOI ($k)", color: "var(--chart-1)" } } satisfies ChartConfig;

export function Kit() {
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 isn't React Compiler-safe; this component opts out
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <main className="space-y-8 p-6">
      <h1 className="text-xl font-semibold">Component kit</h1>

      <section className="flex flex-wrap gap-2">
        <Button onClick={() => toast("Payment recorded")}>Record payment</Button>
        <Button variant="outline" onClick={() => setOpen(true)}><Search /> Search ⌘K</Button>
        <Dialog>
          <DialogTrigger asChild><Button variant="secondary">Open dialog</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve bill</DialogTitle>
              <DialogDescription>Pay $1,240.00 to Lone Star Plumbing from the trust account.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button>Approve</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger asChild><Button variant="ghost">Open sheet</Button></SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Copilot</SheetTitle>
              <SheetDescription>Ask about your portfolio.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </section>

      {/* This shadcn version's CommandDialog doesn't include <Command>; wrap it yourself. */}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <CommandInput placeholder="Search or ask…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Properties">
              {rows.map((r) => <CommandItem key={r.id}><Building2 /> {r.name}</CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      <section className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>{hg.headers.map((h) => <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>)}</TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="h-[var(--row-h)]">{row.getVisibleCells().map((c) => <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="max-w-xl rounded-lg border p-4">
        <h2 className="mb-2 font-medium">NOI, last 6 months</h2>
        <ChartContainer config={chartConfig} className="h-48 w-full">
          <LineChart data={noi} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line dataKey="noi" type="monotone" stroke="var(--color-noi)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </section>
    </main>
  );
}
