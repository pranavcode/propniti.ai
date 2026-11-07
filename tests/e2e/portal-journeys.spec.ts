import { expect as baseExpect, test, type Page } from "@playwright/test";
import { as, BASE, go, ownWorkspace, watch } from "./helpers";

// The applicant and resident journeys across personas: the portal user acts with a sample file,
// staff advance the same record, and the portal tracker shows each step. Each test runs in its own
// workspace so the seeded starting states (a started application, an active lease) hold.
// SHOTS=<dir> also saves phone (390) and desktop (1440) screenshots of the key screens.

test.setTimeout(400_000);
const expect = baseExpect.configure({ timeout: 60_000 });

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS;
  if (!dir) return;
  const size = page.viewportSize()!;
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize(size);
}

// Staff steps through the named-action API, as the record page's buttons do.
async function act(page: Page, entity: string, id: string, action: string, body: unknown = {}) {
  const res = await page.request.post(`${BASE}/api/e/${entity}/${encodeURIComponent(id)}/actions/${action}`, { headers: { Origin: BASE }, data: body });
  expect(res.status(), await res.text()).toBe(200);
}

async function confirmAction(page: Page, label: string, toast: RegExp) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(toast).first()).toBeVisible();
}

test("applicant uploads sample documents, staff screen and approve, the applicant signs and move-in is set", async ({ page, context }) => {
  await ownWorkspace(context);
  await as(context, "applicant");
  const errors = watch(page);
  await go(page, `${BASE}/portal/applicant`);
  await expect(page.getByText("Finish and submit your application.")).toBeVisible();
  await expect(page.getByText("Still needed: Photo ID, Pay stub, Application fee.")).toBeVisible();
  await shot(page, "applicant-1-start");

  await go(page, `${BASE}/portal/applicant/documents`);
  for (const doc of ["Photo ID", "Pay stub"]) {
    const row = page.locator(`li[data-doc="${doc}"]`);
    await row.getByRole("button", { name: `Try a sample file for ${doc}` }).click();
    await expect(row.getByText("SAMPLE", { exact: true })).toBeVisible();
    if (doc === "Photo ID") await shot(page, "applicant-2-sample-loaded");
    await row.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(`${doc} received.`).first()).toBeVisible();
    await expect(row.getByText("Received", { exact: true })).toBeVisible();
  }

  await go(page, `${BASE}/portal/applicant/pay`);
  await page.getByRole("button", { name: /^Pay \$55/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Pay \$55/ }).click();
  await expect(page.getByText(/application fee paid/).first()).toBeVisible();

  await go(page, `${BASE}/portal/applicant`);
  await expect(page.getByText("Ready to submit")).toBeVisible();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText(/Application submitted/).first()).toBeVisible();
  await expect(page.getByText("Application received")).toBeVisible();

  // Leasing agent: the documents are on the application; order screening and record it.
  await as(context, "lena");
  await go(page, `${BASE}/app/leasing/applications/app-0001?tab=documents`);
  await expect(page.getByText("SAMPLE photo ID.png").first()).toBeVisible();
  await shot(page, "applicant-3-staff-documents");
  await confirmAction(page, "Order screening", /Screening ordered/);
  await confirmAction(page, "Record screening results", /Screening recorded/);

  await as(context, "applicant");
  await go(page, `${BASE}/portal/applicant`);
  await expect(page.getByText("Waiting on a decision")).toBeVisible();
  await expect(page.getByText("Background check").locator("..").getByText("Done")).toBeVisible();

  // Broker decides with conditions the applicant sees; the agent sends the lease.
  await as(context, "rachel");
  await go(page, `${BASE}/app/leasing/applications/app-0001`);
  await page.getByLabel("Reason or conditions").fill("A guarantor co-signs the lease");
  await page.getByRole("button", { name: "Approve with conditions" }).click();
  await expect(page.getByText(/Application conditional/).first()).toBeVisible();
  await as(context, "applicant");
  await go(page, `${BASE}/portal/applicant`);
  await expect(page.getByText("Conditions: A guarantor co-signs the lease").first()).toBeVisible();
  await as(context, "lena");
  await go(page, `${BASE}/app/leasing/applications/app-0001`);
  await confirmAction(page, "Send lease to sign", /Lease sent/);

  // The applicant signs; the agent confirms the move-in day.
  await as(context, "applicant");
  await go(page, `${BASE}/portal/applicant`);
  await expect(page.getByText("Your lease is ready to sign")).toBeVisible();
  await shot(page, "applicant-4-lease-ready");
  await page.getByRole("button", { name: "Read and sign lease" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type your full name").fill("Priyanka Rao");
  await dialog.getByLabel(/typing my name is my electronic signature/).check();
  await dialog.getByRole("button", { name: "Sign lease" }).click();
  await expect(page.getByText(/Lease signed\. The office confirms/).first()).toBeVisible();

  await as(context, "lena");
  await go(page, `${BASE}/app/leasing/applications/app-0001`);
  await confirmAction(page, "Schedule move-in", /Move-in scheduled for/);
  await as(context, "applicant");
  await go(page, `${BASE}/portal/applicant`);
  await expect(page.getByText("Move-in is scheduled")).toBeVisible();
  await expect(page.locator('li[data-state="current"]')).toHaveCount(0);
  await shot(page, "applicant-5-move-in");
  expect(errors).toEqual([]);
});

