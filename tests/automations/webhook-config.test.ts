// F7b configuration: CENTCOM_WEBHOOK_URLS (comma-separated http(s) URLs) and CENTCOM_WEBHOOK_SECRET_FILE (mode 600),
// read by src/start.ts with scripts/secret-file.ts before the database opens. Both unset sends nothing. Anything else
// partial or invalid is a startup error that names the variable, and never a URL or the secret.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webhookConfig } from "@/server/services";
import { readSecretFile } from "../../scripts/secret-file.ts";

const URLS = "CENTCOM_WEBHOOK_URLS";
const FILE = "CENTCOM_WEBHOOK_SECRET_FILE";
/** A sentinel standing in for a secret, so a test can show it never reaches an error. */
const SECRET = "whsec-sentinel-7f3a9c";
const A = "https://a.test/hooks/centcom";
const B = "http://b.test:8080/in";
const HIDDEN_URL = "ftp://user:pw@c.test/x?token=abc";

let dir: string;
const file = (name: string) => path.join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "centcom-webhook-"));
  for (const [name, content, mode] of [
    ["secret-600", `${SECRET}\n`, 0o600],
    ["secret-644", `${SECRET}\n`, 0o644],
    ["empty-600", "\n", 0o600],
  ] as const) {
    writeFileSync(file(name), content);
    chmodSync(file(name), mode);
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function refusal(env: Record<string, string>): string {
  try {
    webhookConfig(env, readSecretFile);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`accepted ${JSON.stringify(Object.keys(env))}`);
}

describe("F7b: the webhook configuration", () => {
  it("is null when both variables are unset or empty, and holds every URL and the secret when both are set", () => {
    expect(webhookConfig({}, readSecretFile)).toBeNull();
    expect(webhookConfig({ [URLS]: "", [FILE]: "" }, readSecretFile)).toBeNull();
    expect(
      webhookConfig({ [URLS]: ` ${A}, ${B} `, [FILE]: file("secret-600") }, readSecretFile),
    ).toEqual({ urls: [A, B], secret: SECRET });
  });

  it.each([
    ["URLs without a secret file", () => ({ [URLS]: A }), FILE],
    ["a secret file without URLs", () => ({ [FILE]: file("secret-600") }), URLS],
    [
      "an entry that is not an http(s) URL",
      () => ({ [URLS]: `${A},${HIDDEN_URL}`, [FILE]: file("secret-600") }),
      URLS,
    ],
    ["an empty entry", () => ({ [URLS]: `${A},`, [FILE]: file("secret-600") }), URLS],
    ["a secret file of mode 644", () => ({ [URLS]: A, [FILE]: file("secret-644") }), FILE],
    ["an empty secret file", () => ({ [URLS]: A, [FILE]: file("empty-600") }), FILE],
  ])("refuses %s, naming the variable and never a URL or the secret", (_, env, variable) => {
    const message = refusal(env());
    expect(message).toContain(variable);
    for (const hidden of [SECRET, A, "pw", "c.test", "token=abc"]) {
      expect(message).not.toContain(hidden);
    }
  });
});
