// Client-safe exports. Server pages import fieldSpecs() from "./spec".
export { ConfirmDialog, DeleteRecordDialog } from "./ConfirmDialog";
export { EntityFormSheet } from "./EntityFormSheet";
export { InlineField, displayValue, type SaveField } from "./InlineField";
export { apiJson, recordUrl } from "./api";
export type { FieldSpec } from "./types";
export { emptyValue, schemaFor, zodFor } from "./zod";
