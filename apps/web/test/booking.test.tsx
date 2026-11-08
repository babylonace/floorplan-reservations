import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { ApiProvider } from "../src/api/context";
import type { BookingOptions, BookingRules, Slot } from "../src/api/types";
import { BookingPage, checkFields, phoneInput, slugFromPath } from "../src/booking/BookingPage";
import { ar } from "../src/booking/ar";
import {
  alternativesFor,
  firstBookableDay,
  isBookableDay,
  monthWeeks,
  todayIn,
} from "../src/booking/dates";
import { en } from "../src/booking/en";
import { es } from "../src/booking/es";
import { BookingI18nProvider, bookingMessages, type BookingLocale } from "../src/booking/i18n";
import { fakeApi } from "./fixtures";

/** Every path to a text, such as "errors.busy", in a set of messages. */
function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) =>
    keys(inner, prefix ? `${prefix}.${key}` : key),
  );
}

const ROOM = "zone-room";
const TERRACE = "zone-terrace";

const OPTIONS: BookingOptions = {
  name: "Sample Bistro",
  timeZone: "Europe/Madrid",
  defaultLocale: "es",
  locales: ["es", "en", "ar"],
  largestParty: 12,
  zones: [
    { id: ROOM, name: "Comedor" },
    { id: TERRACE, name: "Terraza" },
  ],
};

/** Open every day, so whatever today is, it can be booked. */
const RULES: BookingRules = {
  horizonDays: 30,
  weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    firstArrival: "20:00",
    lastArrival: "21:00",
  })),
  specialDays: [],
};

const slot = (time: string, zoneIds: string[], available = zoneIds.length > 0): Slot => ({
  time,
  startsAt: `2030-06-01T${time}:00+02:00`,
  available,
  zoneIds,
});

/** At 20:30 the terrace is full; the room has room all evening. */
const SLOTS = [
  slot("20:00", [ROOM, TERRACE]),
  slot("20:15", [ROOM, TERRACE]),
  slot("20:30", [ROOM]),
  slot("20:45", [ROOM]),
  slot("21:00", [], false),
];

function renderPage(overrides: Parameters<typeof fakeApi>[0] = {}, locale: BookingLocale = "es") {
  const api = fakeApi({
    bookingOptions: vi.fn(() => Promise.resolve(OPTIONS)),
    bookingRules: vi.fn(() => Promise.resolve(RULES)),
    availability: vi.fn((_slug: string, date: string) => Promise.resolve({ date, slots: SLOTS })),
    ...overrides,
  });
  render(
    <BookingI18nProvider initial={locale}>
      <ApiProvider client={api}>
        <BookingPage slug="sample-bistro" />
      </ApiProvider>
    </BookingI18nProvider>,
  );
  return api;
}

afterEach(() => {
  document.documentElement.dir = "";
});

