import type { DeepPartial } from "../i18n/i18n";
import type { BookingMessages } from "./en";

/** Spanish: the language the booking page opens in. A test checks that it leaves nothing out. */

const people = (n: number) => (n === 1 ? "1 persona" : `${String(n)} personas`);

export const es: DeepPartial<BookingMessages> = {
  title: "Reservar mesa",
  pageTitle: (venue: string) => `Reservar mesa · ${venue}`,
  language: "Idioma",
  loading: "Cargando…",
  notFound: "Este local no acepta reservas aquí.",
  loadFailed: "No se pudo cargar la página de reservas.",
  retry: "Volver a probar",

  party: "Personas",
  people,
  partyHint: (largest: number) =>
    `Por internet se reserva hasta ${String(largest)} personas. Para grupos más grandes, contacta con el local.`,
  zone: "Zona",
  anyZone: "Sin preferencia",
  zoneHint: "Buscamos primero en esta zona. Si está llena, te proponemos otras horas o zonas.",

  day: "Día",
  previousMonth: "Mes anterior",
  nextMonth: "Mes siguiente",
  closedDay: (date: string) => `${date}, cerrado`,
  calendarHint: "Con las flechas te mueves entre los días.",

  time: "Hora",
  loadingTimes: "Buscando mesas libres…",
  noTimes: "No quedan horas este día. Prueba otro día.",
  timesFailed: "No se pudieron cargar las horas.",
  fullInZone: (time: string, zone: string) => `${time}, ${zone} completa`,
  fullTime: (time: string) => `${time}, completo`,
  zoneFull: (zone: string, time: string) => `${zone} está completa a las ${time}.`,
  otherTimes: (zone: string) => `Otras horas en ${zone}`,
  otherZones: (time: string) => `Otras zonas a las ${time}`,
  noAlternatives: "No hay nada libre cerca. Prueba otro día.",

  details: "Tus datos",
  name: "Nombre",
  email: "Correo",
  phone: "Teléfono",
  contactHint:
    "Basta con un correo o un teléfono, para que el local pueda avisarte sobre esta reserva.",
  notes: "Nota",
  optional: "opcional",
  notesHint: "Alergias, una trona… El local la lee.",
  nameMissing: "Escribe tu nombre.",
  contactMissing: "Escribe un correo o un teléfono.",
  emailInvalid: "Parece que al correo le falta algo.",
  phoneInvalid: "Un teléfono tiene al menos 6 cifras.",
  privacy: (venue: string) =>
    `${venue} usa estos datos solo para gestionar esta reserva, nunca para publicidad. Puedes pedir al local verlos, corregirlos o borrarlos.`,
  submit: "Reservar",
  submitting: "Reservando…",
  summary: (party: number, day: string, time: string) => `${people(party)} · ${day} · ${time}`,

  doneTitle: "Reserva recibida",
  doneZone: (zone: string) => `Zona: ${zone}`,
  doneBody: "Para cambiarla o anularla, contacta con el local.",
  again: "Hacer otra reserva",

  errors: {
    network: "Sin conexión. Revisa internet y vuelve a probar.",
    busy: "Ahora mismo hay mucho movimiento. Vuelve a probar en unos segundos.",
    tooMany: "Demasiados intentos. Espera unos minutos y vuelve a probar.",
    server: "Algo ha fallado por nuestra parte. Vuelve a probar.",
    duplicate: "Ya tienes una reserva aquí a una hora parecida.",
    taken: "Alguien acaba de coger esa hora. Elige otra.",
    closed: "El local ya no acepta reservas a esa hora. Elige otra.",
    rejected: "No se pudo hacer la reserva. Revisa los datos y vuelve a probar.",
    dismiss: "Cerrar aviso",
  },
};
