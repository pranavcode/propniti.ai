// Actions and tabs for the settings module.
import { z } from "zod";
import { FilePenLine } from "lucide-react";
import { registerAction } from "../actions";
import { registerTab } from "../tabs";
import { AuditDiff } from "./AuditDiff";

registerTab({ key: "settings.audit_diff", label: "Changes", entity: "audit", component: AuditDiff });

const amendInput = z.strictObject({
  value: z.string().trim().min(1).max(40).regex(/^\d+(\.\d+)?$/, "Enter a number; 0 means no statutory limit"),
  note: z.string().trim().min(10, "Say what changed and cite the source").max(600),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

// State rules keep their history as rows: amending adds a row with a later effective_from, and
// late fees (src/server/money.ts) use the latest row in force on the posting date.
registerAction({
  key: "state_rules.amend",
  label: "Amend rule",
  entity: "state_rules",
  roles: ["admin", "platform_admin"],
  icon: FilePenLine,
  input: amendInput,
  when: (r) => r.current === true,
  help: { summary: "Adds a new version of the rule from a date you choose. Earlier versions stay in the history and still apply before that date.", article: "state-rules" },
  handler: async ({ db, ws, actor }, row, input) => {
    if (input.effective_from <= String(row.effective_from)) return { status: 400, error: `The new version must start after ${String(row.effective_from)}` };
    if (input.value === String(row.value) && input.note === String(row.note ?? "")) return { status: 400, error: "Nothing changed" };
    const id = `sr-${String(row.state).toLowerCase()}-${String(row.rule)}-${input.effective_from.replace(/-/g, "")}`;
    const res = await db.prepare("INSERT INTO state_rules (workspace_id, id, state, rule, value, note, effective_from, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO NOTHING")
      .bind(ws, id, row.state, row.rule, input.value, input.note, input.effective_from, actor.personaId).run();
    if (!res.meta.changes) return { status: 409, error: "A version starting on that date already exists" };
    return { status: 200, message: `${String(row.title)}: ${String(row.value)} → ${input.value} from ${input.effective_from}`, href: `/app/settings/state-rules/${id}` };
  },
});
