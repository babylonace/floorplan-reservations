import { ApiError, type Api } from "../api/client";
import type { Table } from "../api/types";
import type { Change } from "./draft";

export interface SaveFailure {
  change: Change;
  error: ApiError;
}

export interface SaveResult {
  /** Changes the API refused, with its reason. */
  failures: SaveFailure[];
  /** Changes not sent because saving stopped early (signed out, offline, server trouble). */
  unsent: Change[];
  /** New tables the API created, by the id they had on screen. */
  created: Map<string, Table>;
  /** Number of changes the API accepted. */
  saved: number;
}

/** Errors after which sending the rest is pointless. */
function stopsEverything(error: ApiError): boolean {
  return error.status === 0 || error.status === 401 || error.status === 403 || error.status >= 500;
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, String(error));
}

/**
 * Sends `changes` one by one. The API checks each change against what is stored at that moment,
 * so a table moved into the place of another that is also moving can be refused only because
 * the other one has not moved yet. Changes refused as making the plan invalid (422) are
 * therefore tried again after the others, for as long as each round saves something.
 */
export async function saveChanges(
  api: Pick<Api, "createTable" | "updateTable" | "deleteTable">,
  slug: string,
  zoneId: string,
  changes: Change[],
): Promise<SaveResult> {
  const result: SaveResult = { failures: [], unsent: [], created: new Map(), saved: 0 };
  let queue = changes;

  while (queue.length > 0) {
    const refusedAsInvalid: SaveFailure[] = [];
    let savedThisRound = 0;

    for (const [index, change] of queue.entries()) {
      try {
        if (change.kind === "delete") {
          await api.deleteTable(slug, change.id);
        } else if (change.kind === "update") {
          await api.updateTable(slug, change.id, change.fields);
        } else {
          result.created.set(change.id, await api.createTable(slug, zoneId, change.fields));
        }
        savedThisRound += 1;
      } catch (thrown) {
        const error = asApiError(thrown);
        if (stopsEverything(error)) {
          result.failures.push({ change, error });
          result.unsent.push(...queue.slice(index + 1), ...refusedAsInvalid.map((f) => f.change));
          result.saved += savedThisRound;
          return result;
        }
        if (error.status === 422) refusedAsInvalid.push({ change, error });
        else result.failures.push({ change, error });
      }
    }

    result.saved += savedThisRound;
    if (savedThisRound === 0 || refusedAsInvalid.length === 0) {
      result.failures.push(...refusedAsInvalid);
      break;
    }
    queue = refusedAsInvalid.map((failure) => failure.change);
  }
  return result;
}
