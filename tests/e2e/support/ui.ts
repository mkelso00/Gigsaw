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
 * Expect something to show after a save. Next 15.5 sometimes saves but never redraws; the app's own
 * watchdog (refreshAndWatch / ActionForm) reloads the page after about 3 seconds, so this allows
 * for that but doesn't paper over it: if the change never shows, the test fails.
 */
export async function expectAfterSave(page: Page, locator: Locator, timeout = 15_000) {
  void page;
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Click a link and wait for the page it opens (`arrived`, e.g. that page's heading).
 *
 * In the production build Next 15.5 sometimes fetches the next page but never shows it. The app's
 * NavWatchdog opens the link directly after 5 seconds, so this allows for that; if the page never
 * opens, the test fails.
 */
export async function follow(page: Page, link: Locator, arrived: Locator, timeout = 15_000) {
  void page;
  await link.click();
  await expect(arrived).toBeVisible({ timeout });
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