describe("booking page texts", () => {
  it("has every English text in Spanish and Arabic", () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it("counts people in each language", () => {
    expect(bookingMessages("es").people(1)).toBe("1 persona");
    expect(bookingMessages("en").people(4)).toBe("4 people");
    expect(bookingMessages("ar").people(2)).toBe("شخصان");
    expect(bookingMessages("ar").people(12)).toBe("12 شخصًا");
  });

  it("reads the venue from the address", () => {
    expect(slugFromPath("/reservar/sample-bistro")).toBe("sample-bistro");
    expect(slugFromPath("/reservar/")).toBe("");
  });
});

describe("calendar sums", () => {
  it("lays out a month in weeks that start on Monday", () => {
    // June 2030 starts on a Saturday and has 30 days.
    const weeks = monthWeeks("2030-06");
    expect(weeks[0]).toEqual([null, null, null, null, null, "2030-06-01", "2030-06-02"]);
    expect(weeks.at(-1)?.[0]).toBe("2030-06-24");
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it("only lets guests book open days inside the horizon", () => {
    const hours = { weekly: [{ weekday: 6, firstArrival: "13:00", lastArrival: "15:00" }] };
    const rules = { ...hours, specialDays: [{ date: "2030-06-08", windows: [] }] };
    expect(isBookableDay(rules, "2030-06-01", "2030-05-30", 10)).toBe(true);
    expect(isBookableDay(rules, "2030-06-02", "2030-05-30", 10)).toBe(false);
    expect(isBookableDay(rules, "2030-06-08", "2030-05-30", 10)).toBe(false);
    expect(isBookableDay(rules, "2030-06-15", "2030-05-30", 10)).toBe(false);
    expect(firstBookableDay(rules, "2030-06-02", 30)).toBe("2030-06-15");
    expect(firstBookableDay(rules, "2030-06-02", 3)).toBeNull();
  });

  it("knows today in the venue's time zone, not the device's", () => {
    // 23:30 in London is already the next day in Madrid.
    const now = new Date("2030-06-01T22:30:00Z");
    expect(todayIn("Europe/Madrid", now)).toBe("2030-06-02");
    expect(todayIn("Europe/London", now)).toBe("2030-06-01");
  });

  it("offers the nearest times in the zone and the other zones at that time", () => {
    const options = alternativesFor(SLOTS, "20:30", TERRACE);
    expect(options.times.map((s) => s.time)).toEqual(["20:00", "20:15"]);
    expect(options.zoneIds).toEqual([ROOM]);
    expect(alternativesFor(SLOTS, "23:00", TERRACE)).toEqual({ times: [], zoneIds: [] });
  });

  it("turns Arabic and Persian digits in a phone number into 0-9", () => {
    expect(phoneInput("+٣٤ ٦٠٠ ۱۲۳")).toBe("+34 600 123");
    expect(phoneInput("600-abc")).toBe("600-");
  });

  it("checks only what the booking needs", () => {
    const t = bookingMessages("es");
    expect(checkFields(t, { name: " ", email: "", phone: "", notes: "" })).toEqual({
      name: t.nameMissing,
      contact: t.contactMissing,
    });
    expect(checkFields(t, { name: "Ana", email: "ana@", phone: "12 3", notes: "" })).toEqual({
      email: t.emailInvalid,
      phone: t.phoneInvalid,
    });
    expect(checkFields(t, { name: "Ana", email: "", phone: "+34 600 000 000", notes: "" })).toEqual(
      {},
    );
  });
});

describe("BookingPage", () => {
  it("books the chosen time in the chosen zone, with only the details given", async () => {
    const user = userEvent.setup();
    const book = vi.fn(() =>
      Promise.resolve({
        id: "b1",
        status: "pending",
        startsAt: SLOTS[0]?.startsAt ?? "",
        endsAt: "",
        partySize: 3,
        tables: [{ id: "t1", label: "T1", zoneId: TERRACE }],
      }),
    );
    const api = renderPage({ book });

    await user.selectOptions(await screen.findByLabelText("Personas"), "3");
    await user.selectOptions(screen.getByLabelText("Zona"), "Terraza");
    await user.click(await screen.findByRole("button", { name: "20:00" }));
    await user.type(screen.getByLabelText("Nombre"), "  Ana  ");
    await user.type(screen.getByLabelText("Teléfono"), "+34 600 000 000");
    expect(screen.getByText(/Sample Bistro usa estos datos solo/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reservar" }));

    expect(book).toHaveBeenCalledWith("sample-bistro", {
      startsAt: SLOTS[0]?.startsAt,
      partySize: 3,
      guestName: "Ana",
      guestPhone: "+34 600 000 000",
      locale: "es",
      zoneId: TERRACE,
    });
    expect(api.availability).toHaveBeenLastCalledWith("sample-bistro", expect.any(String), 3);
    const done = await screen.findByRole("heading", { name: "Reserva recibida" });
    expect(done).toHaveFocus();
    expect(screen.getByText("Zona: Terraza")).toBeInTheDocument();
  });

  it("says when the zone is full and offers other times there or other zones then", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await screen.findByLabelText("Zona"), "Terraza");
    // Free, but not on the terrace: marked as such before it is even picked.
    const elsewhere = await screen.findByRole("button", { name: "20:30, Terraza completa" });
    expect(elsewhere).toHaveAttribute("data-elsewhere");
    await user.click(elsewhere);
    expect(screen.getByText("Terraza está completa a las 20:30.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();

    const times = screen.getByRole("group", { name: "Otras horas en Terraza" });
    expect(
      within(times)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["20:00", "20:15"]);
    const zones = screen.getByRole("group", { name: "Otras zonas a las 20:30" });
    await user.click(within(zones).getByRole("button", { name: "Comedor" }));

    expect(screen.getByLabelText("Zona")).toHaveValue(ROOM);
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    // The suggestion's button is gone; the keyboard lands on the chosen time.
    expect(screen.getByRole("button", { name: "20:30" })).toHaveFocus();
  });

  it("does not let a full time be picked, and says it is full", async () => {
    const user = userEvent.setup();
    renderPage();
    const full = await screen.findByRole("button", { name: "21:00, completo" });
    expect(full).toHaveAttribute("aria-disabled", "true");
    await user.click(full);
    expect(full).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("explains a refusal and reads the times again when the table was just taken", async () => {
    const user = userEvent.setup();
    const book = vi.fn(() => Promise.reject(new ApiError(409, "x", { code: "no_table" })));
    const api = renderPage({ book });

    await user.click(await screen.findByRole("button", { name: "20:00" }));
    await user.type(screen.getByLabelText("Nombre"), "Ana");
    await user.type(screen.getByLabelText("Correo"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Reservar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Alguien acaba de coger esa hora. Elige otra.",
    );
    expect(api.availability).toHaveBeenCalledTimes(2);
  });

  it("shows field errors next to the fields and clears them while typing", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "20:00" }));
    await user.click(screen.getByRole("button", { name: "Reservar" }));

    const name = screen.getByLabelText("Nombre");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription("Escribe tu nombre.");
    expect(screen.getByLabelText("Correo")).toHaveAccessibleDescription(
      /Basta con un correo o un teléfono.*Escribe un correo o un teléfono\./,
    );
    await user.type(name, "Ana");
    expect(name).not.toHaveAttribute("aria-invalid");
  });

  it("is written right to left in Arabic, and the arrow keys follow", async () => {
    const user = userEvent.setup();
    renderPage({}, "ar");
    expect(await screen.findByRole("heading", { name: "حجز طاولة" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(document.documentElement).toHaveAttribute("lang", "ar");

    const chosen = screen
      .getAllByRole("button")
      .find((button) => button.getAttribute("aria-pressed") === "true" && button.dataset.date);
    const date = chosen?.dataset.date ?? "";
    chosen?.focus();
    // The week reads from the right, so the left arrow goes on to the next day.
    await user.keyboard("{ArrowLeft}");
    expect((document.activeElement as HTMLElement).dataset.date).toBe(addDay(date, 1));
    await user.keyboard("{ArrowRight}");
    expect((document.activeElement as HTMLElement).dataset.date).toBe(date);

    await user.click(screen.getByRole("button", { name: "Español" }));
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
  });

  it("tells the guest when the venue does not exist", async () => {
    renderPage({
      bookingOptions: vi.fn(() => Promise.reject(new ApiError(404, "Venue not found"))),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este local no acepta reservas aquí.",
    );
  });
});

function addDay(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
