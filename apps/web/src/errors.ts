import type { PlanIssue } from "@floorplan-reservations/engine";
import { ApiError } from "./api/client";
import type { Messages } from "./i18n/en";

/** Turns API errors and plan problems into sentences in the person's language. */

export type ErrorContext = "table" | "tableDelete" | "zone" | "zoneDelete" | "load";

/**
 * What went wrong, in words. Table messages are written to follow "Table 4: ", so they start
 * in lower case where the language wants it.
 */
export function describeError(t: Messages, thrown: unknown, context: ErrorContext): string {
  const error = thrown instanceof ApiError ? thrown : new ApiError(0, String(thrown));
  if (error.status === 0) return t.errors.network;
  if (error.status === 401) return t.errors.signedOut;
  if (error.status === 403) return t.errors.forbidden;
  if (error.status === 429) return t.errors.tooMany;
  if (error.status === 503) return t.errors.busy;
  if (error.status >= 500) return t.errors.server;

  const count = error.count ?? 1;
  switch (error.code) {
    case "not_found":
      return t.errors.notFound;
    case "duplicate_label":
      return t.errors.duplicateLabel;
    case "duplicate_name":
      return t.errors.duplicateZone;
    case "limit_reached":
      return t.errors.limit;
    case "upcoming_reservations":
      return context === "zoneDelete"
        ? t.errors.zoneHasReservations(count)
        : t.errors.tableHasReservations(count);
    case "reservations_without_room":
      return t.errors.noRoom(count);
    case "changed_while_saving":
      return t.errors.changed;
    case "plan_invalid":
      return context === "zone" ? t.errors.zoneInvalid : t.errors.planInvalid;
    default:
      return t.errors.rejected(error.message);
  }
}

/** One plan problem as a sentence. `labelOf` names tables by their id. */
export function describeIssue(
  t: Messages,
  issue: PlanIssue,
  labelOf: (id: string) => string,
): string {
  switch (issue.code) {
    case "overlap":
      return t.issues.overlap(labelOf(issue.tableId), labelOf(issue.otherTableId));
    case "outside_zone":
      return t.issues.outside(labelOf(issue.tableId));
    case "seats_invalid":
      return t.issues.seats(labelOf(issue.tableId));
  }
}

export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
