import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { request, type FullConfig } from "@playwright/test";
import { ASK_AUTO_DONE, FEATURES_SEEN, STATE, TIPS_OFF, TOURS, WELCOME_OFF } from "./helpers";

// One demo workspace per run, shared by every test and persona. Each new browser context would
// otherwise get its own workspace on its first write, and the app caps new workspaces per IP per
// hour. The app has no reset action, so a fresh run is the clean slate.
export default async function globalSetup(config: FullConfig) {
  const base = config.projects[0].use.baseURL!;
  const url = new URL(base);
  const ws = randomBytes(18).toString("base64url");
  const cookie = { domain: url.hostname, path: "/", expires: Math.floor(Date.now() / 1000) + 86_400, httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" as const };
  const state = {
    cookies: [{ name: "pn_ws", value: ws, ...cookie }],
    origins: [{ origin: url.origin, localStorage: [{ name: "pn_tours", value: TOURS }, { name: "pn_guide", value: TIPS_OFF }, { name: "pn_welcome", value: WELCOME_OFF }, { name: "pn_whats_new", value: FEATURES_SEEN }, { name: "pn_ask_auto", value: ASK_AUTO_DONE }] }],
  };

  // A harmless write creates the workspace: an empty save of the admin's notification preferences.
  const api = await request.newContext({ baseURL: base, storageState: { cookies: [...state.cookies, { name: "pn_as", value: "sam", ...cookie, httpOnly: false }], origins: [] } });
  const res = await api.post("/app/settings/notifications/prefs", { headers: { Origin: url.origin }, data: {}, timeout: 120_000 });
  if (res.status() !== 200) throw new Error(`Could not create the demo workspace (HTTP ${res.status()}): ${await res.text()}`);
  await api.dispose();

  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state));
}
