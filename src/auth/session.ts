import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_PERSONA, getPersona, PN_AS, type Persona } from "./personas";

// The persona this request acts as (pn_as cookie), for server components and route handlers.
export async function currentPersona(): Promise<Persona> {
  const id = (await cookies()).get(PN_AS)?.value;
  return getPersona(id) ?? getPersona(DEFAULT_PERSONA)!;
}
