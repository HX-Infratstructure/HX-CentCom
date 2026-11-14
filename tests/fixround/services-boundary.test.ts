// SPEC §8.1: UI code reaches the server only through the service layer's public surface.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");
const DB = path.join(SRC, "server/db");
const SERVICES = path.join(SRC, "server/services");
const UI_DIRS = ["lib", "routes", "components"].map((d) => path.join(SRC, d));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
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

function crossesBoundary(target: string): boolean {
  return (
    target === DB || target.startsWith(DB + path.sep) || target.startsWith(SERVICES + path.sep)
  );
}

const imports = UI_DIRS.flatMap(sourceFiles).flatMap((file) =>
  specifiers(file).map((specifier) => ({ file: path.relative(SRC, file), specifier })),
);

describe("services boundary (SPEC §8.1)", () => {
  it("reads the UI's import specifiers, including the service surface", () => {
    expect(imports).toContainEqual({
      file: path.join("lib", "tasks.functions.ts"),
      specifier: "@/server/services",
    });
  });

  it("no file under src/lib, src/routes or src/components imports src/server/db or a services internal", () => {
    const violations = imports
      .filter(({ file, specifier }) => {
        const target = resolved(path.join(SRC, file), specifier);
        return target !== null && crossesBoundary(target);
      })
      .map(({ file, specifier }) => `${file} -> ${specifier}`);
    expect(violations).toEqual([]);
  });
});
