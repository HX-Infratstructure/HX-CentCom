import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scramSha256Verifier } from "../../deploy/hx9/make-db-secret.mjs";

const script = fileURLToPath(new URL("../../deploy/hx9/make-db-secret.mjs", import.meta.url));
const VERIFIER = /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;
const ENV_LINE =
  /^DATABASE_URL=postgres:\/\/centcom_app:([A-Za-z0-9_-]{43})@192\.168\.50\.209:5432\/centcom\n$/;
const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const mode = (path) => statSync(path).mode & 0o777;

// The SCRAM-SHA-256 exchange in section 3 of https://www.rfc-editor.org/rfc/rfc7677.txt (password "pencil").
const rfc = {
  clientFirstBare: "n=user,r=rOprNGfwEbeRWgbNEkqO",
  serverFirst:
    "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
  clientFinalWithoutProof: "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0",
  clientProof: "dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=",
  serverSignature: "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
};

test("the verifier's keys reproduce the RFC 7677 server signature and client proof", () => {
  const salt = /,s=([^,]+),i=4096$/.exec(rfc.serverFirst)[1];
  const [, verifierSalt, storedKey, serverKey] = VERIFIER.exec(
    scramSha256Verifier("pencil", Buffer.from(salt, "base64")),
  );
  assert.equal(verifierSalt, salt);

  const authMessage = [rfc.clientFirstBare, rfc.serverFirst, rfc.clientFinalWithoutProof].join(",");
  assert.equal(
    hmac(Buffer.from(serverKey, "base64"), authMessage).toString("base64"),
    rfc.serverSignature,
  );

  const clientSignature = hmac(Buffer.from(storedKey, "base64"), authMessage);
  const clientKey = Buffer.from(rfc.clientProof, "base64").map(
    (byte, i) => byte ^ clientSignature[i],
  );
  assert.equal(createHash("sha256").update(clientKey).digest("base64"), storedKey);
});

test("the CLI writes app.env and create-role.sql privately, never prints the password, and keeps it on a rerun", (t) => {
  const root = mkdtempSync(join(tmpdir(), "make-db-secret-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  mkdirSync(home);
  mkdirSync(cwd);
  const dir = join(home, ".config", "hx-centcom");
  const envPath = join(dir, "app.env");
  const sqlPath = join(dir, "create-role.sql");

  const run = () => {
    const result = spawnSync(process.execPath, [script], {
      cwd,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const password = ENV_LINE.exec(readFileSync(envPath, "utf8"))?.[1];
    assert.ok(password, "app.env holds exactly the centcom_app DATABASE_URL");
    const sql = readFileSync(sqlPath, "utf8");
    const verifier = /PASSWORD '([^']+)'/.exec(sql)?.[1] ?? "";
    const salt = VERIFIER.exec(verifier)?.[1];
    assert.ok(
      salt,
      `create-role.sql holds a SCRAM-SHA-256 verifier, got ${JSON.stringify(verifier)}`,
    );
    assert.equal(
      scramSha256Verifier(password, Buffer.from(salt, "base64")),
      verifier,
      "the verifier is for the app.env password",
    );
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
    return { password, verifier };
  };

  const first = run();
  const second = run();
  assert.equal(second.password, first.password, "a rerun keeps the password");
  assert.notEqual(second.verifier, first.verifier, "a rerun writes a new SQL file with a new salt");
});
