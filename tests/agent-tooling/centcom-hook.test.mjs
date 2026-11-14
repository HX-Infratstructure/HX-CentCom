import assert from "node:assert/strict";
import { chmodSync, copyFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import {
  BIN,
  FAKE_KEY,
  UUID_V4,
  assertSilentExit,
  deadUrl,
  hookPayload,
  makeHome,
  makeRepo,
  run,
  startStub,
  wire,
} from "./harness.mjs";

const PR = "https://github.com/o/r/pull/12";

async function hook(
  t,
  { command, env = {}, reply, home = makeHome(t).home, taskFile, cwd, ...payload },
) {
  const stub = await startStub(t, reply);
  const repo = makeRepo(t, { taskFile });
  const r = await run(BIN.hook, {
    env: { HOME: home, CENTCOM_URL: stub.url, CENTCOM_TASK: "IRP-04", ...env },
    stdin: hookPayload({ command, cwd: cwd ?? repo.dir, ...payload }),
  });
  return { ...r, requests: stub.requests, repo };
}

test("T10(c) posts a link update with the commit and PR URL after gh pr create", async (t) => {
  const r = await hook(t, { command: "gh pr create --fill", stdout: `${PR}\n` });
  assert.deepEqual(r.requests.map(wire), [
    {
      method: "POST",
      path: "/api/v1/tasks/IRP-04/updates",
      authorization: "Bearer <FAKE_KEY>",
      accept: "application/json",
      contentType: "application/json",
      body: {
        kind: "link",
        note: "Opened a pull request",
        commitSha: r.repo.sha,
        prUrl: PR,
        source: "hook",
      },
    },
  ]);
  assert.match(r.requests[0].headers["idempotency-key"], UUID_V4);
  assertSilentExit(r);
});

for (const command of [
  "gh pr view 12",
  "git status",
  'echo "git push"',
  "git pushx",
  'git commit -m "then gh pr create"',
]) {
  test(`T10(c) does nothing after another command: ${command}`, async (t) => {
    const r = await hook(t, { command, stdout: `${PR}\n` });
    assert.deepEqual(r.requests, []);
    assertSilentExit(r);
  });
}

test("takes the task from the first line of .centcom-task when CENTCOM_TASK is unset", async (t) => {
  const r = await hook(t, {
    command: "git push",
    env: { CENTCOM_TASK: undefined },
    taskFile: "IRP-05\nignored\n",
  });
  assert.deepEqual(
    r.requests.map((q) => q.path),
    ["/api/v1/tasks/IRP-05/updates"],
  );
  assertSilentExit(r);
});

test("CENTCOM_TASK wins over .centcom-task", async (t) => {
  const r = await hook(t, { command: "git push", taskFile: "IRP-05\n" });
  assert.deepEqual(
    r.requests.map((q) => q.path),
    ["/api/v1/tasks/IRP-04/updates"],
  );
});

test("sends no prUrl for git push's /pull/new/ hint", async (t) => {
  const stderr =
    "remote: Create a pull request for 'feat' on GitHub by visiting:\nremote:      https://github.com/o/r/pull/new/feat\n";
  const r = await hook(t, { command: "git push -u origin feat", stderr });
  assert.deepEqual(
    r.requests.map((q) => q.body),
    [{ kind: "link", note: "Pushed commits", commitSha: r.repo.sha, source: "hook" }],
  );
});

test("takes the PR URL from gh pr merge <url> when the output has none", async (t) => {
  const r = await hook(t, { command: `gh pr merge ${PR} --squash` });
  assert.deepEqual(
    r.requests.map((q) => q.body.prUrl),
    [PR],
  );
});

test("finds the repo through an absolute cd when the session cwd is not a repo", async (t) => {
  const { home } = makeHome(t);
  const repo = makeRepo(t);
  const r = await hook(t, {
    home,
    cwd: home,
    command: `cd ${repo.dir} && git push -u origin HEAD`,
  });
  assert.deepEqual(
    r.requests.map((q) => q.body.commitSha),
    [repo.sha],
  );
});

test("finds the repo through git -C when the session cwd is not a repo", async (t) => {
  const { home } = makeHome(t);
  const repo = makeRepo(t);
  const r = await hook(t, { home, cwd: home, command: `git -C ${repo.dir} push` });
  assert.deepEqual(
    r.requests.map((q) => q.body.commitSha),
    [repo.sha],
  );
});

const POSTS = [
  [{ command: "git push" }, "Pushed commits"],
  [{ command: 'git add -A && git commit -m "wip" && git push -u origin HEAD' }, "Pushed commits"],
  [{ command: "gh pr create --fill 2>&1 | tee log", stdout: `${PR}\n` }, "Opened a pull request"],
  [{ command: "gh pr merge 12 --squash --delete-branch" }, "Merged a pull request"],
  [{ command: 'GIT_SSH_COMMAND="ssh -q" git push' }, "Pushed commits"],
  [{ command: "git push origin :" }, "Pushed commits"],
  [{ command: "git push && gh pr create --fill" }, "Pushed commits; Opened a pull request"],
];
for (const [call, note] of POSTS) {
  test(`posts once after: ${call.command}`, async (t) => {
    const r = await hook(t, call);
    assert.deepEqual(
      r.requests.map((q) => q.body.note),
      [note],
    );
    assertSilentExit(r);
  });
}

const PUSH_STDOUT = "To github.com:o/r.git\n   3e39a5c..9f1b2d4  main -> main\n";
const NOT_PUBLISHED = [
  ["a dry run", { command: "git push --dry-run" }],
  ["git push -n", { command: "git push -n origin main" }],
  ["a push that pushed nothing", { command: "git push", stderr: "Everything up-to-date\n" }],
  ["a push followed by ||", { command: "git push || true" }],
  ["a push after ||", { command: "true || git push" }],
  ["a push in the background", { command: "git push &" }],
  ["a push piped into tail", { command: "git push 2>&1 | tail -3", stdout: PUSH_STDOUT }],
  ["a branch deletion", { command: "git push --delete origin x" }],
  ["a branch deletion with -d", { command: "git push -d origin x" }],
  ["a branch deletion by an empty-source refspec", { command: "git push origin :feature" }],
  ["a forced branch deletion by an empty-source refspec", { command: "git push origin +:feature" }],
  [
    "a piped gh pr create without a PR URL in the output",
    { command: "gh pr create --fill 2>&1 | tee log" },
  ],
  [
    "a piped gh pr create that found an existing PR",
    {
      command: "gh pr create --fill 2>&1 | tee log",
      stdout: `a pull request for branch "x" into branch "main" already exists:\n${PR}\n`,
    },
  ],
  ["a pull request opened in the browser", { command: "gh pr create --web" }],
  ["an auto-merge that has not merged yet", { command: "gh pr merge 12 --auto" }],
  ["git push inside a heredoc body", { command: "cat <<'EOF' > notes.txt\ngit push\nEOF" }],
];
for (const [why, call] of NOT_PUBLISHED) {
  test(`does not post after ${why}: ${JSON.stringify(call.command)}`, async (t) => {
    const r = await hook(t, call);
    assert.deepEqual(r.requests, []);
    assertSilentExit(r);
  });
}

const UNKNOWN_DIRECTORY = [
  ["a relative cd", (decoyRepo) => `cd ../${basename(decoyRepo)} && git push`],
  ["a cd inside parentheses", (decoyRepo) => `(cd ${decoyRepo} && true) && git push`],
];
for (const [why, line] of UNKNOWN_DIRECTORY) {
  test(`does not post when ${why} leaves the repository unknown`, async (t) => {
    const decoyRepo = makeRepo(t);
    const r = await hook(t, { command: line(decoyRepo.dir) });
    assert.deepEqual(r.requests, []);
    assertSilentExit(r);
  });
}

test("T10(d) does nothing when no task is configured", async (t) => {
  const r = await hook(t, {
    command: "gh pr create --fill",
    stdout: PR,
    env: { CENTCOM_TASK: undefined },
  });
  assert.deepEqual(r.requests, []);
  assertSilentExit(r);
});

test("T10(d) does nothing when there is no key file", async (t) => {
  const r = await hook(t, {
    command: "gh pr create --fill",
    stdout: PR,
    home: makeHome(t, { write: false }).home,
  });
  assert.deepEqual(r.requests, []);
  assertSilentExit(r);
});

// Wall-clock bound, not the hook's own deadline: it leaves room for process start on a loaded host, stays under the
// Claude Code hook timeout in docs/AGENT-POSTING.md, and is well short of run()'s kill guard, which a hung hook reaches.
const ENDS_BEFORE_CLAUDE_CODE_TIMEOUT_MS = 5000;

test("T10(e) exits 0 silently and quickly when the server is down", async (t) => {
  const r = await hook(t, {
    command: "gh pr create --fill",
    stdout: PR,
    env: { CENTCOM_URL: await deadUrl() },
  });
  assertSilentExit(r);
  assert.ok(r.ms < ENDS_BEFORE_CLAUDE_CODE_TIMEOUT_MS, `took ${r.ms} ms`);
});

test("gives up within the 3 s budget when the server never answers", async (t) => {
  const r = await hook(t, { command: "gh pr create --fill", stdout: PR, reply: () => "hang" });
  assert.equal(r.requests.length, 1, "it did try");
  assertSilentExit(r);
  assert.ok(r.ms < ENDS_BEFORE_CLAUDE_CODE_TIMEOUT_MS, `took ${r.ms} ms`);
});

test("exits 0 silently within about 3 s when stdin never closes", async (t) => {
  const r = await run(BIN.hook, {
    stdin: null,
    env: { HOME: makeHome(t).home, CENTCOM_TASK: "IRP-04" },
  });
  assertSilentExit(r);
  assert.ok(r.ms < ENDS_BEFORE_CLAUDE_CODE_TIMEOUT_MS, `took ${r.ms} ms`);
});

for (const [why, payload] of [
  ["an interrupted call", { interrupted: true }],
  ["a call run in the background", { runInBackground: true }],
  ["a PostToolUseFailure event", { event: "PostToolUseFailure" }],
  ["another tool", { tool: "Write" }],
]) {
  test(`does not post for ${why}`, async (t) => {
    const r = await hook(t, { command: "gh pr create --fill", stdout: PR, ...payload });
    assert.deepEqual(r.requests, []);
    assertSilentExit(r);
  });
}

test("exits 0 silently when stdin is not JSON", async (t) => {
  const r = await run(BIN.hook, {
    stdin: "not json",
    env: { HOME: makeHome(t).home, CENTCOM_TASK: "IRP-04" },
  });
  assertSilentExit(r);
});

test("exits 0 silently when copied away from bin/lib", async (t) => {
  const { home } = makeHome(t);
  const lone = join(home, "centcom-hook");
  copyFileSync(BIN.hook, lone);
  chmodSync(lone, 0o755);
  const r = await run(lone, {
    env: { HOME: home, CENTCOM_URL: await deadUrl(), CENTCOM_TASK: "IRP-04" },
    stdin: hookPayload({ command: "gh pr create --fill", cwd: makeRepo(t).dir, stdout: PR }),
  });
  assertSilentExit(r);
});

test("CENTCOM_DEBUG=1 explains a skip on stderr and still exits 0", async (t) => {
  const r = await hook(t, {
    command: "gh pr create --fill",
    stdout: PR,
    env: { CENTCOM_TASK: undefined, CENTCOM_DEBUG: "1" },
  });
  assert.match(r.stderr, /no task/);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
});

test("CENTCOM_DEBUG=1 blames the deadline, not the repository, when git is cut off", async (t) => {
  const { home } = makeHome(t);
  writeFileSync(join(home, "git"), "#!/bin/sh\nexec sleep 10\n", { mode: 0o755 });
  const r = await hook(t, {
    home,
    command: "git push",
    env: { CENTCOM_DEBUG: "1", PATH: `${home}:${process.env.PATH}` },
  });
  assert.deepEqual(r.requests, []);
  assert.match(r.stderr, /skipped: .*abort/i);
  assert.doesNotMatch(r.stderr, /no git commit/);
  assert.equal(r.code, 0);
});

test("never prints or posts a key that appears in the command or its output, even with CENTCOM_DEBUG=1", async (t) => {
  const r = await hook(t, {
    command: `echo ${FAKE_KEY} && gh pr create --fill`,
    stdout: `${FAKE_KEY}\n${PR}\n`,
    env: { CENTCOM_DEBUG: "1" },
  });
  assert.equal(r.requests.length, 1, "it posted, so every debug line on the way ran");
  assert.ok(
    !JSON.stringify(r.requests[0].body).includes(FAKE_KEY),
    "the posted update does not carry the key",
  );
  assert.notEqual(r.stderr, "", "debug output was written");
  assert.equal(r.code, 0);
});
