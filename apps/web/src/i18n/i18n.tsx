import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type Messages } from "./en";
import { es } from "./es";

/**
 * Languages. Spanish comes first; English is complete and fills any gap another language
 * leaves, so a missing translation shows English instead of nothing.
 */

export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
export const FALLBACK_LOCALE: Locale = "en";

/** Each language's own name, the same whichever language is showing. */
export const LOCALE_NAMES: Record<Locale, string> = { es: "Español", en: "English" };

const CATALOGS: Record<Locale, DeepPartial<Messages>> = { es, en };
const STORAGE_KEY = "floorplan.locale";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `base` with every text `override` has put in its place. */
export function withFallback<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = withFallback(base[key], value);
  }
  return merged as T;
}

export function messagesFor(locale: Locale): Messages {
  return withFallback<Messages>(en, CATALOGS[locale]);
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The language picked last time on this device, if the browser lets us read it. */
function storedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Private windows may refuse; the choice then lasts until the page is closed.
  }
}

/** Numbers as the language writes them. */
export function formatterFor(locale: Locale) {
  const tag = locale === "es" ? "es-ES" : "en-GB";
  const whole = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const metres = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  return {
    cm: (value: number) => whole.format(value),
    meters: (cm: number) => `${metres.format(cm / 100)} m`,
  };
}

interface I18n {
  locale: Locale;
  t: Messages;
  format: ReturnType<typeof formatterFor>;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initial ?? storedLocale() ?? DEFAULT_LOCALE,
  );

  const value = useMemo<I18n>(
    () => ({
      locale,
      t: messagesFor(locale),
      format: formatterFor(locale),
      setLocale: (next) => {
        storeLocale(next);
        setLocaleState(next);
      },
    }),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = value.t.app.name;
  }, [locale, value.t.app.name]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n needs an I18nProvider above it");
  return value;
}
