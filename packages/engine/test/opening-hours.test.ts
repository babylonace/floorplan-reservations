import { describe, expect, it } from "vitest";
import {
  acceptsArrival,
  isoWeekday,
  previousDay,
  windowsOn,
  type OpeningHours,
} from "../src/index.js";

// 2030-06-01 is a Saturday.
const SATURDAY = "2030-06-01";
const SUNDAY = "2030-06-02";
const MONDAY = "2030-06-03";

const hours: OpeningHours = {
  weekly: [
    // Lunch and dinner on Saturday, dinner running past midnight.
    { weekday: 6, firstArrival: "13:00", lastArrival: "15:30" },
    { weekday: 6, firstArrival: "20:00", lastArrival: "00:30" },
    // Sunday lunch only.
    { weekday: 7, firstArrival: "13:00", lastArrival: "15:30" },
  ],
  specialDays: [],
};

describe("dates", () => {
  it("numbers weekdays from Monday = 1 to Sunday = 7", () => {
    expect(isoWeekday(SATURDAY)).toBe(6);
    expect(isoWeekday(SUNDAY)).toBe(7);
    expect(isoWeekday(MONDAY)).toBe(1);
  });

  it("steps back across months and years", () => {
    expect(previousDay("2030-03-01")).toBe("2030-02-28");
    expect(previousDay("2032-03-01")).toBe("2032-02-29");
    expect(previousDay("2031-01-01")).toBe("2030-12-31");
  });

  it("refuses days that do not exist", () => {
    expect(() => isoWeekday("2030-02-31")).toThrow();
    expect(() => isoWeekday("2031-02-29")).toThrow();
    expect(() => isoWeekday("0000-01-01")).toThrow();
    // 1 January of the year 50 (on the Gregorian calendar, as PostgreSQL counts it), not 1950.
    expect(isoWeekday("0050-01-01")).toBe(6);
    expect(() => acceptsArrival(hours, SATURDAY, "24:00")).toThrow();
  });
});

describe("acceptsArrival", () => {
  it("accepts the first and the last arrival and everything between", () => {
    expect(acceptsArrival(hours, SATURDAY, "13:00")).toBe(true);
    expect(acceptsArrival(hours, SATURDAY, "14:15")).toBe(true);
    expect(acceptsArrival(hours, SATURDAY, "15:30")).toBe(true);
    expect(acceptsArrival(hours, SATURDAY, "15:30:01")).toBe(false);
    expect(acceptsArrival(hours, SATURDAY, "12:59")).toBe(false);
    expect(acceptsArrival(hours, SATURDAY, "17:00")).toBe(false);
  });

  it("keeps a late window open past midnight, into the next day", () => {
    expect(acceptsArrival(hours, SATURDAY, "23:45")).toBe(true);
    expect(acceptsArrival(hours, SUNDAY, "00:15")).toBe(true);
    expect(acceptsArrival(hours, SUNDAY, "00:30")).toBe(true);
    expect(acceptsArrival(hours, SUNDAY, "00:31")).toBe(false);
    // Sunday has no late window, so Monday's early hours are closed.
    expect(acceptsArrival(hours, MONDAY, "00:15")).toBe(false);
  });

  it("is closed on a weekday with no windows", () => {
    expect(acceptsArrival(hours, MONDAY, "13:30")).toBe(false);
  });

  it("lets a special day replace the weekly hours", () => {
    const withSpecial: OpeningHours = {
      ...hours,
      specialDays: [
        // A holiday Monday: open for lunch.
        { date: MONDAY, windows: [{ firstArrival: "12:00", lastArrival: "14:00" }] },
        // A closed Saturday.
        { date: SATURDAY, windows: [] },
      ],
    };
    expect(acceptsArrival(withSpecial, MONDAY, "12:30")).toBe(true);
    expect(acceptsArrival(withSpecial, MONDAY, "13:00")).toBe(true);
    expect(acceptsArrival(withSpecial, SATURDAY, "13:00")).toBe(false);
    expect(acceptsArrival(withSpecial, SATURDAY, "21:00")).toBe(false);
    // Saturday's late window is gone with the rest of Saturday.
    expect(acceptsArrival(withSpecial, SUNDAY, "00:15")).toBe(false);
    expect(windowsOn(withSpecial, SATURDAY)).toEqual([]);
  });

  it("does not let a closed day cut short the late window of the day before", () => {
    const closedSunday: OpeningHours = { ...hours, specialDays: [{ date: SUNDAY, windows: [] }] };
    expect(acceptsArrival(closedSunday, SUNDAY, "00:15")).toBe(true);
    expect(acceptsArrival(closedSunday, SUNDAY, "13:00")).toBe(false);
  });

  it("treats a window whose first and last arrival match as a single arrival time", () => {
    const single: OpeningHours = {
      weekly: [{ weekday: 6, firstArrival: "21:00", lastArrival: "21:00" }],
      specialDays: [],
    };
    expect(acceptsArrival(single, SATURDAY, "21:00")).toBe(true);
    expect(acceptsArrival(single, SATURDAY, "21:01")).toBe(false);
    expect(acceptsArrival(single, SUNDAY, "00:00")).toBe(false);
  });

  it("takes any of several overlapping windows", () => {
    const overlapping: OpeningHours = {
      weekly: [
        { weekday: 6, firstArrival: "12:00", lastArrival: "14:00" },
        { weekday: 6, firstArrival: "13:30", lastArrival: "16:00" },
      ],
      specialDays: [],
    };
    expect(acceptsArrival(overlapping, SATURDAY, "15:00")).toBe(true);
  });

  it("is closed everywhere when there are no hours at all", () => {
    expect(acceptsArrival({ weekly: [], specialDays: [] }, SATURDAY, "20:00")).toBe(false);
  });
});
