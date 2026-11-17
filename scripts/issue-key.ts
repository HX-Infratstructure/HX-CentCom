import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connectDb, requireEnv, type Db } from "../src/server/db/client.ts";
import {
  bootstrapOwnerKey,
  createServices,
  isServiceError,
  type Actor,
  type IssuedKey,
  type Services,
} from "../src/server/services/index.ts";
import { readSecretFile } from "./secret-file.ts";

const USAGE =
  'usage: issue-key --agent <CC1|CC2|Codex|OpenCode|"Agent Zero"> --label <text> [--rotate]';
const FILE_SAFE_AGENT = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
const OWNER_KEY_ENV = "CENTCOM_OWNER_KEY_FILE";

interface Request {
  agentId: string;
  label: string;
  rotate: boolean;
}

interface Output {
  write(text: string): unknown;
}

export interface Deps {
  db: Db;
  home: string;
  stdout: Output;
  stderr: Output;
}

type Env = Record<string, string | undefined>;

function describe(error: unknown): string {
  return errorText(error).replace(/[\r\n]+/g, " ");
}

function errorText(error: unknown): string {
  if (isServiceError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

const octal = (mode: number) => mode.toString(8).padStart(3, "0");

/** The request, or why the arguments are not one. The services parse everything this does not check. */
function parseRequest(argv: readonly string[]): Request | string {
  let values: {
    agent?: string | undefined;
    label?: string | undefined;
    rotate?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        agent: { type: "string" },
        label: { type: "string" },
        rotate: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return describe(error);
  }
  if (values.agent === undefined || values.label === undefined)
    return "--agent and --label are required";
  // Trimmed as the services trim it, so the file name is the stored agent id.
  const agentId = values.agent.trim();
  const label = values.label.trim();
  if (!FILE_SAFE_AGENT.test(agentId))
    return `agent ${JSON.stringify(agentId)} cannot be a file name`;
  if (label === "") return "--label is empty";
  return { agentId, label, rotate: values.rotate === true };
}

function keysFolder(home: string): string {
  const folder = join(home, ".config", "hx-centcom", "keys");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const mode = statSync(folder).mode & 0o777;
  if (mode !== 0o700) throw new Error(`${folder} has mode ${octal(mode)}; it must be 700`);
  return folder;
}

/** `--rotate` revokes the key this file names. Nothing else records which key the key file holds. */
function savedKeyId(file: string): string {
  try {
    return readFileSync(`${file}.id`, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(
      `${file}.id does not exist, so the old key's id is unknown. As the owner, revoke the old key with DELETE /api/v1/keys/<id>, remove ${file}, and rerun without --rotate`,
    );
  }
}

async function revokeOldKey(
  services: Services,
  actor: Actor,
  keyId: string,
  newKeyId: string,
  out: Output,
): Promise<void> {
  try {
    await services.revokeKey(actor, keyId);
  } catch (error) {
    if (!isServiceError(error) || error.code !== "not_found") {
      throw new Error(
        `new key ${newKeyId} is saved, but old key ${keyId} was not revoked; as the owner, revoke it with DELETE /api/v1/keys/${keyId} (${describe(error)})`,
      );
    }
    out.write(`revoked nothing: key ${keyId} is not active\n`);
    return;
  }
  out.write(`revoked ${keyId}\n`);
}

/** A rename is atomic, so a reader of `file` sees the old content or the whole new one, never part of it. */
function writePrivate(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
  renameSync(tmp, file);
}

function saveKey(
  file: string,
  { keyId, plaintext }: IssuedKey,
  oldKeyId: string | undefined,
): void {
  try {
    writePrivate(file, `${plaintext}\n`);
  } catch (error) {
    throw new Error(
      `key ${keyId} was issued but not saved to ${file}; revoke it (${describe(error)})`,
    );
  }
  // --rotate revokes the old key only after both renames, so a crash between them leaves it active, never the agent keyless.
  try {
    writePrivate(`${file}.id`, `${keyId}\n`);
  } catch (error) {
    const revokeOld =
      oldKeyId === undefined
        ? ""
        : `, then revoke old key ${oldKeyId} with DELETE /api/v1/keys/${oldKeyId}`;
    throw new Error(
      `key ${keyId} was saved to ${file} but its id was not saved to ${file}.id; write ${keyId} there before the next --rotate${revokeOld} (${describe(error)})`,
    );
  }
}

async function issue(request: Request, env: Env, db: Db, home: string, out: Output): Promise<void> {
  const ownerKeyFile = env[OWNER_KEY_ENV];
  if (request.rotate && !ownerKeyFile)
    throw new Error(`--rotate needs the owner key file in ${OWNER_KEY_ENV}`);
  const file = join(keysFolder(home), `${request.agentId}.key`);
  const exists = existsSync(file);
  if (exists && !request.rotate) throw new Error(`${file} exists; pass --rotate to replace it`);
  if (!exists && request.rotate)
    throw new Error(`${file} does not exist, so there is no key to rotate`);
  const oldKeyId = request.rotate ? savedKeyId(file) : undefined;

  let issued: IssuedKey;
  let owner: { services: Services; actor: Actor } | undefined;
  if (ownerKeyFile) {
    const services = createServices(db);
    const actor = await services.resolveActor(
      `Bearer ${readSecretFile(ownerKeyFile, OWNER_KEY_ENV)}`,
    );
    if (actor?.role !== "owner")
      throw new Error(`the key in ${OWNER_KEY_ENV} is not an active owner key`);
    owner = { services, actor };
    issued = await services.issueKey(actor, request.agentId, request.label);
  } else {
    // bootstrapOwnerKey refuses a non-owner agent, and refuses every call once an owner key is active.
    issued = await bootstrapOwnerKey(db, { agentId: request.agentId, label: request.label });
  }
  saveKey(file, issued, oldKeyId);
  out.write(`issued ${issued.keyId} ${file}\n`);
  if (owner && oldKeyId !== undefined)
    await revokeOldKey(owner.services, owner.actor, oldKeyId, issued.keyId, out);
}

export async function main(
  argv: readonly string[],
  env: Env,
  deps: Partial<Deps> = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const request = parseRequest(argv);
  if (typeof request === "string") {
    stderr.write(`${USAGE} (${request})\n`);
    return 2;
  }
  const home = deps.home ?? homedir();
  try {
    if (deps.db) {
      await issue(request, env, deps.db, home, stdout);
    } else {
      const { db, close } = connectDb(requireEnv("DATABASE_URL"), { max: 1 });
      try {
        await issue(request, env, db, home, stdout);
      } finally {
        await close();
      }
    }
    return 0;
  } catch (error) {
    stderr.write(`issue-key failed: ${describe(error)}\n`);
    return 1;
  }
}

// import.meta.main needs Node 22.18. process.argv[1] keeps a symlinked path, and import.meta.url is the real path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2), process.env));
}
