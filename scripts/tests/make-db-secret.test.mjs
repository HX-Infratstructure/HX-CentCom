import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(new URL("../../deploy/hx9/make-db-secret.mjs", import.meta.url));
const VERIFIER = /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;
const ENV_LINE =
  /^DATABASE_URL=postgres:\/\/centcom_app:([A-Za-z0-9_-]{43})@192\.168\.50\.209:5432\/centcom\n$/;
const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const sha256 = (data) => createHash("sha256").update(data).digest();
const xor = (a, b) => Buffer.from(a.map((byte, i) => byte ^ b[i]));
const mode = (path) => statSync(path).mode & 0o777;
// Node added URL.parse in 22.1.0. This preload gives the script the URL API of Node 22.0.
const NODE_22_0_URL = "--import=data:text/javascript,delete URL.parse";

// The SCRAM-SHA-256 exchange in section 3 of https://www.rfc-editor.org/rfc/rfc7677.txt (password "pencil").
const rfc = {
  clientFirstBare: "n=user,r=rOprNGfwEbeRWgbNEkqO",
  serverFirst:
    "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
  clientFinalWithoutProof: "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0",
  clientProof: "dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=",
  serverSignature: "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
};
const rfcAuthMessage = [rfc.clientFirstBare, rfc.serverFirst, rfc.clientFinalWithoutProof].join(
  ",",
);

/** What a SCRAM-SHA-256 client sends, and the server signature it then expects (RFC 5802 section 3). */
function clientSide(password, salt, authMessage) {
  const salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const clientKey = hmac(salted, "Client Key");
  return {
    clientProof: xor(clientKey, hmac(sha256(clientKey), authMessage)).toString("base64"),
    serverSignature: hmac(hmac(salted, "Server Key"), authMessage).toString("base64"),
  };
}

/** What PostgreSQL does with the stored verifier: check the client's proof, and sign the exchange. */
function serverSide(verifier, authMessage, clientProof) {
  const [, , storedKey, serverKey] = VERIFIER.exec(verifier);
  const clientKey = xor(
    Buffer.from(clientProof, "base64"),
    hmac(Buffer.from(storedKey, "base64"), authMessage),
  );
  return {
    accepted: sha256(clientKey).toString("base64") === storedKey,
    serverSignature: hmac(Buffer.from(serverKey, "base64"), authMessage).toString("base64"),
  };
}

/** A fresh exchange for `password` against `verifier`, with the salt the verifier carries. */
function login(verifier, password) {
  const [, salt] = VERIFIER.exec(verifier);
  const nonce = randomBytes(18).toString("base64");
  const authMessage = `n=centcom_app,r=${nonce},r=${nonce}srv,s=${salt},i=4096,c=biws,r=${nonce}srv`;
  const client = clientSide(password, Buffer.from(salt, "base64"), authMessage);
  const server = serverSide(verifier, authMessage, client.clientProof);
  return server.accepted && server.serverSignature === client.serverSignature;
}

test("the test's SCRAM client reproduces the RFC 7677 client proof and server signature", () => {
  const salt = /,s=([^,]+),i=4096$/.exec(rfc.serverFirst)[1];
  assert.deepEqual(clientSide("pencil", Buffer.from(salt, "base64"), rfcAuthMessage), {
    clientProof: rfc.clientProof,
    serverSignature: rfc.serverSignature,
  });
});

