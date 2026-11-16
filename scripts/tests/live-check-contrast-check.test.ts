import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checks, displayRatio } from "../live-check/checks/contrast-check.ts";
import type { CheckContext, CheckOutcome } from "../live-check/types.ts";

const WHITE = { bg: [255, 255, 255, 1], opacity: 1 };

function textSample(fg: readonly number[], selector = "span") {
  return { selector, text: "x", fg, levels: [WHITE], fontSize: 16, fontWeight: 400 };
}

const BLACK_TEXT = textSample([0, 0, 0, 1]);
const PALE_TEXT = textSample([200, 200, 200, 1]);

function run(
  status: number,
  samples: readonly unknown[],
  sampled: number,
  found = sampled,
): Promise<CheckOutcome> {
  const ctx = {
    session: {
      goto: async () => status,
      page: { evaluate: async () => ({ samples, sampled, found }) },
    },
    screenshot: async (name: string) => `${name}.png`,
  } as unknown as CheckContext;
  const [check] = checks;
  assert.ok(check);
  return check.run(ctx);
}

function firstPage(outcome: CheckOutcome): Record<string, unknown> {
  const pages = outcome.evidence["pages"] as Record<string, unknown>[];
  assert.ok(pages[0]);
  return pages[0];
}

describe("contrast check", () => {
  test("passes when every sampled pair meets WCAG AA", async () => {
    assert.equal((await run(200, [BLACK_TEXT], 1)).status, "PASS");
  });

  test("fails when text was found but none of it could be measured", async () => {
    const outcome = await run(200, [], 3);
    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.reason ?? "", /3 text elements/);
  });

  test("records how many text elements a route has beside how many were sampled", async () => {
    const page = firstPage(await run(200, [BLACK_TEXT], 400, 1000));
    assert.deepEqual([page["found"], page["sampled"]], [1000, 400]);
  });

  test("a partly skipped route passes and keeps its skipped count", async () => {
    const outcome = await run(200, [BLACK_TEXT], 3);
    assert.equal(outcome.status, "PASS");
    assert.equal(firstPage(outcome)["skipped"], 2);
  });

  test("states that generated ::before/::after text is not measured", async () => {
    const outcome = await run(200, [BLACK_TEXT], 1);
    assert.match(String(outcome.evidence["scope"]), /::before\/::after content is not measured/);
  });

  test("reports no data only when a route shows no text at all", async () => {
    assert.equal((await run(200, [], 0)).status, "LIVE_NOT_EXECUTED");
  });

  test("fails a route that does not answer 200, whatever its error page shows", async () => {
    const outcome = await run(404, [BLACK_TEXT], 1);
    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.reason ?? "", /404/);
    assert.equal(firstPage(outcome)["status"], 404);
  });

  test("records a route that does not answer 200 with the keys of a measured route", async () => {
    const measured = firstPage(await run(200, [BLACK_TEXT], 1));
    const unmeasured = firstPage(await run(404, [BLACK_TEXT], 1));
    assert.deepEqual(Object.keys(unmeasured).sort(), Object.keys(measured).sort());
    assert.deepEqual(
      [unmeasured["checked"], unmeasured["sampled"], unmeasured["failing"], unmeasured["lowest"]],
      [0, 0, [], null],
    );
  });

  test("names each route's worst failing pair in the failure reason", async () => {
    const grey = textSample([150, 150, 150, 1], "span.grey");
    const pale = textSample([200, 200, 200, 1], "span.pale");
    const outcome = await run(200, [grey, pale], 2);
    assert.equal(outcome.status, "FAIL");
    const reason = outcome.reason ?? "";
    assert.match(reason, /\/tasks: .*span\.pale at 1\.\d+:1, needs 4\.5:1/);
    assert.match(reason, /\/decisions: .*span\.pale/);
    assert.doesNotMatch(reason, /span\.grey/);
  });

  test("keeps one screenshot per route on that route's record", async () => {
    const pages = (await run(200, [BLACK_TEXT], 1)).evidence["pages"] as Record<string, unknown>[];
    assert.deepEqual(
      pages.map(({ route, screenshot }) => [route, screenshot]),
      [
        ["/tasks", "contrast-tasks.png"],
        ["/decisions", "contrast-decisions.png"],
        ["/", "contrast-home.png"],
      ],
    );
  });

  test("records the total failing count beside the first ten failures", async () => {
    const outcome = await run(200, Array<unknown>(12).fill(PALE_TEXT), 12);
    const page = firstPage(outcome);
    assert.equal(outcome.status, "FAIL");
    assert.equal(page["failingCount"], 12);
    assert.equal((page["failing"] as unknown[]).length, 10);
  });
});

describe("displayRatio", () => {
  test("keeps a ratio that is exactly two decimals, such as 4.35", () => {
    assert.equal(displayRatio(4.35), 4.35);
    assert.equal(displayRatio(2.29), 2.29);
    assert.equal(displayRatio(5.57), 5.57);
  });

  test("truncates and never shows more than the ratio", () => {
    assert.equal(displayRatio(4.496), 4.49);
    assert.equal(displayRatio(4.4999999), 4.49);
    assert.equal(displayRatio(21), 21);
  });
});
