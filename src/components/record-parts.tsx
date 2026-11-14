import { Children, type ReactNode } from "react";
import { CircleHelp, ShieldCheck, Terminal } from "lucide-react";
import { formatUtc, formatUtcDay, relativeAge } from "./format";
import { assertNever, type AgentRef, type Coverage, type Instant, type SourceRef } from "./model";

/**
 * "Claude Code 01" reads "CC1" and "Agent Zero" "AZ": each word's first letter, a number word whole. A one-word name
 * keeps its capitals and digits ("OpenCode" reads "OC"), or else its first two letters ("Codex" reads "CO").
 */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .map((w) => (/^\d+$/.test(w) ? String(Number(w)) : w.charAt(0)))
      .join("")
      .toUpperCase()
      .slice(0, 3);
  }
  const marks = name.match(/[A-Z0-9]/g) ?? [];
  return marks.length >= 2 ? marks.slice(0, 3).join("") : name.slice(0, 2).toUpperCase();
}

/**
 * An agent's identity. `full` shows the role mark and the name; `chip` is the compact tinted name for rows and facts;
 * `person` is a round avatar with initials and the name, for board cells and cards. The name is always text, so color
 * never carries identity alone.
 */
export function AgentBadge({
  agent,
  variant = "full",
}: {
  agent: AgentRef;
  variant?: "full" | "chip" | "person" | undefined;
}): ReactNode {
  const title = agent.role === null ? "Not in the agents table" : undefined;
  if (variant === "person") {
    return (
      <span className="agent-person" data-tone={agent.tone ?? undefined} title={title}>
        <span className="avatar" aria-hidden="true">
          {initials(agent.name)}
        </span>
        <span className="agent-person-name">{agent.name}</span>
      </span>
    );
  }
  if (variant === "chip") {
    return (
      <span className="agent-chip" data-tone={agent.tone ?? undefined} title={title}>
        {agent.name}
      </span>
    );
  }
  const Mark =
    agent.role === "owner" ? ShieldCheck : agent.role === "agent" ? Terminal : CircleHelp;
  return (
    <span className="agent-badge" data-tone={agent.tone ?? undefined} title={title}>
      <span className="agent-mark" aria-hidden="true">
        <Mark />
      </span>
      <span className="agent-name">{agent.name}</span>
    </span>
  );
}

/**
 * Absolute times are formatted by hand in UTC, so the server and the browser print the same text. Only the relative
 * form reads the clock, and only its text node opts out of the hydration check.
 */
export function Time({
  at,
  format = "relative",
}: {
  at: Instant;
  format?: "relative" | "datetime" | "date" | undefined;
}): ReactNode {
  const exact = formatUtc(at);
  if (format === "relative") {
    return (
      <time dateTime={at} title={exact} suppressHydrationWarning>
        {relativeAge(at, Date.now())}
      </time>
    );
  }
  return (
    <time dateTime={at} title={format === "date" ? exact : undefined}>
      {format === "date" ? formatUtcDay(at) : exact}
    </time>
  );
}

export function SourceLink({
  source,
  label,
  compact = false,
}: {
  source: SourceRef;
  label?: string | undefined;
  /** For a row's meta line: an HX-15 path shows only its file name; the sheet shows the whole path. */
  compact?: boolean | undefined;
}): ReactNode {
  switch (source.kind) {
    case "web":
      return (
        <a href={source.url} target="_blank" rel="noreferrer" className="source-link">
          {label ?? describeUrl(source.url)}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    case "hx15":
      if (compact) {
        return (
          <span className="source-local">
            {label !== undefined && `${label}: `}
            <code title={source.path}>{fileName(source.path)}</code>
          </span>
        );
      }
      return (
        <span className="source-local">
          {label !== undefined && `${label}: `}
          <code>{source.path}</code> local to HX-15
        </span>
      );
    case "text":
      return <span>{label !== undefined ? `${label}: ${source.text}` : source.text}</span>;
    default:
      return assertNever(source);
  }
}

/** The last segment of a path, with any `:line` suffix kept. */
function fileName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

/** GitHub URLs read as "HX-Semantic-Router #10"; any other URL reads as its host and path. */
function describeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const [, repo, type, first, ...rest] = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "github.com" && repo !== undefined) {
    if ((type === "issues" || type === "pull") && first !== undefined) {
      return `${repo} #${first}${url.hash.startsWith("#issuecomment-") ? " comment" : ""}`;
    }
    if (type === "commit" && first !== undefined) return `${repo} ${first.slice(0, 7)}`;
    if (type === "blob" && rest.length > 0) return `${repo} ${rest.join("/")}`;
    if (type === undefined) return repo;
  }
  return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
}

export function CommitSha({ sha }: { sha: string }): ReactNode {
  return (
    <code className="sha" title={sha}>
      {sha.slice(0, 7)}
    </code>
  );
}

/** "X of Y proven" from the server's computed progress. The text carries the value; the bar repeats it visually. */
export function CoverageMeter({
  progress,
  compact = false,
}: {
  progress: Coverage;
  compact?: boolean | undefined;
}): ReactNode {
  if (progress.total === 0) {
    return (
      <span className="coverage quiet" data-compact={compact || undefined}>
        No requirements recorded
      </span>
    );
  }
  return (
    <span className="coverage" data-compact={compact || undefined}>
      <span>
        {progress.proven} of {progress.total} proven
      </span>
      <span className="meter" aria-hidden="true">
        <span
          className="meter-fill"
          style={{ inlineSize: `${(progress.proven / progress.total) * 100}%` }}
        />
      </span>
    </span>
  );
}

/** A definition list that disappears when every fact in it is absent, so a null field never leaves an empty frame. */
export function Facts({ children }: { children: ReactNode }): ReactNode {
  if (Children.toArray(children).length === 0) return null;
  return <dl className="facts">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
