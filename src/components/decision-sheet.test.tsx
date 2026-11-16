import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render-app";
import { workspaceWith } from "@/test/ui-fixtures";
import type { Agent, Decision, DecisionsPage } from "./server-types";

const server = vi.hoisted(() => ({
  listWorkspace: vi.fn(),
  listDecisions: vi.fn(),
  getDecision: vi.fn(),
}));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listWorkspace: server.listWorkspace,
  listDecisions: server.listDecisions,
  getDecision: server.getDecision,
}));

const REPO = "HX-Infratstructure/HX-CentCom";
const OWNER_KEY = "owner-key-for-this-test";

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
];

const NO_DECISIONS: DecisionsPage = {
  items: [],
  nextCursor: null,
  counts: { total: 0, byGateType: {}, byStatus: {} },
};

function decision(fields: Pick<Decision, "id" | "question"> & Partial<Decision>): Decision {
  return {
    subject: null,
    summary: "The owner picks the gate before the next step runs.",
    description: "The requesting agent stops until the owner records a decision.",
    gate_type: "merge",
    options: [
      { label: "Approve", recommended: false },
      { label: "Hold", recommended: false },
    ],
    blocks: [],
    recommended_by: null,
    requested_by: "atlas",
    requested_at: "2026-11-10T09:00:00.123456+00:00",
    source_url: `https://github.com/${REPO}/issues/10`,
    status: "Pending",
    decision_text: null,
    decision_source_url: null,
    decided_at: null,
    superseded_by: null,
    version: 1,
    ...fields,
  };
}

const workspace = (decisions: readonly Decision[]) => workspaceWith({ decisions, agents: AGENTS });

async function renderDecisions(url: string, { owner = false } = {}) {
  if (owner) window.sessionStorage.setItem("hx-centcom.owner-key", OWNER_KEY);
  server.listDecisions.mockResolvedValue(NO_DECISIONS);
  await renderApp(url, { heading: "Decisions", onDocument: true });
}

beforeEach(() => {
  server.getDecision.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  server.listWorkspace.mockReset();
  server.listDecisions.mockReset();
  server.getDecision.mockReset();
});

const DECIDED = decision({
  id: "D-14",
  question: "Deploy release 1.2 to HX-15?",
  gate_type: "deploy",
  status: "Decided",
  decision_text: "Deploy after the smoke test passes.",
  decision_source_url: `https://github.com/${REPO}/issues/10#issuecomment-6875070691`,
  decided_at: "2026-11-13T15:30:00.123456+00:00",
});

describe("the decision sheet for a decision outside the workspace", () => {
  it("opens a decided decision that blocks no open task by asking the register for it", async () => {
    server.listWorkspace.mockResolvedValue(workspace([]));
    server.getDecision.mockResolvedValue(DECIDED);
    await renderDecisions("/decisions?item=D-14");

    const outcome = await screen.findByRole("region", { name: "Owner decision" });
    expect(
      screen.getByRole("dialog", { name: "Deploy release 1.2 to HX-15?" }),
    ).toBeInTheDocument();
    expect(outcome).toHaveTextContent("Deploy after the smoke test passes.");
    expect(server.getDecision).toHaveBeenCalledWith({ data: { id: "D-14" } });
  });

  it("says the decision is not in the register when the register does not hold it either", async () => {
    server.listWorkspace.mockResolvedValue(workspace([]));
    server.getDecision.mockResolvedValue(null);
    await renderDecisions("/decisions?item=D-99");

    expect(await screen.findByText("D-99 is not in the decision register.")).toBeInTheDocument();
    expect(server.getDecision).toHaveBeenCalledWith({ data: { id: "D-99" } });
  });
});

describe("the decision detail", () => {
  it("shows the whole description, however far it runs past the 140-character summary (T13)", async () => {
    const description =
      "Release 1.2 adds the activity log, the revert route and the GitHub pull request page. The smoke run on " +
      "HX-15 passed every check except the phone-width screenshot, which needs the new navigation. Deploying now " +
      "puts the owner's revert in front of real data; holding keeps HX-7 on 1.1 until the screenshot passes.";
    const summary =
      "Deploy release 1.2 to HX-15 now, or hold it until the phone-width screenshot passes on the new navigation.";
    server.listWorkspace.mockResolvedValue(
      workspace([decision({ id: "D-15", question: "Deploy release 1.2?", summary, description })]),
    );
    await renderDecisions("/decisions?item=D-15");

    const section = await screen.findByRole("region", { name: "Description" });
    expect(description.length).toBeGreaterThan(140);
    expect(section.textContent).toBe(`Description${description}`);
  });
});

