import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";
import { OWNER } from "./database.js";

/**
 * The pictures in the README, taken from the made-up sample venue. Only runs when asked:
 *   SCREENSHOTS=1 npm run e2e -- e2e/screenshots.spec.ts
 */
test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to update the README pictures");
test.use({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });

const folder = fileURLToPath(new URL("../../../docs/images/", import.meta.url));

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(OWNER.email);
  await page.getByLabel("Contraseña").fill(OWNER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("button", { name: "Comedor" }).waitFor();
}

test("sign-in page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { name: "Plano de sala" }).waitFor();
  await page.screenshot({ path: `${folder}sign-in.png` });
});

test("editor with a table selected", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /^Mesa 3,/ }).focus();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${folder}editor.png` });
});

test("editor showing two tables on top of each other", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /^Mesa 3,/ }).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowDown");
  await page.getByRole("button", { name: "English" }).click();
  await page.screenshot({ path: `${folder}editor-problem-en.png` });
});

test("a bar in sections, with stools on one side", async ({ page }) => {
  await signIn(page);
  const addBar = page.getByRole("button", { name: "Añadir tramo de barra" });
  for (let i = 0; i < 3; i++) await addBar.click();
  await page.getByRole("button", { name: /^Mesa B3,/ }).focus();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${folder}editor-bar.png` });
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("editor held upright, with the bigger touch handles", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: /^Mesa 4,/ }).focus();
    await page.screenshot({ path: `${folder}editor-tablet.png` });
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("editor on a phone, with the short top rows", async ({ page }) => {
    await signIn(page);
    await page.screenshot({ path: `${folder}editor-phone.png` });
  });
});
