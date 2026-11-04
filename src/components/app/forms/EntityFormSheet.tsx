"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TONE_DOT } from "../status";
import { apiJson, recordUrl } from "./api";
import type { FieldSpec } from "./types";
import { emptyValue, schemaFor } from "./zod";

type Values = Record<string, unknown>;

const LONG = /(notes?|description|detail|body|message|comments?)$/i;
const inputCls = "h-9 w-full rounded-md border bg-background px-3 text-[13px] tabular-nums outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/20 aria-invalid:border-tone-danger aria-invalid:ring-tone-danger/15";

// Create or edit a record in a side sheet, generated from FieldSpec[]. Saves optimistically: the
// sheet closes at once and a toast reports the result, with View and Undo (create → DELETE,
// edit → PATCH the old values back). On failure the sheet reopens with the person's input.
export function EntityFormSheet({ open, onOpenChange, mode, entity, label, fields, initial, id, route, title, description, onSubmit, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  entity: string;
  label: { one: string; many: string };
  fields: FieldSpec[];
  initial?: Values;
  id?: string;                            // edit: the record id
  route?: string;                         // list route, for "View" after create: route/<id>
  title?: string;
  description?: string;
  onSubmit?: (values: Values, changed: Values) => Promise<{ id?: string } | void>;
  onSaved?: (row: Values) => void;
}) {
  const router = useRouter();
  const shown = useMemo(() => fields.filter((f) => f.editable !== false && f.type !== "json" && f.type !== "image"), [fields]);
  const schema = useMemo(() => schemaFor(shown), [shown]);
  const defaults = useMemo(() => Object.fromEntries(shown.map((f) => [f.key, initial?.[f.key] ?? emptyValue(f)])), [shown, initial]);
  const form = useForm<Values>({ resolver: zodResolver(schema as never), defaultValues: defaults, mode: "onTouched" });
  const one = label.one.toLowerCase();

  // Fresh values each time the sheet opens normally; a failed save keeps the input (see below).
  useEffect(() => { if (open && !form.formState.isDirty) form.reset(defaults); }, [open, defaults, form]);

  const submit = form.handleSubmit(async (values) => {
    const changed = mode === "edit" ? Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== defaults[k] && !(v == null && (defaults[k] == null || defaults[k] === "")))) : values;
    if (mode === "edit" && !Object.keys(changed).length) { onOpenChange(false); return; }
    onOpenChange(false);
    const t = toast.loading(mode === "create" ? `Creating ${one}…` : `Saving ${one}…`);
    try {
      let newId = id;
      if (onSubmit) newId = (await onSubmit(values, changed))?.id ?? id;
      else if (mode === "create") newId = String((await apiJson<{ row: Values }>("POST", recordUrl(entity), values)).row.id);
      else await apiJson("PATCH", recordUrl(entity, id), changed);
      form.reset(mode === "edit" ? values : defaults);
      onSaved?.({ ...values, id: newId });
      router.refresh();
      if (mode === "create") {
        toast.success(`${label.one} created`, {
          id: t,
          action: route && newId ? { label: "View", onClick: () => router.push(`${route}/${encodeURIComponent(newId!)}`) } : undefined,
          cancel: !onSubmit && newId ? { label: "Undo", onClick: () => void apiJson("DELETE", recordUrl(entity, newId)).then(() => { toast("Creation undone"); router.refresh(); }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't undo")) } : undefined,
        });
      } else {
        const before = Object.fromEntries(Object.keys(changed).map((k) => [k, defaults[k] ?? null]));
        toast.success(`${label.one} saved`, {
          id: t,
          action: !onSubmit ? { label: "Undo", onClick: () => void apiJson("PATCH", recordUrl(entity, id), before).then(() => { toast("Change undone"); router.refresh(); }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't undo")) } : undefined,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Couldn't save the ${one}`, { id: t, action: { label: "Fix and retry", onClick: () => onOpenChange(true) } });
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-[15px]">{title ?? (mode === "create" ? `New ${one}` : `Edit ${one}`)}</SheetTitle>
          <SheetDescription>{description ?? (mode === "create" ? `Fields marked * are required.` : `Only changed fields are saved. You can undo from the toast.`)}</SheetDescription>
        </SheetHeader>
        <form id={`form-${entity}`} onSubmit={submit} noValidate className="min-h-0 flex-1 flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {shown.map((f) => (
            <Controller
              key={f.key}
              name={f.key}
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined} orientation={f.type === "bool" ? "horizontal" : "vertical"} className="gap-1.5">
                  <FieldLabel htmlFor={`f-${f.key}`} className="text-[12.5px] font-medium">
                    {f.label}{f.required && <span className="text-tone-danger">*</span>}
                  </FieldLabel>
                  <FormControl spec={f} id={`f-${f.key}`} value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={fieldState.invalid} />
                  {f.help && !fieldState.error && <FieldDescription className="text-[12px]">{f.help}</FieldDescription>}
                  <FieldError className="text-[12px]" errors={[fieldState.error]} />
                </Field>
              )}
            />
          ))}
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={`form-${entity}`} disabled={form.formState.isSubmitting}>{mode === "create" ? `Create ${one}` : "Save changes"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FormControl({ spec, id, value, onChange, onBlur, invalid }: { spec: FieldSpec; id: string; value: unknown; onChange: (v: unknown) => void; onBlur: () => void; invalid: boolean }) {
  switch (spec.type) {
    case "bool":
      return <Switch id={id} checked={!!value} onCheckedChange={onChange} className="ml-auto" />;
    case "enum":
    case "ref": {
      const opts = spec.type === "enum" ? (spec.enum ?? []).map((e) => ({ value: e.value, label: e.label ?? e.value, tone: e.tone })) : (spec.options ?? []).map((o) => ({ ...o, tone: undefined }));
      if (spec.type === "ref" && !opts.length) return <input autoComplete="off" id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={invalid} placeholder={spec.placeholder ?? "Record id"} className={inputCls} />;
      return (
        <Select value={value == null || value === "" ? undefined : String(value)} onValueChange={onChange}>
          <SelectTrigger id={id} aria-invalid={invalid} onBlur={onBlur} className="h-9 w-full text-[13px]"><SelectValue placeholder={spec.placeholder ?? `Choose ${spec.label.toLowerCase()}`} /></SelectTrigger>
          <SelectContent>{opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.tone && <span className={cn("size-1.5 rounded-full", TONE_DOT[o.tone])} />}{o.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    case "number":
    case "money":
      return (
        <div className="relative">
          {spec.type === "money" && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">$</span>}
          <input autoComplete="off"
            id={id}
            inputMode="decimal"
            value={value == null ? "" : String(value)}
            onChange={(e) => { const s = e.target.value.replace(/[$,\s]/g, ""); onChange(s === "" ? null : Number.isNaN(Number(s)) ? (s as unknown) : Number(s)); }}
            onBlur={onBlur}
            aria-invalid={invalid}
            placeholder={spec.placeholder ?? (spec.type === "money" ? "0.00" : undefined)}
            className={cn(inputCls, spec.type === "money" && "pl-6")}
          />
        </div>
      );
    case "date":
      return <input autoComplete="off" id={id} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} onBlur={onBlur} aria-invalid={invalid} className={inputCls} />;
    case "datetime":
      return <input autoComplete="off" id={id} type="datetime-local" value={(value as string)?.slice(0, 16) ?? ""} onChange={(e) => onChange(e.target.value || null)} onBlur={onBlur} aria-invalid={invalid} className={inputCls} />;
    default:
      return LONG.test(spec.key) || LONG.test(spec.label)
        ? <Textarea autoComplete="off" id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={invalid} placeholder={spec.placeholder} rows={4} className="text-[13px]" />
        : <input autoComplete="off" id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={invalid} placeholder={spec.placeholder} className={inputCls} />;
  }
}
