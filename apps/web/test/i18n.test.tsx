import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { describeError } from "../src/errors";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { messagesFor, withFallback } from "../src/i18n/i18n";

/** Every path to a text, such as "login.title", in a set of messages. */
function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) =>
    keys(inner, prefix ? `${prefix}.${key}` : key),
  );
}

describe("languages", () => {
  it("has every English text in Spanish too", () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
  });

  it("falls back to English for any text a language leaves out", () => {
    const merged = withFallback(en, { login: { title: "Plano" } });
    expect(merged.login.title).toBe("Plano");
    expect(merged.login.submit).toBe(en.login.submit);
  });

  it("shows Spanish by default texts", () => {
    expect(messagesFor("es").login.submit).toBe("Entrar");
    expect(messagesFor("en").login.submit).toBe("Sign in");
  });

  it("explains each API refusal in the person's language", () => {
    const t = messagesFor("es");
    const booked = new ApiError(409, "x", { code: "upcoming_reservations", count: 2 });
    expect(describeError(t, booked, "tableDelete")).toMatch(/2 reservas próximas/);
    expect(describeError(t, booked, "zoneDelete")).toMatch(/Las mesas de esta zona/);
    expect(describeError(t, new ApiError(409, "x", { code: "duplicate_label" }), "table")).toMatch(
      /otra mesa con ese nombre/,
    );
    expect(describeError(t, new ApiError(0, "offline"), "table")).toBe(t.errors.network);
    expect(describeError(t, new ApiError(503, "busy"), "table")).toBe(t.errors.busy);
    // An unknown refusal still says what the server said.
    expect(describeError(t, new ApiError(400, "body/x must be integer"), "table")).toMatch(
      /body\/x must be integer/,
    );
  });
});
