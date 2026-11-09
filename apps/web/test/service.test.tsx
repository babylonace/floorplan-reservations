import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../src/api/client";
import { ApiProvider } from "../src/api/context";
import type { Account, ServiceReservation } from "../src/api/types";
import { App } from "../src/components/App";
import { todayIn } from "../src/booking/dates";
import { I18nProvider } from "../src/i18n/i18n";
import { fakeApi, floorPlan, table, zone } from "./fixtures";

const WAITER: Account = {
  email: "waiter@example.com",
  venues: [{ slug: "test-venue", name: "Test Venue", role: "staff" }],
};

function booking(overrides: Partial<ServiceReservation> & { id: string }): ServiceReservation {
  return {
    status: "pending",
    startsAt: "2030-06-01T18:00:00.000Z",
    endsAt: "2030-06-01T19:30:00.000Z",
    partySize: 2,
    guestName: "Ana",
    guestEmail: "ana@example.com",
    guestPhone: null,
    notes: null,
    locale: "es",
    tables: [{ id: "t1", label: "1", zoneId: "zone-1", zoneName: "Comedor" }],
    ...overrides,
  };
}

function renderApp(api: Api) {
  return render(
    <I18nProvider initial="es">
      <ApiProvider client={api}>
        <App />
      </ApiProvider>
    </I18nProvider>,
  );
}

function serviceApi(reservations: ServiceReservation[], overrides: Partial<Api> = {}) {
  const today = todayIn("Europe/Madrid");
  return fakeApi({
    me: vi.fn(() => Promise.resolve(WAITER)),
    floorPlan: vi.fn(() =>
      Promise.resolve(
        floorPlan([
          zone([table({ id: "t1", label: "1" }), table({ id: "t2", label: "2", x: 500 })]),
        ]),
      ),
    ),
    serviceDay: vi.fn((_slug: string, date: string) =>
      Promise.resolve({
        date,
        timeZone: "Europe/Madrid",
        reservations: date === today ? reservations : [],
      }),
    ),
    ...overrides,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("the day's service", () => {
  it("opens for staff on today's bookings in arrival order", async () => {
    const api = serviceApi([
      booking({ id: "a", guestName: "Early", startsAt: "2030-06-01T11:00:00.000Z" }),
      booking({ id: "b", guestName: "Late", status: "confirmed", partySize: 4, notes: "Cake" }),
    ]);
    renderApp(api);
    const list = await screen.findByRole("list", { name: "Reservas del día" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Early"),
      expect.stringContaining("Late"),
    ]);
    expect(cards[1]).toHaveTextContent("4 personas");
    expect(cards[1]).toHaveTextContent("Cake");
    expect(screen.getByText("2 reservas · 6 personas")).toBeInTheDocument();
    // A pending booking can be confirmed; a confirmed one goes straight to seating.
    expect(
      within(cards[0] as HTMLElement).getByRole("button", { name: "Confirmar" }),
    ).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(
      within(cards[1] as HTMLElement).getByRole("button", { name: "Sentar" }),
    ).toHaveAccessibleDescription("Los clientes han llegado y se sientan a la mesa.");
  });

  it("changes a booking's status and says so", async () => {
    const user = userEvent.setup();
    const setReservationStatus = vi.fn(() =>
      Promise.resolve(booking({ id: "a", status: "confirmed" })),
    );
    renderApp(serviceApi([booking({ id: "a" })], { setReservationStatus }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(setReservationStatus).toHaveBeenCalledWith("test-venue", "a", "confirmed");
    expect(await screen.findByText("Ana: confirmada.")).toBeInTheDocument();
    expect(screen.getByText("Confirmada")).toBeInTheDocument();
  });

  it("asks before cancelling, and reloads when the booking changed meanwhile", async () => {
    const user = userEvent.setup();
    const setReservationStatus = vi.fn(() =>
      Promise.reject(new ApiError(409, "nope", { code: "status_not_allowed" })),
    );
    const api = serviceApi([booking({ id: "a" })], { setReservationStatus });
    renderApp(api);
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    const dialog = screen.getByRole("dialog", { name: "¿Cancelar la reserva de Ana?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar reserva" }));
    expect(setReservationStatus).toHaveBeenCalledWith("test-venue", "a", "cancelled");
    expect(await screen.findByText(/la reserva cambió/)).toBeInTheDocument();
    await waitFor(() => {
      expect(api.serviceDay).toHaveBeenCalledTimes(2);
    });
  });

  it("moves between days", async () => {
    const user = userEvent.setup();
    const api = serviceApi([booking({ id: "a" })]);
    renderApp(api);
    await screen.findByText("Ana");
    await user.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(await screen.findByText("No hay reservas este día.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hoy" }));
    expect(await screen.findByText("Ana")).toBeInTheDocument();
  });

  it("marks the tables taken at the chosen time on the plan", async () => {
    const user = userEvent.setup();
    renderApp(
      serviceApi([
        booking({ id: "a", guestName: "Ana" }),
        booking({
          id: "b",
          guestName: "Bea",
          startsAt: "2030-06-01T21:00:00.000Z",
          endsAt: "2030-06-01T22:30:00.000Z",
          tables: [{ id: "t2", label: "2", zoneId: "zone-1", zoneName: "Comedor" }],
        }),
      ]),
    );
    await user.click(await screen.findByRole("button", { name: /Bea/ }));
    expect(screen.getByRole("img", { name: "Comedor a las 23:00" })).toBeInTheDocument();
    expect(screen.getByText("Mesa 2: Bea")).toBeInTheDocument();
    expect(screen.queryByText("Mesa 1: Ana")).toBeNull();
  });
});
