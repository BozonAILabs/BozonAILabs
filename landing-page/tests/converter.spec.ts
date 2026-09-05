import { expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";
const id = "11111111-1111-4111-8111-111111111111";
const statement = {
  bank: "NatWest",
  currency: "GBP",
  account: "synthetic",
  start: "2026-01-01",
  end: "2026-01-31",
  opening: 10000,
  closing: 9900,
  transactions: [
    {
      date: "2026-01-03",
      description: "Test debit",
      amount: -100,
      balance: 9900,
      page: 1,
    },
  ],
};
async function setup(
  page: Page,
  {
    signedIn = true,
    delayedSave = false,
    delayedGet = false,
    onboarding = false,
  } = {},
) {
  const user = {
    id,
    email: "test@example.test",
    app_metadata: { provider: "anonymous" },
    is_anonymous: true,
    user_metadata: { full_name: "Test User" },
    aud: "authenticated",
    created_at: new Date().toISOString(),
  };
  if (signedIn) {
    await page.addInitScript(
      ({ user }) => {
        const token = btoa(JSON.stringify({ alg: "HS256" })) +
          "." +
          btoa(
            JSON.stringify({
              sub: user.id,
              exp: Math.floor(Date.now() / 1000) + 3600,
            }),
          ) +
          ".test";
        localStorage.setItem(
          "sb-127-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "test",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            token_type: "bearer",
            user,
          }),
        );
      },
      { user },
    );
  }
  let current = structuredClone(statement),
    revision = 0,
    deleted = false,
    profileDone = !onboarding,
    hasJob = !onboarding,
    jobState = "review";
  await page.route("**/auth/v1/**", async (route) => {
    if (route.request().url().includes("/settings")) {
      return route.fulfill({
        json: { external: { anonymous_users: true } },
      });
    }
    if (route.request().url().includes("/logout")) {
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: user });
  });
  await page.route("**/functions/v1/converter-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const body = action === "upload" ? {} : route.request().postDataJSON();
    const job = {
      id,
      state: jobState,
      pages: 1,
      next_page: 1,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      revision,
      content: { corrected: current },
    };
    if (action === "capabilities") {
      return route.fulfill({
        json: { version: 1, enabled: true, banks: ["NatWest"] },
      });
    }
    if (action === "account") {
      return route.fulfill({
        json: {
          remaining: 49,
          profile: profileDone
            ? { name: "Test", practice: "Test", email: "test@example.test" }
            : null,
          jobs: deleted || !hasJob ? [] : [job],
        },
      });
    }
    if (action === "profile") {
      profileDone = true;
      return route.fulfill({ json: {} });
    }
    if (action === "create") {
      hasJob = true;
      jobState = "uploading";
      return route.fulfill({ json: { ...job, state: jobState } });
    }
    if (action === "upload") {
      jobState = "review";
      return route.fulfill({ json: { id } });
    }
    if (action === "get") {
      if (delayedGet) await new Promise((r) => setTimeout(r, 500));
      return route.fulfill({ json: job });
    }
    if (action === "source") {
      return route.fulfill({
        body: "%PDF-1.4\n%%EOF",
        contentType: "application/pdf",
      });
    }
    if (action === "edit") {
      if (delayedSave) await new Promise((r) => setTimeout(r, 400));
      current = body.statement;
      revision++;
      return route.fulfill({ json: { revision } });
    }
    if (action === "export") {
      return route.fulfill({
        json: {
          statement: current,
          checks: { balance: "matches", issues: [] },
          files: [
            "*Date,*Amount,Description\r\n03/01/2026,-1.00,Test debit\r\n",
          ],
        },
      });
    }
    if (action === "delete") deleted = true;
    return route.fulfill({ json: {} });
  });
  await page.goto("/tools/bank-statement-converter");
}
test("contact gate replaces OAuth and fits mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { signedIn: false });
  await expect(page.getByRole("textbox", { name: "Your email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to converter" }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: /Google|Apple/ })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/bozon-converter-mobile.png",
    fullPage: true,
  });
});
test("editable review, mobile source switch, Excel workbook and deletion", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: /Ready to review/ }).click();
  await expect(
    page.getByText("Balance matches", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Preparing your transactions" }),
  ).toBeHidden();
  await page.getByLabel("description for row 1").fill("Corrected debit");
  await expect(
    page.getByRole("button", { name: "Download Excel" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save corrections" }).click();
  await expect(
    page.getByText("Corrections saved", { exact: true }),
  ).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel" }).click();
  const file = await dl;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await file.path())!);
  expect(book.getWorksheet("Transactions")!.getCell("B2").value).toBe(
    "Corrected debit",
  );
  expect(book.getWorksheet("Checks")).toBeDefined();
  await page.screenshot({
    path: "/tmp/bozon-review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/bozon-review-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Source PDF", exact: true }).click();
  await expect(page.locator("#source")).toBeVisible();
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await expect(page.getByLabel("description for row 1")).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete file & transactions" })
    .click();
  await expect(page.locator("#review")).toBeHidden();
});
test("edits during save remain unsaved", async ({ page }) => {
  await setup(page, { delayedSave: true });
  await page.getByRole("button", { name: /Ready to review/ }).click();
  await page.getByLabel("description for row 1").fill("First");
  await page.getByRole("button", { name: "Save corrections" }).click();
  await page.getByLabel("description for row 1").fill("Second");
  await expect(
    page.getByText("Newer corrections still need saving"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download Excel" }),
  ).toBeDisabled();
});
test("late financial response cannot restore content after sign-out", async ({ page }) => {
  await setup(page, { delayedGet: true });
  await page.getByRole("button", { name: /Ready to review/ }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "End session" }).click();
  await expect(
    page.getByRole("button", { name: "Continue to converter" }),
  ).toBeVisible();
  await page.waitForTimeout(650);
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#rows")).toBeEmpty();
});

test("first-use profile and upload reach review", async ({ page }) => {
  await setup(page, { onboarding: true });
  await page.getByLabel("Your name", { exact: true }).fill("Test User");
  await page.getByLabel("Practice name", { exact: true }).fill("Test Practice");
  await page.getByRole("textbox", { name: "Your email" }).fill(
    "test@example.test",
  );
  await page.getByRole("button", { name: "Continue to converter" }).click();
  await page
    .getByLabel("Choose a bank statement", { exact: true })
    .setInputFiles({
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic fixture"),
    });
  await page.getByRole("button", { name: "Convert statement" }).click();
  await expect(
    page.getByRole("heading", { name: "Your transactions." }),
  ).toBeVisible();
  await expect(
    page.getByText("Balance matches", { exact: true }),
  ).toBeVisible();
});
test("old authentication links return to the contact form", async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto("/auth/callback?error=access_denied");
  await expect(page).toHaveURL(/tools\/bank-statement-converter/);
  await expect(page.getByRole("textbox", { name: "Your email" })).toBeVisible();
});
