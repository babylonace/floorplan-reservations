import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { ApiError } from "../api/client";
import { useApi } from "../api/context";
import type { Booking, BookingOptions, BookingRequest, BookingRules, Slot } from "../api/types";
import { NoticeArea, type NoticeMessage } from "../components/ui";
import { Calendar } from "./Calendar";
import { addDays, alternativesFor, firstBookableDay, isBookableDay, todayIn } from "./dates";
import type { BookingMessages } from "./en";
import { BOOKING_LOCALE_NAMES, BOOKING_LOCALES, dateTag, useBookingI18n } from "./i18n";

/**
 * The public booking page of one venue: how many people, which zone, the day, the time, and
 * the guest's name and a way to reach them. Nothing more is asked (data minimisation).
 */

/** The venue's slug from /reservar/<slug>. */
export function slugFromPath(pathname: string): string {
  return decodeURIComponent(pathname.split("/")[2] ?? "");
}

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "failed" }
  | { state: "ready"; options: BookingOptions; rules: BookingRules; today: string };

export function BookingPage({ slug }: { slug: string }) {
  const { t } = useBookingI18n();
  const client = useApi();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([client.bookingOptions(slug), client.bookingRules(slug)]).then(
      ([options, rules]) => {
        if (live) setLoad({ state: "ready", options, rules, today: todayIn(options.timeZone) });
      },
      (error: unknown) => {
        if (!live) return;
        const missing = error instanceof ApiError && (error.status === 404 || error.status === 400);
        setLoad({ state: missing ? "missing" : "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [client, slug, attempt]);

  const venueName = load.state === "ready" ? load.options.name : null;
  useEffect(() => {
    document.title = venueName ? t.pageTitle(venueName) : t.title;
  }, [t, venueName]);

  return (
    <div className="booking">
      <header className="booking-top">
        <p className="booking-venue">{venueName}</p>
        <LanguagePicker />
      </header>
      <main className="booking-main">
        <h1>{t.title}</h1>
        {load.state === "loading" && <p role="status">{t.loading}</p>}
        {load.state === "missing" && <p role="alert">{t.notFound}</p>}
        {load.state === "failed" && (
          <div role="alert" className="booking-problem">
            <p>{t.loadFailed}</p>
            <button
              type="button"
              className="button"
              onClick={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              {t.retry}
            </button>
          </div>
        )}
        {load.state === "ready" && (
          <BookingFlow slug={slug} options={load.options} rules={load.rules} today={load.today} />
        )}
      </main>
    </div>
  );
}

function LanguagePicker() {
  const { t, locale, setLocale } = useBookingI18n();
  return (
    <div className="language-switch" role="group" aria-label={t.language}>
      {BOOKING_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          dir="auto"
          aria-pressed={code === locale}
          onClick={() => {
            setLocale(code);
          }}
        >
          {BOOKING_LOCALE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}

/** The times of one day for one party size; null slots when they could not be read. */
interface Times {
  key: string;
  slots: Slot[] | null;
}

interface Fields {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

type FieldErrors = Partial<Record<"name" | "contact" | "email" | "phone", string>>;

const EMPTY_FIELDS: Fields = { name: "", email: "", phone: "", notes: "" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkFields(t: BookingMessages, fields: Fields): FieldErrors {
  const errors: FieldErrors = {};
  const email = fields.email.trim();
  const phone = fields.phone.trim();
  if (!fields.name.trim()) errors.name = t.nameMissing;
  if (!email && !phone) errors.contact = t.contactMissing;
  if (email && !EMAIL.test(email)) errors.email = t.emailInvalid;
  if (phone && phone.replace(/[^0-9]/g, "").length < 6) errors.phone = t.phoneInvalid;
  return errors;
}

/** The sentence for a booking the API refused, and whether the times should be read again. */
function refusalOf(t: BookingMessages, error: unknown): { text: string; refresh: boolean } {
  const failure = error instanceof ApiError ? error : new ApiError(0, String(error));
  if (failure.status === 0) return { text: t.errors.network, refresh: false };
  if (failure.status === 429) return { text: t.errors.tooMany, refresh: false };
  if (failure.status === 503) return { text: t.errors.busy, refresh: false };
  if (failure.status >= 500) return { text: t.errors.server, refresh: false };
  switch (failure.code) {
    case "duplicate":
      return { text: t.errors.duplicate, refresh: false };
    case "no_table":
    case "zone_full":
      return { text: t.errors.taken, refresh: true };
    case "closed":
    case "beyond_horizon":
    case "invalid":
      return { text: t.errors.closed, refresh: true };
    default:
      return { text: t.errors.rejected, refresh: false };
  }
}

function BookingFlow({
  slug,
  options,
  rules,
  today,
}: {
  slug: string;
  options: BookingOptions;
  rules: BookingRules;
  today: string;
}) {
  const { t, locale } = useBookingI18n();
  const client = useApi();
  const ids = useId();
  const last = addDays(today, rules.horizonDays);
  const [party, setParty] = useState(Math.min(2, options.largestParty));
  const [zoneId, setZoneId] = useState("");
  const [date, setDate] = useState(() => firstBookableDay(rules, today, rules.horizonDays));
  const [time, setTime] = useState<string | null>(null);
  const [times, setTimes] = useState<Times | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [booked, setBooked] = useState<{ booking: Booking; date: string; time: string } | null>(
    null,
  );
  const form = useRef<HTMLFormElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  /** Set by a refused submit: the first field in error gets focus once it shows as one. */
  const focusError = useRef(false);

  useEffect(() => {
    if (!focusError.current) return;
    focusError.current = false;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  // Read again whenever the day, the party or `refresh` changes; until then it is loading.
  const timesKey = `${date ?? ""}|${String(party)}|${String(refresh)}`;
  useEffect(() => {
    if (!date) return;
    let live = true;
    client.availability(slug, date, party).then(
      (result) => {
        if (live) setTimes({ key: timesKey, slots: result.slots });
      },
      () => {
        if (live) setTimes({ key: timesKey, slots: null });
      },
    );
    return () => {
      live = false;
    };
  }, [client, slug, date, party, timesKey]);
  const current = times?.key === timesKey ? times : null;
  const timesState = !current ? "loading" : current.slots === null ? "failed" : "ready";

  useEffect(() => {
    if (booked) doneHeading.current?.focus();
  }, [booked]);

  const slots = current?.slots ?? [];
  // A time that filled up (or a party that no longer fits) no longer counts as chosen.
  const chosen = slots.find((slot) => slot.time === time && slot.available);

  const zoneName = useCallback(
    (id: string) => options.zones.find((zone) => zone.id === id)?.name ?? "",
    [options.zones],
  );
  const zoneFull = chosen !== undefined && zoneId !== "" && !chosen.zoneIds.includes(zoneId);
  const ready = chosen !== undefined && !zoneFull;
  const dayName = (day: string) =>
    new Intl.DateTimeFormat(dateTag(locale), {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(`${day}T00:00:00Z`));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!chosen || !date) return;
    const found = checkFields(t, fields);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusError.current = true;
      return;
    }
    const email = fields.email.trim();
    const phone = fields.phone.trim();
    const notes = fields.notes.trim();
    const request: BookingRequest = {
      startsAt: chosen.startsAt,
      partySize: party,
      guestName: fields.name.trim(),
      ...(email ? { guestEmail: email } : {}),
      ...(phone ? { guestPhone: phone } : {}),
      ...(notes ? { notes } : {}),
      // The venue writes to the guest in this language, if it offers it.
      ...(options.locales.includes(locale) ? { locale } : {}),
      ...(zoneId ? { zoneId } : {}),
    };
    setSending(true);
    setNotice(null);
    try {
      const booking = await client.book(slug, request);
      setBooked({ booking, date, time: chosen.time });
    } catch (error) {
      const refusal = refusalOf(t, error);
      setNotice({ tone: "error", text: refusal.text });
      if (refusal.refresh) setRefresh((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  if (booked) {
    const zone = zoneName(booked.booking.tables[0]?.zoneId ?? "");
    return (
      <section className="booking-done" aria-labelledby={`${ids}-done`}>
        <h2 id={`${ids}-done`} ref={doneHeading} tabIndex={-1}>
          {t.doneTitle}
        </h2>
        <p className="booking-summary">
          {t.summary(booked.booking.partySize, dayName(booked.date), booked.time)}
        </p>
        {zone && <p>{t.doneZone(zone)}</p>}
        <p>{t.doneBody}</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            setBooked(null);
            setTime(null);
            setFields(EMPTY_FIELDS);
            setErrors({});
            setRefresh((n) => n + 1);
          }}
        >
          {t.again}
        </button>
      </section>
    );
  }

  return (
    <>
      <form ref={form} className="booking-form" noValidate onSubmit={(event) => void submit(event)}>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${ids}-party`}>{t.party}</label>
            <select
              id={`${ids}-party`}
              value={party}
              aria-describedby={`${ids}-party-hint`}
              onChange={(event) => {
                setParty(Number(event.target.value));
              }}
            >
              {Array.from({ length: options.largestParty }, (_, index) => index + 1).map((n) => (
                <option key={n} value={n}>
                  {t.people(n)}
                </option>
              ))}
            </select>
            <p id={`${ids}-party-hint`} className="visually-hidden">
              {t.partyHint(options.largestParty)}
            </p>
          </div>
          {options.zones.length > 1 && (
            <div className="field">
              <label htmlFor={`${ids}-zone`}>{t.zone}</label>
              <select
                id={`${ids}-zone`}
                value={zoneId}
                aria-describedby={`${ids}-zone-hint`}
                onChange={(event) => {
                  setZoneId(event.target.value);
                }}
              >
                <option value="">{t.anyZone}</option>
                {options.zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
              <p id={`${ids}-zone-hint`} className="visually-hidden">
                {t.zoneHint}
              </p>
            </div>
          )}
        </div>

        <fieldset className="field">
          <legend>{t.day}</legend>
          <Calendar
            selected={date}
            first={today}
            last={last}
            isBookable={(day) => isBookableDay(rules, day, today, rules.horizonDays)}
            onSelect={(day) => {
              setDate(day);
              setTime(null);
            }}
          />
        </fieldset>

        {date && (
          <fieldset className="field">
            <legend>{t.time}</legend>
            {timesState === "loading" && <p role="status">{t.loadingTimes}</p>}
            {timesState === "failed" && (
              <div role="alert" className="booking-problem">
                <p>{t.timesFailed}</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setRefresh((n) => n + 1);
                  }}
                >
                  {t.retry}
                </button>
              </div>
            )}
            {timesState === "ready" && slots.length === 0 && <p>{t.noTimes}</p>}
            {timesState === "ready" && slots.length > 0 && (
              <div className="slot-grid">
                {slots.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    className="slot"
                    aria-pressed={slot.time === chosen?.time}
                    aria-disabled={!slot.available || undefined}
                    aria-label={slot.available ? undefined : t.fullTime(slot.time)}
                    onClick={() => {
                      if (slot.available) setTime(slot.time);
                    }}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            )}
            <div aria-live="polite">
              {zoneFull && (
                <ZoneFullHelp
                  slots={slots}
                  time={chosen.time}
                  zoneId={zoneId}
                  zoneName={zoneName}
                  onTime={setTime}
                  onZone={setZoneId}
                />
              )}
            </div>
          </fieldset>
        )}

        {ready && (
          <fieldset className="field booking-details">
            <legend>{t.details}</legend>
            <DetailsFields
              fields={fields}
              errors={errors}
              onChange={(next) => {
                setFields(next);
                // Once errors show, they follow the typing, so a fixed field stops being red.
                if (Object.keys(errors).length > 0) setErrors(checkFields(t, next));
              }}
            />
            <p className="booking-privacy">{t.privacy(options.name)}</p>
            <p className="booking-summary">
              {t.summary(party, dayName(date ?? today), chosen.time)}
              {zoneId && ` · ${zoneName(zoneId)}`}
            </p>
            <button
              type="submit"
              className="button button-primary button-wide booking-submit"
              disabled={sending}
            >
              {sending ? t.submitting : t.submit}
            </button>
          </fieldset>
        )}
      </form>
      <NoticeArea
        notice={notice}
        dismissLabel={t.errors.dismiss}
        onClose={() => {
          setNotice(null);
        }}
      />
    </>
  );
}

function ZoneFullHelp({
  slots,
  time,
  zoneId,
  zoneName,
  onTime,
  onZone,
}: {
  slots: Slot[];
  time: string;
  zoneId: string;
  zoneName: (id: string) => string;
  onTime: (time: string) => void;
  onZone: (zoneId: string) => void;
}) {
  const { t } = useBookingI18n();
  const ids = useId();
  const options = alternativesFor(slots, time, zoneId);
  const name = zoneName(zoneId);
  return (
    <div className="zone-full">
      <p>{t.zoneFull(name, time)}</p>
      {options.times.length > 0 && (
        <div role="group" aria-labelledby={`${ids}-times`} className="zone-full-group">
          <p id={`${ids}-times`} className="zone-full-label">
            {t.otherTimes(name)}
          </p>
          <div className="slot-grid">
            {options.times.map((slot) => (
              <button
                key={slot.time}
                type="button"
                className="slot"
                onClick={() => {
                  onTime(slot.time);
                }}
              >
                {slot.time}
              </button>
            ))}
          </div>
        </div>
      )}
      {options.zoneIds.length > 0 && (
        <div role="group" aria-labelledby={`${ids}-zones`} className="zone-full-group">
          <p id={`${ids}-zones`} className="zone-full-label">
            {t.otherZones(time)}
          </p>
          <div className="zone-full-zones">
            {options.zoneIds.map((id) => (
              <button
                key={id}
                type="button"
                className="button"
                onClick={() => {
                  onZone(id);
                }}
              >
                {zoneName(id)}
              </button>
            ))}
          </div>
        </div>
      )}
      {options.times.length === 0 && options.zoneIds.length === 0 && <p>{t.noAlternatives}</p>}
    </div>
  );
}

function DetailsFields({
  fields,
  errors,
  onChange,
}: {
  fields: Fields;
  errors: FieldErrors;
  onChange: (fields: Fields) => void;
}) {
  const { t } = useBookingI18n();
  const ids = useId();
  const describe = (...parts: (string | false | undefined)[]) =>
    parts.filter(Boolean).join(" ") || undefined;
  const contactError = errors.contact;
  return (
    <>
      <div className="field">
        <label htmlFor={`${ids}-name`}>{t.name}</label>
        <input
          id={`${ids}-name`}
          type="text"
          autoComplete="name"
          maxLength={120}
          value={fields.name}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describe(errors.name && `${ids}-name-error`)}
          onChange={(event) => {
            onChange({ ...fields, name: event.target.value });
          }}
        />
        {errors.name && (
          <p id={`${ids}-name-error`} className="field-error">
            {errors.name}
          </p>
        )}
      </div>
      <p id={`${ids}-contact-hint`} className="visually-hidden">
        {t.contactHint}
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${ids}-email`}>{t.email}</label>
          <input
            id={`${ids}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            dir="ltr"
            maxLength={254}
            value={fields.email}
            aria-invalid={errors.email || contactError ? true : undefined}
            aria-describedby={describe(
              `${ids}-contact-hint`,
              errors.email && `${ids}-email-error`,
              contactError && `${ids}-contact-error`,
            )}
            onChange={(event) => {
              onChange({ ...fields, email: event.target.value });
            }}
          />
          {errors.email && (
            <p id={`${ids}-email-error`} className="field-error">
              {errors.email}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${ids}-phone`}>{t.phone}</label>
          <input
            id={`${ids}-phone`}
            type="tel"
            autoComplete="tel"
            dir="ltr"
            maxLength={32}
            value={fields.phone}
            aria-invalid={errors.phone || contactError ? true : undefined}
            aria-describedby={describe(
              `${ids}-contact-hint`,
              errors.phone && `${ids}-phone-error`,
              contactError && `${ids}-contact-error`,
            )}
            onChange={(event) => {
              // Only what a phone number can hold, as the API accepts it.
              onChange({ ...fields, phone: event.target.value.replace(/[^+0-9 ()-]/g, "") });
            }}
          />
          {errors.phone && (
            <p id={`${ids}-phone-error`} className="field-error">
              {errors.phone}
            </p>
          )}
        </div>
      </div>
      {contactError && (
        <p id={`${ids}-contact-error`} className="field-error booking-contact-error">
          {contactError}
        </p>
      )}
      <div className="field">
        <label htmlFor={`${ids}-notes`}>
          {t.notes} <span className="field-optional">({t.optional})</span>
        </label>
        <textarea
          id={`${ids}-notes`}
          rows={2}
          maxLength={500}
          value={fields.notes}
          aria-describedby={`${ids}-notes-hint`}
          onChange={(event) => {
            onChange({ ...fields, notes: event.target.value });
          }}
        />
        <p id={`${ids}-notes-hint`} className="visually-hidden">
          {t.notesHint}
        </p>
      </div>
    </>
  );
}
