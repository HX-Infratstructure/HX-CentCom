// `node --test tests/agent-tooling/` loads this file as its one test file, because Node 22 treats a directory
// argument as a module path, not a folder to search.
import { readdirSync } from "node:fs";

for (const file of readdirSync(new URL(".", import.meta.url))
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()) {
  await import(new URL(file, import.meta.url).href);
}
