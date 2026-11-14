import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "tsx/esm/api";

register();
const { main } = await import("../issue-key.ts");
const { createTestDb } = await import("../../src/server/db/test-db.ts");

const KEY_SHAPE = /hxc_[a-z0-9-]+_[A-Za-z0-9_-]{32}/;
const writtenKeys = new Set<string>();
const printed: string[] = [];
const mode = (path: string) => statSync(path).mode & 0o777;

function assertNoKeyPrinted() {
  for (const text of printed) {
    assert.doesNotMatch(text, KEY_SHAPE, "no key-shaped text is printed");
    for (const key of writtenKeys)
      assert.ok(!text.includes(key), "no key that was written is printed");
  }
}

function rememberKeys(paths: string[]) {
  for (const path of paths) {
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    const key = readFileSync(path, "utf8").trim();
    if (KEY_SHAPE.test(key)) writtenKeys.add(key);
  }
}

async function setup(t: TestContext) {
  const testDb = await createTestDb();
  const home = mkdtempSync(join(tmpdir(), "issue-key-"));
  t.after(async () => {
    await testDb.close();
    rmSync(home, { recursive: true, force: true });
  });
  const keys = join(home, ".config", "hx-centcom", "keys");
  const keyFile = (agentId: string) => join(keys, `${agentId}.key`);
  const keyFiles = (env: Record<string, string>) => [
    ...(existsSync(keys) ? readdirSync(keys).map((name) => join(keys, name)) : []),
    ...(env["CENTCOM_OWNER_KEY_FILE"] ? [env["CENTCOM_OWNER_KEY_FILE"]] : []),
  ];

  const run = async (argv: string[], env: Record<string, string> = {}) => {
    rememberKeys(keyFiles(env));
    let stdout = "";
    let stderr = "";
    const code = await main(argv, env, {
      db: testDb.db,
      home,
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
    });
    rememberKeys(keyFiles(env));
    printed.push(stdout, stderr);
    assertNoKeyPrinted();
    return { code, stdout, stderr };
  };

  const bootstrapOwner = async () => {
    const result = await run(["--agent", "Agent Zero", "--label", "owner laptop"]);
    assert.equal(result.code, 0, result.stderr);
    return { CENTCOM_OWNER_KEY_FILE: keyFile("Agent Zero") };
  };

  const keyEvents = async () =>
    (await testDb.services.listActivity({ entity: "agent_key", limit: 100 })).items;

  /** Every key id that was issued and every key id that was revoked, from the activity log. */
  const ledger = async () => {
    const events = await keyEvents();
    const ids = (actions: string[]) =>
      events
        .filter((event) => actions.includes(event.action))
        .map((event) => event.entity_id)
        .sort();
    return { issued: ids(["key.bootstrap", "key.issue"]), revoked: ids(["key.revoke"]) };
  };

  /** The one key id issued between two ledgers. */
  const issuedSince = async (before: Awaited<ReturnType<typeof ledger>>) => {
    const added = (await ledger()).issued.filter((id) => !before.issued.includes(id));
    assert.equal(added.length, 1, `exactly one key was issued, got ${added.length}`);
    return added[0]!;
  };

  const resolve = async (key: string) => {
    const actor = await testDb.services.resolveActor(`Bearer ${key}`);
    return actor && { agentId: actor.agentId, role: actor.role };
  };

  const ownerActor = async (owner: { CENTCOM_OWNER_KEY_FILE: string }) => {
    const actor = await testDb.services.resolveActor(
      `Bearer ${readFileSync(owner.CENTCOM_OWNER_KEY_FILE, "utf8").trim()}`,
    );
    assert.ok(actor, "the owner key resolves");
    return actor;
  };

  return {
    services: testDb.services,
    keys,
    keyFile,
    run,
    bootstrapOwner,
    keyEvents,
    ledger,
    issuedSince,
    resolve,
    ownerActor,
  };
}

const empty: { issued: string[]; revoked: string[] } = { issued: [], revoked: [] };

function assertSavedId(file: string, keyId: string) {
  assert.equal(
    readFileSync(`${file}.id`, "utf8"),
    `${keyId}\n`,
    "the .key.id file holds the printed key id",
  );
  assert.equal(mode(`${file}.id`), 0o600);
}

