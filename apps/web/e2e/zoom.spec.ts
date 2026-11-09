import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { OWNER, STAFF } from "./database.js";

/**
 * Zooming the plan in and out, and moving around it, with the buttons, the keyboard, the mouse
 * wheel and two fingers. Dragging a table must still land where the pointer goes at any zoom.
 * Nothing here is saved.
 */

async function signIn(page: Page, account = OWNER) {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(account.email);
  await page.getByLabel("Contraseña").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("button", { name: "Comedor" })).toBeVisible();
}

const tableButton = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(`^Mesa ${label},`) });

/** A metre field's text ("4,5" in Spanish) as centimetres. */
const centimetres = (text: string) => Math.round(Number(text.replace(",", ".")) * 100);

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("Not on screen");
  return found;
}

const middle = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

test("zooms with the buttons and the keyboard, and a dragged table follows the mouse", async ({
  page,
}) => {
  await signIn(page);
  const table = tableButton(page, "3");
  const top = table.locator(".table-top");
  const fitted = await box(top);
  const zoomIn = page.getByRole("button", { name: "Acercar" });
  const fit = page.getByRole("button", { name: "Ver todo el plano" });
  await expect(fit).toBeDisabled();

  await zoomIn.click();
  await zoomIn.click();
  const zoomed = await box(top);
  expect(zoomed.width / fitted.width).toBeCloseTo(1.5 * 1.5, 1);
  await expect(fit).toBeEnabled();

  // Dragging works the same at this zoom: 90 screen pixels are 90 / (pixels per cm) cm.
  await table.click();
  const before = centimetres(await page.getByLabel("Desde la izquierda").inputValue());
  const pixelsPerCm = zoomed.width / 110; // Table 3 is 1.1 m across.
  const start = middle(zoomed);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 45, start.y, { steps: 5 });
  await page.mouse.move(start.x + 90, start.y, { steps: 5 });
  await page.mouse.up();
  const after = centimetres(await page.getByLabel("Desde la izquierda").inputValue());
  expect(Math.abs(after - before - 90 / pixelsPerCm)).toBeLessThanOrEqual(5);
  // The table is still under the pointer.
  expect(Math.abs(middle(await box(top)).x - (start.x + 90))).toBeLessThan(6);

  // The resize handle works at this zoom too.
  const handle = await box(page.locator(".handle-target-resize"));
  const width = centimetres(await page.getByLabel("Ancho (m)").inputValue());
  await page.mouse.move(middle(handle).x, middle(handle).y);
  await page.mouse.down();
  await page.mouse.move(middle(handle).x + 30, middle(handle).y + 30, { steps: 5 });
  await page.mouse.up();
  const grown = centimetres(await page.getByLabel("Ancho (m)").inputValue());
  expect(Math.abs(grown - width - (2 * 30) / pixelsPerCm)).toBeLessThanOrEqual(10);

  // Dragging the free space moves the plan.
  const plan = await box(page.locator("[data-plan-canvas]"));
  const tableBefore = await box(top);
  await page.mouse.move(plan.x + 30, plan.y + plan.height - 30);
  await page.mouse.down();
  await page.mouse.move(plan.x + 130, plan.y + plan.height - 80, { steps: 8 });
  await page.mouse.up();
  const tableAfter = await box(top);
  expect(tableAfter.x - tableBefore.x).toBeCloseTo(100, -1);
  expect(tableAfter.y - tableBefore.y).toBeCloseTo(-50, -1);

  // + and − on the keyboard, and 0 for the whole plan.
  // (The table is wider now: it was resized above.)
  await table.focus();
  const now = (await box(top)).width;
  await page.keyboard.press("-");
  expect(Math.abs((await box(top)).width - now / 1.5)).toBeLessThan(2);
  await page.keyboard.press("+");
  expect(Math.abs((await box(top)).width - now)).toBeLessThan(2);
  await page.keyboard.press("0");
  // The outline keeps its width on screen, so allow a pixel or two.
  expect(Math.abs((await box(top)).width - now / 2.25)).toBeLessThan(2);
  await expect(fit).toBeDisabled();
});

