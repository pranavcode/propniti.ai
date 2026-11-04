"use client";

import { LAST_PERSONA, PN_AS, personaCookie } from "@/auth/personas";

// Demo role switching (plan §5): the pn_as cookie picks the persona. A full navigation makes
// every server component re-read it.
export function switchPersona(id: string, home: string) {
  rememberPersona(id);
  document.cookie = personaCookie(id);
  window.location.assign(home);
}

// The sign-in page preselects the last person, so signing out and back in is one Enter.
function rememberPersona(id: string | undefined) {
  try {
    if (id) localStorage.setItem(LAST_PERSONA, id);
  } catch {}
}

export function exitPersona() {
  const id = document.cookie.split(/;\s*/).find((c) => c.startsWith(`${PN_AS}=`))?.slice(PN_AS.length + 1);
  rememberPersona(id && decodeURIComponent(id));
  document.cookie = `${PN_AS}=; Path=/; Max-Age=0; SameSite=Lax`;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload drops persona state
  window.location.assign("/login");
}
