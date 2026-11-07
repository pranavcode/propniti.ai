import { expect, test, type Page } from "@playwright/test";
import { as, BASE, go, ownWorkspace, watch } from "./helpers";

// Lakeside Property Co., the empty demo org, from zero: sign in as its principal, land in Guided
// setup, import the AppFolio sample files, invite the property manager to the imported properties,
// switch to her and see just those. Summit's data never shows in Lakeside and Lakeside's import
// never shows in Summit, in the same browser and visitor workspace. Undo empties Lakeside again.
// Runs in a workspace of its own; the model is cut off at the network edge (rules only).

const SUMMIT = /Summit Residential|Lofts at Riverside|Barton Creek|Bluebonnet|Lone Star Plumbing/;
const IMPORTED = ["Maple Court Apartments", "Cedar Row Townhomes"];
const total = async (page: Page, entity: string) => ((await (await page.request.get(`${BASE}/api/e/${entity}?size=25`)).json()) as { total: number }).total;

test("an empty company: guided setup imports sample files, invites the property manager, and she sees only those properties", async ({ page, context }) => {
  test.setTimeout(300_000);
  await ownWorkspace(context);
  const errors = watch(page);
  await page.route("**/api/onboarding/detect", (r) => r.abort());
  await page.route("**/api/import/ai", (r) => r.abort());

  // Sign in from the third group of the people list.
  await go(page, "/login?switch=1");
  const group = page.getByRole("group", { name: /New company \(empty\)/ });
  await expect(group).toContainText("Start from zero: import files and set up");
  await group.getByRole("radio", { name: /Alex Morgan/ }).click();
  await page.getByRole("button", { name: "Sign in as Alex Morgan" }).click();
  await page.waitForURL("**/app/onboarding");

  // Nothing of Summit's: no properties, people, vendors, owners, work, bills or messages.
  for (const e of ["properties", "units", "residents", "leases", "vendors", "owners", "owner_entities", "work_orders", "bills", "message_threads", "tasks"]) expect(await total(page, e), e).toBe(0);

  // 1. Company: the name comes from the org.
  await expect(page.getByLabel("Company name")).toHaveValue("Lakeside Property Co.");
  await page.getByRole("button", { name: "TX", exact: true }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 2. Bring your data: the sample set for an empty company adds owners and the property list.
  await expect(page.getByRole("heading", { name: "Bring your data", exact: true })).toBeVisible();
  const ai = page.getByRole("switch", { name: /Use AI to identify files/ });
  if ((await ai.getAttribute("aria-checked")) === "true") await ai.click();
  await page.getByRole("button", { name: "Try sample files" }).click();
  await expect(page.getByLabel("Record type in appfolio-owner-directory.csv")).toHaveValue("owners");
  await expect(page.getByLabel("Record type in appfolio-property-directory.csv")).toHaveValue("properties");
  await page.getByRole("button", { name: "Match columns" }).click();
  await page.getByRole("button", { name: /Review values/ }).click();
  const fixes = page.getByRole("region", { name: "Suggested fixes" });
  if (await fixes.isVisible()) await fixes.getByRole("button", { name: /Accept all/ }).click();
  await page.getByRole("button", { name: /Preview import/ }).click();
  await expect(page.getByTestId("import-summary")).toContainText("2 properties");
  const committed = page.waitForResponse((r) => r.url().endsWith("/api/import") && (r.request().postData() ?? "").includes('"commit"'));
  await page.getByRole("button", { name: /^Import \d+ records$/ }).click();
  const batch = ((await (await committed).json()) as { batch: string }).batch;
  await expect(page.getByRole("heading", { name: /^Imported \d+ records$/ })).toBeVisible();
  expect(await total(page, "properties")).toBe(2);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // 3. Rules: skipped for now.
  await expect(page.getByRole("heading", { name: "Approval rules", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Continue/ }).click();

  // 4. Team: filled in for Maya Chen, scoped to the imported properties.
  await expect(page.getByRole("heading", { name: "Your team", exact: true })).toBeVisible();
  await expect(page.getByText(/the form is filled in for Maya Chen/)).toBeVisible();
  const form = page.getByRole("form", { name: "Add a person" });
  await expect(form.locator("input[name=email]")).toHaveValue("maya@propniti.demo");
  for (const name of IMPORTED) await expect(form.getByRole("checkbox", { name: new RegExp(`^${name}`) })).toBeChecked();
  await form.getByRole("button", { name: "Add to team" }).click();
  await expect(page.getByRole("region", { name: "Added during setup" })).toContainText("Maya Chen");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check and finish", exact: true })).toBeVisible();

  // Lakeside's lists hold only what was imported.
  await go(page, "/app/properties");
  for (const name of IMPORTED) await expect(page.getByRole("main")).toContainText(name);
  await expect(page.getByRole("main")).not.toContainText(SUMMIT);

  // 5. Switch to Maya: her properties are the two she was invited to.
  await as(context, "maya");
  await go(page, "/app/properties");
  await expect(page.getByRole("main")).toContainText(IMPORTED[0]!);
  expect(await total(page, "properties")).toBe(2);
  await go(page, "/app/today");
  await expect(page.getByRole("heading", { name: /Maya/ })).toBeVisible();
  await expect(page.getByTestId("nothing-yet")).toHaveCount(0);

  // Summit, in the same browser and visitor workspace, never sees Lakeside's import.
  await as(context, "daniel");
  expect(await total(page, "properties")).toBe(30);
  const search = (await (await page.request.get(`${BASE}/api/e/properties?q=Maple%20Court`)).json()) as { total: number };
  expect(search.total).toBe(0);

  // Undo the import as Alex: Lakeside is empty again and Maya has nothing to see.
  await as(context, "alex");
  expect((await page.request.post(`${BASE}/api/import/undo`, { headers: { Origin: BASE }, data: { batch } })).status()).toBe(200);
  expect(await total(page, "properties")).toBe(0);
  await as(context, "maya");
  await go(page, "/app/properties");
  await expect(page.getByTestId("nothing-yet").or(page.getByText("Nothing here yet — import your data"))).toBeVisible();
  expect(errors).toEqual([]);
});

test("an empty company's pages say how data arrives instead of showing broken zeros", async ({ page, context }) => {
  await ownWorkspace(context);
  await as(context, "alex");
  const errors = watch(page);
  // Guided setup is home until it's finished.
  await go(page, "/app");
  await page.waitForURL("**/app/onboarding");
  for (const [path, text] of [["/app/inbox", "Nothing needs you right now"], ["/app/portfolio", "Nothing here yet — import your data"], ["/app/data-health", "Nothing here yet — import your data"], ["/app/reports", "Nothing here yet — import your data"], ["/app/units", "Nothing here yet — import your data"], ["/app/residents", "Nothing here yet — import your data"]] as const) {
    await go(page, path);
    await expect(page.getByRole("main"), path).toContainText(text);
    await expect(page.getByRole("main"), path).not.toContainText(SUMMIT);
  }
  await expect(page.getByRole("link", { name: "Start guided setup" }).first()).toHaveAttribute("href", "/app/onboarding");
  // Maya before any invite: nothing assigned yet.
  await as(context, "maya");
  await go(page, "/app/today");
  await expect(page.getByTestId("nothing-yet")).toBeVisible();
  expect(errors).toEqual([]);
});