describe("recording a decision through the owner actions", () => {
  it("sends the owner key, the version as If-Match and a request key, then shows the refreshed outcome", async () => {
    const pending = decision({ id: "D-15", question: "Merge the shadow hook PR?", version: 3 });
    const words = "Merge after CI passes.";
    const source = `https://github.com/${REPO}/issues/10#issuecomment-6875070701`;
    server.listWorkspace.mockResolvedValueOnce(workspace([pending])).mockResolvedValue(
      workspace([
        {
          ...pending,
          status: "Decided",
          decision_text: words,
          decision_source_url: source,
          decided_at: "2026-11-14T09:00:00.123456+00:00",
          version: 4,
        },
      ]),
    );
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ decision: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderDecisions("/decisions?item=D-15", { owner: true });

    fireEvent.click(await screen.findByRole("radio", { name: "Decided" }));
    fireEvent.change(screen.getByLabelText("Your words"), { target: { value: words } });
    fireEvent.change(screen.getByLabelText("Source link"), { target: { value: source } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Record your decision" }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/v1/decisions/D-15/decide");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${OWNER_KEY}`);
    expect(headers.get("If-Match")).toBe("3");
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(String(init.body))).toEqual({
      status: "Decided",
      decisionText: words,
      sourceUrl: source,
    });
    expect(await screen.findByRole("region", { name: "Owner decision" })).toHaveTextContent(words);
  });

  it("keeps the version the owner opened as If-Match when a refetch moves the decision on, and says it changed", async () => {
    const opened = decision({ id: "D-16", question: "Merge the refresh PR?", version: 3 });
    server.listWorkspace
      .mockResolvedValueOnce(workspace([opened]))
      .mockResolvedValue(
        workspace([{ ...opened, summary: "An agent changed the gate.", version: 4 }]),
      );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "version_conflict",
              message: "The decision changed since you read it.",
              currentVersion: 4,
            },
          }),
          { status: 409 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderDecisions("/decisions?item=D-16", { owner: true });
    fireEvent.click(await screen.findByRole("radio", { name: "Decided" }));
    fireEvent.change(screen.getByLabelText("Your words"), { target: { value: "Merge it." } });
    fireEvent.change(screen.getByLabelText("Source link"), {
      target: { value: `https://github.com/${REPO}/issues/10#issuecomment-6875070702` },
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh", hidden: true }));

    expect(
      await screen.findByText(
        "This decision changed after you opened it. Review it before you decide.",
      ),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Record your decision" }));
    });
    const ifMatch = (call: number) =>
      new Headers((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].headers).get(
        "If-Match",
      );
    expect(ifMatch(0)).toBe("3");
    expect(
      await screen.findByText("It is now at version 4. Review it above, then record again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Use the latest version" }));
    expect(
      screen.queryByText("This decision changed after you opened it. Review it before you decide."),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeEnabled();
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Record your decision" }));
    });
    expect(ifMatch(1)).toBe("4");
  });

  it("keeps the latest version out of reach while a submit is in flight, so its conflict can still be adopted", async () => {
    const opened = decision({ id: "D-17", question: "Merge the adopt fix?", version: 3 });
    server.listWorkspace
      .mockResolvedValueOnce(workspace([opened]))
      .mockResolvedValue(
        workspace([{ ...opened, summary: "An agent changed the gate.", version: 4 }]),
      );
    let answer: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderDecisions("/decisions?item=D-17", { owner: true });
    fireEvent.click(await screen.findByRole("radio", { name: "Decided" }));
    fireEvent.change(screen.getByLabelText("Your words"), { target: { value: "Merge it." } });
    fireEvent.change(screen.getByLabelText("Source link"), {
      target: { value: `https://github.com/${REPO}/issues/10#issuecomment-6875070703` },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Record your decision" }));
    });
    expect(screen.getByRole("button", { name: "Recording" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Refresh", hidden: true }));
    const adopt = await screen.findByRole("button", { name: "Use the latest version" });
    expect(adopt).toBeDisabled();
    fireEvent.click(adopt);
    expect(screen.getByRole("button", { name: "Recording" })).toBeDisabled();

    await act(async () => {
      answer(
        new Response(
          JSON.stringify({
            error: {
              code: "version_conflict",
              message: "The decision changed since you read it.",
              currentVersion: 4,
            },
          }),
          { status: 409 },
        ),
      );
    });
    expect(
      await screen.findByText("It is now at version 4. Review it above, then record again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use the latest version" }));
    expect(screen.getByRole("button", { name: "Record decision" })).toBeEnabled();
  });
});
