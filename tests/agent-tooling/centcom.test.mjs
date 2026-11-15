import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { BIN, FAKE_KEY, UUID_V4, deadUrl, makeHome, run, startStub, wire } from "./harness.mjs";

const PROGRESS = ["progress", "--task", "IRP-04", "--note", "Router tests green"];
const RAID_ADD = [
  ["--type", "issue"],
  ["--title", "Router answers 500"],
  ["--summary", "Empty body gives 500"],
  ["--description", "The handler reads body.model first."],
  ["--source", "https://github.com/o/r/issues/7"],
];
const LESSON_ADD = [
  ["--title", "Check bodies first"],
  ["--summary", "Parse at the route"],
  ["--situation", "An empty body gave 500."],
  ["--action", "Added a route schema."],
  ["--outcome", "It now gives 400."],
  ["--recommendation", "Parse every body."],
  ["--source", "https://github.com/o/r/pull/12"],
];
const TASK_ADD = [
  ["--id", "CC-90"],
  ["--title", "Register agent work"],
  ["--source", "https://github.com/o/r/issues/7"],
];
const without = (pairs, flag) => pairs.filter(([f]) => f !== flag).flat();

async function cli(t, { args = PROGRESS, home = makeHome(t).home, reply, env = {} } = {}) {
  const stub = await startStub(t, reply);
  const r = await run(BIN.cli, { args, env: { HOME: home, CENTCOM_URL: stub.url, ...env } });
  return { ...r, requests: stub.requests };
}

for (const mode of [0o644, 0o640, 0o400]) {
  test(`T10(a) refuses a key file with mode ${mode.toString(8)} and sends nothing`, async (t) => {
    const { home, keyFile } = makeHome(t, { mode });
    const r = await cli(t, { home });
    assert.match(r.stderr, /key_mode/);
    assert.ok(r.stderr.includes(keyFile), "names the file to fix");
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.deepEqual(r.requests, []);
  });
}

test("refuses when the key file is missing", async (t) => {
  const { home } = makeHome(t, { write: false });
  const r = await cli(t, { home });
  assert.match(r.stderr, /key_missing/);
  assert.ok(r.stderr.includes(join(home, ".config/hx-centcom/key")), "names the default path");
  assert.equal(r.code, 1);
  assert.deepEqual(r.requests, []);
});

test("refuses a key file that holds more than one line", async (t) => {
  const { home } = makeHome(t, { key: `${FAKE_KEY}\nsecond line` });
  const r = await cli(t, { home });
  assert.match(r.stderr, /key_invalid/);
  assert.equal(r.code, 1);
  assert.deepEqual(r.requests, []);
});

test("reads the key from CENTCOM_KEY_FILE and expands a leading ~/", async (t) => {
  const { home } = makeHome(t, { at: "keys/CC1.key" });
  const r = await cli(t, { home, env: { CENTCOM_KEY_FILE: "~/keys/CC1.key" } });
  assert.deepEqual(
    r.requests.map((q) => wire(q).authorization),
    ["Bearer <FAKE_KEY>"],
  );
  assert.equal(r.code, 0);
});

test("T10(b) posts the SPEC §5 request with a fresh Idempotency-Key on each run", async (t) => {
  const stub = await startStub(t);
  const env = { HOME: makeHome(t).home, CENTCOM_URL: stub.url };
  const args = [
    ...PROGRESS,
    "--status",
    "In progress",
    "--link",
    "CI=https://github.com/o/r/actions/runs/1",
    "--link",
    "Doc=https://example.com/d?a=b",
    "--sha",
    "3e39a5c",
    "--pr",
    "https://github.com/o/r/pull/12",
    "--run",
    "run-1",
  ];
  const runs = [await run(BIN.cli, { args, env }), await run(BIN.cli, { args, env })];
  const expected = {
    method: "POST",
    path: "/api/v1/tasks/IRP-04/updates",
    authorization: "Bearer <FAKE_KEY>",
    accept: "application/json",
    contentType: "application/json",
    body: {
      kind: "progress",
      note: "Router tests green",
      status: "In progress",
      links: [
        { label: "CI", url: "https://github.com/o/r/actions/runs/1" },
        { label: "Doc", url: "https://example.com/d?a=b" },
      ],
      commitSha: "3e39a5c",
      prUrl: "https://github.com/o/r/pull/12",
      source: "cli",
      runId: "run-1",
    },
  };
  assert.deepEqual(stub.requests.map(wire), [expected, expected]);
  const [first, second] = stub.requests.map((q) => q.headers["idempotency-key"]);
  assert.match(first, UUID_V4);
  assert.match(second, UUID_V4);
  assert.notEqual(first, second);
  assert.deepEqual(
    runs.map((r) => [r.code, r.stdout]),
    [
      [0, "upd_1\n"],
      [0, "upd_1\n"],
    ],
  );
});

