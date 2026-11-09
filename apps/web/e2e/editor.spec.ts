import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OWNER, STAFF } from "./database.js";

/**
 * The editor in a real browser, against the real API and PostgreSQL. The tests run in order and
 * share the database that prepare-database.ts set up.
 */
test.describe.configure({ mode: "serial" });

const consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  page.on("console", (message) => {
    // The browser also logs every refusal the tests provoke on purpose (401, 409, 422).
    if (message.type() === "error" && !/status of 4[0-9]{2} /.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
});

test.afterEach(() => {
  // Anything here would include scripts or styles the content security policy blocked.
  expect(consoleErrors).toEqual([]);
});

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(account.email);
  await page.getByLabel("Contraseña").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("button", { name: "Comedor" })).toBeVisible();
}

/** A metre field's text ("4,5" in Spanish) as a number. */
const metres = (text: string) => Number(text.replace(",", "."));

const tableButton = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(`^Mesa ${label},`) });

async function expectNoAccessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

test("refuses a wrong password and has no accessibility problems on the sign-in page", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Plano de sala" })).toBeVisible();
  await expectNoAccessibilityProblems(page);

  await page.getByLabel("Correo electrónico").fill(OWNER.email);
  await page.getByLabel("Contraseña").fill("not-the-password");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("El correo y la contraseña no coinciden.");
});

test("signs in with a secure, script-proof session cookie", async ({ page, context }) => {
  await signIn(page, OWNER);
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "__Host-floorplan_session");
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
  expect(await page.evaluate(() => document.cookie)).toBe("");
  await expectNoAccessibilityProblems(page);
});

test("moves a table with the keyboard and keeps it there after a reload", async ({ page }) => {
  await signIn(page, OWNER);
  const table = tableButton(page, "3");
  await table.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("Desde la izquierda")).toHaveValue("5,55");
  // The top bar stays short, and the message after saving floats: the plan does not move.
  expect((await page.locator(".app-header").boundingBox())?.height).toBeLessThanOrEqual(48);
  const before = await page.locator(".canvas-wrap").boundingBox();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cambio guardado." })).toBeVisible();
  expect(await page.locator(".canvas-wrap").boundingBox()).toEqual(before);

  await page.reload();
  await tableButton(page, "3").focus();
  await expect(page.getByLabel("Desde la izquierda")).toHaveValue("5,55");
});

test("adds, drags, turns and resizes a table with the mouse", async ({ page }) => {
  await signIn(page, OWNER);
  await page.getByRole("button", { name: "Añadir mesa redonda" }).click();
  const added = tableButton(page, "5");
  await expect(added).toBeFocused();

  // Drag it straight down, to the free space at the bottom of the room.
  const box = await added.boundingBox();
  if (!box) throw new Error("The new table is not on screen");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x, centre.y + 250, { steps: 8 });
  await page.mouse.up();
  const y = metres(await page.getByLabel("Desde arriba").inputValue());
  expect(y).toBeGreaterThan(4);
  await expect(page.getByText("Sin problemas", { exact: true })).toBeVisible();

  // Make it rectangular, then pull the corner handle out to resize it.
  await page.getByRole("radio", { name: "Rectangular" }).check();
  // With a mouse, what you grab is at least 24 px even where the drawn handle is smaller.
  const grab = await page.locator(".handle-target-resize").boundingBox();
  expect(grab?.width).toBeGreaterThanOrEqual(23.5);
  const handle = page.locator(".handle-resize");
  const corner = await handle.boundingBox();
  if (!corner) throw new Error("The resize handle is not on screen");
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + 40, corner.y + 12, { steps: 6 });
  await page.mouse.up();
  const width = metres(await page.getByLabel("Ancho (m)").inputValue());
  expect(width).toBeGreaterThan(0.9);

  // Turn it with the round handle above it: dragging to its right turns it a quarter.
  await added.focus();
  const rotate = await page.locator(".handle-rotate").boundingBox();
  const tableBox = await added.boundingBox();
  if (!rotate || !tableBox) throw new Error("The turning handle is not on screen");
  await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2);
  await page.mouse.down();
  await page.mouse.move(tableBox.x + tableBox.width + 120, tableBox.y + tableBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByLabel("Giro (grados)")).toHaveValue("90");

  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cambio guardado." })).toBeVisible();
  await page.reload();
  await expect(tableButton(page, "5")).toHaveAccessibleName(/rectangular.*girada 90 grados/);
});