test("bootstrap issues the first Agent Zero key into a private file, and only once", async (t) => {
  const s = await setup(t);
  const file = s.keyFile("Agent Zero");

  const first = await s.run(["--agent", "Agent Zero", "--label", "owner laptop"]);
  assert.equal(first.code, 0, first.stderr);
  const ownerKeyId = await s.issuedSince(empty);
  assert.equal(first.stdout, `issued ${ownerKeyId} ${file}\n`);
  assert.equal(first.stderr, "");
  assert.equal(mode(s.keys), 0o700);
  assert.equal(mode(file), 0o600);
  const content = readFileSync(file, "utf8");
  assert.match(
    content,
    /^hxc_agent-zero_[A-Za-z0-9_-]{32}\n$/,
    "the file holds one key and a newline",
  );
  assert.deepEqual(await s.resolve(content.trim()), { agentId: "Agent Zero", role: "owner" });
  assertSavedId(file, ownerKeyId);

  rmSync(file);
  const second = await s.run(["--agent", "Agent Zero", "--label", "second laptop"]);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /^issue-key failed: forbidden: /);
  assert.equal(second.stdout, "");
  assert.deepEqual(await s.ledger(), { issued: [ownerKeyId], revoked: [] });
  assert.equal(existsSync(file), false);
});

test("bootstrap refuses an agent that is not the owner", async (t) => {
  const s = await setup(t);
  const result = await s.run(["--agent", "CC1", "--label", "cc1 host"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^issue-key failed: forbidden: /);
  assert.deepEqual(await s.ledger(), empty);
  assert.equal(existsSync(s.keyFile("CC1")), false);
});

test("with the owner key file, the owner issues CC1 a private key that resolves to CC1", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const file = s.keyFile("CC1");
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host"], owner);
  assert.equal(result.code, 0, result.stderr);
  const keyId = await s.issuedSince(before);
  assert.equal(result.stdout, `issued ${keyId} ${file}\n`);
  assert.equal(mode(file), 0o600);
  const content = readFileSync(file, "utf8");
  assert.match(content, /^hxc_cc1_[A-Za-z0-9_-]{32}\n$/);
  assert.deepEqual(await s.resolve(content.trim()), { agentId: "CC1", role: "agent" });
  assertSavedId(file, keyId);
});

test("an owner key file that is not mode 600 is refused before any key is issued", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const before = await s.ledger();
  chmodSync(owner.CENTCOM_OWNER_KEY_FILE, 0o644);

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host"], owner);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^issue-key failed: CENTCOM_OWNER_KEY_FILE .*mode 644/);
  assert.equal(result.stdout, "");
  assert.deepEqual(await s.ledger(), before);
  assert.equal(existsSync(s.keyFile("CC1")), false);
});

test("a keys folder that is not mode 700 is refused before any key is issued", async (t) => {
  const s = await setup(t);
  mkdirSync(s.keys, { recursive: true });
  chmodSync(s.keys, 0o755);

  const result = await s.run(["--agent", "Agent Zero", "--label", "owner laptop"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^issue-key failed: .*mode 755/);
  assert.deepEqual(await s.ledger(), empty);
  assert.equal(existsSync(s.keyFile("Agent Zero")), false);
});

test("an existing key file is left unchanged without --rotate", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const file = s.keyFile("CC1");
  assert.equal((await s.run(["--agent", "CC1", "--label", "cc1 host"], owner)).code, 0);
  const content = readFileSync(file, "utf8");
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host again"], owner);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^issue-key failed: /);
  assert.equal(readFileSync(file, "utf8"), content);
  assert.deepEqual(await s.ledger(), before);
});

