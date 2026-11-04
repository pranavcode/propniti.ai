import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";

// Notifications are addressed to a persona id (staff) or, for portal users, to their record id.
export const recipientIds = (actor: Actor) => {
  const rec = getPersona(actor.personaId)?.record;
  return rec ? [actor.personaId, rec.id] : [actor.personaId];
};
