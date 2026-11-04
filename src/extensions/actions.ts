import type { ActionDef, ActionKey, EntityKey } from "@/entities/types";

// Named actions (plan §4, extension point 2): record payment, approve bill, post late fees…
// Served by POST /api/e/[entity]/[id]/actions/[action]. Money handlers call src/server/money.ts.
// Register from src/extensions/<module>/; src/extensions/index.ts imports every module.

const actions = new Map<ActionKey, ActionDef<unknown>>();

export function registerAction<I>(def: ActionDef<I>) {
  actions.set(def.key, def as unknown as ActionDef<unknown>);
  return def;
}

export const getAction = (key: string) => actions.get(key as ActionKey);
export const actionsFor = (entity: EntityKey) => [...actions.values()].filter((a) => a.entity === entity);
