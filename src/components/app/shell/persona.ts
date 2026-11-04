"use client";

import { PN_AS, personaCookie } from "@/auth/personas";

// Demo role switching (plan §5): the pn_as cookie picks the persona. A full navigation makes
// every server component re-read it.
export function switchPersona(id: string, home: string) {
  document.cookie = personaCookie(id);
  window.location.assign(home);
}

export function exitPersona() {
  document.cookie = `${PN_AS}=; Path=/; Max-Age=0; SameSite=Lax`;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload drops persona state
  window.location.assign("/login");
}
