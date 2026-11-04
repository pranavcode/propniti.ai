import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { as, BASE, go, reload, watch } from "./helpers";

// Guided setup at /app/onboarding. The rules-only path end to end (company, an AppFolio export
// identified and imported through the import wizard, a suggested approval limit accepted, the
// team step, Data Health on the import and the summary, then resume after a reload), and the AI
// path with the model stubbed at the network edge (no paid call). Both tests clean up after
// themselves, because the run's workspace is shared with the specs that follow.

const ROLL = "public/samples/appfolio-rent-roll.csv";
const DIRECTORY = "public/samples/appfolio-tenant-directory.csv";
const api = (page: Page, method: "post" | "patch", path: string, data: unknown) => page.request[method](`${BASE}${path}`, { headers: { Origin: BASE }, data });

test("rules only: company, import, a suggested limit, Data Health and the summary, then resume", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  let aiCalls = 0;
  await page.route("**/api/onboarding/detect", (r) => { aiCalls++; return r.abort(); });
  await page.route("**/api/import/ai", (r) => { aiCalls++; return r.abort(); });
  await go(page, "/app/onboarding");

  // 1. Company
  await expect(page.getByRole("heading", { name: "Your company", exact: true })).toBeVisible();
  await page.getByLabel("Company name").fill("Lakeside Property Co.");
  await page.getByRole("button", { name: "TX", exact: true }).click();
  await page.getByRole("button", { name: "AZ", exact: true }).click();
  await expect(page.getByRole("button", { name: "TX", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel(/Units managed/).fill("420");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 2. Bring your data: identified by rules, then the import wizard from column matching on.
  await expect(page.getByRole("heading", { name: "Bring your data", exact: true })).toBeVisible();
  const ai = page.getByRole("switch", { name: /Use AI to identify files/ });
  if ((await ai.getAttribute("aria-checked")) === "true") await ai.click();
  await expect(page.getByText(/Rules only: files are identified by their columns and names/)).toBeVisible();
  await page.getByLabel("Choose export files").setInputFiles([ROLL, DIRECTORY]);
  await expect(page.getByLabel("Source tool of appfolio-rent-roll.csv")).toHaveValue("appfolio");
  await expect(page.getByLabel("Record type in appfolio-rent-roll.csv")).toHaveValue("rent_roll");
  await expect(page.getByLabel("Record type in appfolio-tenant-directory.csv")).toHaveValue("residents");
  await expect(page.getByText(/Headers match the typical AppFolio Rent Roll layout/)).toBeVisible();
  await expect(page.getByTestId("file-detection").first()).toContainText("Rules");
  await page.getByRole("button", { name: "Match columns" }).click();

  await expect(page.getByLabel("Column for Tenant name")).toHaveValue("2");
  await page.getByRole("button", { name: /Review values/ }).click();
  const fixes = page.getByRole("region", { name: "Suggested fixes" });
  await fixes.getByRole("button", { name: /Accept all/ }).click();
  await page.getByRole("button", { name: /Preview import/ }).click();
  await expect(page.getByTestId("import-summary")).toContainText("This import adds 2 properties, 12 units, 10 residents, 10 leases");
  const committed = page.waitForResponse((r) => r.url().endsWith("/api/import") && r.request().method() === "POST" && (r.request().postData() ?? "").includes('"commit"'));
  await page.getByRole("button", { name: /^Import \d+ records$/ }).click();
  const batch = ((await (await committed).json()) as { batch: string }).batch;
  await expect(page.getByRole("heading", { name: /^Imported \d+ records$/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // 3. Rules: sized from the import, each suggestion decided on its own.
  await expect(page.getByRole("heading", { name: "Approval rules", exact: true })).toBeVisible();
  await expect(page.getByText(/Sized from 12 imported units/)).toBeVisible();
  const maintenance = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Maintenance spend" }) });
  await expect(maintenance).toContainText(/Median completed work order \$[\d,]+ across [\d,]+ jobs → auto-approve up to \$[\d,]+/);
  await expect(maintenance).toContainText(/Computed from your records · (High|Medium) confidence/);
  const before = (await maintenance.locator("dd").first().innerText()).trim();
  await maintenance.getByRole("button", { name: /Accept the suggested maintenance spend limit/ }).click();
  await expect(maintenance.getByText("Saved")).toBeVisible();
  const concession = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Concession" }) });
  if (await concession.getByRole("button", { name: "Keep current" }).isVisible()) {
    await concession.getByRole("button", { name: "Keep current" }).click();
    await expect(concession.getByText("Kept as is")).toBeVisible();
  }
  await page.getByRole("button", { name: /^Continue with 1 saved/ }).click();

  // 4. Team: the principal can't add people (an admin does), and the flow says so.
  await expect(page.getByRole("heading", { name: "Your team", exact: true })).toBeVisible();
  await expect(page.getByText(/No email is sent/)).toBeVisible();
  await expect(page.getByText(/Only an administrator adds people/)).toBeVisible();
  await page.getByRole("button", { name: "Skip this step" }).click();

  // 5. Check: Data Health over the imported records, then the summary.
  await expect(page.getByRole("heading", { name: "Check and finish", exact: true })).toBeVisible();
  const checked = page.waitForResponse((r) => r.url().endsWith("/api/onboarding/check"));
  await page.getByRole("button", { name: "Run the checks" }).click();
  const issues = ((await (await checked).json()) as { issues: { id: string }[] }).issues;
  await expect(page.getByTestId("check-result")).toContainText(/rules (ran|found)/);
  await expect(page.getByRole("heading", { name: "Lakeside Property Co.: your portfolio is ready" })).toBeVisible();
  const summary = page.getByTestId("onboarding-summary");
  await expect(summary).toContainText("2 properties, 12 units, 10 residents, 10 leases");
  await expect(summary).toContainText("1 approval limit, 0 agent settings");
  await expect(page.getByText(/operating in AZ, TX · about 420 units/)).toBeVisible();

  // Progress is kept: a reload resumes at the same step, with earlier steps marked.
  await reload(page);
  await expect(page.getByRole("heading", { name: "Check and finish", exact: true })).toBeVisible();
  const steps = page.getByRole("navigation", { name: "Setup steps" });
  await expect(steps.getByRole("button", { name: /Company\s*Done/ })).toBeVisible();
  await expect(steps.getByRole("button", { name: /Team\s*Skipped/ })).toBeVisible();
  const setup = await page.evaluate(() => JSON.parse(localStorage.getItem("pn_setup") ?? "{}"));
  expect(setup).toMatchObject({ company: true, import: true, payments: true });

  expect(aiCalls).toBe(0);
  expect(errors).toEqual([]);

  // Clean up the shared workspace: the limit back, the issues dismissed, the import undone.
  const m = before.match(/auto up to \$([\d,]+)(?: · owner above \$([\d,]+))?/);
  const toCents = (s?: string) => (s ? Number(s.replace(/,/g, "")) * 100 : null);
  expect((await api(page, "patch", "/api/ai/policies/pol-org-maintenance-spend", { limit_cents: toCents(m?.[1]), owner_approval_over_cents: toCents(m?.[2]) })).status()).toBe(200);
  for (const i of issues) await api(page, "post", `/api/ai/data-health/issues/${encodeURIComponent(i.id)}`, { action: "dismiss", note: "e2e cleanup" });
  expect((await api(page, "post", "/api/import/undo", { batch })).status()).toBe(200);
});

test("AI on: a stubbed model names the source of a file with an unhelpful name, labelled with its confidence", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  let sent = "";
  await page.route("**/api/onboarding/detect", async (route) => {
    sent = route.request().postData() ?? "";
    const id = (JSON.parse(sent) as { files: { id: string }[] }).files[0]!.id;
    await route.fulfill({ json: { live: true, source: "Scripted model", model: "claude-sonnet-5", usage: { tokensIn: 600, tokensOut: 90, costCents: 0.2, latencyMs: 700 }, detections: [{ id, tool: "appfolio", kind: "residents", confidence: 0.91, reason: "Emails and Phone Numbers columns are how AppFolio names its tenant directory." }] } });
  });
  let suggestCalls = 0;
  await page.route("**/api/import/ai", async (route) => {
    suggestCalls++;
    await route.fulfill({ json: { live: true, source: "Scripted model", model: "claude-sonnet-5", estimate: { tokensIn: 900, tokensOut: 100, costCents: 0.3 }, mappings: [], suggestions: [], notes: [] } });
  });
  await go(page, "/app/onboarding");
  await page.getByRole("navigation", { name: "Setup steps" }).getByRole("button", { name: /Bring your data/ }).click();
  await expect(page.getByRole("heading", { name: "Bring your data", exact: true })).toBeVisible();
  const more = page.getByRole("button", { name: "Import more files" });
  if (await more.isVisible()) await more.click();
  const ai = page.getByRole("switch", { name: /Use AI to identify files/ });
  if ((await ai.getAttribute("aria-checked")) !== "true") await ai.click();

  await page.getByLabel("Choose export files").setInputFiles({ name: "export (7).csv", mimeType: "text/csv", buffer: readFileSync(DIRECTORY) });
  const detection = page.getByTestId("file-detection");
  await expect(detection).toContainText("AI");
  await expect(detection).toContainText("High confidence · 91%");
  await expect(page.getByText("Emails and Phone Numbers columns are how AppFolio names its tenant directory.")).toBeVisible();
  await expect(page.getByLabel("Source tool of export (7).csv")).toHaveValue("appfolio");

  // Only names, headers and three rows went to the model; never the rest of the file.
  const body = JSON.parse(sent) as { files: { name: string; headers: string[]; samples: string[][] }[] };
  expect(body.files).toHaveLength(1);
  expect(body.files[0]!.samples.length).toBeLessThanOrEqual(3);
  const lastRow = readFileSync(DIRECTORY, "utf8").trim().split("\n").at(-1)!.split(",")[2]!;
  expect(sent).not.toContain(lastRow);

  await page.getByRole("button", { name: "Match columns" }).click();
  await expect(page.getByLabel("Column for Tenant name")).toBeVisible();
  expect(suggestCalls).toBe(1);
  expect(errors).toEqual([]);
});

test("roles that don't set up the org see what the flow covers, read-only", async ({ page, context }) => {
  await as(context, "marcus");
  await go(page, "/app/onboarding");
  await expect(page.getByText(/Setting up the portfolio is done by a Principal, Regional manager or Administrator/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and continue" })).toHaveCount(0);
  await as(context, "daniel");
});
