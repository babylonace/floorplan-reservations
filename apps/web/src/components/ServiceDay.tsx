import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api/client";
import { useApi } from "../api/context";
import type { FloorPlan, ServiceDay as Day, ServiceReservation, StaffAction } from "../api/types";
import { addDays, todayIn } from "../booking/dates";
import { describeError, isSignedOut } from "../errors";
import { useI18n } from "../i18n/i18n";
import { ServicePlan } from "./ServicePlan";
import { ConfirmDialog, SideSlotContext, useNotice } from "./ui";

/** Bookings that still hold their tables. */
const HOLDING = new Set(["pending", "confirmed", "seated"]);

/** What staff can do next with a booking, the most likely first. */
const NEXT: Record<string, StaffAction[]> = {
  pending: ["confirmed", "seated", "no_show", "cancelled"],
  confirmed: ["seated", "no_show", "cancelled"],
};

/** These cannot be undone, so they ask first. */
const ASKS_FIRST = new Set<StaffAction>(["cancelled", "no_show"]);

/** New bookings arrive from the booking page; the list looks for them this often. */
const REFRESH_MS = 60_000;

/** HH:MM of an instant in the venue's time zone. */
function localTime(timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Which booking holds each table at `at`. */
function takenAt(reservations: readonly ServiceReservation[], at: number) {
  const taken = new Map<string, ServiceReservation>();
  for (const reservation of reservations) {
    if (!HOLDING.has(reservation.status)) continue;
    if (Date.parse(reservation.startsAt) > at || Date.parse(reservation.endsAt) <= at) continue;
    for (const table of reservation.tables) taken.set(table.id, reservation);
  }
  return taken;
}

/**
 * The day's service: the bookings of one day in arrival order on the left, with buttons to
 * confirm, seat, mark a no-show or cancel, and the zone on the right with its taken tables.
 */
export function ServiceDay({
  slug,
  plan,
  zoneId,
  onZoneChange,
  onSessionLost,
}: {
  slug: string;
  plan: FloorPlan;
  zoneId: string | null;
  onZoneChange: (zoneId: string) => void;
  onSessionLost: () => void;
}) {
  const { t } = useI18n();
  const client = useApi();
  const notify = useNotice();
  const sideSlot = useContext(SideSlotContext);
  const ids = useId();
  const timeZone = plan.venue.timeZone;
  const today = todayIn(timeZone);

  const [date, setDate] = useState(today);
  const [day, setDay] = useState<Day | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [asking, setAsking] = useState<{
    reservation: ServiceReservation;
    action: StaffAction;
  } | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  /** The moment the plan shows, as an ISO instant; null follows the default. */
  const [planAt, setPlanAt] = useState<string | null>(null);

  // The day on screen, for answers that arrive after the person moved to another day.
  const shownDate = useRef(date);
  useEffect(() => {
    shownDate.current = date;
  }, [date]);

  const load = useCallback(
    async (target: string) => {
      try {
        const next = await client.serviceDay(slug, target);
        if (shownDate.current !== target) return;
        setDay(next);
        setLoadError(null);
      } catch (error) {
        if (isSignedOut(error)) onSessionLost();
        else if (shownDate.current === target) setLoadError(error);
      }
    },
    [client, slug, onSessionLost],
  );

  useEffect(() => {
    let current = true;
    const fetchDay = () => {
      client.serviceDay(slug, date).then(
        (next) => {
          if (!current) return;
          setDay(next);
          setLoadError(null);
        },
        (error: unknown) => {
          if (!current) return;
          if (isSignedOut(error)) onSessionLost();
          else setLoadError(error);
        },
      );
    };
    fetchDay();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchDay();
    }, REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [client, slug, date, onSessionLost]);

  function goTo(next: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next === date) return;
    setDay(null);
    setLoadError(null);
    setPickedId(null);
    setPlanAt(null);
    setDate(next);
  }

  const reservations = useMemo(() => (day?.date === date ? day.reservations : []), [day, date]);
  const active = reservations.filter((reservation) => HOLDING.has(reservation.status));
  const people = active.reduce((sum, reservation) => sum + reservation.partySize, 0);

  // The plan can show the start of each booking, and now when the day is today.
  const moments = useMemo(() => {
    const starts = [
      ...new Set(
        reservations
          .filter((reservation) => HOLDING.has(reservation.status))
          .map((reservation) => reservation.startsAt),
      ),
    ];
    const now = date === today ? [new Date().toISOString()] : [];
    return [...now, ...starts.sort()];
  }, [reservations, date, today]);
  const nowMoment = date === today ? (moments[0] ?? null) : null;
  const shownAt = planAt ?? moments[0] ?? null;
  const taken = useMemo(
    () =>
      shownAt ? takenAt(reservations, Date.parse(shownAt)) : new Map<string, ServiceReservation>(),
    [reservations, shownAt],
  );
  const picked = reservations.find((reservation) => reservation.id === pickedId) ?? null;
  const highlighted = new Set(picked?.tables.map((table) => table.id) ?? []);
  const zone = plan.zones.find((candidate) => candidate.id === zoneId) ?? plan.zones[0] ?? null;

  function pick(reservation: ServiceReservation) {
    if (pickedId === reservation.id) {
      setPickedId(null);
      return;
    }
    setPickedId(reservation.id);
    setPlanAt(reservation.startsAt);
    const first = reservation.tables[0];
    if (first && first.zoneId !== zone?.id) onZoneChange(first.zoneId);
  }

  async function act(reservation: ServiceReservation, action: StaffAction) {
    setBusyId(reservation.id);
    try {
      const updated = await client.setReservationStatus(slug, reservation.id, action);
      setDay((current) =>
        current && current.date === date
          ? {
              ...current,
              reservations: current.reservations.map((candidate) =>
                candidate.id === updated.id ? updated : candidate,
              ),
            }
          : current,
      );
      notify({ tone: "success", text: t.service.done[action](reservation.guestName) });
    } catch (error) {
      if (isSignedOut(error)) {
        onSessionLost();
      } else if (error instanceof ApiError && error.code === "status_not_allowed") {
        notify({ tone: "error", text: t.service.notAllowed });
        void load(date);
      } else {
        notify({ tone: "error", text: describeError(t, error, "load") });
      }
    } finally {
      setBusyId(null);
    }
  }

  const hintId = (action: StaffAction) => `${ids}-hint-${action}`;

  const side = (
    <div className="side-panel service-panel">
      <div className="toolbar service-toolbar">
        <div className="day-nav">
          <button
            type="button"
            className="button icon-button"
            aria-label={t.service.previousDay}
            onClick={() => {
              goTo(addDays(date, -1));
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M10 3 5 8l5 5" />
            </svg>
          </button>
          <input
            type="date"
            className="day-input"
            aria-label={t.service.day}
            value={date}
            onChange={(event) => {
              goTo(event.target.value);
            }}
          />
          <button
            type="button"
            className="button icon-button"
            aria-label={t.service.nextDay}
            onClick={() => {
              goTo(addDays(date, 1));
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="m6 3 5 5-5 5" />
            </svg>
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={date === today}
            onClick={() => {
              goTo(today);
            }}
          >
            {t.service.today}
          </button>
        </div>
        {day?.date === date && (
          <p className="save-state" role="status">
            {t.service.summary(active.length, people)}
          </p>
        )}
      </div>

      {/* What each button does, read out with it but not shown. */}
      <div hidden>
        {(Object.keys(t.service.hints) as StaffAction[]).map((action) => (
          <span key={action} id={hintId(action)}>
            {t.service.hints[action]}
          </span>
        ))}
        <span id={`${ids}-show`}>{t.service.showOnPlan}</span>
      </div>

      {loadError !== null && day?.date !== date ? (
        <div className="panel-section" role="alert">
          <p>
            {t.service.loadFailed} {describeError(t, loadError, "load")}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              void load(date);
            }}
          >
            {t.venues.retry}
          </button>
        </div>
      ) : day?.date !== date ? (
        <p className="panel-section save-state" role="status">
          {t.service.loading}
        </p>
      ) : reservations.length === 0 ? (
        <p className="panel-section save-state">{t.service.none}</p>
      ) : (
        <ol className="service-list" aria-label={t.service.listLabel}>
          {reservations.map((reservation) => {
            const actions = NEXT[reservation.status] ?? [];
            const tables =
              reservation.tables.length === 0
                ? t.service.noTable
                : `${reservation.tables[0]?.zoneName ?? ""} · ${reservation.tables.map((table) => table.label).join(" + ")}`;
            return (
              <li
                key={reservation.id}
                className={`service-card status-${reservation.status}${pickedId === reservation.id ? " is-picked" : ""}`}
              >
                <button
                  type="button"
                  className="service-card-head"
                  aria-pressed={pickedId === reservation.id}
                  aria-describedby={`${ids}-show`}
                  onClick={() => {
                    pick(reservation);
                  }}
                >
                  <time dateTime={reservation.startsAt}>
                    {localTime(timeZone, reservation.startsAt)}
                  </time>
                  <span className="service-guest">{reservation.guestName}</span>
                  <span className={`service-status status-chip status-${reservation.status}`}>
                    {t.service.status[reservation.status]}
                  </span>
                </button>
                <p className="service-meta">
                  <span>{t.service.people(reservation.partySize)}</span>
                  <span>{tables}</span>
                </p>
                <p className="service-contact">
                  {reservation.guestEmail && (
                    <a href={`mailto:${reservation.guestEmail}`}>{reservation.guestEmail}</a>
                  )}
                  {reservation.guestPhone && (
                    <a href={`tel:${reservation.guestPhone.replace(/[^+0-9]/g, "")}`}>
                      {reservation.guestPhone}
                    </a>
                  )}
                </p>
                {reservation.notes && (
                  <p className="service-note">
                    <span className="visually-hidden">{t.service.note}: </span>
                    {reservation.notes}
                  </p>
                )}
                {actions.length > 0 && (
                  <div className="service-actions">
                    {actions.map((action, index) => (
                      <button
                        key={action}
                        type="button"
                        className={
                          index === 0
                            ? "button button-primary"
                            : action === "cancelled"
                              ? "button button-danger-quiet"
                              : "button"
                        }
                        aria-describedby={hintId(action)}
                        disabled={busyId === reservation.id}
                        onClick={() => {
                          if (ASKS_FIRST.has(action)) setAsking({ reservation, action });
                          else void act(reservation, action);
                        }}
                      >
                        {t.service.actions[action]}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );

  return (
    <>
      {sideSlot ? createPortal(side, sideSlot) : side}
      <div className="service-main">
        {moments.length > 0 && shownAt && (
          <div className="service-plan-bar">
            <label className="plan-at">
              <span>{t.service.planAt}</span>
              <select
                value={shownAt}
                onChange={(event) => {
                  setPlanAt(event.target.value);
                }}
              >
                {[...new Set([shownAt, ...moments])]
                  .sort((a, b) => Date.parse(a) - Date.parse(b))
                  .map((moment) => (
                    <option key={moment} value={moment}>
                      {moment === nowMoment
                        ? `${t.service.now} (${localTime(timeZone, moment)})`
                        : localTime(timeZone, moment)}
                    </option>
                  ))}
              </select>
            </label>
            <span className="plan-legend" aria-hidden="true">
              <span className="legend-swatch is-taken" /> {t.service.taken}
              <span className="legend-swatch is-free" /> {t.service.free}
            </span>
          </div>
        )}
        <div className="canvas-wrap service-canvas">
          {zone && (
            <ServicePlan
              zone={zone}
              takenBy={taken}
              highlighted={highlighted}
              time={shownAt ? localTime(timeZone, shownAt) : "—"}
            />
          )}
        </div>
      </div>

      {asking && (
        <ConfirmDialog
          title={
            asking.action === "cancelled"
              ? t.service.cancelTitle(asking.reservation.guestName)
              : t.service.noShowTitle(asking.reservation.guestName)
          }
          body={asking.action === "cancelled" ? t.service.cancelBody : t.service.noShowBody}
          confirm={
            asking.action === "cancelled" ? t.service.cancelConfirm : t.service.noShowConfirm
          }
          cancel={t.service.keep}
          danger
          onConfirm={() => {
            const { reservation, action } = asking;
            setAsking(null);
            void act(reservation, action);
          }}
          onCancel={() => {
            setAsking(null);
          }}
        />
      )}
    </>
  );
}
