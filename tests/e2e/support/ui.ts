import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Wait until React has taken over this element (and the form it's in). The app's forms submit
 * through JavaScript, so a click before the page is hydrated would do nothing useful, and text
 * typed into a controlled field could be lost. React marks each element it hydrates with a
 * __reactProps$… key, which is what this looks for.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(
      () =>
        locator.evaluate((el) => {
          const isReact = (node: Element | null) => !!node && Object.keys(node).some((k) => k.startsWith("__reactProps$"));
          const form = el.closest("form");
          return isReact(el) && (!form || isReact(form));
        }),
      { message: "the page to finish loading (React hydration)", timeout: 15_000 },
    )
    .toBe(true);
}

/** Sign in through the login page. Lands wherever the app sends that login (dashboard or act app). */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  const button = page.getByRole("button", { name: "Sign in", exact: true });
  await hydrated(button);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await button.click();
}

/**
 * The value of a copy-to-clipboard link box (e.g. an offer or proposal link), found by the path
 * the link starts with. Returned as a path, so it opens on whichever address the tests use.
 */
export async function linkFromCopyField(page: Page, pathPrefix: string, timeout = 15_000) {
  const box = page.locator(`input[readonly][value*="${pathPrefix}"]`);
  await expect(box).toBeVisible({ timeout });
  const url = new URL(await box.inputValue());
  return url.pathname + url.search;
}

/**
 * Expect something to show after a save on a page that has no reload watchdog (the customer's
 * and act's link pages). Next 15.5 sometimes saves but never redraws; the server has the change,
 * so if it hasn't shown after a while the page is loaded again, as a person would.
 */
export async function expectAfterSave(page: Page, locator: Locator, timeout = 10_000) {
  try {
    await expect(locator).toBeVisible({ timeout });
  } catch {
    test.info().annotations.push({ type: "stalled redraw", description: `${new URL(page.url()).pathname} didn't show the change until it was reloaded` });
    await page.reload();
    await expect(locator).toBeVisible({ timeout });
  }
}

/**
 * Click a link and wait for the page it opens (`arrived`, e.g. that page's heading).
 *
 * In the production build Next 15.5 sometimes fetches the next page but never shows it, most
 * often between the bookings list and a booking, or between tabs of the same list. The app's
 * watchdog only covers saves, not links, so if nothing has happened after a few seconds the link's
 * address is opened directly, as a person would by reloading, and the test is annotated
 * "stalled navigation" so it shows in the report. Anything else (a wrong link, a broken page)
 * still fails.
 */
export async function follow(page: Page, link: Locator, arrived: Locator, timeout = 8_000) {
  const href = await link.getAttribute("href");
  if (!href) throw new Error("That link has no address");
  await link.click();
  try {
    await expect(arrived).toBeVisible({ timeout });
  } catch {
    test.info().annotations.push({ type: "stalled navigation", description: `${href} didn't open from the link, so it was opened directly` });
    await page.goto(new URL(href, page.url()).href);
    await expect(arrived).toBeVisible();
  }
}

/** Pick an option in one of the app's type-to-search boxes (Combobox). */
export async function pickFromCombobox(page: Page, box: Locator, text: string) {
  await hydrated(box);
  await box.click();
  await box.fill(text);
  const option = page.getByRole("option", { name: text });
  await expect(option).toBeVisible();
  await option.click();
  await expect(box).toHaveValue(text);
}