test("a table dragged to the edge of a zoomed-in plan stays under the pointer", async ({
  page,
}) => {
  await signIn(page);
  const zoomIn = page.getByRole("button", { name: "Acercar" });
  await zoomIn.click();
  await zoomIn.click();
  const plan = await box(page.locator("[data-plan-canvas]"));
  const top = tableButton(page, "3").locator(".table-top");
  const other = tableButton(page, "4").locator(".table-top");
  const otherBefore = await box(other);
  const start = middle(await box(top));
  const end = { x: plan.x + plan.width - 15, y: start.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  // The plan did not slide away under the table: the table is where the pointer is.
  expect(Math.abs(middle(await box(top)).x - end.x)).toBeLessThan(6);
  await page.mouse.up();
  const otherAfter = await box(other);
  expect(Math.abs(otherAfter.x - otherBefore.x)).toBeLessThan(1);
  expect(Math.abs(otherAfter.y - otherBefore.y)).toBeLessThan(1);
});

test("staff can move around a zoomed-in plan from a table too", async ({ page }) => {
  await signIn(page, STAFF);
  await page.getByRole("button", { name: "Plano", exact: true }).click();
  const top = tableButton(page, "1").locator(".table-top");
  // Zoom in on table 1 itself, so it stays under the pointer.
  const fitted = middle(await box(top));
  await page.mouse.move(fitted.x, fitted.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -500);
  await page.keyboard.up("Control");
  await expect(page.getByRole("button", { name: "Ver todo el plano" })).toBeEnabled();
  const before = await box(top);
  const start = middle(before);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 6 });
  await page.mouse.up();
  const after = await box(top);
  expect(after.x - before.x).toBeCloseTo(80, -1);
  expect(after.y - before.y).toBeCloseTo(40, -1);
  // Staff only see the shortcuts that apply to them.
  await page.getByRole("button", { name: "Atajos de teclado" }).click();
  await expect(page.getByText("ver todo el plano")).toBeVisible();
  await expect(page.getByText("quitar la mesa")).toHaveCount(0);
});

test("zooms around the pointer with Ctrl and the mouse wheel", async ({ page }) => {
  await signIn(page);
  const top = tableButton(page, "4").locator(".table-top");
  const fitted = await box(top);
  const point = middle(fitted);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -400);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await box(top)).width).toBeGreaterThan(fitted.width * 1.5);
  // The point under the pointer stays where it was.
  const zoomed = middle(await box(top));
  expect(Math.abs(zoomed.x - point.x)).toBeLessThan(4);
  expect(Math.abs(zoomed.y - point.y)).toBeLessThan(4);
  // The page itself did not zoom or scroll.
  expect(await page.evaluate(() => [window.scrollY, window.visualViewport?.scale])).toEqual([0, 1]);
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  type Touch = { x: number; y: number; id: number };

  /** Fingers pressed at `from`, slid to `to` together in small steps, then lifted. */
  async function slide(cdp: CDPSession, from: Touch[], to: Touch[]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: from });
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const touchPoints = from.map((start, index) => {
        const end = to[index] ?? start;
        return {
          id: start.id,
          x: start.x + ((end.x - start.x) * i) / steps,
          y: start.y + ((end.y - start.y) * i) / steps,
        };
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  test("two fingers pinch the plan, and one finger then moves it", async ({ page }) => {
    test.skip(test.info().project.name !== "chromium", "Touches are sent through Chromium");
    await signIn(page);
    const cdp = await page.context().newCDPSession(page);
    const top = tableButton(page, "4").locator(".table-top");
    const fitted = await box(top);
    const centre = middle(fitted);

    // Spread two fingers apart around table 4: the plan zooms in, the page does not.
    await slide(
      cdp,
      [
        { id: 1, x: centre.x - 30, y: centre.y },
        { id: 2, x: centre.x + 30, y: centre.y },
      ],
      [
        { id: 1, x: centre.x - 90, y: centre.y },
        { id: 2, x: centre.x + 90, y: centre.y },
      ],
    );
    const pinched = await box(top);
    expect(pinched.width / fitted.width).toBeCloseTo(3, 0);
    expect(await page.evaluate(() => [window.scrollY, window.visualViewport?.scale])).toEqual([
      0, 1,
    ]);
    // Nothing moved: pinching is not dragging.
    await expect(page.getByText("Todo guardado")).toBeVisible();

    // Zoomed in, one finger on the free space moves the plan instead of the page.
    const plan = await box(page.locator("[data-plan-canvas]"));
    const from = { id: 1, x: plan.x + 20, y: plan.y + plan.height - 20 };
    await slide(cdp, [from], [{ ...from, y: from.y - 100 }]);
    expect((await box(top)).y - pinched.y).toBeCloseTo(-100, -1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
