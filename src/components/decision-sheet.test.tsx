import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render-app";
import { shellWith } from "@/test/ui-fixtures";
import type { Agent, Decision, DecisionsPage } from "./server-types";

const server = vi.hoisted(() => ({
  listWorkspaceShell: vi.fn(),
  listDecisions: vi.fn(),
  getDecision: vi.fn(),
}));
vi.mock("@/lib/tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks.functions")>()),
  listWorkspaceShell: server.listWorkspaceShell,
  listDecisions: server.listDecisions,
  getDecision: server.getDecision,
}));

const REPO = "HX-Infratstructure/HX-CentCom";
const OWNER_KEY = "owner-key-for-this-test";

// Names the seed roster does not use (tests/codebase/agent-display-names.test.ts).
const AGENTS: readonly Agent[] = [
  { id: "atlas", display_name: "Atlas", role: "agent", color: "green", active: true },
];

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

/** The server's status filter: none, every decided status (`not_pending`), or one status. */
function matchesStatus(d: Decision, status: string | undefined): boolean {
  if (status === undefined) return true;
  if (status === "not_pending") return d.status !== "Pending";
  return d.status === status;
}

/** The decision reads answer from `register()`, read at each call, so a test changes what a refetch returns. */
function serve(register: () => readonly Decision[]) {
  server.listDecisions.mockImplementation(
    async ({ data }: { data: { status?: string } }): Promise<DecisionsPage> => {
      const items = register().filter((d) => matchesStatus(d, data.status));
      return {
        items,
        nextCursor: null,
        counts: { total: items.length, byGateType: {}, byStatus: {} },
      };
    },
  );
  server.getDecision.mockImplementation(
    async ({ data }: { data: { id: string } }) => register().find((d) => d.id === data.id) ?? null,
  );
}

async function renderDecisions(url: string, { owner = false } = {}) {
  if (owner) window.sessionStorage.setItem("hx-centcom.owner-key", OWNER_KEY);
  await renderApp(url, { heading: "Decisions", onDocument: true, hidden: true });
}

