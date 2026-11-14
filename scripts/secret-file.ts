import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

const octal = (mode: number) => mode.toString(8).padStart(3, "0");

/**
 * The trimmed content of the secret file that the variable `name` points at. Errors name the variable and the path,
 * never the content. A relative value is not echoed, because a secret pasted in place of its path would be printed.
 */
export function readSecretFile(path: string | undefined, name: string): string {
  if (!path) throw new Error(`${name} is not set`);
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path`);
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    throw new Error(`${name} ${path} cannot be opened (${code})`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${name} ${path} is not a regular file`);
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) throw new Error(`${name} ${path} has mode ${octal(mode)}; it must be 600`);
    const secret = readFileSync(fd, "utf8").trim();
    if (secret === "") throw new Error(`${name} ${path} is empty`);
    return secret;
  } finally {
    closeSync(fd);
  }
}
