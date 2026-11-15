import type { Instant } from "./model";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "14 Nov 2026, 03:29 UTC". */
export function formatUtc(at: Instant): string {
  const d = new Date(at);
  return `${formatUtcDay(at)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "14 Nov 2026". Takes an Instant or a plain `YYYY-MM-DD` date column. */
export function formatUtcDay(at: Instant | string): string {
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}`;
}

/** "14 Nov", for a dense table cell; the cell's title carries the year. */
export function formatUtcShort(at: string): string {
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

/** "just now" under a minute, then "12 min ago", "5 h ago", "3 d ago". */
export function relativeAge(at: Instant, now: number): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(at)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * "Claude Code 01" reads "CC1" and "Agent Zero" "AZ": each word's first letter, a number word whole. A one-word name
 * keeps its capitals and digits ("OpenCode" reads "OC"), or else its first two letters ("Codex" reads "CO").
 */
export function initials(name: string): string {
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
