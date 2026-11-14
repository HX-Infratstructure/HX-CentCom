import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVICES = new Set(["@/server/services", "../src/server/services/index.ts"]);
const DB_CLIENT = new Set(["@/server/db/client", "../src/server/db/client.ts"]);
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const SERVER = /^@\/server(?:\/|$)|(?:^|\/)src\/server(?:\/|$)/;

function serverImports(source) {
  return [...source.matchAll(SPECIFIER)]
    .map((match) => match[1])
    .filter((specifier) => SERVER.test(specifier));
}

function violations(source) {
  const found = serverImports(source).filter(
    (specifier) => !SERVICES.has(specifier) && !DB_CLIENT.has(specifier),
  );
  return source.includes("server/db/schema") ? [...found, "mentions server/db/schema"] : found;
}

test("the matcher flags schema imports and deep services imports, static or dynamic, and passes the services index", () => {
  assert.deepEqual(violations(`import { githubPrs } from '@/server/db/schema';`), [
    "@/server/db/schema",
    "mentions server/db/schema",
  ]);
  assert.deepEqual(
    violations(`const { githubRepos } = await import("../src/server/db/schema.ts");`),
    ["../src/server/db/schema.ts", "mentions server/db/schema"],
  );
  assert.deepEqual(violations(`import {\n  listWorkspace,\n} from "@/server/services/reads";`), [
    "@/server/services/reads",
  ]);
  assert.deepEqual(violations(`export { POLICY } from '../src/server/services/policy.ts';`), [
    "../src/server/services/policy.ts",
  ]);
  assert.deepEqual(
    violations(`import type { Db } from '@/server/db/client';\nawait import('@/server/services');`),
    [],
  );
});

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TESTS = join("scripts", "tests");

/** Every file under scripts/ and bin/. The tests in scripts/tests reach the database through createTestDb. */
function files(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (!entry.isDirectory()) return [path];
    return path === TESTS ? [] : files(path);
  });
}

const sources = new Map(
  ["scripts", "bin"].flatMap(files).map((file) => [file, readFileSync(join(ROOT, file), "utf8")]),
);

test("the scan reads every script and bin file, and sees the services index where a script uses it", () => {
  for (const file of ["scripts/github-sync.ts", "scripts/issue-key.ts", "bin/centcom"]) {
    assert.ok(sources.has(file), file);
  }
  assert.ok(sources.has("bin/lib/centcom.mjs"), "the scan reaches bin/lib");
  assert.ok(![...sources.keys()].some((file) => file.startsWith(TESTS)));
  for (const file of ["scripts/github-sync.ts", "scripts/issue-key.ts"]) {
    assert.ok(
      serverImports(sources.get(file)).some((specifier) => SERVICES.has(specifier)),
      file,
    );
  }
});

test("every file under scripts/ and bin/ reaches src/server only through the services index and the db client", () => {
  const found = [...sources].flatMap(([file, source]) =>
    violations(source).map((violation) => `${file}: ${violation}`),
  );
  assert.deepEqual(found, []);
});
