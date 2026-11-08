import type { DeepPartial } from "../i18n/i18n";
import type { BookingMessages } from "./en";

/** Arabic, written right to left. A test checks that it leaves nothing out. */

function people(n: number): string {
  if (n === 1) return "شخص واحد";
  if (n === 2) return "شخصان";
  if (n <= 10) return `${String(n)} أشخاص`;
  return `${String(n)} شخصًا`;
}

export const ar: DeepPartial<BookingMessages> = {
  title: "حجز طاولة",
  pageTitle: (venue: string) => `حجز طاولة · ${venue}`,
  language: "اللغة",
  loading: "جارٍ التحميل…",
  notFound: "هذا المكان لا يقبل الحجوزات هنا.",
  loadFailed: "تعذّر تحميل صفحة الحجز.",
  retry: "حاول مرة أخرى",

  party: "الأشخاص",
  people,
  partyHint: (largest: number) =>
    `الحجز عبر الإنترنت حتى ${String(largest)} شخصًا. للمجموعات الأكبر، تواصل مع المكان.`,
  zone: "المنطقة",
  anyZone: "بلا تفضيل",
  zoneHint: "نبحث في هذه المنطقة أولًا. إن كانت ممتلئة، نقترح أوقاتًا أو مناطق أخرى.",

  day: "اليوم",
  previousMonth: "الشهر السابق",
  nextMonth: "الشهر التالي",
  closedDay: (date: string) => `${date}، مغلق`,
  calendarHint: "استخدم الأسهم للتنقل بين الأيام.",

  time: "الوقت",
  loadingTimes: "نبحث عن طاولات متاحة…",
  noTimes: "لا توجد أوقات متبقية في هذا اليوم. جرّب يومًا آخر.",
  timesFailed: "تعذّر تحميل الأوقات.",
  fullInZone: (time: string, zone: string) => `${time}، ${zone} ممتلئة`,
  fullTime: (time: string) => `${time}، ممتلئ`,
  zoneFull: (zone: string, time: string) => `${zone} ممتلئة في الساعة ${time}.`,
  otherTimes: (zone: string) => `أوقات أخرى في ${zone}`,
  otherZones: (time: string) => `مناطق أخرى في الساعة ${time}`,
  noAlternatives: "لا يوجد شيء متاح قريبًا. جرّب يومًا آخر.",

  details: "بياناتك",
  name: "الاسم",
  email: "البريد الإلكتروني",
  phone: "الهاتف",
  contactHint: "يكفي بريد إلكتروني أو رقم هاتف، ليتمكن المكان من التواصل معك بشأن هذا الحجز.",
  notes: "ملاحظة",
  optional: "اختياري",
  notesHint: "حساسية من طعام، كرسي أطفال… يقرؤها المكان.",
  nameMissing: "اكتب اسمك.",
  contactMissing: "اكتب بريدًا إلكترونيًا أو رقم هاتف.",
  emailInvalid: "يبدو أن البريد الإلكتروني غير مكتمل.",
  phoneInvalid: "رقم الهاتف يتكوّن من 6 أرقام على الأقل.",
  privacy: (venue: string) =>
    `يستخدم ${venue} هذه البيانات فقط لإدارة هذا الحجز، ولا يستخدمها أبدًا للإعلانات. يمكنك أن تطلب من المكان الاطلاع عليها أو تصحيحها أو حذفها.`,
  submit: "احجز",
  submitting: "جارٍ الحجز…",
  summary: (party: number, day: string, time: string) => `${people(party)} · ${day} · ${time}`,

  doneTitle: "تم استلام الحجز",
  doneZone: (zone: string) => `المنطقة: ${zone}`,
  doneBody: "لتغيير الحجز أو إلغائه، تواصل مع المكان.",
  again: "حجز آخر",

  errors: {
    network: "لا يوجد اتصال. تحقّق من الإنترنت وحاول مرة أخرى.",
    busy: "الضغط كبير الآن. حاول مرة أخرى بعد بضع ثوانٍ.",
    tooMany: "محاولات كثيرة. انتظر بضع دقائق وحاول مرة أخرى.",
    server: "حدث خطأ من جهتنا. حاول مرة أخرى.",
    duplicate: "لديك حجز هنا في وقت قريب من هذا.",
    taken: "حجز أحدهم هذا الوقت للتو. اختر وقتًا آخر.",
    closed: "لم يعد المكان يقبل الحجوزات في هذا الوقت. اختر وقتًا آخر.",
    rejected: "تعذّر إتمام الحجز. تحقّق من البيانات وحاول مرة أخرى.",
    dismiss: "إغلاق الرسالة",
  },
};