test("omits options that were not given instead of sending nulls", async (t) => {
  const r = await cli(t);
  assert.deepEqual(
    r.requests.map((q) => q.body),
    [{ kind: "progress", note: "Router tests green", source: "cli" }],
  );
});

test("keeps a path prefix in CENTCOM_URL and encodes the task id", async (t) => {
  const stub = await startStub(t);
  const r = await run(BIN.cli, {
    args: ["progress", "--task", "IRP 04/x", "--note", "n"],
    env: { HOME: makeHome(t).home, CENTCOM_URL: `${stub.url}/dash` },
  });
  assert.deepEqual(
    stub.requests.map((q) => q.path),
    ["/dash/api/v1/tasks/IRP%2004%2Fx/updates"],
  );
  assert.equal(r.code, 0);
});

test("prints the server's error code and message and exits 1", async (t) => {
  const r = await cli(t, {
    reply: () => ({
      status: 403,
      body: { error: { code: "forbidden", message: "CC1 may not write task IRP-05" } },
    }),
  });
  assert.equal(r.stderr, "centcom: forbidden (403): CC1 may not write task IRP-05\n");
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
});

test("falls back to a top-level code and message", async (t) => {
  const r = await cli(t, {
    reply: () => ({
      status: 403,
      body: { code: "forbidden", message: "CC1 may not write task IRP-05" },
    }),
  });
  assert.equal(r.stderr, "centcom: forbidden (403): CC1 may not write task IRP-05\n");
  assert.equal(r.code, 1);
});

test("reports an error page without a JSON body by its HTTP status", async (t) => {
  const r = await cli(t, { reply: () => ({ status: 502, raw: "<html>Bad Gateway</html>" }) });
  assert.match(r.stderr, /http_error \(502\)/);
  assert.equal(r.code, 1);
});

test("reports an unreachable server and exits 1", async (t) => {
  const r = await run(BIN.cli, {
    args: PROGRESS,
    env: { HOME: makeHome(t).home, CENTCOM_URL: await deadUrl() },
  });
  assert.match(r.stderr, /unreachable/);
  assert.equal(r.code, 1);
});

test("refuses to run without CENTCOM_URL", async (t) => {
  const r = await run(BIN.cli, { args: PROGRESS, env: { HOME: makeHome(t).home } });
  assert.match(r.stderr, /config/);
  assert.equal(r.code, 1);
});

test("refuses a CENTCOM_URL that holds credentials, without echoing them", async (t) => {
  const r = await run(BIN.cli, {
    args: PROGRESS,
    env: { HOME: makeHome(t).home, CENTCOM_URL: "http://user:s3cretpw@127.0.0.1:9" },
  });
  assert.match(r.stderr, /config/);
  assert.doesNotMatch(r.stderr, /s3cretpw/);
  assert.equal(r.code, 1);
});

