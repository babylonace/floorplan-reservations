import { vi } from "vitest";
import type { Api } from "../src/api/client";
import type { Account, FloorPlan, PlanZone, Table } from "../src/api/types";

/** Made-up data for the component tests. */

export function table(overrides: Partial<Table> & { id: string }): Table {
  return {
    zoneId: "zone-1",
    label: overrides.id,
    minSeats: 2,
    maxSeats: 4,
    shape: "rect",
    x: 200,
    y: 200,
    width: 80,
    height: 80,
    rotation: 0,
    style: {},
    bookable: true,
    seatSides: null,
    ...overrides,
  };
}

export function zone(tables: Table[], overrides: Partial<PlanZone> = {}): PlanZone {
  return {
    id: "zone-1",
    name: "Comedor",
    sortOrder: 0,
    width: 1000,
    height: 600,
    tables,
    issues: [],
    ...overrides,
  };
}

export function floorPlan(zones: PlanZone[]): FloorPlan {
  return {
    venue: {
      slug: "test-venue",
      name: "Test Venue",
      timeZone: "Europe/Madrid",
      defaultLocale: "es",
      locales: ["es", "en"],
    },
    zones,
  };
}

export const OWNER: Account = {
  email: "owner@example.com",
  venues: [{ slug: "test-venue", name: "Test Venue", role: "owner" }],
};

/** An API whose every call fails until a test says what it should answer. */
export function fakeApi(overrides: Partial<Api> = {}): Api {
  const notSet = (name: string) =>
    vi.fn(() => Promise.reject(new Error(`${name} was called but the test did not expect it`)));
  return {
    me: notSet("me"),
    login: notSet("login"),
    logout: notSet("logout"),
    floorPlan: notSet("floorPlan"),
    createZone: notSet("createZone"),
    updateZone: notSet("updateZone"),
    deleteZone: notSet("deleteZone"),
    createTable: notSet("createTable"),
    updateTable: notSet("updateTable"),
    deleteTable: notSet("deleteTable"),
    ...overrides,
  };
}
