"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState, type VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, Download, Rows3, Rows4, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber } from "@/lib/format";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useUrlState } from "@/hooks/use-url-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShellMaybe } from "../shell/context";
import { ConfirmDialog } from "../forms/ConfirmDialog";
import { EmptyState, ErrorBanner } from "../states";
import { TONE_DOT } from "../status";
import { Cell, isRight } from "./cells";
import { AiFilter, FacetChip, SearchBox } from "./FilterBar";
import { fillTemplate, filterKeys, paramsToView, PAGE_SIZES, readSort, readValues, viewToParams } from "./params";
import { serverViews, type SavedViewsAdapter } from "./views";
import { PeekLink } from "../peek/PeekLink";
import { usePeek, usePeekPageEntity } from "../peek/usePeek";
import type { AiFilterFn, AiFilterResult, BulkAction, DataColumn, EmptyCopy, Facet, Row, SavedView, StatusTabs } from "./types";

export type DataTableProps = {
  entity: string;                         // EntityKey; keys saved views and column prefs
  label?: { one: string; many: string };
  columns: DataColumn[];
  rows: Row[];
  total: number;
  page: number;
  size: number;
  counts?: Record<string, number>;        // status tab counts (ListResult.counts)
  footer?: Record<string, number | null>; // "sum:field" → value (list API footer)
  statusTabs?: StatusTabs;
  facets?: Facet[];
  rowHref?: string;                       // "/app/units/{id}"; a row click opens the peek drawer
  bulkActions?: BulkAction[];
  onBulkAction?: (key: string, ids: string[]) => Promise<unknown> | void;
  exportHref?: string;                    // "/api/e/units/export.csv"; the current query is appended
  onAiFilter?: AiFilterFn;
  views?: SavedView[];                    // built-in views (EntityDef.list.savedViews)
  viewsAdapter?: SavedViewsAdapter;
  searchPlaceholder?: string;
  empty?: EmptyCopy;                      // first-use empty state
  error?: string | null;
  toolbar?: React.ReactNode;              // extra buttons (e.g. "New unit")
  keyboard?: boolean;                     // j/k/enter/x shortcuts; one table per page
  maxHeight?: string;                     // scroll area height; default fills the viewport
  className?: string;
};

const VIRTUAL_OVER = 100;
const OVERSCAN = 8;