const USAGE_ERRORS = [
  ["no --task", ["progress", "--note", "n"]],
  ["no --note", ["progress", "--task", "IRP-04"]],
  ["a --link without =", [...PROGRESS, "--link", "just-text"]],
  ["an unknown option", [...PROGRESS, "--bogus"]],
  ["an unknown command", ["frobnicate"]],
  ...RAID_ADD.map(([flag]) => [
    `raid add without ${flag}`,
    ["raid", "add", ...without(RAID_ADD, flag)],
    flag,
  ]),
  ["raid update without an id", ["raid", "update", "--status", "closed"], "<id> is required"],
  [
    "raid update with two ids",
    ["raid", "update", "RAID-01", "RAID-02", "--status", "closed"],
    '"RAID-02"',
  ],
  ["raid update without a field", ["raid", "update", "RAID-01"], "at least one field"],
  ["raid update with --type", ["raid", "update", "RAID-01", "--type", "risk"], "--type"],
  ...LESSON_ADD.map(([flag]) => [
    `lesson add without ${flag}`,
    ["lesson", "add", ...without(LESSON_ADD, flag)],
    flag,
  ]),
  ...TASK_ADD.map(([flag]) => [
    `task add without ${flag}`,
    ["task", "add", ...without(TASK_ADD, flag)],
    flag,
  ]),
  ["lesson update without an id", ["lesson", "update", "--status", "adopted"], "<id> is required"],
  [
    "lesson update with two ids",
    ["lesson", "update", "L-01", "L-02", "--status", "adopted"],
    '"L-02"',
  ],
  ["lesson update without a field", ["lesson", "update", "L-01"], "at least one field"],
  ["an unknown raid subcommand", ["raid", "delete", "RAID-01"], '"raid delete"'],
];
for (const [why, args, names] of USAGE_ERRORS) {
  test(`exits 2 and sends nothing for ${why}`, async (t) => {
    const homeWithRefusedKey = makeHome(t, { mode: 0o644 }).home;
    const r = await cli(t, { args, home: homeWithRefusedKey });
    assert.equal(r.code, 2);
    assert.doesNotMatch(
      r.stderr,
      /key_mode/,
      "a usage error is reported before the key file is opened",
    );
    assert.deepEqual(r.requests, []);
    if (names) assert.ok(r.stderr.includes(names), `the message names ${names}: ${r.stderr}`);
  });
}

test("help prints usage and exits 0", async (t) => {
  const r = await run(BIN.cli, { args: ["help"], env: { HOME: makeHome(t).home } });
  assert.match(r.stdout, /centcom progress --task/);
  assert.match(
    r.stdout,
    /centcom task add --id <id> --title <title> --source <source> \[--repo <repo>\]/,
  );
  assert.match(r.stdout, /centcom raid add --type/);
  assert.match(r.stdout, /centcom raid update <id> /);
  assert.match(r.stdout, /centcom lesson add --title/);
  assert.match(r.stdout, /centcom lesson update <id> /);
  assert.match(r.stdout, /\[--escalated \| --no-escalated\]/);
  assert.equal(r.code, 0);
});

test("help lists the seeded status labels for progress and task add", async (t) => {
  const r = await run(BIN.cli, { args: ["help"], env: { HOME: makeHome(t).home } });
  assert.match(
    r.stdout,
    /Status labels for progress --status and task add --status:\n {2}Blocked, Complete, In progress, Ready for owner, Waiting\n/,
  );
  assert.equal(r.code, 0);
});

test("whoami shows the agent the key resolves to", async (t) => {
  const r = await cli(t, { args: ["whoami"] });
  assert.deepEqual(r.requests.map(wire), [
    {
      method: "GET",
      path: "/api/v1/workspace",
      authorization: "Bearer <FAKE_KEY>",
      accept: "application/json",
      contentType: undefined,
      body: undefined,
    },
  ]);
  assert.equal(r.stdout, "CC1 (agent)\n");
  assert.equal(r.code, 0);
});

test("whoami says so when the server does not report the agent", async (t) => {
  const r = await cli(t, { args: ["whoami"], reply: () => ({ status: 200, body: { tasks: [] } }) });
  assert.match(r.stdout, /did not say which agent/);
  assert.equal(r.code, 0);
});

