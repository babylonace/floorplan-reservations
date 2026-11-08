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
  await expect(page.getByLabel("Desde la izquierda (cm)")).toHaveValue("555");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cambio guardado." })).toBeVisible();

  await page.reload();
  await tableButton(page, "3").focus();
  await expect(page.getByLabel("Desde la izquierda (cm)")).toHaveValue("555");
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
  const y = Number(await page.getByLabel("Desde arriba (cm)").inputValue());
  expect(y).toBeGreaterThan(400);
  await expect(page.getByText("Sin problemas", { exact: true })).toBeVisible();

  // Make it rectangular, then pull the corner handle out to resize it.
  await page.getByRole("radio", { name: "Con esquinas" }).check();
  const handle = page.locator(".handle-resize");
  const corner = await handle.boundingBox();
  if (!corner) throw new Error("The resize handle is not on screen");
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + 40, corner.y + 12, { steps: 6 });
  await page.mouse.up();
  const width = Number(await page.getByLabel("Ancho (cm)").inputValue());
  expect(width).toBeGreaterThan(90);

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
  await expect(tableButton(page, "5")).toHaveAccessibleName(/con esquinas.*girada 90 grados/);
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
  await dialog.getByLabel("Ancho (cm)").fill("600");
  await dialog.getByLabel("Fondo (cm)").fill("450");
  await dialog.getByRole("button", { name: "Crear zona" }).click();
  await expect(page.getByText("Zona «Patio» creada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Patio" })).toHaveAttribute("aria-current", "true");

  await page.getByLabel("Nombre").fill("Patio interior");
  await page.getByRole("button", { name: "Guardar zona" }).click();
  await expect(page.getByText("Zona «Patio interior» guardada.")).toBeVisible();

  await page.getByRole("button", { name: "Borrar zona" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Borrar zona" }).click();
  await expect(page.getByText("Zona «Patio interior» borrada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Patio interior" })).toHaveCount(0);
});

test("lets staff look without changing anything, in English too", async ({ page }) => {
  await signIn(page, STAFF);
  await expect(
    page.getByText("Puedes ver el plano. Solo la persona propietaria del local puede cambiarlo."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Añadir mesa cuadrada" })).toHaveCount(0);
  await tableButton(page, "1").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Desde la izquierda (cm)")).toBeDisabled();

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByText("You can look at the floor plan.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