test("--rotate saves a new key first, then revokes the old one", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const file = s.keyFile("CC1");
  const start = await s.ledger();
  assert.equal((await s.run(["--agent", "CC1", "--label", "cc1 host"], owner)).code, 0);
  const oldKey = readFileSync(file, "utf8").trim();
  const oldId = await s.issuedSince(start);
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host rotated", "--rotate"], owner);
  assert.equal(result.code, 0, result.stderr);
  const newId = await s.issuedSince(before);
  assert.deepEqual((await s.ledger()).revoked, [oldId]);
  assert.equal(result.stdout, `issued ${newId} ${file}\nrevoked ${oldId}\n`);

  const newKey = readFileSync(file, "utf8").trim();
  assert.notEqual(newKey, oldKey);
  assert.equal(mode(file), 0o600);
  assert.equal(await s.resolve(oldKey), null);
  assert.deepEqual(await s.resolve(newKey), { agentId: "CC1", role: "agent" });
  assertSavedId(file, newId);

  const events = await s.keyEvents();
  const at = (action: string, keyId: string) =>
    Date.parse(events.find((e) => e.action === action && e.entity_id === keyId)!.created_at);
  assert.ok(
    at("key.issue", newId) <= at("key.revoke", oldId),
    "the new key was issued before the old one was revoked",
  );
});

test("--rotate whose new key the services refuse leaves the old key active and saved", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const file = s.keyFile("CC1");
  assert.equal((await s.run(["--agent", "CC1", "--label", "cc1 host"], owner)).code, 0);
  const oldKey = readFileSync(file, "utf8");
  const oldSavedId = readFileSync(`${file}.id`, "utf8");
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "x".repeat(101), "--rotate"], owner);
  assert.equal(result.code, 1);
  assert.deepEqual(
    await s.resolve(oldKey.trim()),
    { agentId: "CC1", role: "agent" },
    "the old key still works",
  );
  assert.deepEqual(await s.ledger(), before, "no key was issued or revoked");
  assert.match(result.stderr, /^issue-key failed: invalid: /);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(file, "utf8"), oldKey);
  assert.equal(readFileSync(`${file}.id`, "utf8"), oldSavedId);
});

test("--rotate with no saved key id is refused and changes nothing", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const file = s.keyFile("CC1");
  assert.equal((await s.run(["--agent", "CC1", "--label", "cc1 host"], owner)).code, 0);
  const content = readFileSync(file, "utf8");
  rmSync(`${file}.id`);
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host rotated", "--rotate"], owner);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /^issue-key failed: .*DELETE \/api\/v1\/keys\/<id>.*rerun without --rotate/,
  );
  assert.deepEqual(await s.ledger(), before, "no key was issued or revoked");
  assert.equal(readFileSync(file, "utf8"), content);
  assert.deepEqual(await s.resolve(content.trim()), { agentId: "CC1", role: "agent" });
});

test("--rotate whose saved key is already revoked says so and still issues a new key", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const file = s.keyFile("CC1");
  const start = await s.ledger();
  assert.equal((await s.run(["--agent", "CC1", "--label", "cc1 host"], owner)).code, 0);
  const oldId = await s.issuedSince(start);
  await s.services.revokeKey(await s.ownerActor(owner), oldId);
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host rotated", "--rotate"], owner);
  assert.equal(result.code, 0, result.stderr);
  const newId = await s.issuedSince(before);
  assert.equal(
    result.stdout,
    `issued ${newId} ${file}\nrevoked nothing: key ${oldId} is not active\n`,
  );
  assert.deepEqual((await s.ledger()).revoked, [oldId], "the key was revoked once");
  assert.deepEqual(await s.resolve(readFileSync(file, "utf8").trim()), {
    agentId: "CC1",
    role: "agent",
  });
  assertSavedId(file, newId);
});

test("--rotate whose old key the services refuse to revoke keeps the new key saved and names both ids", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const file = s.keyFile("CC1");
  assert.equal((await s.run(["--agent", "CC1", "--label", "cc1 host"], owner)).code, 0);
  const oldKey = readFileSync(file, "utf8").trim();
  writeFileSync(`${file}.id`, "not-a-key-id\n");
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host rotated", "--rotate"], owner);
  assert.equal(result.code, 1);
  const newId = await s.issuedSince(before);
  assert.equal(result.stdout, `issued ${newId} ${file}\n`);
  assert.match(
    result.stderr,
    new RegExp(
      `^issue-key failed: [^\\n]*${newId}[^\\n]*not-a-key-id[^\\n]*DELETE /api/v1/keys/not-a-key-id[^\\n]*\\n$`,
    ),
  );
  assert.deepEqual((await s.ledger()).revoked, before.revoked, "no key was revoked");
  assert.deepEqual(
    await s.resolve(readFileSync(file, "utf8").trim()),
    { agentId: "CC1", role: "agent" },
    "the saved key works",
  );
  assertSavedId(file, newId);
  assert.deepEqual(
    await s.resolve(oldKey),
    { agentId: "CC1", role: "agent" },
    "the old key is still active",
  );
});

