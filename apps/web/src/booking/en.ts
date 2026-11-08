/**
 * Texts of the public booking page, in English. The other languages fill in what they have;
 * anything they leave out shows in English.
 */

const people = (n: number) => (n === 1 ? "1 person" : `${String(n)} people`);

export const en = {
  title: "Book a table",
  pageTitle: (venue: string) => `Book a table · ${venue}`,
  language: "Language",
  loading: "Loading…",
  notFound: "This venue does not take bookings here.",
  loadFailed: "The booking page could not load.",
  retry: "Try again",

  party: "People",
  people,
  partyHint: (largest: number) =>
    `Online bookings are for up to ${String(largest)} people. For bigger groups, contact the venue.`,
  zone: "Zone",
  anyZone: "No preference",
  zoneHint: "We look in this zone first. If it is full, we suggest other times or zones.",

  day: "Day",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  closedDay: (date: string) => `${date}, closed`,
  calendarHint: "Arrow keys move between days.",

  time: "Time",
  loadingTimes: "Looking for free tables…",
  noTimes: "No times left on this day. Try another day.",
  timesFailed: "The times could not load.",
  fullTime: (time: string) => `${time}, full`,
  zoneFull: (zone: string, time: string) => `${zone} is full at ${time}.`,
  otherTimes: (zone: string) => `Other times in ${zone}`,
  otherZones: (time: string) => `Other zones at ${time}`,
  noAlternatives: "Nothing nearby is free. Try another day.",

  details: "Your details",
  name: "Name",
  email: "E-mail",
  phone: "Phone",
  contactHint:
    "An e-mail or a phone number is enough, so the venue can reach you about this booking.",
  notes: "Note",
  optional: "optional",
  notesHint: "Allergies, a high chair… The venue reads it.",
  nameMissing: "Write your name.",
  contactMissing: "Write an e-mail or a phone number.",
  emailInvalid: "This e-mail does not look complete.",
  phoneInvalid: "A phone number has at least 6 digits.",
  privacy: (venue: string) =>
    `${venue} uses these details only to manage this booking, never for advertising. You can ask the venue to see, correct or delete them.`,
  submit: "Book",
  submitting: "Booking…",
  summary: (party: number, day: string, time: string) => `${people(party)} · ${day} · ${time}`,

  doneTitle: "Booking received",
  doneZone: (zone: string) => `Zone: ${zone}`,
  doneBody: "To change or cancel it, contact the venue.",
  again: "Make another booking",

  errors: {
    network: "No connection. Check your internet and try again.",
    busy: "We are very busy right now. Try again in a few seconds.",
    tooMany: "Too many attempts. Wait a few minutes and try again.",
    server: "Something went wrong on our side. Try again.",
    duplicate: "You already have a booking here around that time.",
    taken: "Someone has just taken that time. Pick another one.",
    closed: "The venue no longer takes bookings at that time. Pick another one.",
    rejected: "The booking could not be made. Check the details and try again.",
    dismiss: "Close message",
  },
};

export type BookingMessages = typeof en;