beforeEach(() => {
  server.listWorkspaceShell.mockResolvedValue(shellWith({ agents: AGENTS }));
  serve(() => []);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  server.listWorkspaceShell.mockReset();
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

describe("the decision sheet's lookup: loaded pages first, then by id", () => {
  it("shows a decision on the loaded Pending page at once, while its by-id read is still pending", async () => {
    serve(() => [decision({ id: "D-15", question: "Merge the paging PR?" })]);
    server.getDecision.mockImplementation(() => new Promise(() => {}));
    await renderDecisions("/decisions?item=D-15");

    expect(await screen.findByRole("dialog", { name: "Merge the paging PR?" })).toBeInTheDocument();
    expect(screen.queryByText(/^Loading .* D-15\.$/)).toBeNull();
    expect(server.getDecision).toHaveBeenCalledWith({ data: { id: "D-15" } });
  });

  it("opens a decided decision on no loaded page by asking the register for it", async () => {
    serve(() => [DECIDED]);
    await renderDecisions("/decisions?item=D-14");

    const outcome = await screen.findByRole("region", { name: "Owner decision" });
    expect(
      screen.getByRole("dialog", { name: "Deploy release 1.2 to HX-15?" }),
    ).toBeInTheDocument();
    expect(outcome).toHaveTextContent("Deploy after the smoke test passes.");
    expect(server.getDecision).toHaveBeenCalledWith({ data: { id: "D-14" } });
  });

  it("says the decision is not in the register when the register does not hold it either", async () => {
    await renderDecisions("/decisions?item=D-99");

    expect(await screen.findByText("D-99 is not in the decision register.")).toBeInTheDocument();
    expect(server.getDecision).toHaveBeenCalledWith({ data: { id: "D-99" } });
  });

  it("reads the agents from the bounded shell", async () => {
    serve(() => [decision({ id: "D-15", question: "Merge the paging PR?" })]);
    await renderDecisions("/decisions?item=D-15");

    await screen.findByRole("dialog", { name: "Merge the paging PR?" });
    expect(server.listWorkspaceShell).toHaveBeenCalled();
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
    serve(() => [decision({ id: "D-15", question: "Deploy release 1.2?", summary, description })]);
    await renderDecisions("/decisions?item=D-15");

    const section = await screen.findByRole("region", { name: "Description" });
    expect(description.length).toBeGreaterThan(140);
    expect(section.textContent).toBe(`Description${description}`);
  });
});

describe("the owner key prompt on a decision", () => {
  const PROMPT = "Deciding needs the owner key.";

  it("asks for the owner key on a pending decision in public mode, then shows the decide form once a key is stored", async () => {
    serve(() => [decision({ id: "D-15", question: "Merge the shadow hook PR?" })]);
    await renderDecisions("/decisions?item=D-15");

    const sheet = await screen.findByRole("dialog", { name: "Merge the shadow hook PR?" });
    expect(within(sheet).getByText(PROMPT)).toBeInTheDocument();
    expect(within(sheet).queryByRole("form", { name: "Record your decision" })).toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "Enter owner key" }));
    const keyDialog = await screen.findByRole("dialog", { name: "Owner key" });
    fireEvent.change(within(keyDialog).getByLabelText("Owner key"), {
      target: { value: OWNER_KEY },
    });
    await act(async () => {
      fireEvent.click(within(keyDialog).getByRole("button", { name: "Use key" }));
    });

    expect(window.sessionStorage.getItem("hx-centcom.owner-key")).toBe(OWNER_KEY);
    expect(
      await within(sheet).findByRole("form", { name: "Record your decision" }),
    ).toBeInTheDocument();
    expect(within(sheet).queryByText(PROMPT)).toBeNull();
  });

  it("moves focus to the decide form's first choice once a key is stored", async () => {
    serve(() => [decision({ id: "D-15", question: "Merge the shadow hook PR?" })]);
    await renderDecisions("/decisions?item=D-15");

    const sheet = await screen.findByRole("dialog", { name: "Merge the shadow hook PR?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Enter owner key" }));
    const keyDialog = await screen.findByRole("dialog", { name: "Owner key" });
    fireEvent.change(within(keyDialog).getByLabelText("Owner key"), {
      target: { value: OWNER_KEY },
    });
    await act(async () => {
      fireEvent.click(within(keyDialog).getByRole("button", { name: "Use key" }));
    });

    const firstChoice = await within(sheet).findByRole("radio", { name: "Decided" });
    await waitFor(() => expect(document.activeElement).toBe(firstChoice));
  });

  it("shows no prompt on a decided decision, only the owner's outcome", async () => {
    serve(() => []);
    server.getDecision.mockResolvedValue(DECIDED);
    await renderDecisions("/decisions?item=D-14");

    const outcome = await screen.findByRole("region", { name: "Owner decision" });
    expect(outcome).toHaveTextContent("Deploy after the smoke test passes.");
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.queryByRole("button", { name: "Enter owner key" })).toBeNull();
  });

  it("shows no prompt in owner mode, only the decide form", async () => {
    serve(() => [decision({ id: "D-15", question: "Merge the shadow hook PR?" })]);
    await renderDecisions("/decisions?item=D-15", { owner: true });

    expect(await screen.findByRole("form", { name: "Record your decision" })).toBeInTheDocument();
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.queryByRole("button", { name: "Enter owner key" })).toBeNull();
  });
});

describe("recording a decision through the owner actions", () => {
  it("sends the owner key, the version as If-Match and a request key, then shows the refreshed outcome", async () => {
    const pending = decision({ id: "D-15", question: "Merge the shadow hook PR?", version: 3 });
    const words = "Merge after CI passes.";
    const source = `https://github.com/${REPO}/issues/10#issuecomment-6875070701`;
    let current = pending;
    serve(() => [current]);
    const fetchMock = vi.fn(async () => {
      current = {
        ...pending,
        status: "Decided",
        decision_text: words,
        decision_source_url: source,
        decided_at: "2026-11-14T09:00:00.123456+00:00",
        version: 4,
      };
      return new Response(JSON.stringify({ decision: {} }), { status: 200 });
    });
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
    // Decided, it leaves the Pending page, so the sheet reads it by id.
    expect(server.getDecision).toHaveBeenCalledWith({ data: { id: "D-15" } });
  });

  it("keeps the version the owner opened as If-Match when a refetch moves the decision on, and says it changed", async () => {
    const opened = decision({ id: "D-16", question: "Merge the refresh PR?", version: 3 });
    let current = opened;
    serve(() => [current]);
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

    current = { ...opened, summary: "An agent changed the gate.", version: 4 };
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
    let current = opened;
    serve(() => [current]);
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

    current = { ...opened, summary: "An agent changed the gate.", version: 4 };
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
