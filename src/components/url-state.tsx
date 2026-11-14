import { useId, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ITEM,
  cleared,
  only,
  patch,
  splitDays,
  trust,
  type AnyCounts,
  type Facet,
  type FacetCounts,
  type Facets,
  type ListSearch,
  type SearchOf,
  type SpecCore,
} from "./list-search";
import type { AgentDirectory } from "./model";
import { RECORD_ROUTES, type RecordKind } from "./open-record";

/**
 * The components that read or write URL state: list filters, the open record, and the links that change them.
 * Components elsewhere in src/components never touch search params.
 */

/** Exact matching marks a filter link active only when following it changes nothing: the current tab, never a chip. */
const EXACT = { exact: true } as const;
/** More options than this turn a chip row into a select, so a facet never wraps into a wall of chips. */
const MAX_CHIPS = 8;

type Option = {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly tone: string | null;
};

export function FilterBar<F extends Facets>(props: {
  search: ListSearch<F>;
  counts: FacetCounts<F>;
  /** The accessible name of the whole bar, for example "Filter decisions". */
  label: string;
  /** Names and tones for agent facets. An id missing from it shows as the raw id. */
  agents?: AgentDirectory | undefined;
}): ReactNode {
  return (
    <FilterBarView
      core={props.search.core}
      counts={trust<AnyCounts>(props.counts)}
      label={props.label}
      agents={props.agents}
    />
  );
}

function FilterBarView({
  core,
  counts,
  label,
  agents,
}: {
  core: SpecCore;
  counts: AnyCounts;
  label: string;
  agents: AgentDirectory | undefined;
}): ReactNode {
  const raw: Record<string, unknown> = useSearch({ strict: false });
  const current = core.validate(raw);
  return (
    <div role="group" aria-label={label} className="filter-bar">
      {core.facets.map(([key, f]) =>
        f.kind === "days" ? (
          <DaysFacet key={key} name={key} label={f.label} value={current[key]} />
        ) : (
          <ChoiceFacet
            key={key}
            name={key}
            facet={f}
            value={current[key]}
            options={facetOptions(f, current[key], counts[key] ?? {}, agents)}
          />
        ),
      )}
      {core.active(current) && (
        <Link
          to="."
          search={patch(cleared(core.facets.map(([key]) => key)))}
          resetScroll={false}
          activeOptions={EXACT}
          className="clear-filters"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}

function facetOptions(
  f: Exclude<Facet, { kind: "days" }>,
  active: string | undefined,
  counts: Readonly<Record<string, number>>,
  agents: AgentDirectory | undefined,
): readonly Option[] {
  if (f.kind === "closed") {
    return Object.entries(f.vocab)
      .filter(([value]) => (counts[value] ?? 0) > 0 || value === active)
      .map(([value, label]) => ({ value, label, count: counts[value] ?? 0, tone: null }));
  }
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (active !== undefined && !entries.some(([value]) => value === active))
    entries.push([active, 0]);
  return entries
    .map(([value, count]) => {
      const agent = f.kind === "agent" ? agents?.get(value) : undefined;
      return { value, label: agent?.name ?? value, count, tone: agent?.tone ?? null };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function ChoiceFacet({
  name,
  facet: f,
  value,
  options,
}: {
  name: string;
  facet: Exclude<Facet, { kind: "days" }>;
  value: string | undefined;
  options: readonly Option[];
}): ReactNode {
  const labelId = useId();
  const navigate = useNavigate();
  if (options.length === 0) return null;

  if (f.kind === "closed" && f.display === "tabs") {
    const all = options.reduce((sum, o) => sum + o.count, 0);
    return (
      <nav aria-labelledby={labelId} className="facet facet-tabs">
        <span id={labelId} className="facet-label">
          {f.label}
        </span>
        <ul>
          <li>
            <Link
              to="."
              search={patch({ [name]: undefined })}
              resetScroll={false}
              activeOptions={EXACT}
              className="facet-tab"
            >
              All <span className="chip-count">{all}</span>
            </Link>
          </li>
          {options.map((o) => (
            <li key={o.value}>
              <Link
                to="."
                search={patch({ [name]: o.value })}
                resetScroll={false}
                activeOptions={EXACT}
                className="facet-tab"
              >
                {o.label} <span className="chip-count">{o.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  if (options.length > MAX_CHIPS) {
    return (
      <label className="facet facet-select">
        <span className="facet-label">{f.label}</span>
        <select
          value={value ?? ""}
          onChange={(event) =>
            void navigate({
              to: ".",
              search: patch({ [name]: event.currentTarget.value || undefined }),
              resetScroll: false,
            })
          }
        >
          <option value="">All</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div role="group" aria-labelledby={labelId} className="facet">
      <span id={labelId} className="facet-label">
        {f.label}
      </span>
      <ul className="chips">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <li key={o.value}>
              <Link
                to="."
                search={patch({ [name]: selected ? undefined : o.value })}
                resetScroll={false}
                activeOptions={EXACT}
                aria-current={selected ? "true" : undefined}
                data-tone={o.tone ?? undefined}
                className="chip"
              >
                {o.tone !== null && <span className="chip-mark" aria-hidden="true" />}
                {o.label}
                <span className="chip-count">{o.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DaysFacet({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string | undefined;
}): ReactNode {
  const navigate = useNavigate();
  const { from, to } = splitDays(value);
  // replace: a date input changes on every picked day, and Back should leave the page, not step through dates.
  const set = (nextFrom: string, nextTo: string) =>
    void navigate({
      to: ".",
      search: patch({ [name]: nextFrom || nextTo ? `${nextFrom}..${nextTo}` : undefined }),
      replace: true,
      resetScroll: false,
    });
  return (
    <fieldset className="facet facet-days">
      <legend className="facet-label">{label}</legend>
      <label>
        From (UTC)
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => set(event.currentTarget.value, to)}
        />
      </label>
      <label>
        To (UTC)
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => set(from, event.currentTarget.value)}
        />
      </label>
    </fieldset>
  );
}

/** Sets filters of a list on the current route and closes the open record, for example "Updates for IRP-04". */
export function FilterLink<F extends Facets>(props: {
  search: ListSearch<F>;
  set: SearchOf<F>;
  /** The id of the list's section, so the page scrolls to the filtered list. */
  hash?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}): ReactNode {
  const changes = { ...trust<Record<string, unknown>>(props.set), [ITEM]: undefined };
  return (
    <Link
      to="."
      search={patch(changes)}
      resetScroll={false}
      {...(props.hash === undefined ? {} : { hash: props.hash })}
      className={props.className}
    >
      {props.children}
    </Link>
  );
}

/**
 * A link to a record's detail sheet, with a real href the owner can copy. On the record's own route it keeps the
 * current filters; from any other route it sends only `item`, so this page's filters never ride onto that one.
 */
export function RecordLink(props: {
  kind: RecordKind;
  id: string;
  /** Inside an open sheet: swap the open record without adding a history entry. */
  inSheet?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}): ReactNode {
  const { kind, id, inSheet = false, className, children } = props;
  const pathname = useLocation({ select: (location) => location.pathname });
  const record = `${kind}:${id}`;
  const path = RECORD_ROUTES[kind];
  if (pathname === path) {
    return (
      <Link
        to="."
        search={patch({ [ITEM]: id })}
        replace={inSheet}
        state={inSheet ? true : { openedInPlace: true }}
        resetScroll={false}
        data-record={record}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link to={path} search={only({ [ITEM]: id })} data-record={record} className={className}>
      {children}
    </Link>
  );
}
