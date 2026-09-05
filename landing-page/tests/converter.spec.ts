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
    remaining = 49,
    rejectAllowance = false,
    partial = false,
    failed = false,
    processing = false,
    anomalies = false,
    unknownLocation = false,
    uncertainPage = false,
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
    jobState = failed ? "failed" : processing ? "processing" : "review";
  if (anomalies) { current.closing = 123; current.transactions[0].date = "2025-12-01"; }
  if (partial) current.transactions[0].amount = null as unknown as number;
  if (partial) Object.assign(current, { extraction: { complete: false, unreadablePages: [2], uncertainPages: [] } });
  if (unknownLocation) Object.assign(current, { extraction: { complete: false, unreadablePages: [], uncertainPages: [] } });
  if (uncertainPage) Object.assign(current, { extraction: { complete: false, unreadablePages: [], uncertainPages: [1] } });
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
      pages: processing ? 8 : 1,
      next_page: processing ? 6 : 1,
      extracted_pages: processing ? 6 : 1,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      revision,
      error_code: failed ? "UNSUPPORTED_CURRENCY" : null,
      content: { corrected: current },
    };
    if (action === "capabilities") {
      return route.fulfill({
        json: { version: 2, enabled: true, format_agnostic: true },
      });
    }
    if (action === "account") {
      return route.fulfill({
        json: {
          remaining,
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
      if (rejectAllowance) {
        jobState = "failed";
        return route.fulfill({ status: 400, json: { error: "ALLOWANCE" } });
      }
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
          statement: body.statement ?? current,
          incomplete: partial,
          in_progress: processing,
          files: ["*Date,*Amount,Description\r\n03/01/2026,,Test debit\r\n"],
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
    page.getByText("Extraction completed. Your transactions are ready to download.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Preparing your transactions" }),
  ).toBeHidden();
  await page.getByLabel("description for row 1").fill("Corrected debit");
  await expect(
    page.getByRole("button", { name: "Download Excel" }),
  ).toBeEnabled();
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
  expect(book.getWorksheet("Checks")).toBeUndefined();
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
  await expect(page.getByRole("button", { name: "Delete file & transactions" })).toHaveCount(0);
  const trash = page.getByRole("button", { name: /Delete conversion from/ });
  await trash.click();
  const confirmation = page.getByRole("dialog", { name: "Delete this statement?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.screenshot({ path: "/tmp/bozon-delete-dialog-mobile.png" });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#review")).toBeVisible();
  await expect(trash).toBeEnabled();
  await expect(trash).toBeFocused();
  await trash.click();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(trash).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 900 });
  await trash.click();
  await page.screenshot({ path: "/tmp/bozon-delete-dialog-desktop.png" });
  await confirmation.getByRole("button", { name: "Delete statement", exact: true }).click();
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#recent")).toBeHidden();
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
  ).toBeEnabled();
});
test("late financial response cannot restore content after sign-out", async ({ page }) => {
  await setup(page, { delayedGet: true });
  await page.getByRole("button", { name: /Ready to review/ }).click();
  await page.evaluate(async () => {
    const modulePath = "/src/converter-client.ts";
    const { client } = await import(modulePath);
    await client.auth.signOut();
  });
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
    page.getByText("Extraction completed. Your transactions are ready to download.", { exact: true }),
  ).toBeVisible();
});
test("old authentication links return to the contact form", async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto("/auth/callback?error=access_denied");
  await expect(page).toHaveURL(/tools\/bank-statement-converter/);
  await expect(page.getByRole("textbox", { name: "Your email" })).toBeVisible();
});

test("page limit appears only when exhausted or an upload would exceed it", async ({ page }) => {
  await setup(page, { remaining: 0 });
  await expect(page.locator("#completed")).toBeVisible();
  await page.getByRole("button", { name: "Convert another statement" }).click();
  await expect(page.locator("#quota")).toBeVisible();
  await expect(page.locator("#quota a")).toHaveAttribute("href", /mailto:dev@bozonailabs.com/);
  await expect(page.locator("#upload")).toBeHidden();

  await page.unrouteAll({ behavior: "wait" });
  await setup(page, { rejectAllowance: true });
  await page.getByRole("button", { name: "Convert another statement" }).click();
  await expect(page.locator("#quota")).toBeHidden();
  await expect(page.getByText(/free pages remaining|50 free pages in this browser/)).toHaveCount(0);
  await page.locator("#pdf").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.getByRole("button", { name: "Convert statement" }).click();
  await expect(page.locator("#quota")).toBeVisible();
  await expect(page.locator("#quota")).toContainText("make this part of your practice workflow");
  await expect(page.locator("#progress")).toBeHidden();
});

