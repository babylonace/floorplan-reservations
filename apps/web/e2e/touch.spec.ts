import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { OWNER } from "./database.js";

/**
 * The editor on a tablet held upright, driven by a finger. Chromium only: the touches go through
 * the DevTools protocol, the way a real touch screen sends them. Nothing here is saved.
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

const tableButton = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(`^Mesa ${label},`) });

/** One finger pressed at `from`, slid to `to` in small steps, then lifted. */
async function swipe(
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const point = {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("a finger drags tables, grabs big handles and still scrolls the page", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium", "Touches are sent through Chromium");
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(OWNER.email);
  await page.getByLabel("Contraseña").fill(OWNER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("button", { name: "Comedor" })).toBeVisible();
  expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);
  const cdp = await page.context().newCDPSession(page);

  // A finger on a table moves the table, not the page.
  const table = tableButton(page, "3");
  const box = await table.boundingBox();
  if (!box) throw new Error("Table 3 is not on screen");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await swipe(cdp, centre, { x: centre.x, y: centre.y + 120 });
  await expect(table).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/1 cambio sin guardar/)).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The turning and resizing handles are big enough for a finger: 44 px.
  for (const target of [".handle-target-rotate", ".handle-target-resize"]) {
    const handle = await page.locator(target).boundingBox();
    expect(handle?.width).toBeGreaterThanOrEqual(43.5);
    expect(handle?.height).toBeGreaterThanOrEqual(43.5);
  }

  // A finger on the plan's free space scrolls down to the panel under it.
  const plan = await page.locator("[data-plan-canvas]").boundingBox();
  if (!plan) throw new Error("The plan is not on screen");
  const free = { x: plan.x + 20, y: plan.y + plan.height - 20 };
  await swipe(cdp, free, { x: free.x, y: free.y - 300 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  // Scrolling is not a tap: the table stays chosen and its details are still in the panel.
  await expect(table).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Mesa 3" })).toBeVisible();

  // A tap on the free space lets go of it.
  const panel = await page.locator("[data-plan-canvas]").boundingBox();
  if (!panel) throw new Error("The plan is not on screen");
  await page.touchscreen.tap(panel.x + 20, panel.y + panel.height - 20);
  await expect(table).toHaveAttribute("aria-pressed", "false");

  // Every button and field is at least 36 px tall on a touch screen (WCAG 2.2 AA asks for 24).
  const short = await page.evaluate(() =>
    // Radio buttons and checkboxes are tapped through their labels; problem links are inline.
    [...document.querySelectorAll<HTMLElement>("button:not(.link-button), select, input")]
      .filter((element) => element.offsetParent !== null)
      .filter((element) => !["radio", "checkbox"].includes(element.getAttribute("type") ?? ""))
      .map((element) => ({
        name: element.getAttribute("aria-label") ?? (element.textContent.trim() || element.id),
        height: element.getBoundingClientRect().height,
      }))
      .filter((element) => element.height < 35.5 && element.name !== ""),
  );
  expect(short).toEqual([]);
});