export function DataTable(props: DataTableProps) {
  const { entity, columns, rows, total, page, size, counts, footer, statusTabs, facets = [], rowHref, bulkActions = [], onBulkAction, exportHref, onAiFilter, views: builtIn = [], viewsAdapter = serverViews, searchPlaceholder, empty, error, toolbar, keyboard = true, maxHeight, className } = props;
  const label = props.label ?? { one: "record", many: "records" };
  const router = useRouter();
  const { params, set, reset, pending } = useUrlState();
  const density = useShellMaybe()?.density ?? "comfortable";
  const scrollRef = useRef<HTMLDivElement>(null);
  const peek = usePeek();
  usePeekPageEntity(entity);
  const peekedId = peek.target?.entity === entity ? peek.target.id : null;

  // ---- columns: URL cols= wins, then this browser's choice, then the defaults
  const [storedCols, setStoredCols] = useLocalStorage<string[] | null>(`pn_cols:${entity}`, null);
  const urlCols = params.get("cols")?.split(",").filter(Boolean);
  const visibleKeys = urlCols ?? storedCols ?? columns.filter((c) => !c.defaultHidden).map((c) => c.key);
  const columnVisibility: VisibilityState = Object.fromEntries(columns.map((c) => [c.key, c.primary || visibleKeys.includes(c.key)]));
  const setColumns = (keys: string[]) => { setStoredCols(keys); if (urlCols) set({ cols: keys.join(",") }); };

  // ---- selection
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const selectable = bulkActions.length > 0;
  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) { setPrevRows(rows); setRowSelection({}); }

  const sort = readSort(params);
  const filtersActive = filterKeys(params).length > 0 || !!params.get("q");

  const tcols = useMemo<ColumnDef<Row>[]>(() => {
    const out: ColumnDef<Row>[] = columns.map((c) => ({ id: c.key, accessorFn: (r) => r[c.key], header: c.label, cell: ({ row }) => <Cell col={c} row={row.original} />, meta: c }));
    if (selectable) out.unshift({
      id: "__select",
      header: ({ table }) => <Checkbox aria-label="Select all on this page" checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false} onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)} />,
      cell: ({ row }) => <Checkbox aria-label="Select row" checked={row.getIsSelected()} onClick={(e) => e.stopPropagation()} onCheckedChange={(v) => row.toggleSelected(!!v)} />,
    });
    return out;
  }, [columns, selectable]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 isn't React Compiler-safe; this component opts out
  const table = useReactTable({
    data: rows,
    columns: tcols,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r, i) => String(r.id ?? i),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    state: { columnVisibility, rowSelection },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: selectable,
  });
  const tRows = table.getRowModel().rows;
  const visibleCols = table.getVisibleLeafColumns();

  // ---- virtualization (manual windowing; rows have a fixed height)
  const hasSub = columns.some((c) => c.primary) && rows.some((r) => r._subtitle);
  const rowH = hasSub ? (density === "compact" ? 40 : 46) : density === "compact" ? 30 : 36;
  const virtual = tRows.length > VIRTUAL_OVER;
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !virtual) return;
    const on = () => setScroll({ top: el.scrollTop, height: el.clientHeight });
    on();
    el.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { el.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, [virtual]);
  const start = virtual ? Math.max(0, Math.floor(scroll.top / rowH) - OVERSCAN) : 0;
  const end = virtual ? Math.min(tRows.length, Math.ceil((scroll.top + scroll.height) / rowH) + OVERSCAN) : tRows.length;

  // ---- keyboard: j/k move, enter opens, x selects, esc clears
  const [cursor, setCursor] = useState(-1);
  const moveTo = useCallback((i: number) => {
    const n = Math.max(0, Math.min(tRows.length - 1, i));
    setCursor(n);
    const el = scrollRef.current;
    if (el) {
      const top = n * rowH, head = 36;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + rowH > el.scrollTop + el.clientHeight - head) el.scrollTop = top + rowH - el.clientHeight + head + 4;
    }
  }, [tRows.length, rowH]);
  // Plain click or Enter peeks; Cmd/Ctrl-click opens the full page in a new tab.
  const { open: openPeek } = peek;
  const open = useCallback((r: Row, newTab?: boolean) => {
    if (!rowHref) return;
    if (newTab) window.open(fillTemplate(rowHref, r), "_blank");
    else openPeek({ entity, id: String(r.id) });
  }, [rowHref, entity, openPeek]);
  useHotkeys({
    j: () => moveTo(cursor + 1),
    k: () => moveTo(cursor - 1),
    Enter: (e) => {
      const r = tRows[cursor];
      const onPage = e.target === document.body || (e.target as HTMLElement).id === "main";
      if (!r || !onPage) return false;
      open(r.original);
    },
    x: () => { const r = tRows[cursor]; if (!r || !selectable) return false; r.toggleSelected(); },
    Escape: () => { if (selectedIds.length) setRowSelection({}); else if (cursor >= 0) setCursor(-1); else return false; },
  }, keyboard && !peek.target);

  // ---- saved views
  const [views, setViews] = useState<SavedView[]>(builtIn);
  useEffect(() => {
    let alive = true;
    viewsAdapter.list(entity).then((v) => { if (alive) setViews([...builtIn.filter((b) => !v.some((x) => x.key === b.key)), ...v]); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per entity
  }, [entity]);
  const activeView = views.find((v) => v.key === params.get("view"));
  const applyView = (v: SavedView | null) => reset(v ? viewToParams(params, v, v.key) : viewToParams(params, {}));
  const [saveOpen, setSaveOpen] = useState(false);

  // ---- AI filter with undo
  const [aiApplied, setAiApplied] = useState<{ text: string; explanation?: string; before: string } | null>(null);
  const applyAi = (r: AiFilterResult, text: string) => {
    setAiApplied({ text, explanation: r.explanation, before: params.toString() });
    reset(viewToParams(params, { q: r.q, filters: r.filters, sort: r.sort }));
  };
  const undoAi = () => { if (aiApplied) reset(new URLSearchParams(aiApplied.before)); setAiApplied(null); };

  const setPatch = (patch: Record<string, string | null>) => set({ ...patch, page: null, view: null });
  const clearAll = () => { const sp = viewToParams(params, {}); reset(sp); setAiApplied(null); };

  // ---- status tabs
  const tabValue = statusTabs ? readValues(params, statusTabs.field) : [];
  const tabTotal = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;

  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  const footerCells = footer && Object.keys(footer).length ? footer : null;

  const [confirming, setConfirming] = useState<BulkAction | null>(null);
  const doBulk = async (a: BulkAction, confirmed = false) => {
    if (a.confirm && !confirmed) { setConfirming(a); return; }
    const ids = selectedIds;
    const run = Promise.resolve(onBulkAction?.(a.key, ids));
    toast.promise(run, { loading: `${a.label}: ${ids.length} ${ids.length === 1 ? label.one : label.many}…`, success: `${a.label}: done for ${ids.length}`, error: (e) => (e instanceof Error ? e.message : `${a.label} failed`) });
    await run.catch(() => {});
    setRowSelection({});
  };

  const exportUrl = exportHref ? `${exportHref}${exportHref.includes("?") ? "&" : "?"}${new URLSearchParams([...params].filter(([k]) => !["page", "view", "cols", "tab"].includes(k))).toString()}` : null;

  return (
    <div className={cn("flex min-w-0 flex-col", className)} data-entity={entity}>
      {statusTabs && (
        <div role="tablist" aria-label="Status" className="-mb-px flex items-end gap-0.5 overflow-x-auto border-b [scrollbar-width:none]">
          {[{ value: "", label: statusTabs.allLabel ?? "All", tone: undefined }, ...statusTabs.options].map((o) => {
            const on = o.value ? tabValue.length === 1 && tabValue[0] === o.value : tabValue.length === 0;
            const n = o.value ? counts?.[o.value] : tabTotal;
            return (
              <button
                key={o.value || "all"}
                role="tab"
                aria-selected={on}
                onClick={() => setPatch({ [`f.${statusTabs.field}`]: o.value || null })}
                className={cn("relative flex h-9 shrink-0 items-center gap-1.5 px-2.5 text-[13px] transition-colors", on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {o.tone && <span className={cn("size-1.5 rounded-full", TONE_DOT[o.tone])} />}
                {o.label ?? o.value}
                {n != null && <span className={cn("rounded px-1 text-[11px] tabular-nums", on ? "bg-foreground/[0.07] text-foreground" : "text-muted-foreground")}>{formatNumber(n)}</span>}
                {on && <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-foreground" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 py-2.5">
        <ViewsMenu views={views} active={activeView} onApply={applyView} onSave={() => setSaveOpen(true)} onDelete={async (v) => { await viewsAdapter.remove(entity, v.key); setViews((vs) => vs.filter((x) => x.key !== v.key)); if (activeView?.key === v.key) applyView(null); }} />
        <SearchBox value={params.get("q") ?? ""} onChange={(q) => setPatch({ q: q || null })} placeholder={searchPlaceholder ?? `Search ${label.many.toLowerCase()}…`} />
        {facets.filter((f) => f.key !== statusTabs?.field).map((f) => <FacetChip key={f.key} facet={f} params={params} set={setPatch} />)}
        {onAiFilter && <AiFilter onAiFilter={onAiFilter} apply={applyAi} undo={undoAi} applied={aiApplied} />}
        {filtersActive && <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={clearAll}>Clear</Button>}
        <div className="ml-auto flex items-center gap-1">
          <ColumnsMenu columns={columns} visible={visibleKeys} onChange={setColumns} />
          <DensityToggle />
          {exportUrl && (
            <Tooltip>
              <TooltipTrigger asChild><Button asChild variant="outline" size="sm"><a href={exportUrl} download><Download /> <span className="hidden md:inline">Export</span></a></Button></TooltipTrigger>
              <TooltipContent>Export {formatNumber(total)} {label.many.toLowerCase()} as CSV</TooltipContent>
            </Tooltip>
          )}
          {toolbar}
        </div>
      </div>

      {error && <ErrorBanner className="mb-2.5" title={`Couldn't load ${label.many.toLowerCase()}`} message={error} onRetry={() => router.refresh()} />}

      <div className="relative overflow-hidden rounded-lg border bg-card">
        {pending && <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/15"><div className="h-full w-1/3 animate-[pn-progress_1s_ease-in-out_infinite] bg-primary motion-reduce:animate-none" /></div>}
        <div ref={scrollRef} className="overflow-auto overscroll-x-contain" style={{ maxHeight: maxHeight ?? "calc(100dvh - 15rem)" }}>
          <table className={cn("w-full border-separate border-spacing-0 text-[13px] transition-opacity", pending && "opacity-60")} aria-rowcount={total} aria-busy={pending}>
            <thead className="sticky top-0 z-10">
              <tr>
                {visibleCols.map((c) => {
                  const meta = c.columnDef.meta as DataColumn | undefined;
                  const sortable = meta && meta.sortable !== false && meta.kind !== "json" && meta.kind !== "health";
                  const dir = sort && meta && sort[0] === meta.key ? sort[1] : null;
                  const right = meta && isRight(meta);
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      style={{ width: c.id === "__select" ? 36 : meta?.width, minWidth: c.id === "__select" ? 36 : meta?.primary ? 220 : undefined }}
                      className={cn("h-9 border-b bg-muted/60 px-3 text-left text-[12px] font-medium whitespace-nowrap text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-muted/70", right && "text-right", c.id === "__select" && "pr-0")}
                    >
                      {sortable ? (
                        <button
                          onClick={() => setPatch({ sort: dir === "asc" ? `-${meta.key}` : dir === "desc" ? null : meta.key })}
                          className={cn("group/sort inline-flex items-center gap-1 rounded hover:text-foreground", right && "flex-row-reverse", dir && "text-foreground")}
                        >
                          {meta.label}
                          {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-0 group-hover/sort:opacity-60" />}
                        </button>
                      ) : flexRender(c.columnDef.header, table.getHeaderGroups()[0]!.headers.find((h) => h.column.id === c.id)!.getContext())}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {virtual && start > 0 && <tr aria-hidden style={{ height: start * rowH }} />}
              {tRows.slice(start, end).map((r, i) => {
                const idx = start + i;
                const selected = r.getIsSelected();
                return (
                  <tr
                    key={r.id}
                    aria-rowindex={(page - 1) * size + idx + 1}
                    aria-selected={selectable ? selected : undefined}
                    data-cursor={cursor === idx || undefined}
                    data-peeked={peekedId === r.id || undefined}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,[role=checkbox]")) return; setCursor(idx); open(r.original, e.metaKey || e.ctrlKey); }}
                    style={{ height: rowH }}
                    className={cn(
                      "group/row transition-colors [&>td]:border-b [&>td]:border-border/70",
                      rowHref && "cursor-pointer",
                      selected ? "bg-primary/[0.06]" : "hover:bg-muted/50",
                      (cursor === idx || peekedId === r.id) && "bg-muted/70 shadow-[inset_2px_0_0_var(--primary)]",
                    )}
                  >
                    {r.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as DataColumn | undefined;
                      const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                      return (
                        <td key={cell.id} className={cn("max-w-[360px] px-3 align-middle", meta && isRight(meta) && "text-right", cell.column.id === "__select" && "w-9 pr-0")}>
                          <div className={cn("flex min-w-0 items-center", meta && isRight(meta) && "justify-end")}>
                            {meta?.primary && rowHref && r.original.id != null
                              ? <PeekLink entity={entity} id={String(r.original.id)} href={fillTemplate(rowHref, r.original)} className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{content}</PeekLink>
                              : content}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {virtual && end < tRows.length && <tr aria-hidden style={{ height: (tRows.length - end) * rowH }} />}
            </tbody>
            {footerCells && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-muted/80 backdrop-blur">
                  {visibleCols.map((c, i) => {
                    const meta = c.columnDef.meta as DataColumn | undefined;
                    const hit = meta && Object.entries(footerCells).find(([k]) => k.split(":")[1] === meta.key);
                    const first = i === (selectable ? 1 : 0);
                    return (
                      <td key={c.id} className={cn("h-9 border-t px-3 text-[12.5px] font-medium tabular-nums", meta && isRight(meta) && "text-right")}>
                        {hit ? <FooterValue fn={hit[0].split(":")[0]!} value={hit[1]} money={meta?.kind === "money"} /> : first ? <span className="text-muted-foreground">Total · {formatNumber(total)} {total === 1 ? label.one.toLowerCase() : label.many.toLowerCase()}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>

          {rows.length === 0 && !error && (
            filtersActive
              ? <EmptyState kind="filtered" title={`No matching ${label.many.toLowerCase()}`} description="Try a different search, or adjust or clear the filters." action={{ label: "Clear filters", onClick: clearAll }} />
              : <EmptyState kind="table" title={empty?.title ?? `No ${label.many.toLowerCase()} yet`} description={empty?.description} action={empty?.action} />
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-3 pt-2.5 text-[12.5px] text-muted-foreground">
          <span className="tabular-nums"><span className="font-medium text-foreground">{formatNumber(from)}–{formatNumber(to)}</span> of {formatNumber(total)}</span>
          <span className="hidden items-center gap-1 sm:flex">
            Rows
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" className="tabular-nums">{size} <ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>{PAGE_SIZES.map((s) => <DropdownMenuItem key={s} onSelect={() => set({ size: s, page: null })}>{s}{s === size && <Check className="ml-auto" />}</DropdownMenuItem>)}</DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
          {keyboard && rows.length > 0 && <span className="hidden text-[11.5px] lg:inline">J/K to move · Enter to preview{selectable ? " · X to select" : ""}</span>}
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 tabular-nums">Page {formatNumber(page)} of {formatNumber(pages)}</span>
            <Button variant="outline" size="icon-sm" disabled={page <= 1 || pending} onClick={() => set({ page: page - 1 === 1 ? null : page - 1 })} aria-label="Previous page"><ChevronLeft /></Button>
            <Button variant="outline" size="icon-sm" disabled={page >= pages || pending} onClick={() => set({ page: page + 1 })} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div role="toolbar" aria-label="Bulk actions" className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3 text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none">
          <span className="mr-2 font-medium tabular-nums">{selectedIds.length} selected</span>
          {bulkActions.map((a) => (
            <Button key={a.key} size="sm" variant={a.tone === "danger" ? "destructive" : "outline"} onClick={() => void doBulk(a)}>{a.tone === "danger" && <Trash2 />}{a.label}</Button>
          ))}
          <Button size="icon-sm" variant="ghost" onClick={() => setRowSelection({})} aria-label="Clear selection"><X /></Button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirming(null)}
          title={`${confirming.label}: ${selectedIds.length} ${selectedIds.length === 1 ? label.one.toLowerCase() : label.many.toLowerCase()}?`}
          description={confirming.confirm?.replace("{n}", String(selectedIds.length))}
          confirmLabel={confirming.label}
          tone={confirming.tone === "danger" ? "danger" : "default"}
          onConfirm={() => { const a = confirming; setConfirming(null); return doBulk(a, true); }}
        />
      )}

      <SaveViewDialog open={saveOpen} onOpenChange={setSaveOpen} onSave={async (name, shared) => {
        const v = await viewsAdapter.save(entity, name, paramsToView(params), shared);
        setViews((vs) => [...vs, v]);
        set({ view: v.key });
        toast.success(`Saved view “${name}”`);
      }} />
    </div>
  );
}

function FooterValue({ fn, value, money }: { fn: string; value: number | null; money: boolean }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const text = money ? formatMoney(value) : formatNumber(value, { decimals: fn === "avg" });
  return <span title={fn === "sum" ? "Sum of all matching rows" : fn === "avg" ? "Average" : fn}>{fn !== "sum" && <span className="mr-1 text-[11px] font-normal text-muted-foreground uppercase">{fn}</span>}{text}</span>;
}

function ViewsMenu({ views, active, onApply, onSave, onDelete }: { views: SavedView[]; active?: SavedView; onApply: (v: SavedView | null) => void; onSave: () => void; onDelete: (v: SavedView) => void }) {
  const builtIn = views.filter((v) => v.builtIn || (!v.mine && !v.shared && !v.key.startsWith("local-")) || (!("mine" in v) && !("shared" in v)));
  const shared = views.filter((v) => v.shared && !v.builtIn && !builtIn.includes(v));
  const mine = views.filter((v) => v.mine && !v.shared);
  const section = (title: string, list: SavedView[], deletable?: boolean) => list.length > 0 && (
    <>
      <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">{title}</DropdownMenuLabel>
      <DropdownMenuGroup>{list.map((v) => (
        <DropdownMenuItem key={v.key} onSelect={() => onApply(v)} className="group/v">
          <span className="flex-1 truncate">{v.label}</span>
          {active?.key === v.key && <Check className="text-primary" />}
          {deletable && <button onClick={(e) => { e.stopPropagation(); onDelete(v); }} className="opacity-0 group-hover/v:opacity-60 hover:opacity-100" aria-label={`Delete ${v.label}`}><Trash2 className="size-3.5" /></button>}
        </DropdownMenuItem>
      ))}</DropdownMenuGroup>
    </>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("max-w-48", active && "border-primary/30 bg-primary/[0.05]")}>
          <Bookmark className={cn(active && "fill-primary/20 text-primary")} />
          <span className="truncate">{active?.label ?? "All records"}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup><DropdownMenuItem onSelect={() => onApply(null)}><span className="flex-1">All records</span>{!active && <Check className="text-primary" />}</DropdownMenuItem></DropdownMenuGroup>
        {section("Views", builtIn)}
        {section("Shared with the team", shared, true)}
        {section("My views", mine, true)}
        <DropdownMenuSeparator />
        <DropdownMenuGroup><DropdownMenuItem onSelect={onSave}><Bookmark /> Save current view…</DropdownMenuItem></DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SaveViewDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (name: string, shared: boolean) => Promise<void> }) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription>Keeps the current search, filters, sort and columns.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; setBusy(true); try { await onSave(name.trim(), shared); onOpenChange(false); setName(""); } finally { setBusy(false); } }}>
          <input autoFocus name="view-name" autoComplete="off" aria-label="View name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Austin 2-beds on notice…" className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" />
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <span><span className="block font-medium">Share with the team</span><span className="text-[12px] text-muted-foreground">Everyone in your org sees it under Shared.</span></span>
            <Switch checked={shared} onCheckedChange={setShared} />
          </label>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={!name.trim() || busy}>Save view</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ColumnsMenu({ columns, visible, onChange }: { columns: DataColumn[]; visible: string[]; onChange: (keys: string[]) => void }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Columns"><Columns3 /></Button></DropdownMenuTrigger></TooltipTrigger>
        <TooltipContent>Columns</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-[60vh] w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Show columns</DropdownMenuLabel>
        <DropdownMenuGroup>{columns.filter((c) => !c.primary).map((c) => (
          <DropdownMenuCheckboxItem key={c.key} checked={visible.includes(c.key)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => onChange(on ? columns.filter((x) => x.key === c.key || visible.includes(x.key)).map((x) => x.key) : visible.filter((k) => k !== c.key))}>
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}</DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup><DropdownMenuItem onSelect={() => onChange(columns.filter((c) => !c.defaultHidden).map((c) => c.key))}>Reset to default</DropdownMenuItem></DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DensityToggle() {
  const shell = useShellMaybe();
  if (!shell) return null;
  const compact = shell.density === "compact";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => shell.setDensity(compact ? "comfortable" : "compact")} aria-label={compact ? "Comfortable rows" : "Compact rows"} aria-pressed={compact}>{compact ? <Rows4 /> : <Rows3 />}</Button>
      </TooltipTrigger>
      <TooltipContent>{compact ? "Comfortable rows" : "Compact rows"}</TooltipContent>
    </Tooltip>
  );
}

// Suspense fallback / first load: same frame as the table, skeleton rows.
export function DataTableSkeleton({ columns = 6, rows = 12, tabs }: { columns?: number; rows?: number; tabs?: boolean }) {
  return (
    <div className="flex flex-col" aria-busy aria-label="Loading">
      {tabs && <div className="flex h-9 items-center gap-4 border-b px-1">{[48, 64, 56, 52].map((w, i) => <Skeleton key={i} className="h-3.5" style={{ width: w }} />)}</div>}
      <div className="flex items-center gap-1.5 py-2.5"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-60" /><Skeleton className="h-7 w-20" /><Skeleton className="h-7 w-20" /><Skeleton className="ml-auto h-8 w-20" /></div>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex h-9 items-center gap-6 border-b bg-muted/60 px-3">{Array.from({ length: columns }, (_, i) => <Skeleton key={i} className="h-3" style={{ width: i === 0 ? 120 : 64 }} />)}</div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex h-9 items-center gap-6 border-b border-border/60 px-3 last:border-0">
            {Array.from({ length: columns }, (_, i) => <Skeleton key={i} className="h-3" style={{ width: i === 0 ? 160 - ((r * 37) % 60) : 48 + ((r * 13 + i * 7) % 30), marginLeft: i > columns - 3 ? "auto" : undefined }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