test("shows overlapping tables, and the API's refusal to save them", async ({ page }) => {
  await signIn(page, OWNER);
  const two = tableButton(page, "2");
  await two.focus();
  // Table 2 starts touching table 1; moving it 5 cm left puts it on top.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Las mesas 1 y 2 se pisan.").first()).toBeVisible();
  await expect(page.locator(".overlap-area")).toHaveCount(1);

  await page.getByRole("button", { name: "Guardar cambios" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("El cambio no se guardó.");
  await expect(alert).toContainText("Mesa 2: el plano quedaría con problemas:");

  await page.getByRole("button", { name: "Descartar cambios" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Descartar cambios" }).click();
  await expect(page.getByText("Todo guardado")).toBeVisible();
});

test("explains that a table with an upcoming booking cannot be removed", async ({ page }) => {
  await signIn(page, OWNER);
  await tableButton(page, "4").focus();
  await page.keyboard.press("Delete");
  await expect(tableButton(page, "4")).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Mesa 4: tiene una reserva próxima. Muévela o cancélala antes, o desmarca «Se puede reservar por internet».",
  );
  await expect(tableButton(page, "4")).toBeVisible();
  await page.reload();
  await expect(tableButton(page, "4")).toBeVisible();
});

test("creates, renames and deletes a zone", async ({ page }) => {
  await signIn(page, OWNER);
  await page.getByRole("button", { name: "Nueva zona" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva zona" });
  await dialog.getByLabel("Nombre").fill("Patio");
  await dialog.getByLabel("Ancho (m)").fill("6");
  await dialog.getByLabel("Fondo (m)").fill("4,5");
  await dialog.getByRole("button", { name: "Crear zona" }).click();
  await expect(page.getByText("Zona «Patio» creada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Patio" })).toHaveAttribute("aria-current", "true");

  await page.getByLabel("Nombre").fill("Patio interior");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambio guardado.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Patio interior" })).toBeVisible();

  await page.getByRole("button", { name: "Borrar zona" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Borrar zona" }).click();
  await expect(page.getByText("Zona «Patio interior» borrada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Patio interior" })).toHaveCount(0);
});

test("puts the plan on the right, as tall as the window, and the rest in a column on the left", async ({
  page,
}) => {
  await signIn(page, OWNER);
  const viewport = page.viewportSize();
  const plan = await page.locator(".canvas-wrap").boundingBox();
  const add = await page.getByRole("button", { name: "Añadir mesa rectangular" }).boundingBox();
  const save = await page.getByRole("button", { name: "Guardar cambios" }).boundingBox();
  const signOut = await page.getByRole("button", { name: "Cerrar sesión" }).boundingBox();
  if (!viewport || !plan || !add || !save || !signOut) throw new Error("Not on screen");
  // Only the zone tabs above the plan, and the plan reaches the bottom of the window.
  expect(plan.y).toBeLessThan(60);
  expect(Math.abs(plan.y + plan.height - viewport.height)).toBeLessThan(2);
  // The tools are in the column on its left, adding at the top and saving at the bottom; the
  // language and signing out are in the top right corner.
  for (const button of [add, save]) expect(button.x + button.width).toBeLessThan(plan.x);
  expect(add.y).toBeLessThan(save.y);
  expect(save.y + save.height).toBeGreaterThan(viewport.height - 60);
  expect(signOut.y).toBeLessThan(40);
  expect(signOut.x + signOut.width).toBeGreaterThan(viewport.width - 40);
  // With a mouse, buttons are compact.
  expect(save.height).toBeLessThanOrEqual(32);

  // In a short window only the panel scrolls: saving stays in sight.
  await page.setViewportSize({ width: 1280, height: 560 });
  await tableButton(page, "3").focus();
  await page.getByRole("button", { name: "Quitar mesa" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeInViewport();
});

test("lets staff look without changing anything, in English too", async ({ page }) => {
  await signIn(page, STAFF);
  // Staff start on the day's service; the plan is one tab away.
  await page.getByRole("button", { name: "Plano", exact: true }).click();
  await expect(
    page.getByText("Solo lectura: los cambios los hace la persona propietaria."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Añadir mesa rectangular" })).toHaveCount(0);
  await tableButton(page, "1").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Desde la izquierda")).toBeDisabled();

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByText("View only: the venue's owner makes the changes.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("builds a bar in sections, with stools on one side, and keeps it after a reload", async ({
  page,
}) => {
  await signIn(page, OWNER);
  const addBar = page.getByRole("button", { name: "Añadir tramo de barra" });
  await addBar.click();
  await expect(tableButton(page, "B1")).toBeFocused();
  // With B1 selected, the next section goes right after it, in line.
  await addBar.click();
  await expect(tableButton(page, "B2")).toBeFocused();
  await expect(page.getByText("Sin problemas", { exact: true })).toBeVisible();
  for (const label of ["B1", "B2"]) {
    await expect(tableButton(page, label).locator(".chairs circle")).toHaveCount(2);
  }
  const first = await tableButton(page, "B1").locator(".table-top").boundingBox();
  const second = await tableButton(page, "B2").locator(".table-top").boundingBox();
  // Same line, and B2 starts where B1 ends (give or take the outline).
  if (!first || !second) throw new Error("The bar sections are not on screen");
  expect(Math.abs(second.y - first.y)).toBeLessThan(1);
  expect(Math.abs(second.x - first.x - first.width)).toBeLessThan(3);

  // The side picker shows the stools on the bottom side; axe finds nothing serious.
  await expect(page.getByLabel("Abajo")).toBeChecked();
  await expectNoAccessibilityProblems(page);

  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 cambios guardados." })).toBeVisible();
  await page.reload();
  await expect(tableButton(page, "B2")).toHaveAccessibleName(/asientos en un solo lado/);
  for (const label of ["B1", "B2"]) {
    await expect(tableButton(page, label).locator(".chairs circle")).toHaveCount(2);
  }
});
