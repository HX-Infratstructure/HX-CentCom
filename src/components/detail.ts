import { toAppError } from "./adapt";
import { assertNever, type AppError } from "./model";

/** What the sheet shows for the URL's open record. */
export type Detail<T> =
  | { readonly state: "closed" }
  | { readonly state: "loading"; readonly id: string }
  | { readonly state: "ready"; readonly item: T }
  | { readonly state: "missing"; readonly id: string }
  | { readonly state: "failed"; readonly id: string; readonly error: AppError };

/** The fields of a react-query result that `detailFrom` reads, for a record fetched by id. */
export type ByIdResult<T> =
  | { readonly status: "pending" }
  | { readonly status: "success"; readonly data: T | null }
  | { readonly status: "error"; readonly error: unknown };

/**
 * `byId` is for a list the browser holds only in part: a record past the loaded page is fetched by id. Without it the
 * list is whole, so an id that is not in it is missing.
 */
export function detailFrom<T extends { readonly id: string }>(
  openId: string | undefined,
  loaded: readonly T[],
  byId?: ByIdResult<T> | undefined,
): Detail<T> {
  if (openId === undefined) return { state: "closed" };
  const item = loaded.find((candidate) => candidate.id === openId);
  if (item !== undefined) return { state: "ready", item };
  if (byId === undefined) return { state: "missing", id: openId };
  switch (byId.status) {
    case "pending":
      return { state: "loading", id: openId };
    case "success":
      return byId.data === null
        ? { state: "missing", id: openId }
        : { state: "ready", item: byId.data };
    case "error": {
      const error = toAppError(byId.error);
      return error.code === "not_found"
        ? { state: "missing", id: openId }
        : { state: "failed", id: openId, error };
    }
    default:
      return assertNever(byId);
  }
}