test("partial results keep rows, label workbook and offer a workflow contact link", async ({ page }) => {
  await setup(page, {partial:true});
  await page.getByRole("button", {name:/Ready to review/}).click();
  await expect(page.locator("#result-status")).toHaveText("Extraction completed.");
  for (const id of ["completed-details", "result-details"]) {
    await expect(page.locator(`#${id} li`)).toHaveText([
      "Row 1 (page 1): amount missing.",
      "Page 2: could not be read. Transactions may be missing.",
    ]);
  }
  await expect(page.locator("#rows tr")).toHaveCount(1);
  await expect(page.locator("#xero")).toBeEnabled();
  await expect(page.locator("#completed-title")).toHaveText("Extraction completed");
  await expect(page.locator("#share-statement, #request-help, #followup, #request-followup")).toHaveCount(0);
  await expect(page.locator("#workflow-contact a")).toHaveAttribute("href", /mailto:dev@bozonailabs.com\?subject=Workflow%20enquiry%20%E2%80%94%20Bank%20statement%20converter/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name:"Download Excel"}).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("statement-partial.xlsx");
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile((await file.path())!);
  expect(book.getWorksheet("Partial transactions")?.rowCount).toBe(2);
  expect(book.getWorksheet("Checks")).toBeUndefined();
  expect(book.getWorksheet("Extraction")?.getCell("A2").value).toBe("Incomplete extraction");
  expect(book.getWorksheet("Partial transactions")?.getCell("C2").value).toBeNull();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Xero CSV" }).click();
  const csvFile = await csvDownload;
  expect(csvFile.suggestedFilename()).toBe("xero-statement-partial.csv");
  await page.screenshot({path:"/tmp/bozon-incomplete-downloads.png",fullPage:true});
});
test("failed extraction explains the failure and offers workflow contact without finished output", async ({page}) => {
  await setup(page,{failed:true});
  await page.getByRole("button",{name:/pages · failed/}).click();
  await expect(page.locator("#failure-message")).toContainText("mixed-currency");
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#completed")).toBeHidden();
  await expect(page.locator("#workflow-contact a")).toHaveAttribute("href", /mailto:dev@bozonailabs.com/);
  await page.getByRole("button", { name: "Try another statement" }).click();
  await expect(page.locator("#upload")).toBeVisible();
});

test("completion persists after reload and another conversion is an explicit choice", async ({ page }) => {
  await setup(page);
  await expect(page.locator("#completed-title")).toHaveText("Extraction completed");
  await expect(page.locator("#upload")).toBeHidden();
  await page.reload();
  await expect(page.locator("#completed")).toBeVisible();
  await page.getByRole("button", { name: "Review transactions", exact: true }).click();
  await expect(page.locator("#review-title")).toBeFocused();
  await page.getByLabel("description for row 1").fill("Unsaved change");
  page.once("dialog", d => d.dismiss());
  await page.getByRole("button", { name: "Convert another statement" }).click();
  await expect(page.locator("#completed")).toBeVisible();
  await expect(page.getByLabel("description for row 1")).toHaveValue("Unsaved change");
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Convert another statement" }).click();
  await expect(page.locator("#upload")).toBeVisible();
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#completed")).toBeHidden();
  await page.getByRole("button", { name: /Ready to review/ }).click();
  await expect(page.locator("#completed")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#workbench").screenshot({ path: "/tmp/bozon-completion-mobile.png" });
});

test("downloads include unsaved visible edits without saving or clearing them", async ({ page }) => {
  await setup(page, { anomalies: true });
  await expect(page.locator("#completed-title")).toHaveText("Extraction completed");
  await expect(page.locator("#checks, #ack-wrap")).toHaveCount(0);
  await page.getByLabel("description for row 1").fill("Visible unsaved edit");
  await page.getByLabel("Amount in pounds for row 1").fill("-12.34");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel" }).click();
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile((await (await download).path())!);
  expect(book.getWorksheet("Transactions")?.getCell("B2").value).toBe("Visible unsaved edit");
  expect(book.getWorksheet("Transactions")?.getCell("C2").value).toBe(-12.34);
  expect(book.getWorksheet("Checks")).toBeUndefined();
  await expect(page.locator("#save-status")).toHaveText("Unsaved corrections");
});
test("available rows can be downloaded while extraction continues", async ({ page }) => {
  await setup(page, { processing: true });
  await expect(page.locator("#progress")).toBeVisible();
  await expect(page.locator("#completed")).toBeHidden();
  await expect(page.locator("#result-status")).toContainText("Extraction still in progress");
  await expect(page.getByLabel("description for row 1")).toHaveAttribute("readonly", "");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("statement-in-progress.xlsx");
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile((await file.path())!);
  expect(book.getWorksheet("Available transactions")?.rowCount).toBe(2);
  expect(book.getWorksheet("Extraction")?.getCell("A2").value).toBe("Extraction still in progress");
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Xero CSV" }).click();
  expect((await csv).suggestedFilename()).toBe("xero-statement-in-progress.csv");
});

test("missing-detail bullets update after edits and do not invent locations", async ({ page }) => {
  await setup(page, { partial: true });
  await expect(page.locator("#result-details")).toContainText("Row 1 (page 1): amount missing.");
  await page.getByLabel("date for row 1", { exact: true }).fill("");
  await expect(page.locator("#result-details li").first()).toHaveText("Row 1 (page 1): date and amount missing.");
  await page.getByLabel("Amount in pounds for row 1").fill("-1.00");
  await expect(page.locator("#result-details li").first()).toHaveText("Row 1 (page 1): date missing.");
  await page.getByLabel("date for row 1", { exact: true }).fill("2026-01-03");
  await expect(page.locator("#result-details li")).toHaveText(["Page 2: could not be read. Transactions may be missing."]);
  await expect(page.locator("#xero")).toBeEnabled();
  await expect(page.locator("#excel")).toBeEnabled();

  await page.unrouteAll({ behavior: "wait" });
  await setup(page, { uncertainPage: true });
  await expect(page.locator("#result-details li")).toHaveText(["Page 1: the extractor could not read all details confidently."]);
  await page.unrouteAll({ behavior: "wait" });
  await setup(page, { unknownLocation: true });
  await expect(page.locator("#result-details li")).toHaveText(["The extractor reported missing details but did not identify a row or page."]);
});
