import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../src/api/client";
import { ApiProvider } from "../src/api/context";
import type { Table } from "../src/api/types";
import { App } from "../src/components/App";
import { I18nProvider } from "../src/i18n/i18n";
import { fakeApi, floorPlan, OWNER, table, zone } from "./fixtures";

function renderApp(api: Api) {
  return render(
    <I18nProvider initial="es">
      <ApiProvider client={api}>
        <App />
      </ApiProvider>
    </I18nProvider>,
  );
}

const TABLES = [
  table({ id: "t1", label: "1", x: 100, y: 100 }),
  table({ id: "t2", label: "2", x: 400, y: 100 }),
];

function signedInApi(overrides: Partial<Api> = {}, tables: Table[] = TABLES) {
  return fakeApi({
    me: vi.fn(() => Promise.resolve(OWNER)),
    floorPlan: vi.fn(() => Promise.resolve(floorPlan([zone(tables)]))),
    ...overrides,
  });
}

/** Puts keyboard focus on a table, which also selects it. */
async function focusTable(label: string) {
  const element = await findTable(label);
  act(() => {
    element.focus();
  });
  return element;
}

/** The plan's table with this label, found the way a screen reader names it. */
async function findTable(label: string) {
  return screen.findByRole("button", { name: new RegExp(`^Mesa ${label},`) });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("signing in", () => {
  it("says when the e-mail and password do not match, then lets the person in", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<Api["login"]>()
      .mockRejectedValueOnce(new ApiError(401, "Wrong e-mail address or password."))
      .mockResolvedValueOnce(OWNER);
    renderApp(
      signedInApi({
        me: vi.fn(() => Promise.reject(new ApiError(401, "Please sign in first."))),
        login,
      }),
    );

    await user.type(await screen.findByLabelText("Correo electrónico"), "owner@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El correo y la contraseña no coinciden.",
    );
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");

    await user.type(screen.getByLabelText("Contraseña"), "right-password");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await findTable("1")).toBeInTheDocument();
    expect(login).toHaveBeenLastCalledWith("owner@example.com", "right-password");
  });

  it("switches every text to English", async () => {
    const user = userEvent.setup();
    renderApp(
      fakeApi({ me: vi.fn(() => Promise.reject(new ApiError(401, "Please sign in first."))) }),
    );
    await user.click(await screen.findByRole("button", { name: "English" }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail address")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("the plan editor", () => {
  it("moves the selected table with the arrow keys and saves only what changed", async () => {
    const user = userEvent.setup();
    const updateTable = vi.fn<Api["updateTable"]>((_slug, id, fields) =>
      Promise.resolve({ ...table({ id, label: "1", x: 100, y: 100 }), ...fields }),
    );
    renderApp(signedInApi({ updateTable }));

    const first = await findTable("1");
    act(() => {
      first.focus();
    });
    expect(first).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{ArrowRight}{ArrowRight}{Shift>}{ArrowDown}{/Shift}");

    expect(screen.getByLabelText("Desde la izquierda (cm)")).toHaveValue(110);
    expect(screen.getByLabelText("Desde arriba (cm)")).toHaveValue(150);
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
    expect(screen.getByText("Mesa 1 en 110, 150 cm.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Cambio guardado.")).toBeInTheDocument();
    expect(updateTable).toHaveBeenCalledExactlyOnceWith("test-venue", "t1", { x: 110, y: 150 });
  });

  it("turns a table with R and removes it with Delete", async () => {
    const user = userEvent.setup();
    renderApp(signedInApi());
    await focusTable("2");
    await user.keyboard("r");
    expect(screen.getByLabelText("Giro (grados)")).toHaveValue(15);
    await user.keyboard("{Shift>}R{/Shift}{Shift>}R{/Shift}");
    expect(screen.getByLabelText("Giro (grados)")).toHaveValue(345);
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("button", { name: /^Mesa 2,/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
  });

  it("shows tables that overlap, and names them", async () => {
    const user = userEvent.setup();
    renderApp(signedInApi());
    await focusTable("2");
    await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}");
    expect(screen.getByText("1 problema")).toBeInTheDocument();
    const issues = screen.getByRole("heading", { name: "Problemas en el plano" }).parentElement;
    expect(issues).not.toBeNull();
    expect(
      within(issues as HTMLElement).getByText("Las mesas 1 y 2 se pisan."),
    ).toBeInTheDocument();
    expect(await findTable("2")).toHaveAccessibleName(/1 problema$/);
  });

  it("edits a table from the panel and adds a new one", async () => {
    const user = userEvent.setup();
    const createTable = vi.fn<Api["createTable"]>((_slug, zoneId, fields) =>
      Promise.resolve({ ...fields, id: "stored", zoneId }),
    );
    const updateTable = vi.fn<Api["updateTable"]>((_slug, id, fields) =>
      Promise.resolve({ ...table({ id }), ...fields }),
    );
    renderApp(signedInApi({ createTable, updateTable }));

    await focusTable("1");
    const label = screen.getByLabelText("Nombre o número");
    await user.clear(label);
    expect(screen.getByText("Ponle un nombre o un número.")).toBeInTheDocument();
    await user.type(label, "Ventana");
    await user.click(screen.getByLabelText("Redonda"));
    await user.click(screen.getByLabelText("Nogal"));
    await user.click(screen.getByLabelText("Se puede reservar por internet"));

    await user.click(screen.getByRole("button", { name: "Añadir mesa redonda" }));
    expect(await findTable("3")).toHaveFocus();
    expect(screen.getByText("Nueva, sin guardar")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("2 cambios guardados.")).toBeInTheDocument();
    expect(updateTable).toHaveBeenCalledWith("test-venue", "t1", {
      label: "Ventana",
      shape: "round",
      style: { color: "#8a5a3b" },
      bookable: false,
    });
    expect(createTable).toHaveBeenCalledWith(
      "test-venue",
      "zone-1",
      expect.objectContaining({ label: "3", shape: "round", width: 90, height: 90 }),
    );
  });

  it("explains why a booked table cannot be removed, and puts it back", async () => {
    const user = userEvent.setup();
    const deleteTable = vi.fn<Api["deleteTable"]>(() =>
      Promise.reject(
        new ApiError(409, "1 upcoming reservation(s) use this table.", {
          code: "upcoming_reservations",
          count: 1,
        }),
      ),
    );
    renderApp(signedInApi({ deleteTable }));

    await focusTable("1");
    await user.keyboard("{Delete}");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El cambio no se guardó.");
    expect(alert).toHaveTextContent(
      "Mesa 1: tiene una reserva próxima. Muévela o cancélala antes, o desmarca «Se puede reservar por internet».",
    );
    expect(await findTable("1")).toBeInTheDocument();
    expect(screen.getByText("Todo guardado")).toBeInTheDocument();
  });

  it("lists the problems the API found when it refuses a change", async () => {
    const user = userEvent.setup();
    const updateTable = vi.fn<Api["updateTable"]>(() =>
      Promise.reject(
        new ApiError(422, "The change would make the floor plan invalid", {
          code: "plan_invalid",
          issues: [{ code: "overlap", tableId: "t1", otherTableId: "t2" }],
        }),
      ),
    );
    renderApp(signedInApi({ updateTable }));
    await focusTable("1");
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Mesa 1: el plano quedaría con problemas:");
    expect(alert).toHaveTextContent("Las mesas 1 y 2 se pisan.");
    // The change stays on screen to be fixed.
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
  });

  it("asks before throwing away unsaved changes", async () => {
    const user = userEvent.setup();
    renderApp(signedInApi());
    await focusTable("1");
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("button", { name: "Descartar cambios" }));

    const dialog = screen.getByRole("dialog", { name: "¿Descartar los cambios sin guardar?" });
    expect(within(dialog).getByRole("button", { name: "Seguir editando" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Descartar cambios" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar cambios" }),
    );
    expect(screen.getByText("Todo guardado")).toBeInTheDocument();
  });

  it("asks to sign in again when the session ends, and keeps what was not saved", async () => {
    const user = userEvent.setup();
    const updateTable = vi
      .fn<Api["updateTable"]>()
      .mockRejectedValueOnce(new ApiError(401, "Please sign in first."))
      .mockImplementation((_slug, id, fields) => Promise.resolve({ ...table({ id }), ...fields }));
    const login = vi.fn<Api["login"]>(() => Promise.resolve(OWNER));
    renderApp(signedInApi({ updateTable, login }));
    await focusTable("1");
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const dialog = await screen.findByRole("dialog", { name: "Vuelve a entrar" });
    expect(dialog).toHaveTextContent("lo que no habías guardado sigue en el plano");
    expect(within(dialog).getByLabelText("Correo electrónico")).toHaveFocus();
    await user.type(within(dialog).getByLabelText("Correo electrónico"), "owner@example.com");
    await user.type(within(dialog).getByLabelText("Contraseña"), "right-password");
    await user.click(within(dialog).getByRole("button", { name: "Entrar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Cambio guardado.")).toBeInTheDocument();
    expect(updateTable).toHaveBeenLastCalledWith("test-venue", "t1", { y: 105 });
  });

  it("will not save a table without a name", async () => {
    const user = userEvent.setup();
    renderApp(signedInApi());
    await focusTable("1");
    await user.clear(screen.getByLabelText("Nombre o número"));
    expect(
      screen.getByText("Todas las mesas necesitan un nombre o un número para guardar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  it("moves keyboard focus to the next table after removing one", async () => {
    const user = userEvent.setup();
    renderApp(signedInApi());
    await focusTable("1");
    await user.keyboard("{Delete}");
    expect(await findTable("2")).toHaveFocus();
    await user.keyboard("{Delete}");
    expect(document.querySelector("[data-plan-canvas]")).toHaveFocus();
  });

  it("creates a zone", async () => {
    const user = userEvent.setup();
    const createZone = vi.fn<Api["createZone"]>((_slug, fields) =>
      Promise.resolve({ ...fields, id: "zone-2" }),
    );
    const plans = vi
      .fn<Api["floorPlan"]>()
      .mockResolvedValueOnce(floorPlan([zone(TABLES)]))
      .mockResolvedValue(
        floorPlan([
          zone(TABLES),
          zone([], { id: "zone-2", name: "Terraza", sortOrder: 1, width: 900, height: 400 }),
        ]),
      );
    renderApp(signedInApi({ createZone, floorPlan: plans }));

    await user.click(await screen.findByRole("button", { name: "Nueva zona" }));
    const dialog = screen.getByRole("dialog", { name: "Nueva zona" });
    await user.type(within(dialog).getByLabelText("Nombre"), "Terraza");
    const width = within(dialog).getByLabelText("Ancho (cm)");
    await user.clear(width);
    await user.type(width, "900");
    await user.click(within(dialog).getByRole("button", { name: "Crear zona" }));

    expect(await screen.findByText("Zona «Terraza» creada.")).toBeInTheDocument();
    expect(createZone).toHaveBeenCalledWith("test-venue", {
      name: "Terraza",
      width: 900,
      height: 800,
      sortOrder: 1,
    });
    expect(screen.getByRole("button", { name: "Terraza" })).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByText("Esta zona está vacía. Añade la primera mesa con los botones de arriba."),
    ).toBeInTheDocument();
  });

  it("shows why a zone cannot be deleted", async () => {
    const user = userEvent.setup();
    const deleteZone = vi.fn<Api["deleteZone"]>(() =>
      Promise.reject(new ApiError(409, "x", { code: "upcoming_reservations", count: 3 })),
    );
    renderApp(signedInApi({ deleteZone }));
    await user.click(await screen.findByRole("button", { name: "Borrar zona" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Borrar zona" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Las mesas de esta zona tienen 3 reservas próximas.",
    );
  });

  it("lets staff look at the plan without changing it", async () => {
    const user = userEvent.setup();
    renderApp(
      signedInApi({
        me: vi.fn(() =>
          Promise.resolve({
            email: "waiter@example.com",
            venues: [{ slug: "test-venue", name: "Test Venue", role: "staff" as const }],
          }),
        ),
      }),
    );
    expect(
      await screen.findByText(
        "Puedes ver el plano. Solo la persona propietaria del local puede cambiarlo.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir mesa cuadrada" })).not.toBeInTheDocument();
    await focusTable("1");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByLabelText("Desde la izquierda (cm)")).toHaveValue(100);
    expect(screen.getByLabelText("Desde la izquierda (cm)")).toBeDisabled();
  });

  it("offers to try again when the plan cannot be loaded", async () => {
    const user = userEvent.setup();
    const plans = vi
      .fn<Api["floorPlan"]>()
      .mockRejectedValueOnce(new ApiError(0, "offline"))
      .mockResolvedValue(floorPlan([zone(TABLES)]));
    renderApp(signedInApi({ floorPlan: plans }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el plano.");
    await user.click(screen.getByRole("button", { name: "Volver a probar" }));
    await waitFor(async () => {
      expect(await findTable("1")).toBeInTheDocument();
    });
  });
});
