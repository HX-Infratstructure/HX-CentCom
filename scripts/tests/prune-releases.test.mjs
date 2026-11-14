import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const DAY = 24 * 60 * 60;
const BASE = 1_800_000_000;

function folder(path, files) {
  mkdirSync(join(path, ".output", "server"), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(path, name), content);
}

function release(releases, name, day) {
  const dir = join(releases, name);
  folder(dir, { RELEASE: `${name}${"0".repeat(28)}\n`, ".output/server/index.mjs": "" });
  utimesSync(join(dir, "RELEASE"), BASE + day * DAY, BASE + day * DAY);
  return dir;
}

function prune(home) {
  const result = spawnSync(
    "bash",
    ["-c", "set -euo pipefail; . deploy/hx15/common.sh; . deploy/hx15/mutate.sh; prune_releases"],
    {
      cwd: repoRoot,
      env: { PATH: process.env.PATH, HOME: home },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout.split("\n").filter(Boolean).sort();
}

test("prune_releases keeps current, previous and the newest other release, and leaves unrecognized entries alone", (t) => {
  const home = mkdtempSync(join(tmpdir(), "prune-releases-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const data = join(home, ".local", "share", "hx-centcom");
  const releases = join(data, "releases");

  // Folder names sort in a different order from RELEASE mtimes, so glob order cannot pass for "newest".
  const newestOther = release(releases, "111111111111", 5);
  const oldest = release(releases, "222222222222", 1);
  const current = release(releases, "333333333333", 4);
  const older = release(releases, "444444444444", 2);
  const previous = release(releases, "555555555555", 3);
  symlinkSync("releases/333333333333", join(data, "current"));
  symlinkSync("releases/555555555555", join(data, "previous"));

  const unrecognized = [
    join(releases, ".build-666666666666"),
    join(releases, "777777777777"),
    join(releases, "notes"),
  ];
  folder(unrecognized[0], { RELEASE: "build\n", ".output/server/index.mjs": "" });
  folder(unrecognized[1], { ".output/server/index.mjs": "" });
  folder(unrecognized[2], { RELEASE: "notes\n", ".output/server/index.mjs": "" });
  for (const dir of unrecognized) {
    if (existsSync(join(dir, "RELEASE"))) utimesSync(join(dir, "RELEASE"), BASE, BASE);
  }

  assert.deepEqual(
    prune(home),
    [
      `delete ${oldest}`,
      `delete ${older}`,
      `keep ${current}`,
      `keep ${newestOther}`,
      `keep ${previous}`,
    ].sort(),
  );
  const survivors = [
    ".build-666666666666",
    "111111111111",
    "333333333333",
    "555555555555",
    "777777777777",
    "notes",
  ];
  assert.deepEqual(readdirSync(releases).sort(), survivors);
  for (const dir of unrecognized)
    assert.ok(existsSync(join(dir, ".output", "server", "index.mjs")), `${dir} is untouched`);
  assert.equal(readlinkSync(join(data, "current")), "releases/333333333333");
  assert.equal(readlinkSync(join(data, "previous")), "releases/555555555555");
  assert.deepEqual(readdirSync(home), [".local"], "nothing outside DATA_DIR was written");

  assert.deepEqual(
    prune(home),
    [`keep ${current}`, `keep ${newestOther}`, `keep ${previous}`].sort(),
    "a second run deletes nothing",
  );
  assert.deepEqual(readdirSync(releases).sort(), survivors);
});

test("common.sh, which verify.sh sources, defines none of the functions in mutate.sh", () => {
  const functions = (file) => {
    const result = spawnSync(
      "bash",
      ["-c", `set -euo pipefail; . deploy/hx15/${file}; declare -F`],
      {
        cwd: repoRoot,
        env: { PATH: process.env.PATH, HOME: tmpdir() },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace("declare -f ", ""));
  };
  const mutating = functions("mutate.sh");
  assert.deepEqual(mutating.sort(), [
    "activate_release",
    "install_units",
    "prune_releases",
    "restart_app",
    "switch_current",
  ]);
  const common = functions("common.sh");
  assert.deepEqual(
    common.filter((name) => mutating.includes(name)),
    [],
    "common.sh alone defines no function of mutate.sh",
  );
});