test("resident reports a leak with a sample photo, staff fix it and the resident rates it", async ({ page, context }) => {
  await ownWorkspace(context);
  await as(context, "resident");
  const errors = watch(page);
  await go(page, `${BASE}/portal/resident/requests?new=1`);
  await page.getByRole("button", { name: "Leak under the sink" }).click();
  await expect(page.getByAltText("Photo 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("What's wrong?")).toHaveValue(/leaking under the kitchen sink/);
  await expect(page.getByLabel("AI first read").getByText("Plumbing").first()).toBeVisible();
  await shot(page, "resident-1-request-sample");
  await page.getByRole("button", { name: "Send request" }).click();
  await page.waitForURL(/wo=WO-\d+/);
  const wo = new URL(page.url()).searchParams.get("wo")!;
  const card = page.locator(`li#${wo}`);
  await expect(card.getByText("Waiting for the team")).toBeVisible();

  await as(context, "tom");
  await go(page, `${BASE}/app/maintenance/work-orders/${wo}`);
  await expect(page.getByText(/leaking under the kitchen sink/).first()).toBeVisible();
  await act(page, "work_orders", wo, "work_orders.dispatch", { vendor_id: null, assignee_id: "t-andre", priority: "Urgent", category: "Plumbing" });
  await act(page, "work_orders", wo, "work_orders.set_status", { status: "Scheduled" });

  await as(context, "resident");
  await go(page, `${BASE}/portal/resident/requests?wo=${wo}`);
  await expect(card.getByText("Visit booked")).toBeVisible();
  await shot(page, "resident-2-request-scheduled");

  await as(context, "tom");
  await act(page, "work_orders", wo, "work_orders.set_status", { status: "In progress" });
  await act(page, "work_orders", wo, "work_orders.set_status", { status: "Completed" });

  await as(context, "resident");
  await go(page, `${BASE}/portal/resident/requests?wo=${wo}`);
  await expect(card.getByText("How did it go?")).toBeVisible();
  await card.getByRole("radio", { name: "5 stars" }).click();
  await card.getByRole("button", { name: "Send rating" }).click();
  await expect(page.getByText("Thanks for the rating!").first()).toBeVisible();
  await expect(card.getByText("Thanks for the rating.")).toBeVisible();
  await shot(page, "resident-3-request-rated");
  expect(errors).toEqual([]);
});

test("resident sends a sample declarations page, staff reject it, the resident resends and staff verify", async ({ page, context }) => {
  await ownWorkspace(context);
  await as(context, "resident");
  const errors = watch(page);
  const insurance = page.locator("#insurance");
  const upload = async () => {
    await go(page, `${BASE}/portal/resident/lease`);
    await insurance.getByRole("button", { name: /declarations page/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Try a sample file/ }).click();
    await expect(dialog.getByLabel("Policy number")).toHaveValue("SMP-RI-2027-0412");
    await dialog.getByRole("button", { name: "Confirm and send" }).click();
    await expect(page.getByText(/Received\. Your policy shows as pending/).first()).toBeVisible();
    await expect(insurance.getByText("Waiting for the office")).toBeVisible();
  };
  await upload();
  await shot(page, "resident-4-insurance-pending");

  await as(context, "marcus");
  await go(page, `${BASE}/app/residents/insurance/ri-L-10329-2027-11-01`);
  await expect(page.getByRole("link", { name: "SAMPLE renters insurance declarations.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByLabel("Why can't it be verified?").fill("The named insured isn't on this lease");
  await page.getByRole("button", { name: "Reject policy" }).click();
  await expect(page.getByText(/rejected\. The resident sees why/).first()).toBeVisible();

  await as(context, "resident");
  await go(page, `${BASE}/portal/resident/lease`);
  await expect(insurance.getByText("The office couldn't verify this policy")).toBeVisible();
  await expect(insurance.getByText(/named insured isn't on this lease/).first()).toBeVisible();
  await shot(page, "resident-5-insurance-rejected");
  await upload();

  await as(context, "marcus");
  await go(page, `${BASE}/app/residents/insurance/ri-L-10329-2027-11-01`);
  await confirmAction(page, "Verify policy", /verified\./);

  await as(context, "resident");
  await go(page, `${BASE}/portal/resident/lease`);
  await expect(insurance.getByText("Verified", { exact: true }).first()).toBeVisible();
  await shot(page, "resident-6-insurance-verified");
  expect(errors).toEqual([]);
});

test("resident counters, then gives notice, and staff book the move-out inspection", async ({ page, context }) => {
  await ownWorkspace(context);
  await as(context, "resident");
  const errors = watch(page);
  await go(page, `${BASE}/portal/resident/lease`);
  await page.getByRole("button", { name: "Counter" }).click();
  await page.getByRole("dialog").getByLabel("Your counter-offer").fill("12 months at my current rent");
  await page.getByRole("dialog").getByRole("button", { name: "Send counter-offer" }).click();
  await expect(page.getByText(/Counter-offer sent\. The office replies/).first()).toBeVisible();
  await expect(page.getByText("You asked: 12 months at my current rent.")).toBeVisible();

  await page.getByRole("button", { name: "Give move-out notice" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send notice" }).click();
  await expect(page.getByText(/Notice received\. Your move-out date is/).first()).toBeVisible();
  await expect(page.locator("#move-out").getByText("Notice received")).toBeVisible();

  await as(context, "marcus");
  await go(page, `${BASE}/app/leases/L-10329`);
  await confirmAction(page, "Schedule move-out inspection", /Move-out inspection scheduled/);
  await as(context, "resident");
  await go(page, `${BASE}/portal/resident/lease#move-out`);
  await expect(page.locator("#move-out").getByText("Inspection scheduled").first()).toBeVisible();
  await shot(page, "resident-7-move-out");
  expect(errors).toEqual([]);
});
