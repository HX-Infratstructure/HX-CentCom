import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { adaptPullRequestPages } from "./adapt";
import { PullRequestList } from "./pull-request";
import type { GithubPrsPage, PullRequest } from "./server-types";

const REPO = "HX-Infratstructure/HX-Semantic-Router";

function pr(number: number, title: string, state: string): PullRequest {
  return {
    id: 3_000_000 + number,
    repo: REPO,
    number,
    title,
    state,
    draft: false,
    head_sha: "6a69437d1c2b9e0f4a5b6c7d8e9f0a1b2c3d4e5f",
    merge_commit_sha: null,
    url: `https://github.com/${REPO}/pull/${number}`,
    fetched_at: "2026-11-14T08:10:00.123456+00:00",
  };
}

function pageWith(items: readonly PullRequest[]): GithubPrsPage {
  return { items, nextCursor: null, counts: { total: items.length, byRepo: {}, byState: {} } };
}

/** Renders the rows as the sync stored them, through the same parse the routes use. */
function renderRows(rows: readonly PullRequest[]) {
  render(<PullRequestList prs={adaptPullRequestPages([pageWith(rows)]).items} />);
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByRole("link", { name: new RegExp(title) }).closest("li");
  if (row === null) throw new Error(`No row for ${title}`);
  return row;
}

describe("a pull request's state in the list", () => {
  it("labels a PR that is no longer in the HX org on GitHub as gone", () => {
    renderRows([pr(19, "Wire the MVP 4 release build", "gone")]);
    expect(rowOf("Wire the MVP 4 release build")).toHaveTextContent(
      "Gone (no longer in the HX org on GitHub)",
    );
  });

  it.each([
    ["closed", "Closed"],
    ["merged", "Merged"],
  ])("labels a %s PR as %s", (state, label) => {
    renderRows([pr(21, "Pin the router config", state)]);
    expect(rowOf("Pin the router config")).toHaveTextContent(label);
  });

  it("shows an unknown state as its raw text, never as Open", () => {
    renderRows([pr(22, "Retry the shadow hook", "archived")]);
    const row = rowOf("Retry the shadow hook");
    expect(row).toHaveTextContent("archived");
    expect(row).not.toHaveTextContent("Open");
  });

  it("leaves an open PR unlabeled", () => {
    renderRows([pr(23, "Add the eval dashboard", "open")]);
    const row = rowOf("Add the eval dashboard");
    expect(row).toHaveTextContent(`${REPO} #23`);
    expect(row).not.toHaveTextContent(/Open|Closed|Merged|Gone/);
  });
});
