import { CalendarCheck } from "lucide-react";
import { OPS } from "@/entities/common";
import { effective } from "@/server/effective";
import { eventStmt, notifyStmt, uid } from "@/server/money";
import { nowIso } from "@/server/workspace";
import { registerAction } from "../actions";

// After a resident gives notice in the portal, the property team books the move-out inspection
// for the move-out day. One per notice: the insert is guarded on no move-out inspection for the
// unit since the notice. The resident's tracker shows it.
registerAction({
  key: "leases.schedule_move_out_inspection",
  label: "Schedule move-out inspection",
  entity: "leases",
  roles: [...OPS, "maintenance_supervisor"],
  icon: CalendarCheck,
  when: (r) => r.status === "Notice" && !!r.move_out_on,
  confirm: { title: "Schedule the move-out inspection?", body: "Books the walk-through for the move-out day and shows it on the resident's portal." },
  async handler(ctx, row) {
    const at = nowIso(ctx.nowMs);
    const day = String(row.move_out_on).slice(0, 10);
    const id = uid("insp");
    const [r] = await ctx.db.batch([
      ctx.db.prepare(`INSERT INTO inspections (workspace_id, id, property_id, unit_id, kind, scheduled_on, status)
        SELECT ?1, ?2, ?3, ?4, 'Move-out', ?5, 'Scheduled' WHERE NOT EXISTS (SELECT 1 FROM ${effective("inspections")} AS i WHERE i.unit_id = ?4 AND i.kind = 'Move-out' AND i.scheduled_on >= ?6)`)
        .bind(ctx.ws, id, row.property_id, row.unit_id, day, String(row.notice_on ?? day)),
    ]);
    if (!r.meta.changes) return { status: 409, error: "A move-out inspection is already scheduled for this notice." };
    const resident = await ctx.db.prepare(`SELECT r.id FROM ${effective("residents")} AS r WHERE r.household_id = ?2 ORDER BY r.is_primary DESC LIMIT 1`).bind(ctx.ws, row.household_id).first<{ id: string }>();
    await ctx.db.batch([
      eventStmt(ctx.db, ctx.ws, at, "inspection.scheduled", "leases", String(row.id), String(row.property_id), { inspection_id: id, kind: "Move-out", on: day }),
      ...(resident ? [notifyStmt(ctx.db, ctx.ws, at, resident.id, "Move-out inspection scheduled", `Your move-out walk-through is on ${day}.`, "/portal/resident/lease#move-out", ["leases", String(row.id)])] : []),
    ]);
    return { status: 200, message: `Move-out inspection scheduled for ${day}.` };
  },
  help: { summary: "Books the move-out walk-through for a lease on notice; the resident sees it in their portal.", article: "move-out-deposit-disposition" },
});
