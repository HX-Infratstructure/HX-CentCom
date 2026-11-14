// T11 (R6): the app owns its platform. No Lovable or Supabase package is imported or installed, and the build
// targets a plain Node server. tests/start/sigterm-releases-pool.test.ts builds and runs that server.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const FORBIDDEN = /lovable|supabase/i;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

/** Static imports, `export ... from`, `require()` and dynamic `import()`, per file. */
const imports = ["src", "scripts", "bin"].flatMap((dir) =>
  files(path.join(ROOT, dir)).flatMap((file) =>
    ts
      .preProcessFile(readFileSync(file, "utf8"), true, true)
      .importedFiles.map((f) => ({ file: path.relative(ROOT, file), specifier: f.fileName })),
  ),
);

const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("T11: no Lovable or Supabase, and a Node server build", () => {
  it("reads the import specifiers of src, scripts and bin", () => {
    expect(imports).toContainEqual({
      file: path.join("src", "start.ts"),
      specifier: "@tanstack/react-start",
    });
    expect(imports.some(({ file }) => file.startsWith(`bin${path.sep}`))).toBe(true);
  });

  it("no source file imports a Lovable or Supabase package", () => {
    const hits = imports
      .filter(({ specifier }) => FORBIDDEN.test(specifier))
      .map(({ file, specifier }) => `${file} -> ${specifier}`);
    expect(hits).toEqual([]);
  });

  it("package.json depends on no Lovable or Supabase package", () => {
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(names).toContain("@tanstack/react-start");
    expect(names.filter((name) => FORBIDDEN.test(name))).toEqual([]);
  });

  it("the production build uses Nitro's node-server preset", () => {
    const config = readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    expect(config).toMatch(/command === "build" \? \[nitro\(\{ preset: "node-server" \}\)\]/);
  });
});
