import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createPool } from "../../api/src/db.js";
import { e2eDatabaseUrl, STAFF } from "./database.js";

/**
 * The day's service in a real browser, against the real API and PostgreSQL: a waiter finds a
 * booking three days ahead, confirms it, sees its table on the plan and cancels it.
 */
test.describe.configure({ mode: "serial" });

const TABLE_1 = "00000000-0000-4000-8000-000000001001";
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  // A booking of our own at table 1, three days from now at 12:00 in the venue's time zone,
  // so the other tests' bookings stay as they are.
  const pool = createPool(e2eDatabaseUrl());
  try {
    await pool.query(
      `with r as (
         insert into reservations
           (venue_id, starts_at, ends_at, party_size, guest_name, guest_email, guest_phone, notes, locale)
         select venue_id,
                ((now() at time zone 'Europe/Madrid')::date + 3 + time '12:00') at time zone 'Europe/Madrid',
                ((now() at time zone 'Europe/Madrid')::date + 3 + time '13:30') at time zone 'Europe/Madrid',
                2, 'Service Guest', 'service-guest@example.com', '+34 600 000 001', 'Window seat', 'en'
           from dining_tables where id = $1
         returning id, venue_id
       )
       insert into reservation_tables (reservation_id, table_id, venue_id)
       select id, $1, venue_id from r`,
      [TABLE_1],
    );
  } finally {
    await pool.end();
  }
});

test.beforeEach(({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 4[0-9]{2} /.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(STAFF.email);
  await page.getByLabel("Contraseña").fill(STAFF.password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

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

test("staff confirm, find on the plan and cancel a booking of the day", async ({ page }) => {
  await signIn(page);
  // Staff start on the day's service.
  await expect(page.getByRole("button", { name: "Servicio" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const next = page.getByRole("button", { name: "Día siguiente" });
  const list = page.getByRole("list", { name: "Reservas del día" });
  await next.click();
  // The sample booking from prepare-database.ts.
  await expect(list.getByText("Test Guest")).toBeVisible();
  await next.click();
  await next.click();

  const card = list.getByRole("listitem").filter({ hasText: "Service Guest" });
  await expect(card).toContainText("12:00");
  await expect(card).toContainText("2 personas");
  await expect(card).toContainText("Comedor · 1");
  await expect(card).toContainText("Window seat");
  await expect(card.getByRole("link", { name: "service-guest@example.com" })).toBeVisible();
  await expect(card).toContainText("Pendiente");
  await expectNoAccessibilityProblems(page);

  await card.getByRole("button", { name: "Confirmar" }).click();
  await expect(card).toContainText("Confirmada");
  await expect(page.getByText("Service Guest: confirmada.")).toBeVisible();

  // Picking the booking shows the plan at its time, with its table taken.
  await card.getByRole("button", { name: /Service Guest/ }).click();
  await expect(page.getByRole("combobox", { name: "Plano a las" })).toHaveValue(/T/);
  await expect(page.getByRole("img", { name: "Comedor a las 12:00" })).toBeVisible();
  await expect(page.getByText("Mesa 1: Service Guest")).toBeAttached();

  await card.getByRole("button", { name: "Cancelar" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Cancelar la reserva de Service Guest?" });
  await dialog.getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(card).toContainText("Cancelada");
  await expect(card.getByRole("button", { name: "Confirmar" })).toHaveCount(0);
  // The table is free again on the plan.
  await expect(page.getByText("Mesa 1: Service Guest")).toHaveCount(0);
});

test("on a phone the list comes before the plan", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await page.getByRole("button", { name: "Día siguiente" }).click();
  const card = page
    .getByRole("list", { name: "Reservas del día" })
    .getByRole("listitem")
    .filter({ hasText: "Test Guest" });
  await expect(card).toBeVisible();
  const listBox = await card.boundingBox();
  const planBox = await page.locator(".service-canvas").boundingBox();
  expect(listBox && planBox && listBox.y < planBox.y).toBe(true);
  // Nothing sticks out sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expectNoAccessibilityProblems(page);
});