test("the CLI writes app.env and create-role.sql privately, never shows the password, and keeps it on a rerun", (t) => {
  const root = mkdtempSync(join(tmpdir(), "make-db-secret-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  mkdirSync(home);
  mkdirSync(cwd);
  const dir = join(home, ".config", "hx-centcom");
  const envPath = join(dir, "app.env");
  const sqlPath = join(dir, "create-role.sql");

  const run = (...nodeArgs) => {
    const result = spawnSync(process.execPath, [...nodeArgs, script], {
      cwd,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf8");
    const password = ENV_LINE.exec(env)?.[1];
    assert.ok(password, "app.env holds exactly the centcom_app DATABASE_URL");
    const url = new URL(env.slice("DATABASE_URL=".length).trim());
    assert.deepEqual(
      [url.protocol, url.username, url.password, url.host, url.pathname],
      ["postgres:", "centcom_app", password, "192.168.50.209:5432", "/centcom"],
    );

    const sql = readFileSync(sqlPath, "utf8");
    const verifier = /PASSWORD '([^']+)'/.exec(sql)?.[1] ?? "";
    assert.match(verifier, VERIFIER, "create-role.sql holds a SCRAM-SHA-256 verifier");
    assert.ok(!sql.includes(password), "create-role.sql never holds the clear password");
    assert.ok(login(verifier, password), "the verifier accepts the app.env password");
    assert.ok(!login(verifier, `${password}x`), "the verifier refuses another password");
    for (const statement of [
      "CREATE ROLE centcom_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD",
      "CREATE DATABASE centcom OWNER centcom_app;",
      "REVOKE ALL ON DATABASE centcom FROM PUBLIC;",
      "COMMENT ON DATABASE centcom IS 'HX-CentCom (DEV/TEST); consumer 192.168.50.215';",
    ]) {
      assert.ok(sql.includes(statement), `create-role.sql has: ${statement}`);
    }

    assert.equal(result.stdout, `${envPath} 600\n${sqlPath} 600\n`);
    for (const secret of [password, verifier]) {
      assert.ok(
        !`${result.stdout}${result.stderr}`.includes(secret),
        "the output holds no password or verifier",
      );
    }
    assert.equal(mode(dir), 0o700);
    assert.equal(mode(envPath), 0o600);
    assert.equal(mode(sqlPath), 0o600);
    assert.deepEqual(readdirSync(dir).sort(), ["app.env", "create-role.sql"]);
    assert.deepEqual(readdirSync(home), [".config"]);
    assert.deepEqual(readdirSync(join(home, ".config")), ["hx-centcom"]);
    assert.deepEqual(readdirSync(cwd), []);
    return { env, password, verifier };
  };

  const first = run();
  const second = run(NODE_22_0_URL);
  assert.equal(second.env, first.env, "a rerun on Node 22.0 leaves app.env as it was");
  assert.notEqual(second.verifier, first.verifier, "a rerun writes a new SQL file with a new salt");
  assert.ok(login(second.verifier, first.password), "the new verifier is for the same password");
});

test("a rerun refuses an existing app.env whose DATABASE_URL is invalid, and changes nothing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "make-db-secret-invalid-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const dir = join(home, ".config", "hx-centcom");
  const envPath = join(dir, "app.env");
  mkdirSync(dir, { recursive: true });

  for (const env of [
    "DATABASE_URL=postgres://centcom_app:pw@[192.168.50.209/centcom\n",
    "DATABASE_URL=postgres://other:pw@192.168.50.209:5432/centcom\n",
    "PORT=3000\n",
  ]) {
    writeFileSync(envPath, env);
    for (const nodeArgs of [[], [NODE_22_0_URL]]) {
      const result = spawnSync(process.execPath, [...nodeArgs, script], {
        cwd: root,
        env: { ...process.env, HOME: home },
        encoding: "utf8",
      });
      assert.equal(result.status, 1, env);
      assert.equal(
        result.stderr,
        `make-db-secret: ${envPath} exists, but its DATABASE_URL is not for centcom_app at 192.168.50.209:5432/centcom. It was left unchanged.\n`,
      );
      assert.equal(result.stdout, "");
      assert.equal(readFileSync(envPath, "utf8"), env, "app.env is left unchanged");
      assert.deepEqual(readdirSync(dir), ["app.env"], "no create-role.sql is written");
    }
  }
});

test("the CLI runs when started through a symlink, and an import of the module writes nothing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "make-db-secret-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  mkdirSync(home);
  const node = (file) =>
    spawnSync(process.execPath, [file], {
      cwd: root,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });

  const importer = join(root, "importer.mjs");
  writeFileSync(importer, `await import(${JSON.stringify(pathToFileURL(script).href)});\n`);
  const imported = node(importer);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(`${imported.stdout}${imported.stderr}`, "");
  assert.deepEqual(readdirSync(home), [], "an import writes nothing");

  const link = join(root, "make-db-secret.mjs");
  symlinkSync(script, link);
  const linked = node(link);
  assert.equal(linked.status, 0, linked.stderr);
  const envPath = join(home, ".config", "hx-centcom", "app.env");
  assert.match(readFileSync(envPath, "utf8"), ENV_LINE, "a run through a symlink writes app.env");
});
