// SPEC §8.1 and AGENTS.md: code outside src/server/services reaches it only through its index, and only the database
// component itself, plus the code that opens the database, imports src/server/db.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");
const DB = path.join(SRC, "server/db");
const SERVICES = path.join(SRC, "server/services");
/** AGENTS.md: code that opens the database imports the client to build the database it injects. */
const OPENS_DB = new Map([[path.join(SRC, "start.ts"), path.join(DB, "client")]]);

const inside = (dir: string, target: string) => target.startsWith(dir + path.sep);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return full === SERVICES ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Static imports, `export ... from` and dynamic `import()`, type-only ones included. */
function specifiers(file: string): string[] {
  return ts
    .preProcessFile(readFileSync(file, "utf8"), true, true)
    .importedFiles.map((f) => f.fileName);
}

function resolved(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return path.join(SRC, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(file), specifier);
  return null;
}

function crossesBoundary(file: string, specifier: string): boolean {
  const target = resolved(file, specifier)?.replace(/\.tsx?$/, "");
  if (target === undefined) return false;
  if (inside(SERVICES, target)) return true;
  if (target !== DB && !inside(DB, target)) return false;
  return !inside(DB, file) && OPENS_DB.get(file) !== target;
}

const imports = sourceFiles(SRC).flatMap((file) =>
  specifiers(file).map((specifier) => ({ file, specifier })),
);

describe("services boundary (SPEC §8.1)", () => {
  it("scans every folder outside src/server/services", () => {
    const scanned = new Set(
      imports.map(({ file }) => path.relative(SRC, path.dirname(file)) || "."),
    );
    for (const dir of ["lib", "routes", "components", "server/http", "server/db", "."]) {
      expect(scanned).toContain(dir);
    }
    expect([...scanned].filter((dir) => dir.startsWith("server/services"))).toEqual([]);
  });

  it("flags a private services module or a database module, and passes the index and the allowed db imports", () => {
    const sample = (file: string, specifier: string) =>
      crossesBoundary(path.join(SRC, file), specifier);
    expect(sample("routes/x.ts", "@/server/db/schema")).toBe(true);
    expect(sample("server/http/mcp.ts", "@/server/services/reads")).toBe(true);
    expect(sample("server/http/mcp.ts", "../services/policy")).toBe(true);
    expect(sample("server/db/seed.ts", "@/server/services/writes")).toBe(true);
    expect(sample("start.ts", "@/server/db/schema")).toBe(true);
    expect(sample("lib/x.ts", "@/server/db/client")).toBe(true);
    expect(sample("lib/x.ts", "@/server/services")).toBe(false);
    expect(sample("server/db/seed.ts", "./schema")).toBe(false);
    expect(sample("start.ts", "@/server/db/client")).toBe(false);
    expect(sample("components/x.tsx", "@tanstack/react-query")).toBe(false);
  });

  it("no file outside src/server/services imports one of its modules, or src/server/db without leave", () => {
    const violations = imports
      .filter(({ file, specifier }) => crossesBoundary(file, specifier))
      .map(({ file, specifier }) => `${path.relative(SRC, file)} -> ${specifier}`);
    expect(violations).toEqual([]);
  });
});
