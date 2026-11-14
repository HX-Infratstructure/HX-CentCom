// P3-2: drizzle's migrator applies only the journal entries whose `when` is newer than the newest applied
// `created_at`, so an entry with a lower `when` is skipped on a database that is already migrated. Every test
// database starts empty, so only the journal itself can show the order.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "@/server/db/migrations";

type Entry = { readonly idx: number; readonly tag: string; readonly when: number };

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
) as { readonly entries: readonly Entry[] };

/** The entries whose `when` is not greater than the entry before them. */
function outOfOrder(entries: readonly Entry[]): string[] {
  return entries.flatMap((e, i) => {
    const prior = entries[i - 1];
    return prior !== undefined && e.when <= prior.when
      ? [`${e.tag} (${e.when} <= ${prior.when})`]
      : [];
  });
}

describe("the migration journal", () => {
  it("has a strictly increasing `when` on every entry", () => {
    expect(journal.entries.length, "the journal lists migrations").toBeGreaterThan(1);
    expect(outOfOrder(journal.entries)).toEqual([]);
  });

  it("the check names an entry that is not newer than the one before it", () => {
    const unsorted: Entry[] = [
      { idx: 0, tag: "0000_a", when: 1000 },
      { idx: 1, tag: "0001_b", when: 3000 },
      { idx: 2, tag: "0002_c", when: 3000 },
      { idx: 3, tag: "0003_d", when: 2000 },
    ];
    expect(outOfOrder(unsorted)).toEqual(["0002_c (3000 <= 3000)", "0003_d (2000 <= 3000)"]);
  });
});
