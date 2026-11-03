// Client-safe exports. Server pages import tableSpec() from "./spec".
export { DataTable, DataTableSkeleton, type DataTableProps } from "./DataTable";
export { Cell } from "./cells";
export * from "./params";
export * from "./types";
export { localViews, serverViews, type SavedViewsAdapter } from "./views";
