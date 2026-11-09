/**
 * The words of each e-mail, in the languages the booking page offers. Plain text: it reads
 * well in every mail program and cannot carry anything a guest typed as markup.
 */

export const EMAIL_KINDS = [
  "guest_received",
  "guest_confirmed",
  "guest_cancelled",
  "venue_new_booking",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailFacts {
  venueName: string;
  timeZone: string;
  startsAt: Date;
  partySize: number;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  notes: string | null;
  /** "Terrace · T2 + T3", or empty when no table is assigned. */
  tables: string;
}

export interface EmailContent {
  subject: string;
  text: string;
}

interface Words {
  people: (n: number) => string;
  received: { subject: (venue: string) => string; lead: string };
  confirmed: { subject: (venue: string) => string; lead: string };
  cancelled: { subject: (venue: string) => string; lead: string };
  hello: (name: string) => string;
  cantCome: string;
  venueSubject: (when: string, people: string) => string;
  venueLead: string;
  labels: { name: string; contact: string; tables: string; notes: string };
}

const WORDS: Record<string, Words> = {
  es: {
    people: (n) => (n === 1 ? "1 persona" : `${String(n)} personas`),
    received: {
      subject: (venue) => `Hemos recibido tu reserva en ${venue}`,
      lead: "Hemos recibido tu reserva. Te avisaremos cuando esté confirmada.",
    },
    confirmed: {
      subject: (venue) => `Tu reserva en ${venue} está confirmada`,
      lead: "Tu reserva está confirmada. ¡Te esperamos!",
    },
    cancelled: {
      subject: (venue) => `Tu reserva en ${venue} está cancelada`,
      lead: "Tu reserva está cancelada. Si es un error, ponte en contacto con el local.",
    },
    hello: (name) => `Hola, ${name}:`,
    cantCome: "Si no puedes venir, avisa al local, por favor.",
    venueSubject: (when, people) => `Nueva reserva: ${when}, ${people}`,
    venueLead: "Ha llegado una reserva nueva desde la página de reservas.",
    labels: { name: "Nombre", contact: "Contacto", tables: "Mesas", notes: "Nota" },
  },
  en: {
    people: (n) => (n === 1 ? "1 person" : `${String(n)} people`),
    received: {
      subject: (venue) => `We have your booking at ${venue}`,
      lead: "We have received your booking. We will let you know once it is confirmed.",
    },
    confirmed: {
      subject: (venue) => `Your booking at ${venue} is confirmed`,
      lead: "Your booking is confirmed. See you soon!",
    },
    cancelled: {
      subject: (venue) => `Your booking at ${venue} is cancelled`,
      lead: "Your booking is cancelled. If this is a mistake, please contact the venue.",
    },
    hello: (name) => `Hello ${name},`,
    cantCome: "If you cannot come, please let the venue know.",
    venueSubject: (when, people) => `New booking: ${when}, ${people}`,
    venueLead: "A new booking has arrived from the booking page.",
    labels: { name: "Name", contact: "Contact", tables: "Tables", notes: "Note" },
  },
  ar: {
    people: (n) => (n === 1 ? "شخص واحد" : n === 2 ? "شخصان" : `${String(n)} أشخاص`),
    received: {
      subject: (venue) => `استلمنا حجزك في ${venue}`,
      lead: "استلمنا حجزك. سنخبرك عندما يتم تأكيده.",
    },
    confirmed: {
      subject: (venue) => `تم تأكيد حجزك في ${venue}`,
      lead: "تم تأكيد حجزك. نراك قريبًا!",
    },
    cancelled: {
      subject: (venue) => `تم إلغاء حجزك في ${venue}`,
      lead: "تم إلغاء حجزك. إذا كان ذلك خطأ، يرجى التواصل مع المطعم.",
    },
    hello: (name) => `مرحبًا ${name}،`,
    cantCome: "إذا لم تتمكن من الحضور، يرجى إبلاغ المطعم.",
    venueSubject: (when, people) => `حجز جديد: ${when}، ${people}`,
    venueLead: "وصل حجز جديد من صفحة الحجز.",
    labels: { name: "الاسم", contact: "التواصل", tables: "الطاولات", notes: "ملاحظة" },
  },
};

/** The language used when a message's language has no words here. */
export const FALLBACK_LOCALE = "en";

function wordsFor(locale: string): { words: Words; locale: string } {
  const words = WORDS[locale];
  return words ? { words, locale } : { words: WORDS.en as Words, locale: FALLBACK_LOCALE };
}

/** Date and time in the venue's time zone, in the reader's language, with Western digits. */
export function formatWhen(locale: string, timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

export function renderEmail(kind: EmailKind, requested: string, facts: EmailFacts): EmailContent {
  const { words, locale } = wordsFor(requested);
  const when = formatWhen(locale, facts.timeZone, facts.startsAt);
  const people = words.people(facts.partySize);

  if (kind === "venue_new_booking") {
    const contact = [facts.guestEmail, facts.guestPhone].filter(Boolean).join(" · ");
    const lines = [
      words.venueLead,
      "",
      `${when} · ${people}`,
      `${words.labels.name}: ${facts.guestName}`,
      `${words.labels.contact}: ${contact}`,
      ...(facts.tables ? [`${words.labels.tables}: ${facts.tables}`] : []),
      ...(facts.notes ? [`${words.labels.notes}: ${facts.notes}`] : []),
      "",
      facts.venueName,
    ];
    return { subject: words.venueSubject(when, people), text: lines.join("\n") };
  }

  const message =
    kind === "guest_received"
      ? words.received
      : kind === "guest_confirmed"
        ? words.confirmed
        : words.cancelled;
  const lines = [
    words.hello(facts.guestName),
    "",
    message.lead,
    "",
    facts.venueName,
    `${when} · ${people}`,
    ...(kind === "guest_cancelled" ? [] : ["", words.cantCome]),
  ];
  return { subject: message.subject(facts.venueName), text: lines.join("\n") };
}
