import { expect, test, type Page } from "@playwright/test";
import { as, BASE, go } from "./helpers";

// The sign-in page: one card with the email + password form and a compact one-click people list. Each test starts signed
// out (storageState carries the workspace cookie only, no pn_as).

const persona = async (page: Page) => (await page.context().cookies(BASE)).find((c) => c.name === "pn_as")?.value;
const email = (page: Page) => page.getByLabel("Email", { exact: true });
const password = (page: Page) => page.getByLabel("Password", { exact: true });
// Match the path, not a glob: "**/app/x" also matches "/login?next=/app/x" before sign-in finishes.
const landed = (page: Page, path: string) => page.waitForURL((u) => u.pathname === path);

test.describe("sign in", () => {
  test("clicking a person fills the form, and Enter signs in", async ({ page }) => {
    await go(page, "/login");
    await page.getByRole("radio", { name: "Marcus Bell, Property manager" }).click();
    await expect(email(page)).toHaveValue("marcus@propniti.demo");
    await expect(password(page)).toHaveValue("propniti-demo");
    await expect(page.getByRole("radio", { name: "Marcus Bell, Property manager" })).toHaveAttribute("aria-checked", "true");
    const submit = page.getByRole("button", { name: "Sign in as Marcus Bell" });
    await expect(submit).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/app/today");
    expect(await persona(page)).toBe("marcus");
  });

  test("the people list and the form both fit the first screen; arrow keys move through the list", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await go(page, "/login");
    const picker = page.getByRole("radiogroup", { name: "Pick a person" });
    for (const box of [await picker.boundingBox(), await page.getByRole("button", { name: "Sign in", exact: true }).boundingBox()]) {
      expect(box && box.y >= 0 && box.y + box.height <= 900).toBe(true);
    }
    await expect(picker.getByRole("radio")).toHaveCount(13);

    await page.getByRole("radio", { name: "Daniel Reyes, Principal" }).focus();
    await page.keyboard.press("ArrowDown");
    const priya = page.getByRole("radio", { name: "Priya Shah, Regional manager" });
    await expect(priya).toBeFocused();
    await expect(priya).toHaveAttribute("aria-checked", "true");
    await expect(email(page)).toHaveValue("priya@propniti.demo");
  });

  test("one card: the people list sits beside the form on desktop and above it on a phone", async ({ page }) => {
    const boxes = async () => {
      const [title, list, button] = await Promise.all([
        page.getByRole("heading", { name: "Sign in", exact: true }).boundingBox(),
        page.getByRole("radiogroup", { name: "Pick a person" }).boundingBox(),
        page.getByRole("button", { name: "Sign in", exact: true }).boundingBox(),
      ]);
      return { title: title!, list: list!, button: button! };
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    await go(page, "/login");
    let b = await boxes();
    expect(b.list.x).toBeGreaterThan(b.button.x + b.button.width);
    expect(b.list.y).toBeLessThan(b.button.y);

    await page.setViewportSize({ width: 390, height: 844 });
    b = await boxes();
    expect(b.list.y).toBeGreaterThan(b.title.y);
    expect(b.list.y + b.list.height).toBeLessThan(b.button.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("typing an email shows who it is", async ({ page }) => {
    await go(page, "/login");
    await email(page).fill("grace@propniti.demo");
    await expect(page.locator("#signin-who")).toContainText("Grace Kim");
    await expect(page.getByRole("button", { name: "Sign in as Grace Kim" })).toBeVisible();
  });

  test("?as= prefills the person and a deep link lands where it was going", async ({ page }) => {
    await go(page, "/login?as=grace&next=/app/payables/bills");
    await expect(email(page)).toHaveValue("grace@propniti.demo");
    await expect(password(page)).toHaveValue("propniti-demo");
    await page.getByRole("button", { name: "Sign in as Grace Kim" }).click();
    await landed(page, "/app/payables/bills");
    expect(await persona(page)).toBe("grace");
  });

  test("a wrong password says so, and nothing is signed in", async ({ page }) => {
    await go(page, "/login");
    await email(page).fill("marcus@propniti.demo");
    await password(page).fill("letmein");
    await page.getByRole("button", { name: "Sign in as Marcus Bell" }).click();
    await expect(page.getByRole("alert")).toHaveText("Wrong password — the demo password is shown above.");
    await expect(password(page)).toHaveAttribute("aria-invalid", "true");
    expect(await persona(page)).toBeUndefined();

    await email(page).fill("mallory@propniti.demo");
    await password(page).fill("propniti-demo");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("No demo account with that email — pick a person from the list.");
  });

  test("double-clicking a person signs in straight away", async ({ page }) => {
    await go(page, "/login");
    await page.getByRole("radio", { name: "Tom Alvarez, Maintenance supervisor" }).dblclick();
    await page.waitForURL("**/app/maintenance");
    expect(await persona(page)).toBe("tom");
  });

  test("a signed-in visitor can continue or switch, and sign-out preselects them", async ({ page }) => {
    await go(page, "/login?as=lena");
    await page.getByRole("button", { name: "Sign in as Lena Ortiz" }).click();
    await page.waitForURL("**/app/leasing/today");

    await go(page, "/login");
    await expect(page.getByText("You're signed in as")).toBeVisible();
    // Headings don't skip a level: h1, then an h2 (hidden) before the people list's h3.
    expect(await page.locator("h1, h2, h3").evaluateAll((hs) => hs.map((h) => h.tagName))).toEqual(expect.arrayContaining(["H1", "H2", "H3"]));
    await expect(page.getByRole("heading", { level: 2, name: "Signed in" })).toBeAttached();
    await page.getByRole("link", { name: "Switch person" }).click();
    await expect(email(page)).toBeVisible();
    await go(page, "/login");
    await page.getByRole("link", { name: "Continue as Lena Ortiz" }).click();
    await page.waitForURL("**/app/leasing/today");

    // Signing out clears the persona; the next visit preselects the last person.
    await page.context().clearCookies({ name: "pn_as" });
    await go(page, "/login");
    await expect(email(page)).toHaveValue("lena@propniti.demo");
    await expect(page.getByRole("button", { name: "Sign in as Lena Ortiz" })).toBeFocused();
  });
});

test("the banner's Switch opens the people list on the current person, and choosing one switches", async ({ page, context }) => {
  await as(context, "marcus");
  await go(page, "/app/today");
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /Marcus Bell/ })).toBeFocused();
  await page.getByRole("menuitem", { name: /Priya Shah/ }).click();
  await landed(page, "/app");
  expect(await persona(page)).toBe("priya");
});

test.describe("sign in without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the form posts and lands on the persona's home; errors come back to the page", async ({ page }) => {
    await page.goto(BASE + "/login?next=/app/properties");
    await email(page).fill("priya@propniti.demo");
    await password(page).fill("wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/login\?error=password/);
    await expect(page.getByRole("alert")).toHaveText("Wrong password — the demo password is shown above.");
    await expect(email(page)).toHaveValue("priya@propniti.demo");

    await password(page).fill("propniti-demo");
    await page.getByRole("button", { name: "Sign in as Priya Shah" }).click();
    await landed(page, "/app/properties");
    expect(await persona(page)).toBe("priya");
  });

  test("a person still signs in with one click", async ({ page }) => {
    await page.goto(BASE + "/login");
    await page.getByRole("radio", { name: "Helen Carter, Owner · Bluebonnet Residential Fund II" }).click();
    await page.waitForURL("**/portal/owner");
    expect(await persona(page)).toBe("owner");
  });
});