test("prints each issue of an invalid request on its own indented line", async (t) => {
  const r = await cli(t, {
    reply: () => ({
      status: 400,
      body: {
        error: {
          code: "invalid",
          status: 400,
          message: "The request body is invalid.",
          issues: [
            { path: "proofUrl", message: "PASS needs a proofUrl" },
            { path: "links.0.url", message: "Invalid url" },
          ],
        },
      },
    }),
  });
  assert.equal(
    r.stderr,
    "centcom: invalid (400): The request body is invalid.\n  proofUrl: PASS needs a proofUrl\n  links.0.url: Invalid url\n",
  );
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
});

test("raid add posts the given fields with a fresh Idempotency-Key and prints the item id", async (t) => {
  const r = await cli(t, {
    args: [
      "raid",
      "add",
      ...RAID_ADD.flat(),
      "--severity",
      "medium",
      "--impact",
      "No routing",
      "--task",
      "IRP-04",
      "--task",
      "IRP-05",
      "--escalated",
    ],
  });
  assert.deepEqual(r.requests.map(wire), [
    {
      method: "POST",
      path: "/api/v1/raid",
      authorization: "Bearer <FAKE_KEY>",
      accept: "application/json",
      contentType: "application/json",
      body: {
        type: "issue",
        title: "Router answers 500",
        summary: "Empty body gives 500",
        description: "The handler reads body.model first.",
        sourceUrl: "https://github.com/o/r/issues/7",
        severity: "medium",
        impact: "No routing",
        taskIds: ["IRP-04", "IRP-05"],
        escalated: true,
      },
    },
  ]);
  assert.match(r.requests[0].headers["idempotency-key"], UUID_V4);
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "RAID-01\n", ""]);
});

test("raid add prints the decision the server opened on a second line", async (t) => {
  const r = await cli(t, {
    args: ["raid", "add", ...RAID_ADD.flat(), "--severity", "high"],
    reply: () => ({
      status: 201,
      body: { item: { id: "RAID-02" }, decision: { id: "D-07" }, systemUpdates: [] },
    }),
  });
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "RAID-02\ndecision D-07\n", ""]);
});

test("raid update puts only the given fields and prints the item id", async (t) => {
  const r = await cli(t, {
    args: ["raid", "update", "RAID-01", "--status", "closed", "--resolution", "Fixed in #12"],
  });
  assert.deepEqual(r.requests.map(wire), [
    {
      method: "PUT",
      path: "/api/v1/raid/RAID-01",
      authorization: "Bearer <FAKE_KEY>",
      accept: "application/json",
      contentType: "application/json",
      body: { status: "closed", resolution: "Fixed in #12" },
    },
  ]);
  assert.match(r.requests[0].headers["idempotency-key"], UUID_V4);
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "RAID-01\n", ""]);
});

test("raid update encodes the item id in the path", async (t) => {
  const r = await cli(t, { args: ["raid", "update", "RAID 01/x", "--escalated"] });
  assert.deepEqual(
    r.requests.map((q) => [q.path, q.body]),
    [["/api/v1/raid/RAID%2001%2Fx", { escalated: true }]],
  );
  assert.equal(r.code, 0);
});

test("raid update --no-escalated sends escalated false", async (t) => {
  const r = await cli(t, { args: ["raid", "update", "RAID-01", "--no-escalated"] });
  assert.deepEqual(
    r.requests.map((q) => [q.method, q.path, q.body]),
    [["PUT", "/api/v1/raid/RAID-01", { escalated: false }]],
  );
  assert.deepEqual([r.code, r.stdout], [0, "RAID-01\n"]);
});

test("task add posts the given fields with a fresh Idempotency-Key and prints the task id", async (t) => {
  const r = await cli(t, {
    args: [
      "task",
      "add",
      ...TASK_ADD.flat(),
      "--repo",
      "HX-CentCom",
      "--host",
      "HX-15",
      "--start",
      "2026-11-15",
      "--due",
      "2026-11-16",
      "--status",
      "In progress",
      "--note",
      "Registered by the hook",
    ],
  });
  assert.deepEqual(r.requests.map(wire), [
    {
      method: "POST",
      path: "/api/v1/tasks",
      authorization: "Bearer <FAKE_KEY>",
      accept: "application/json",
      contentType: "application/json",
      body: {
        id: "CC-90",
        title: "Register agent work",
        sourceUrl: "https://github.com/o/r/issues/7",
        repository: "HX-CentCom",
        host: "HX-15",
        startDate: "2026-11-15",
        dueDate: "2026-11-16",
        status: "In progress",
        note: "Registered by the hook",
      },
    },
  ]);
  assert.match(r.requests[0].headers["idempotency-key"], UUID_V4);
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "CC-90\n", ""]);
});

