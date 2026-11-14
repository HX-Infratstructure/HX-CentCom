import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/server/db/test-db";

const ROOT = path.resolve(__dirname, "../..");
const UI_DIRS = ["src/lib", "src/routes", "src/components"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

/** Every string a reader would see in the file: string literals, plain template literals and JSX text. */
function literals(file: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    kind,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text);
    else if (ts.isJsxText(node) && node.text.trim() !== "") found.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const scanned = new Map(
  UI_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).map(
    (file) => [path.relative(ROOT, file), literals(file)] as const,
  ),
);

describe("one source of truth for agents", () => {
  it("the scan sees the literals of the UI source files", () => {
    expect(scanned.get("src/lib/task-data.ts")).toContain("task-workspace");
  });

  it("no UI source file restates an agent's display name", async () => {
    const t = await createTestDb();
    const { agents } = await t.services.listWorkspace();
    await t.close();
    const names = new Set(agents.filter((a) => a.display_name !== a.id).map((a) => a.display_name));
    expect(names.size, "the seed has agents whose display name is not their id").toBeGreaterThan(0);

    const restated = [...scanned].flatMap(([file, found]) =>
      found.filter((s) => names.has(s)).map((s) => `${file}: ${s}`),
    );
    expect(restated).toEqual([]);
  });
});
