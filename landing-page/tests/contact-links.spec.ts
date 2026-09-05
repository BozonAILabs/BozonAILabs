import { expect, test } from "@playwright/test";

for (const { path, count, subject, introduction } of [
  {
    path: "/",
    count: 2,
    subject: "Workflow enquiry",
    introduction: "I’d like to discuss reducing manual work in our practice.",
  },
  {
    path: "/contact.html",
    count: 1,
    subject: "Workflow enquiry",
    introduction: "I’d like to discuss reducing manual work in our practice.",
  },
  {
    path: "/tools/bank-statement-converter",
    count: 6,
    subject: "Workflow enquiry — Bank statement converter",
    introduction: "I’m getting in touch from your bank statement converter page. I’d like to discuss bank statement conversion in our practice.",
  },
]) {
  test(`all contact links use the agreed message on ${path}`, async ({ page }) => {
    // Contact remains available even when the converter service is unavailable.
    await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
    await page.goto(path);
    const links = page.locator('a[href^="mailto:"]');
    await expect(links).toHaveCount(count);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("href", /\?subject=/);
      const url = new URL((await link.getAttribute("href"))!);
      expect(url.pathname).toBe("dev@bozonailabs.com");
      expect(url.searchParams.get("subject")).toBe(subject);
      expect(url.searchParams.get("body")).toBe([
        "Hi Bozon AI Labs,", "", introduction, "", "Practice name:", "What we’d like help with:",
      ].join("\n"));
    }
    if (path.includes("bank-statement-converter")) {
      await expect(page.locator("footer a").first()).toHaveAttribute("data-contact", "converter");
    }
  });
}
