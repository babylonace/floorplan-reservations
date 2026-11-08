import { windowsOn, type OpeningHours } from "@floorplan-reservations/engine";
import type { Slot } from "../api/types";

/**
 * Calendar sums for the booking page. Dates are "YYYY-MM-DD" in the venue's own time zone, so
 * the guest sees the venue's days whatever the clock on their phone says.
 */

/** Today in a time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // Canadian English writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const day = toUtc(date);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** "YYYY-MM" of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, months: number): string {
  const day = toUtc(`${month}-01`);
  day.setUTCMonth(day.getUTCMonth() + months);
  return day.toISOString().slice(0, 7);
}

/**
 * The weeks of a month, Monday first, as dates; the days of the neighbouring months are null.
 */
export function monthWeeks(month: string): (string | null)[][] {
  const first = toUtc(`${month}-01`);
  const lead = (first.getUTCDay() + 6) % 7;
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let date = `${month}-01`; monthOf(date) === month; date = addDays(date, 1)) {
    days.push(date);
  }
  while (days.length % 7 !== 0) days.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** True when guests may book `date`: inside the horizon and with some arrival window. */
export function isBookableDay(
  hours: OpeningHours,
  date: string,
  today: string,
  horizonDays: number,
): boolean {
  return date >= today && date <= addDays(today, horizonDays) && windowsOn(hours, date).length > 0;
}

/** The first day guests may book from `today` on, or null when there is none. */
export function firstBookableDay(
  hours: OpeningHours,
  today: string,
  horizonDays: number,
): string | null {
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i);
    if (windowsOn(hours, date).length > 0) return date;
  }
  return null;
}

export interface Alternatives {
  /** Times of the same day with room in the zone: the nearest ones, in clock order. */
  times: Slot[];
  /** Other zones with room at the chosen time, in the venue's order. */
  zoneIds: string[];
}

/**
 * What to offer when the zone a guest asked for is full at the chosen time: the nearest times
 * of that day with room in that zone, and the other zones with room at that time. Distance goes
 * by place in the day's list, which stays in order past midnight.
 */
export function alternativesFor(
  slots: readonly Slot[],
  time: string,
  zoneId: string,
  limit = 3,
): Alternatives {
  const origin = slots.findIndex((slot) => slot.time === time);
  const chosen = slots[origin];
  if (!chosen) return { times: [], zoneIds: [] };
  const nearest = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => index !== origin && slot.zoneIds.includes(zoneId))
    .sort((a, b) => Math.abs(a.index - origin) - Math.abs(b.index - origin) || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index);
  return {
    times: nearest.map(({ slot }) => slot),
    zoneIds: chosen.zoneIds.filter((id) => id !== zoneId),
  };
}
