import type { PlanIssue } from "@floorplan-reservations/engine";
import type { Account, FloorPlan, Table, TableFields, Zone, ZoneFields } from "./types";

/**
 * Talks to the API on the same address the page came from. The session lives in an HttpOnly
 * cookie the browser sends by itself; this code never sees it.
 */

/** A refused or failed request. `status` is 0 when the API could not be reached at all. */
export class ApiError extends Error {
  readonly status: number;
  /** The API's stable name for the problem, such as `upcoming_reservations`. */
  readonly code: string | undefined;
  readonly count: number | undefined;
  readonly issues: PlanIssue[];

  constructor(
    status: number,
    message: string,
    details: { code?: string; count?: number; issues?: PlanIssue[] } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = details.code;
    this.count = details.count;
    this.issues = details.issues ?? [];
  }
}

interface ErrorBody {
  error?: unknown;
  code?: unknown;
  count?: unknown;
  issues?: unknown;
}

function toApiError(status: number, body: unknown): ApiError {
  const data = (typeof body === "object" && body !== null ? body : {}) as ErrorBody;
  const message = typeof data.error === "string" ? data.error : `HTTP ${String(status)}`;
  return new ApiError(status, message, {
    ...(typeof data.code === "string" ? { code: data.code } : {}),
    ...(typeof data.count === "number" ? { count: data.count } : {}),
    ...(Array.isArray(data.issues) ? { issues: data.issues as PlanIssue[] } : {}),
  });
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "The API could not be reached");
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, data);
  return data as T;
}

const venue = (slug: string) => `/venues/${encodeURIComponent(slug)}`;

export const api = {
  me: () => request<Account>("GET", "/auth/me"),
  login: (email: string, password: string) =>
    request<Account>("POST", "/auth/login", { email, password }),
  logout: () => request<undefined>("POST", "/auth/logout"),

  floorPlan: (slug: string) => request<FloorPlan>("GET", `${venue(slug)}/floor-plan`),

  createZone: (slug: string, fields: ZoneFields) =>
    request<Zone>("POST", `${venue(slug)}/zones`, fields),
  updateZone: (slug: string, zoneId: string, fields: Partial<ZoneFields>) =>
    request<Zone>("PATCH", `${venue(slug)}/zones/${encodeURIComponent(zoneId)}`, fields),
  deleteZone: (slug: string, zoneId: string) =>
    request<undefined>("DELETE", `${venue(slug)}/zones/${encodeURIComponent(zoneId)}`),

  createTable: (slug: string, zoneId: string, fields: Omit<TableFields, "zoneId">) =>
    request<Table>("POST", `${venue(slug)}/zones/${encodeURIComponent(zoneId)}/tables`, fields),
  updateTable: (slug: string, tableId: string, fields: Partial<TableFields>) =>
    request<Table>("PATCH", `${venue(slug)}/tables/${encodeURIComponent(tableId)}`, fields),
  deleteTable: (slug: string, tableId: string) =>
    request<undefined>("DELETE", `${venue(slug)}/tables/${encodeURIComponent(tableId)}`),
};

export type Api = typeof api;
