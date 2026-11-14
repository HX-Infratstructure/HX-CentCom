import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROLE = "centcom_app";
const DATABASE = "centcom";
const SERVER = "192.168.50.209:5432";
const ITERATIONS = 4096;

const hmac = (key, text) => createHmac("sha256", key).update(text).digest();

export function scramSha256Verifier(password, salt = randomBytes(16)) {
  const salted = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  const storedKey = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

function writePrivate(path, text) {
  const tmp = `${path}.tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
  renameSync(tmp, path);
}

function readOrCreatePassword(envPath) {
  let text;
  try {
    text = readFileSync(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // base64url is ASCII, so PostgreSQL's SASLprep leaves it unchanged and it needs no escaping in the URL.
    const password = randomBytes(32).toString("base64url");
    writePrivate(envPath, `DATABASE_URL=postgres://${ROLE}:${password}@${SERVER}/${DATABASE}\n`);
    return password;
  }
  const line = text.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  const url = line && URL.parse(line.slice("DATABASE_URL=".length));
  if (
    !url ||
    url.username !== ROLE ||
    url.host !== SERVER ||
    url.pathname !== `/${DATABASE}` ||
    !url.password
  ) {
    throw new Error(
      `${envPath} exists, but its DATABASE_URL is not for ${ROLE} at ${SERVER}/${DATABASE}. It was left unchanged.`,
    );
  }
  return decodeURIComponent(url.password);
}

function roleSql(verifier) {
  return `-- HX-CentCom database and role on HX-9 (GO-1, deploy/hx9/README.md), written by deploy/hx9/make-db-secret.mjs.
-- The password is a SCRAM-SHA-256 verifier. The clear password stays in app.env on HX-15.
CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${verifier}';
CREATE DATABASE ${DATABASE} OWNER ${ROLE};
REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC;
COMMENT ON DATABASE ${DATABASE} IS 'HX-CentCom (DEV/TEST); consumer 192.168.50.215';
SELECT datname, pg_get_userbyid(datdba) AS owner, datacl FROM pg_database WHERE datname = '${DATABASE}';
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication,
	rolpassword LIKE 'SCRAM-SHA-256$%' AS scram_verifier
	FROM pg_authid WHERE rolname = '${ROLE}';
`;
}

function main() {
  const dir = join(homedir(), ".config", "hx-centcom");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const envPath = join(dir, "app.env");
  const sqlPath = join(dir, "create-role.sql");
  writePrivate(sqlPath, roleSql(scramSha256Verifier(readOrCreatePassword(envPath))));
  for (const path of [envPath, sqlPath])
    console.log(`${path} ${(statSync(path).mode & 0o777).toString(8)}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`make-db-secret: ${error.message}`);
    process.exitCode = 1;
  }
}
