import { assertNever, toInstant, type Instant } from "./model";

/**
 * The URL contract of a filterable list: which search keys it owns, how they parse, and how a list the route holds in
 * full is filtered and counted. url-state.tsx renders it; nothing else in src/components reads search params.
 */

export const ITEM = "item";

export type Vocab = Readonly<Record<string, string>>;
export type Facet =
  | { readonly kind: "agent"; readonly label: string }
  | { readonly kind: "open"; readonly label: string }
  | {
      readonly kind: "closed";
      readonly label: string;
      readonly vocab: Vocab;
      readonly display: "chips" | "tabs";
    }
  /** `?posted=2026-11-01..2026-11-14`: UTC calendar days, either side optional. */
  | { readonly kind: "days"; readonly label: string };

function closedFacet<V extends Vocab>(
  label: string,
  vocab: V,
  display: "chips" | "tabs" = "chips",
) {
  return { kind: "closed", label, vocab, display } as const;
}

export const facet = {
  agent: (label = "Agent") => ({ kind: "agent", label }) as const,
  /** Values come from the data: task ids, repositories, tags. */
  open: (label: string) => ({ kind: "open", label }) as const,
  /** Values come from a label registry in model.ts, in its key order. */
  closed: closedFacet,
  days: (label: string) => ({ kind: "days", label }) as const,
};

export type Facets = Readonly<Record<string, Facet>>;
type UrlValue<F extends Facet> = F extends { kind: "closed"; vocab: infer V }
  ? Extract<keyof V, string>
  : string;
export type DayRange = { readonly since?: Instant; readonly until?: Instant };
type FilterValue<F extends Facet> = F extends { kind: "days" } ? DayRange : UrlValue<F>;

/** The route's search. Every key is optional and clearable, as `exactOptionalPropertyTypes` requires. */
export type SearchOf<F extends Facets> = { [K in keyof F]?: UrlValue<F[K]> | undefined } & {
  item?: string | undefined;
};
/** What loaders, query keys and filtering read. It never holds `item`, so opening a sheet never refetches a list. */
export type FiltersOf<F extends Facets> = {
  readonly [K in keyof F]?: FilterValue<F[K]> | undefined;
};
/** Required for every facet except date ranges, so a chip row without counts does not compile. */
export type FacetCounts<F extends Facets> = {
  readonly [K in keyof F as F[K] extends { kind: "days" } ? never : K]: Readonly<
    Record<string, number>
  >;
};
type Readers<F extends Facets, T> = {
  readonly [K in keyof F]: (
    item: T,
  ) => F[K] extends { kind: "days" } ? Instant | null : string | readonly string[] | null;
};

export interface ListSearch<F extends Facets> {
  readonly facets: F;
  /** The untyped view url-state.tsx reads. */
  readonly core: SpecCore;
  /** Route `validateSearch`. Never throws: a value that does not parse is dropped and the list shows unfiltered. */
  validate(raw: Record<string, unknown>): SearchOf<F>;
  filters(search: SearchOf<F>): FiltersOf<F>;
  active(filters: FiltersOf<F>): boolean;
  /**
   * Faceting for a list the route already holds in full. Counts follow the UpdateCounts rule: each facet applies
   * every filter except its own.
   */
  local<T>(
    items: readonly T[],
    filters: FiltersOf<F>,
    read: Readers<F, T>,
  ): { readonly items: readonly T[]; readonly counts: FacetCounts<F> };
}

export type AnySearch = Readonly<Record<string, string>>;
type AnyFilters = Readonly<Record<string, string | DayRange>>;
export type AnyCounts = Readonly<Record<string, Readonly<Record<string, number>>>>;
type AnyValue = string | readonly string[] | null;
type AnyReaders<T> = Readonly<Record<string, (item: T) => AnyValue>>;

export interface SpecCore {
  readonly facets: readonly (readonly [string, Facet])[];
  validate(raw: Readonly<Record<string, unknown>>): AnySearch;
  filters(search: Readonly<Record<string, unknown>>): AnyFilters;
  active(filters: Readonly<Record<string, unknown>>): boolean;
  local<T>(
    items: readonly T[],
    filters: AnyFilters,
    read: AnyReaders<T>,
  ): { readonly items: readonly T[]; readonly counts: AnyCounts };
}

/**
 * The only unchecked conversion of the list modules. Generic mapped types over a route's facet keys cannot be built
 * or indexed by a loop, and a route-agnostic link cannot prove to TypeScript that a computed key belongs to the
 * current route. Every value that passes through here comes from a ListSearch whose `validate` that route registered.
 */
export function trust<T>(value: unknown): T {
  return value as T;
}

