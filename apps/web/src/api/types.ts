import type { PlanIssue, PlanTable, TableSide } from "@floorplan-reservations/engine";

/** The shapes the API sends and accepts. Lengths are in centimetres, angles in degrees. */

export type Role = "owner" | "staff";

export interface VenueAccess {
  slug: string;
  name: string;
  role: Role;
}

export interface Account {
  email: string;
  venues: VenueAccess[];
}

export interface Table extends PlanTable {
  zoneId: string;
  style: Record<string, unknown>;
  bookable: boolean;
  /** Sides with seats before the table is turned; null means all around. */
  seatSides: TableSide[] | null;
}

export interface Zone {
  id: string;
  name: string;
  sortOrder: number;
  width: number;
  height: number;
  /** Guests may ask for this zone on the public booking page. */
  guestSelectable: boolean;
}

export interface PlanZone extends Zone {
  tables: Table[];
  issues: PlanIssue[];
}

export interface FloorPlan {
  venue: { slug: string; name: string; timeZone: string; defaultLocale: string; locales: string[] };
  zones: PlanZone[];
}

export type ZoneFields = Omit<Zone, "id">;

/** Everything about a table that can be saved; `zoneId` moves it to another zone. */
export type TableFields = Omit<Table, "id">;

/** The public booking page. */

export interface BookingOptions {
  name: string;
  timeZone: string;
  defaultLocale: string;
  /** Languages the venue writes to guests in. */
  locales: string[];
  /** Bigger groups have to contact the venue. */
  largestParty: number;
  /** Zones a guest may ask for. */
  zones: { id: string; name: string }[];
}

export interface ArrivalWindow {
  firstArrival: string;
  lastArrival: string;
}

export interface BookingRules {
  horizonDays: number;
  weekly: (ArrivalWindow & { weekday: number })[];
  specialDays: { date: string; windows: ArrivalWindow[] }[];
}

export interface Slot {
  /** Local time, HH:MM. */
  time: string;
  startsAt: string;
  /** Some table is free, in any zone. */
  available: boolean;
  /** Zones a guest may ask for that have room at this time. */
  zoneIds: string[];
}

export interface Availability {
  date: string;
  slots: Slot[];
}

export interface BookingRequest {
  startsAt: string;
  partySize: number;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  locale?: string;
  notes?: string;
  zoneId?: string;
}

export interface Booking {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  tables: { id: string; label: string; zoneId: string }[];
}

/** The day's service, for the venue's staff. */

export type ReservationStatus =
  "pending" | "confirmed" | "seated" | "completed" | "cancelled" | "no_show";

/** The statuses staff can set. */
export type StaffAction = "confirmed" | "seated" | "no_show" | "cancelled";

export interface ServiceReservation {
  id: string;
  status: ReservationStatus;
  startsAt: string;
  endsAt: string;
  partySize: number;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  notes: string | null;
  locale: string;
  tables: { id: string; label: string; zoneId: string; zoneName: string }[];
}

export interface ServiceDay {
  date: string;
  timeZone: string;
  reservations: ServiceReservation[];
}
