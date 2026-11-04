import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";

export const BASE = process.env.BASE_URL ?? "http://localhost:3201";
export const STATE = fileURLToPath(new URL(".auth/state.json", import.meta.url));
export const GREETING = /Good (morning|afternoon|evening)/;

const TOUR_IDS = ["app-basics", "applicant-portal", "broker", "finance-month-end", "leasing-agent", "maintenance-supervisor", "owner-portal", "owner-statements", "persona-accountant", "persona-admin", "persona-broker", "persona-principal", "pm-today", "portfolio-principal", "portfolio-regional", "receivables", "resident-portal", "vendor-portal"];
// Every product tour marked dismissed, so none covers the page.
export const TOURS = JSON.stringify(Object.fromEntries(TOUR_IDS.map((t) => [t, { tour: t, step: 0, status: "Dismissed", updatedAt: "2026-11-04T00:00:00Z" }])));
// Chat bubble tips off, so no nudge covers the page (chat-bubble.spec.ts turns them back on).
export const TIPS_OFF = JSON.stringify({ off: true });

// Act as a persona inside the run's shared workspace (the pn_ws cookie comes from storageState).
export async function as(context: BrowserContext, persona: string) {
  await context.addCookies([{ name: "pn_as", value: persona, url: BASE }]);
}

// A plain click on a list row opens the record peek drawer; this continues to the full record page.
export async function openFull(page: Page) {
  await page.locator("[data-peek-drawer]").getByRole("link", { name: /Open full page/ }).click();
}

// React tags each element it has wired with a __reactProps$ key. Until every control has one,
// clicks can land on server HTML with no handler and do nothing.
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    if (document.readyState !== "complete") return false;
    const controls = document.querySelectorAll("button, a[href], input, select, textarea");
    return Array.from(controls).every((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$")));
  }, undefined, { timeout: 90_000 });
  // The staff shell can hold a connection open, so network idle is best effort.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

// Navigate and wait until the page can be clicked.
export async function go(page: Page, url: string) {
  const res = await page.goto(url.startsWith("http") ? url : BASE + url);
  await hydrated(page);
  return res;
}

export async function reload(page: Page) {
  await page.reload();
  await hydrated(page);
}

// Uncaught page errors and console errors (failed resource loads aside).
export function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon|Download the React DevTools/.test(m.text()) && errors.push(m.text()));
  return errors;
}
