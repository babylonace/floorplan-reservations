import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OWNER, VENUE } from "./database.js";

/**
 * The public booking page in a real browser, against the real API and PostgreSQL, on the
 * made-up sample venue. The tests run in order: the second one fills the terrace the first one
 * started to book.
 */
test.describe.configure({ mode: "serial" });

const PAGE = `/reservar/${VENUE.slug}`;
const TERRACE_ID = "00000000-0000-4000-8000-000000000102";
const consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 4[0-9]{2} /.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
});

test.afterEach(() => {
  // Anything here would include scripts or styles the content security policy blocked.
  expect(consoleErrors).toEqual([]);
});

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

/**
 * Goes to next month (always inside the 60-day horizon, and never today, whose times may be
 * gone) and picks its first open day and that day's first time. Returns the time.
 */
async function pickDayAndTime(page: Page, nextMonth: string): Promise<string> {
  await page.getByRole("button", { name: nextMonth }).click();
  await page.locator(".calendar-day:not([aria-disabled])").first().click();
  const time = page.locator(".slot:not([aria-disabled])").first();
  const label = (await time.textContent()) ?? "";
  await time.click();
  return label;
}

let bookedTime = "";
let bookedStart = "";

test("books a table in the terrace, in Spanish, with only a name and a phone", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { name: "Reservar mesa" })).toBeVisible();
  await expect(page).toHaveTitle("Reservar mesa · Sample Bistro");
  await expectNoAccessibilityProblems(page);

  await page.getByLabel("Zona").selectOption({ label: "Terraza" });
  bookedTime = await pickDayAndTime(page, "Mes siguiente");
  await page.getByLabel("Nombre").fill("Sample Guest");
  await page.getByLabel("Teléfono").fill("+34 600 000 001");
  await expect(page.getByText(/usa estos datos solo para gestionar esta reserva/)).toBeVisible();
  await expectNoAccessibilityProblems(page);

  const answer = page.waitForResponse((response) =>
    response.url().endsWith(`/venues/${VENUE.slug}/reservations`),
  );
  await page.getByRole("button", { name: "Reservar", exact: true }).click();
  const response = await answer;
  expect(response.status()).toBe(201);
  bookedStart = ((await response.json()) as { startsAt: string }).startsAt;

  await expect(page.getByRole("heading", { name: "Reserva recibida" })).toBeFocused();
  await expect(page.getByText("Zona: Terraza")).toBeVisible();
});

test("says the terrace is full and offers the dining room at the same time", async ({ page }) => {
  // Someone else takes the terrace's other table at that time.
  const other = await page.request.post(`/venues/${VENUE.slug}/reservations`, {
    data: {
      startsAt: bookedStart,
      partySize: 2,
      guestName: "Other Guest",
      guestEmail: "other-guest@example.com",
      zoneId: TERRACE_ID,
    },
  });
  expect(other.status()).toBe(201);

  await page.goto(PAGE);
  await page.getByLabel("Zona").selectOption({ label: "Terraza" });
  expect(await pickDayAndTime(page, "Mes siguiente")).toBe(bookedTime);

  await expect(page.getByText(`Terraza está completa a las ${bookedTime}.`)).toBeVisible();
  await expect(page.getByLabel("Nombre")).toHaveCount(0);
  await expectNoAccessibilityProblems(page);
  await page
    .getByRole("group", { name: `Otras zonas a las ${bookedTime}` })
    .getByRole("button", { name: "Comedor" })
    .click();
  await expect(page.getByLabel("Zona")).toHaveValue(/0101$/);
  await expect(page.getByLabel("Nombre")).toBeVisible();
});

test("reads right to left in Arabic and books in Arabic", async ({ page }) => {
  await page.goto(PAGE);
  await page.getByRole("button", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { name: "حجز طاولة" })).toBeVisible();

  // The page really is laid out from the right: the venue's name sits at the right edge.
  const venue = await page.locator(".booking-venue").boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect((venue?.x ?? 0) + (venue?.width ?? 0)).toBeGreaterThan(width - 40);

  // The left arrow goes on to the next day, as the week reads from the right.
  await page.getByRole("button", { name: "الشهر التالي" }).click();
  const first = page.locator(".calendar-day:not([aria-disabled])").first();
  const date = (await first.getAttribute("data-date")) ?? "";
  await first.click();
  await first.press("ArrowLeft");
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  await expect(page.locator(":focus")).toHaveAttribute(
    "data-date",
    next.toISOString().slice(0, 10),
  );
  await expectNoAccessibilityProblems(page);

  await page.locator(".slot:not([aria-disabled])").last().click();
  await page.getByLabel("الاسم").fill("ضيف تجريبي");
  await page.getByLabel("البريد الإلكتروني").fill("arabic-guest@example.com");
  const answer = page.waitForRequest((request) => request.method() === "POST");
  await page.getByRole("button", { name: "احجز" }).click();
  // The venue offers Arabic, so it will write to this guest in Arabic.
  expect((await answer).postDataJSON()).toMatchObject({ locale: "ar" });
  await expect(page.getByRole("heading", { name: "تم استلام الحجز" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("fits the screen and has thumb-sized buttons", async ({ page }) => {
    await page.goto(PAGE);
    await page.getByRole("button", { name: "Mes siguiente" }).click();
    const day = page.locator(".calendar-day:not([aria-disabled])").first();
    await day.click();
    const time = page.locator(".slot:not([aria-disabled])").first();
    await time.waitFor();

    // No sideways scrolling.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const target of [day, time, page.getByLabel("Personas")]) {
      expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test("staff decide which zones guests may ask for", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(OWNER.email);
  await page.getByLabel("Contraseña").fill(OWNER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("button", { name: "Terraza" }).click();
  const choice = page.getByLabel("Se puede elegir al reservar");
  await expect(choice).toBeChecked();
  await choice.uncheck();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/sin guardar/)).toHaveCount(0);

  // Only the dining room is left to choose, so there is nothing to choose.
  await page.goto(PAGE);
  await expect(page.getByLabel("Personas")).toBeVisible();
  await expect(page.getByLabel("Zona")).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Terraza" }).click();
  await page.getByLabel("Se puede elegir al reservar").check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/sin guardar/)).toHaveCount(0);
});