export function listSearch<const F extends Facets>(def: { facets: F }): ListSearch<F> {
  const core = specCore(def.facets);
  return trust<ListSearch<F>>({ ...core, facets: def.facets, core });
}

function specCore(facets: Facets): SpecCore {
  const entries: readonly (readonly [string, Facet])[] = Object.entries(facets);

  function validate(raw: Readonly<Record<string, unknown>>): AnySearch {
    const out: Record<string, string> = {};
    for (const [key, f] of entries) {
      const value = parseFacetValue(f, raw[key]);
      if (value !== undefined) out[key] = value;
    }
    const item = toParam(raw[ITEM]);
    if (item !== undefined) out[ITEM] = item;
    return out;
  }

  function filters(search: Readonly<Record<string, unknown>>): AnyFilters {
    const out: Record<string, string | DayRange> = {};
    for (const [key, f] of entries) {
      const value = parseFacetValue(f, search[key]);
      if (value !== undefined) out[key] = f.kind === "days" ? dayRange(value) : value;
    }
    return out;
  }

  function active(values: Readonly<Record<string, unknown>>): boolean {
    return entries.some(([key]) => values[key] !== undefined);
  }

  function local<T>(items: readonly T[], wanted: AnyFilters, read: AnyReaders<T>) {
    const tests = entries.map(([key, f]) => ({ key, f, want: wanted[key], read: read[key] }));
    const passes = (item: T, test: (typeof tests)[number]) =>
      test.want === undefined || test.read === undefined || matches(test.want, test.read(item));
    const visible = items.filter((item) => tests.every((test) => passes(item, test)));
    const counts: Record<string, Record<string, number>> = {};
    for (const test of tests) {
      const reader = test.read;
      if (test.f.kind === "days" || reader === undefined) continue;
      const tally: Record<string, number> = {};
      for (const item of items) {
        if (!tests.every((other) => other === test || passes(item, other))) continue;
        for (const value of valuesOf(reader(item))) tally[value] = (tally[value] ?? 0) + 1;
      }
      counts[test.key] = tally;
    }
    return { items: visible, counts };
  }

  return { facets: entries, validate, filters, active, local };
}

function parseFacetValue(f: Facet, raw: unknown): string | undefined {
  const value = toParam(raw);
  if (value === undefined) return undefined;
  switch (f.kind) {
    case "closed":
      return Object.hasOwn(f.vocab, value) ? value : undefined;
    case "days":
      return isDayRange(value) ? value : undefined;
    case "agent":
    case "open":
      return value;
    default:
      return assertNever(f);
  }
}

/** Search is JSON-first: a hand-typed `?task=12` arrives as the number 12, so a finite number reads as its text. */
export function toParam(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw === "" ? undefined : raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

const DAY_RANGE = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/;

function isDay(text: string): boolean {
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text;
}

function isDayRange(text: string): boolean {
  const match = DAY_RANGE.exec(text);
  if (match === null) return false;
  const [, from, to] = match;
  if (from === undefined && to === undefined) return false;
  if ((from !== undefined && !isDay(from)) || (to !== undefined && !isDay(to))) return false;
  return from === undefined || to === undefined || from <= to;
}

export function splitDays(text: string | undefined): {
  readonly from: string;
  readonly to: string;
} {
  const [from = "", to = ""] = text?.split("..") ?? [];
  return { from, to };
}

/** `until` is the start of the day after `to`, so the last day counts in full. Only called on a validated range. */
function dayRange(text: string): DayRange {
  const { from, to } = splitDays(text);
  return {
    ...(from === "" ? {} : { since: toInstant(`${from}T00:00:00.000Z`) }),
    ...(to === ""
      ? {}
      : { until: toInstant(new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString()) }),
  };
}

function matches(want: string | DayRange, got: AnyValue): boolean {
  if (typeof want !== "string") {
    if (typeof got !== "string") return false;
    const time = Date.parse(got);
    return (
      (want.since === undefined || time >= Date.parse(want.since)) &&
      (want.until === undefined || time < Date.parse(want.until))
    );
  }
  return valuesOf(got).includes(want);
}

function valuesOf(got: AnyValue): readonly string[] {
  if (got === null) return [];
  if (typeof got === "string") return [got];
  return got;
}

/** A search updater that keeps every other key, for `<Link search>` and `navigate({ search })`. */
export function patch(changes: Readonly<Record<string, unknown>>) {
  return trust<never>((prev: Record<string, unknown>) => ({ ...prev, ...changes }));
}

/** A search updater that drops every other key. */
export function only(changes: Readonly<Record<string, unknown>>) {
  return trust<never>(() => ({ ...changes }));
}

export function cleared(keys: readonly string[]): Record<string, undefined> {
  return Object.fromEntries(keys.map((key) => [key, undefined] as const));
}
