import type { PlanIssue, PlanTable } from "@floorplan-reservations/engine";

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
}

export interface Zone {
  id: string;
  name: string;
  sortOrder: number;
  width: number;
  height: number;
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
