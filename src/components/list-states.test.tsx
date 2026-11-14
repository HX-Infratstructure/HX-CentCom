import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShowMore, type ShowMoreProps } from "./list-states";

const IDLE = { hasMore: true, pending: false, onShowMore: () => {} } as const;

function status(): string | null {
  return screen.getByText(/^Showing /).textContent;
}

describe("the show-more status line", () => {
  it.each([
    { shown: 1, total: undefined, noun: "updates", expected: "Showing 1 update." },
    { shown: 1, total: 1, noun: "updates", expected: "Showing 1 update." },
    { shown: 3, total: undefined, noun: "updates", expected: "Showing 3 updates." },
    { shown: 3, total: 3, noun: "updates", expected: "Showing all 3 updates." },
    { shown: 2, total: 3, noun: "updates", expected: "Showing 2 of 3 updates." },
    { shown: 1, total: undefined, noun: "RAID items", expected: "Showing 1 RAID item." },
  ] as const)("reads $expected for $shown shown of $total $noun", (c) => {
    render(<ShowMore {...IDLE} shown={c.shown} total={c.total} noun={c.noun} />);
    expect(status()).toBe(c.expected);
  });

  it("keeps the error line plural when one item is shown", () => {
    const error = { code: "unreachable", message: "fetch failed" } as const;
    render(<ShowMore {...IDLE} shown={1} total={4} noun="lessons" error={error} />);
    expect(screen.getByRole("alert").textContent).toBe("Could not load more lessons. fetch failed");
  });

  // tsc proves this one: the directive fails the type check as soon as "tasks" compiles.
  it("does not compile a noun that has no singular in the registry", () => {
    // @ts-expect-error "tasks" has no singular, so no list can show it until the registry names one.
    const unregistered: ShowMoreProps["noun"] = "tasks";
  });
});
