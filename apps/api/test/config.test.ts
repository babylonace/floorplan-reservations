import { describe, expect, it } from "vitest";
import { loadConfig, parseTrustProxy } from "../src/config.js";

const BASE = { DATABASE_URL: "postgres://localhost/example" };

describe("loadConfig", () => {
  it("limits bookings to 10 requests per address every 15 minutes unless told otherwise", () => {
    expect(loadConfig(BASE).bookingRateLimit).toEqual({ max: 10, windowMs: 15 * 60_000 });
    expect(
      loadConfig({
        ...BASE,
        BOOKING_RATE_LIMIT_MAX: "30",
        BOOKING_RATE_LIMIT_WINDOW_MINUTES: "60",
      }).bookingRateLimit,
    ).toEqual({ max: 30, windowMs: 60 * 60_000 });
  });

  it("refuses a rate limit that is not a whole number above 0", () => {
    expect(() => loadConfig({ ...BASE, BOOKING_RATE_LIMIT_MAX: "0" })).toThrow(
      /BOOKING_RATE_LIMIT_MAX/,
    );
    expect(() => loadConfig({ ...BASE, BOOKING_RATE_LIMIT_WINDOW_MINUTES: "1.5" })).toThrow(
      /BOOKING_RATE_LIMIT_WINDOW_MINUTES/,
    );
  });

  it("trusts no proxy unless told which one", () => {
    expect(loadConfig(BASE).trustProxy).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("127.0.0.1,10.0.0.0/8")).toBe("127.0.0.1,10.0.0.0/8");
  });
});
