/**
 * Opening hours as arrival windows: the first and the last time a guest may arrive.
 *
 * Dates are "YYYY-MM-DD" and times "HH:MM" (or "HH:MM:SS"), both in the venue's own time zone.
 * Nothing here knows about time zones: the caller turns an instant into the venue's local date
 * and time first.
 */

export interface ArrivalWindow {
  firstArrival: string;
  /** Earlier than `firstArrival` when the window runs past midnight. */
  lastArrival: string;
}

export interface WeeklyWindow extends ArrivalWindow {
  /** 1 = Monday ... 7 = Sunday. */
  weekday: number;
}

export interface SpecialDay {
  date: string;
  /** Replaces the weekly hours of that date. Empty means closed all day. */
  windows: ArrivalWindow[];
}

export interface OpeningHours {
  weekly: WeeklyWindow[];
  specialDays: SpecialDay[];
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function parseDate(date: string): Date {
  const match = DATE.exec(date);
  if (!match) throw new Error(`Not a date: ${date}`);
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  // Date.UTC would read years 0-99 as 1900-1999, so the year is set on its own.
  const parsed = new Date(Date.UTC(2000, month - 1, day));
  parsed.setUTCFullYear(year);
  // There is no year 0 in the calendar PostgreSQL uses.
  if (year < 1 || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`Not a date: ${date}`);
  }
  return parsed;
}

/** Seconds since midnight. */
function parseTime(time: string): number {
  const match = TIME.exec(time);
  if (!match) throw new Error(`Not a time: ${time}`);
  const [hours, minutes, seconds] = [match[1], match[2], match[3] ?? "0"].map(Number) as [
    number,
    number,
    number,
  ];
  return hours * 3600 + minutes * 60 + seconds;
}

/** 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  return parseDate(date).getUTCDay() || 7;
}

export function previousDay(date: string): string {
  const day = parseDate(date);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** The windows that start on `date`: the special day's if it is one, else the weekly ones. */
export function windowsOn(hours: OpeningHours, date: string): ArrivalWindow[] {
  const special = hours.specialDays.find((day) => day.date === date);
  if (special) return special.windows;
  const weekday = isoWeekday(date);
  return hours.weekly.filter((window) => window.weekday === weekday);
}

function runsPastMidnight(window: ArrivalWindow): boolean {
  return parseTime(window.lastArrival) < parseTime(window.firstArrival);
}

/**
 * True when a guest may arrive at `time` on `date`. A window runs from its first to its last
 * arrival, both included. A window that runs past midnight also covers the early hours of the
 * next day, even when that next day is closed.
 */
export function acceptsArrival(hours: OpeningHours, date: string, time: string): boolean {
  const at = parseTime(time);
  const today = windowsOn(hours, date).some((window) => {
    const first = parseTime(window.firstArrival);
    const last = parseTime(window.lastArrival);
    return runsPastMidnight(window) ? at >= first : at >= first && at <= last;
  });
  if (today) return true;
  return windowsOn(hours, previousDay(date)).some(
    (window) => runsPastMidnight(window) && at <= parseTime(window.lastArrival),
  );
}

export function nextDay(date: string): string {
  const day = parseDate(date);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

export interface ArrivalTime {
  /** The calendar date of the arrival: the next day for times past midnight. */
  date: string;
  /** "HH:MM". */
  time: string;
}

function hhmm(minutes: number): string {
  const wrapped = minutes % (24 * 60);
  const hours = Math.floor(wrapped / 60);
  return `${String(hours).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * The times a guest can pick for the day `date`: every `stepMinutes` from each window's first
 * arrival up to its last one. A window that runs past midnight belongs to the day it starts on,
 * so its late times are dated the next day. Early times of a window that started the day before
 * are listed under that day, not this one. Sorted, without repeats.
 */
export function arrivalTimes(hours: OpeningHours, date: string, stepMinutes = 15): ArrivalTime[] {
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1) {
    throw new RangeError(`Step must be a whole number of minutes, got ${String(stepMinutes)}`);
  }
  const following = nextDay(date);
  const seen = new Map<number, ArrivalTime>();
  for (const window of windowsOn(hours, date)) {
    const first = Math.ceil(parseTime(window.firstArrival) / 60);
    let last = Math.floor(parseTime(window.lastArrival) / 60);
    if (runsPastMidnight(window)) last += 24 * 60;
    for (let at = first; at <= last; at += stepMinutes) {
      seen.set(at, { date: at >= 24 * 60 ? following : date, time: hhmm(at) });
    }
  }
  return [...seen.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
}