test("task add sends only the given fields", async (t) => {
  const r = await cli(t, { args: ["task", "add", ...TASK_ADD.flat()] });
  assert.deepEqual(r.requests[0].body, {
    id: "CC-90",
    title: "Register agent work",
    sourceUrl: "https://github.com/o/r/issues/7",
  });
  assert.equal(r.code, 0);
});

test("lesson add posts the given fields and prints the lesson id", async (t) => {
  const r = await cli(t, {
    args: [
      "lesson",
      "add",
      ...LESSON_ADD.flat(),
      "--tag",
      "validation",
      "--tag",
      "routing",
      "--applies-to",
      "Route handlers",
    ],
  });
  assert.deepEqual(r.requests.map(wire), [
    {
      method: "POST",
      path: "/api/v1/lessons",
      authorization: "Bearer <FAKE_KEY>",
      accept: "application/json",
      contentType: "application/json",
      body: {
        title: "Check bodies first",
        summary: "Parse at the route",
        situation: "An empty body gave 500.",
        action: "Added a route schema.",
        outcome: "It now gives 400.",
        recommendation: "Parse every body.",
        sourceUrl: "https://github.com/o/r/pull/12",
        tags: ["validation", "routing"],
        appliesTo: "Route handlers",
      },
    },
  ]);
  assert.match(r.requests[0].headers["idempotency-key"], UUID_V4);
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "L-01\n", ""]);
});

test("lesson update puts only the given fields and prints the lesson id", async (t) => {
  const r = await cli(t, {
    args: [
      "lesson",
      "update",
      "L-01",
      "--status",
      "adopted",
      "--enforced-by",
      "https://github.com/o/r/pull/9",
    ],
  });
  assert.deepEqual(r.requests.map(wire), [
    {
      method: "PUT",
      path: "/api/v1/lessons/L-01",
      authorization: "Bearer <FAKE_KEY>",
      accept: "application/json",
      contentType: "application/json",
      body: { status: "adopted", enforcedByUrl: "https://github.com/o/r/pull/9" },
    },
  ]);
  assert.match(r.requests[0].headers["idempotency-key"], UUID_V4);
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "L-01\n", ""]);
});

test("lesson update encodes the lesson id in the path", async (t) => {
  const r = await cli(t, { args: ["lesson", "update", "L 01/x", "--title", "Parse bodies first"] });
  assert.deepEqual(
    r.requests.map((q) => [q.path, q.body]),
    [["/api/v1/lessons/L%2001%2Fx", { title: "Parse bodies first" }]],
  );
  assert.equal(r.code, 0);
});

const NO_ID_ANSWERS = [
  [
    "raid add",
    ["raid", "add", ...RAID_ADD.flat()],
    { status: 201, body: { decision: null, systemUpdates: [] } },
  ],
  [
    "raid update",
    ["raid", "update", "RAID-01", "--status", "closed"],
    { status: 200, body: { item: {}, decision: null } },
  ],
  ["task add", ["task", "add", ...TASK_ADD.flat()], { status: 201, body: { task: null } }],
  ["lesson add", ["lesson", "add", ...LESSON_ADD.flat()], { status: 201, body: { lesson: null } }],
  [
    "lesson update",
    ["lesson", "update", "L-01", "--status", "retired"],
    { status: 200, body: { lesson: {} } },
  ],
];
for (const [name, args, answer] of NO_ID_ANSWERS) {
  test(`${name} reports a success answer without the id as bad_response`, async (t) => {
    const r = await cli(t, { args, reply: () => answer });
    assert.match(r.stderr, /^centcom: bad_response: /);
    assert.deepEqual([r.code, r.stdout], [1, ""]);
  });
}