test("--rotate whose new key id cannot be saved leaves both files naming active keys", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  const file = s.keyFile("CC1");
  const start = await s.ledger();
  assert.equal((await s.run(["--agent", "CC1", "--label", "cc1 host"], owner)).code, 0);
  const oldKey = readFileSync(file, "utf8").trim();
  const oldId = await s.issuedSince(start);
  mkdirSync(`${file}.id.tmp`);
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host rotated", "--rotate"], owner);
  assert.equal(result.code, 1);
  const newId = await s.issuedSince(before);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    new RegExp(`^issue-key failed: [^\\n]*${newId}[^\\n]*DELETE /api/v1/keys/${oldId}[^\\n]*\\n$`),
  );
  assert.deepEqual((await s.ledger()).revoked, before.revoked, "no key was revoked");
  const newKey = readFileSync(file, "utf8").trim();
  assert.notEqual(newKey, oldKey);
  assert.deepEqual(
    await s.resolve(newKey),
    { agentId: "CC1", role: "agent" },
    "the key in .key works",
  );
  assert.equal(readFileSync(`${file}.id`, "utf8"), `${oldId}\n`);
  assert.deepEqual(
    await s.resolve(oldKey),
    { agentId: "CC1", role: "agent" },
    "the key that .key.id names is still active",
  );
});

test("--rotate is refused without a key file to replace or without the owner key", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  assert.equal((await s.run(["--agent", "CC1", "--label", "cc1 host"], owner)).code, 0);
  const before = await s.ledger();

  const missing = await s.run(["--agent", "CC2", "--label", "cc2 host", "--rotate"], owner);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^issue-key failed: /);
  assert.equal(existsSync(s.keyFile("CC2")), false);

  const noOwner = await s.run(["--agent", "CC1", "--label", "cc1 host rotated", "--rotate"]);
  assert.equal(noOwner.code, 1);
  assert.match(noOwner.stderr, /^issue-key failed: /);
  assert.deepEqual(await s.ledger(), before);
});

test("a key that cannot be saved is named by id so the owner can revoke it", async (t) => {
  const s = await setup(t);
  const owner = await s.bootstrapOwner();
  mkdirSync(`${s.keyFile("CC1")}.tmp`);
  const before = await s.ledger();

  const result = await s.run(["--agent", "CC1", "--label", "cc1 host"], owner);
  assert.equal(result.code, 1);
  const keyId = await s.issuedSince(before);
  assert.match(result.stderr, new RegExp(`^issue-key failed: .*${keyId}`));
  assert.equal(existsSync(s.keyFile("CC1")), false);
});

test("bad arguments print the usage line, exit 2 and issue nothing", async (t) => {
  const s = await setup(t);
  const cases = [
    [],
    ["--agent", "CC1"],
    ["--agent", "CC1", "--label"],
    ["--agent", "CC1", "--label", ""],
    ["--agent", "CC1", "--label", "   "],
    ["--agent", "../CC1", "--label", "cc1 host"],
    ["--agent", "CC1", "--label", "cc1 host", "--force"],
    ["--agent", "CC1", "--label", "cc1 host", "extra"],
  ];
  for (const argv of cases) {
    const result = await s.run(argv);
    assert.equal(result.code, 2, JSON.stringify(argv));
    assert.match(result.stderr, /^usage: issue-key /, JSON.stringify(argv));
    assert.equal(result.stdout, "");
  }
  assert.deepEqual(await s.ledger(), empty);
  assert.equal(existsSync(s.keys), false);
});

test("no run printed a key, its own or any other", () => {
  assert.ok(writtenKeys.size > 0, "the runs above wrote keys to check");
  assertNoKeyPrinted();
});
