import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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

for (const file of ["github-sync.ts", "issue-key.ts"]) {
  test(`scripts/${file} reaches src/server only through the services index and the db client`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(
      serverImports(source).some((specifier) => SERVICES.has(specifier)),
      "the script imports the services index",
    );
    assert.deepEqual(violations(source), []);
  });
}
