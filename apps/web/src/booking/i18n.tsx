import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { withFallback, type DeepPartial } from "../i18n/i18n";
import { ar } from "./ar";
import { en, type BookingMessages } from "./en";
import { es } from "./es";

/**
 * Languages of the public booking page: Spanish first, English, and Arabic written right to
 * left. English is complete and fills any gap another language leaves.
 */

export const BOOKING_LOCALES = ["es", "en", "ar"] as const;
export type BookingLocale = (typeof BOOKING_LOCALES)[number];

/** Each language's own name, the same whichever language is showing. */
export const BOOKING_LOCALE_NAMES: Record<BookingLocale, string> = {
  es: "Español",
  en: "English",
  ar: "العربية",
};

const CATALOGS: Record<BookingLocale, DeepPartial<BookingMessages>> = { es, en, ar };
const RIGHT_TO_LEFT = new Set<BookingLocale>(["ar"]);
const STORAGE_KEY = "floorplan.booking.locale";

export function bookingMessages(locale: BookingLocale): BookingMessages {
  return withFallback<BookingMessages>(en, CATALOGS[locale]);
}

export function isBookingLocale(value: unknown): value is BookingLocale {
  return typeof value === "string" && (BOOKING_LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: BookingLocale): "rtl" | "ltr" {
  return RIGHT_TO_LEFT.has(locale) ? "rtl" : "ltr";
}

/** Dates as the language writes them, with the digits the times on the page use. */
export function dateTag(locale: BookingLocale): string {
  return locale === "es" ? "es-ES" : locale === "en" ? "en-GB" : "ar-u-nu-latn";
}

/** The language picked last time on this device, else Spanish; guests change it on the page. */
export function initialBookingLocale(): BookingLocale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isBookingLocale(stored)) return stored;
  } catch {
    // Private windows may refuse; then the page opens in Spanish.
  }
  return "es";
}

interface BookingI18n {
  locale: BookingLocale;
  t: BookingMessages;
  setLocale: (locale: BookingLocale) => void;
}

const BookingI18nContext = createContext<BookingI18n | null>(null);

export function BookingI18nProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: BookingLocale;
}) {
  const [locale, setLocaleState] = useState<BookingLocale>(() => initial ?? initialBookingLocale());

  const value = useMemo<BookingI18n>(
    () => ({
      locale,
      t: bookingMessages(locale),
      setLocale: (next) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // The choice then lasts until the page is closed.
        }
        setLocaleState(next);
      },
    }),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);
  }, [locale]);

  return <BookingI18nContext.Provider value={value}>{children}</BookingI18nContext.Provider>;
}

export function useBookingI18n(): BookingI18n {
  const value = useContext(BookingI18nContext);
  if (!value) throw new Error("useBookingI18n needs a BookingI18nProvider above it");
  return value;
}
