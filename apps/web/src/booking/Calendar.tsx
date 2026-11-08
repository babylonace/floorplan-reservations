import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ButtonLabel } from "../components/ui";
import { addDays, addMonths, monthOf, monthWeeks } from "./dates";
import { dateTag, directionOf, useBookingI18n } from "./i18n";

/** A Monday, to name the weekdays from. */
const A_MONDAY = "2024-01-01";

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/**
 * A month of days to pick from. Days the venue does not take bookings stay in the tab order of
 * the arrow keys but cannot be picked. One day is in the Tab order: the chosen one.
 */
export function Calendar({
  selected,
  first,
  last,
  isBookable,
  onSelect,
}: {
  selected: string | null;
  /** The first and last day guests may book. */
  first: string;
  last: string;
  isBookable: (date: string) => boolean;
  onSelect: (date: string) => void;
}) {
  const { t, locale } = useBookingI18n();
  const ids = useId();
  const [month, setMonth] = useState(() => monthOf(selected ?? first));
  /** The day the keyboard just moved to in another month; it gets focus once that is shown. */
  const pendingFocus = useRef<string | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  const rtl = directionOf(locale) === "rtl";
  const tag = dateTag(locale);

  const focusDay = (date: string) =>
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();

  useEffect(() => {
    if (pendingFocus.current) focusDay(pendingFocus.current);
    pendingFocus.current = null;
  }, [month]);

  const weeks = monthWeeks(month);
  const days = weeks.flat().filter((date): date is string => date !== null);
  const inMonth = (date: string | null) => date !== null && days.includes(date);
  const tabStop = inMonth(selected)
    ? selected
    : (days.find((date) => date >= first && date <= last && isBookable(date)) ?? days[0]);

  const monthName = new Intl.DateTimeFormat(tag, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc(`${month}-01`));
  const longDate = new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const weekday = (format: "short" | "long", index: number) =>
    new Intl.DateTimeFormat(tag, { weekday: format, timeZone: "UTC" }).format(
      utc(addDays(A_MONDAY, index)),
    );

  const canGoBack = month > monthOf(first);
  const canGoOn = month < monthOf(last);

  function moveTo(date: string) {
    const target = date < first ? first : date > last ? last : date;
    if (monthOf(target) === month) {
      focusDay(target);
    } else {
      pendingFocus.current = target;
      setMonth(monthOf(target));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const step: Record<string, number> = {
      ArrowLeft: rtl ? 1 : -1,
      ArrowRight: rtl ? -1 : 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const days = step[event.key];
    if (days === undefined) return;
    event.preventDefault();
    moveTo(addDays(date, days));
  }

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button
          type="button"
          className="button button-quiet calendar-nav"
          aria-disabled={!canGoBack || undefined}
          onClick={() => {
            if (canGoBack) setMonth(addMonths(month, -1));
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="flip-rtl">
            <path d="M10 3L5 8l5 5" />
          </svg>
          <ButtonLabel full={t.previousMonth} />
        </button>
        <h2 id={`${ids}-month`} className="calendar-month" aria-live="polite">
          {monthName}
        </h2>
        <button
          type="button"
          className="button button-quiet calendar-nav"
          aria-disabled={!canGoOn || undefined}
          onClick={() => {
            if (canGoOn) setMonth(addMonths(month, 1));
          }}
        >
          <ButtonLabel full={t.nextMonth} />
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="flip-rtl">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
      </div>
      <p id={`${ids}-hint`} className="visually-hidden">
        {t.calendarHint}
      </p>
      <table ref={grid} className="calendar-grid" aria-labelledby={`${ids}-month`}>
        <thead>
          <tr>
            {Array.from({ length: 7 }, (_, index) => (
              <th key={index} scope="col" abbr={weekday("long", index)}>
                {weekday("short", index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, row) => (
            <tr key={row}>
              {week.map((date, column) => {
                if (!date) return <td key={column} />;
                const open = date >= first && date <= last && isBookable(date);
                const name = longDate.format(utc(date));
                return (
                  <td key={date}>
                    <button
                      type="button"
                      className="calendar-day"
                      data-date={date}
                      tabIndex={date === tabStop ? 0 : -1}
                      aria-pressed={date === selected}
                      aria-disabled={!open || undefined}
                      aria-label={open ? name : t.closedDay(name)}
                      aria-describedby={`${ids}-hint`}
                      onKeyDown={(event) => {
                        onKeyDown(event, date);
                      }}
                      onClick={() => {
                        if (open) onSelect(date);
                      }}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
