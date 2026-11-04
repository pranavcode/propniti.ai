import { expect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// Data import: an AppFolio rent roll end to end with rules only (preview, import, result links,
// undo), and the AI path with the model stubbed at the network edge (no paid call), checking that
// only headers and a few rows go out and that every AI suggestion waits for acceptance.

test("imports an AppFolio rent roll with rules only, then undoes it", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await go(page, `${BASE}/app/settings/import`);
  await page.getByRole("radio", { name: /AppFolio/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const ai = page.getByRole("switch", { name: /Use AI to help map and clean up/ });
  if ((await ai.getAttribute("aria-checked")) === "true") await ai.click();
  await expect(page.getByText(/Rules only: columns are matched by preset and name/)).toBeVisible();
  let aiCalls = 0;
  await page.route("**/api/import/ai", (r) => { aiCalls++; return r.abort(); });

  await page.getByLabel("Choose export files").setInputFiles(["public/samples/appfolio-rent-roll.csv", "public/samples/appfolio-tenant-directory.csv"]);
  await expect(page.getByText(/matches the typical AppFolio Rent Roll layout/)).toBeVisible();
  await expect(page.getByText(/matches the typical AppFolio Tenant Directory layout/)).toBeVisible();
  await expect(page.getByText(/2 property headings used as property names/)).toBeVisible();
  await page.getByRole("button", { name: "Match columns" }).click();

  await expect(page.getByLabel("Column for Tenant name")).toHaveValue("2");
  await expect(page.getByText("Preset").first()).toBeVisible();
  await page.getByRole("button", { name: /Review values/ }).click();

  // The ALL-CAPS name is a rules suggestion that waits for a person.
  const fixes = page.getByRole("region", { name: "Suggested fixes" });
  await expect(fixes.getByText(/"MORA, HANNAH" → "Mora, Hannah"/)).toBeVisible();
  await fixes.getByRole("button", { name: /Accept all/ }).click();
  await expect(page.getByText(/Fixed by rules: .*Unit numbers cleaned/)).toBeVisible();
  await expect(page.getByText("0 errors")).toBeVisible();
  await page.getByRole("button", { name: /Preview import/ }).click();

  await expect(page.getByTestId("import-summary")).toContainText("This import adds 2 properties, 12 units, 10 residents, 10 leases");
  await expect(page.getByText("First properties to add")).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ records$/ }).click();

  await expect(page.getByRole("heading", { name: /^Imported \d+ records$/ })).toBeVisible();
  await expect(page.getByTestId("import-result")).toContainText("2 properties, 12 units");
  const propertyLink = page.getByRole("link", { name: "Maple Court Apartments", exact: true });
  await expect(propertyLink).toHaveAttribute("href", /\/app\/properties\/pro-i[0-9a-f]{10}-1$/);
  const href = (await propertyLink.getAttribute("href"))!;

  // The imported property opens like any other.
  const tab = await context.newPage();
  await go(tab, `${BASE}${href}`);
  await expect(tab.getByRole("heading", { name: "Maple Court Apartments" })).toBeVisible();
  await tab.close();

  await page.getByRole("button", { name: "Undo import" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByText("Import undone")).toBeVisible();
  const gone = await page.request.get(`${BASE}/api/e/properties/${href.split("/").pop()}`);
  expect(gone.status()).toBe(404);
  expect(aiCalls).toBe(0);
  expect(errors).toEqual([]);
});

test("AI on: suggestions come from a stubbed model, show their source, and apply only when accepted", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  let sent = "";
  await page.route("**/api/import/ai", async (route) => {
    sent = route.request().postData() ?? "";
    const fileId = (JSON.parse(sent) as { files: { id: string }[] }).files[0]!.id;
    await route.fulfill({
      json: {
        live: true, source: "Scripted model", model: "claude-sonnet-5", usage: { tokensIn: 1400, tokensOut: 220, costCents: 0.5, latencyMs: 800 }, estimate: { tokensIn: 1400, costCents: 0.5 },
        mappings: [{ file: fileId, field: "rent", col: 3, confidence: 0.88, reason: "Monthly amounts in the range of rents" }],
        suggestions: [{ id: `ai:${fileId}:rent:replace:4:14500`, file: fileId, field: "rent", kind: "replace", from: "14500", to: "1450", line: 4, reason: "Likely an extra zero", confidence: 0.81, source: "ai", rows: 1 }],
        notes: ["Rents look consistent apart from one likely typo."],
      },
    });
  });
  await go(page, `${BASE}/app/settings/import`);
  await page.getByRole("radio", { name: /Other \/ spreadsheet/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const ai = page.getByRole("switch", { name: /Use AI to help map and clean up/ });
  if ((await ai.getAttribute("aria-checked")) !== "true") await ai.click();
  await expect(page.getByText(/Never the whole file/)).toBeVisible();

  const at = `"50 Juniper Ln, Austin, TX 78702"`;
  const rows = ["Community,Apt,Occupant,Contract Amount,Lease Begin,Lease End,Address", `Juniper Flats,1,Ana Lopez,1400,2026-01-01,2026-12-31,${at}`, `Juniper Flats,2,Bo Kim,1425,2026-02-01,2027-01-31,${at}`, `Juniper Flats,3,Cy Do,14500,2026-03-01,2027-02-28,${at}`];
  for (let i = 4; i <= 9; i++) rows.push(`Juniper Flats,${i},Person${i} Row${i},1450,2026-04-01,2027-03-31,${at}`);
  rows.push(`Juniper Flats,10,Zed SECRETROW,1450,2026-04-01,2027-03-31,${at}`);
  await page.getByLabel("Choose export files").setInputFiles({ name: "juniper.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.getByLabel("Record type in juniper.csv").selectOption("rent_roll");
  await page.getByRole("button", { name: "Match columns" }).click();

  // Only headers, five rows and flagged cells went to the model.
  const body = JSON.parse(sent) as { files: { headers: string[]; samples: unknown[] }[] };
  expect(body.files[0]!.headers).toEqual(["Community", "Apt", "Occupant", "Contract Amount", "Lease Begin", "Lease End", "Address"]);
  expect(body.files[0]!.samples).toHaveLength(5);
  expect(sent).not.toContain("SECRETROW");

  const panel = page.getByRole("region", { name: "AI column suggestions" });
  await expect(panel.getByText(/"Contract Amount" → Monthly rent/)).toBeVisible();
  await expect(panel.getByText(/High confidence · 88%/)).toBeVisible();
  await expect(page.getByLabel("Column for Monthly rent")).toHaveValue("");
  await panel.getByRole("button", { name: /Accept all/ }).click();
  await expect(page.getByLabel("Column for Monthly rent")).toHaveValue("3");
  await page.getByRole("button", { name: /Review values/ }).click();

  const fixes = page.getByRole("region", { name: "Suggested fixes" });
  const suggestion = fixes.getByRole("listitem").filter({ hasText: '"14500" → "1450"' });
  await expect(suggestion.getByText(/^AI/)).toBeVisible();
  await expect(suggestion.getByText(/Likely an extra zero/)).toBeVisible();
  await expect(page.getByText(/Rent 14500.00 is more than 3×/)).toBeVisible();
  await suggestion.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText(/Rent 14500.00 is more than 3×/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "AI notes" })).toContainText("one likely typo");
  await page.getByRole("button", { name: /Preview import/ }).click();

  await expect(page.getByTestId("import-summary")).toContainText("This import adds 1 property, 10 units, 10 residents and 10 leases.");
  await page.getByRole("button", { name: /^Import \d+ records$/ }).click();
  await expect(page.getByRole("heading", { name: /^Imported \d+ records$/ })).toBeVisible();
  expect(errors).toEqual([]);
});
