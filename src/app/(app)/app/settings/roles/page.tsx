import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { PERSONAS, type Access } from "@/auth/personas";
import { MODULE_KEYS, ROLES, type Role } from "@/entities";
import { currentPersona } from "@/auth/session";
import { moduleAccess, permissionMatrix, type MatrixCell } from "@/server/permissions";

export const metadata: Metadata = { title: "Roles and permissions · Propniti" };

// Settings → Roles. Generated from the entity defs and the role × module matrix, so it always
// matches what the API enforces: a module lane that adds an entity adds a row here.

const ROLE_LABEL: Record<Role, string> = Object.fromEntries(ROLES.map((r) => [r, PERSONAS.find((p) => p.role === r)?.title ?? r])) as Record<Role, string>;
const ACCESS_TONE: Record<Access, string> = {
  none: "text-muted-foreground",
  read: "bg-tone-neutral/10 text-foreground",
  write: "bg-tone-info/10 text-tone-info",
  approve: "bg-tone-success/10 text-tone-success",
};

function Ops({ c }: { c: MatrixCell }) {
  if (!c.read) return <Minus className="mx-auto size-3.5 text-muted-foreground/50" aria-label="No access" />;
  const letters = [c.create && "C", "R", c.update && "U", c.delete && "D"].filter(Boolean).join("");
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]" title={[c.create && "create", "read", c.update && "update", c.delete && "delete", ...c.actions].filter(Boolean).join(", ")}>
      {letters}
      {c.actions.length > 0 && <span className="rounded bg-tone-ai/10 px-1 text-tone-ai">+{c.actions.length}</span>}
    </span>
  );
}

export default async function RolesPage() {
  const me = await currentPersona();
  const rows = permissionMatrix();
  const roles = [...ROLES];
  return (
    <main className="space-y-8 p-6">
      <header>
        <h1 className="text-xl font-semibold">Roles and permissions</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          What each role can do, generated from the record definitions the API enforces. Scope decides which records: a property manager sees only their properties, a regional manager their region. You are viewing as <span className="font-medium text-foreground">{me.name}</span> ({ROLE_LABEL[me.role]}, {me.scope.label}).
        </p>
      </header>

      <section aria-labelledby="modules" className="space-y-3">
        <h2 id="modules" className="text-sm font-semibold">Module access</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="sticky left-0 bg-muted/50 px-3 py-2 font-medium">Role</th>
                {MODULE_KEYS.map((m) => <th key={m} className="px-2 py-2 font-medium capitalize">{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => {
                const access = moduleAccess(r);
                return (
                  <tr key={r} className={`border-t ${r === me.role ? "bg-primary/5" : ""}`}>
                    <th scope="row" className="sticky left-0 bg-background px-3 py-1.5 text-left font-medium">{ROLE_LABEL[r]}</th>
                    {MODULE_KEYS.map((m) => {
                      const a = access[m] ?? "none";
                      return <td key={m} className="px-2 py-1.5"><span className={`rounded px-1.5 py-0.5 text-[11px] ${ACCESS_TONE[a]}`}>{a === "none" ? "—" : a}</span></td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="records" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="records" className="text-sm font-semibold">Record permissions</h2>
          <p className="text-xs text-muted-foreground">C create · R read · U update · D delete · <span className="text-tone-ai">+n</span> named actions (hover for the list). Money records change only through actions.</p>
        </div>
        <div className="max-h-[70vh] overflow-auto rounded-md border">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-muted text-left text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-20 bg-muted px-3 py-2 font-medium">Record</th>
                <th className="px-2 py-2 font-medium">Changes</th>
                {roles.map((r) => <th key={r} className={`px-2 py-2 text-center font-medium ${r === me.role ? "text-foreground" : ""}`}><span className="block max-w-24 truncate" title={ROLE_LABEL[r]}>{ROLE_LABEL[r]}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.entity} className={`border-t ${i > 0 && rows[i - 1].module !== row.module ? "border-t-2" : ""}`}>
                  <th scope="row" className="sticky left-0 bg-background px-3 py-1.5 text-left font-medium">
                    {row.label}
                    <span className="ml-2 text-[11px] font-normal capitalize text-muted-foreground">{row.module}</span>
                  </th>
                  <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{row.writes === "generic" ? "Edit" : row.writes === "actions-only" ? <span className="inline-flex items-center gap-1"><Check className="size-3" />Actions only</span> : "Read-only"}</td>
                  {roles.map((r) => <td key={r} className={`px-2 py-1.5 text-center ${r === me.role ? "bg-primary/5" : ""}`}><Ops c={row.cells[r]} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
