import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseRichText, richTextPlainText } from "@/lib/rich-text";
import { RichText } from "./rich-text";

// The live check compares the sheet's real `textContent` with `richTextPlainText` (scripts/live-check/checks/boards.ts).
// `richTextPlainText` walks the parsed blocks separately from the component, so this test catches the two walks
// drifting apart: a construct the component renders but the plain text drops, reorders, or spaces differently.
describe("RichText and richTextPlainText", () => {
  it.each([
    ["two paragraphs", "First line\ncontinues here.\n\nSecond paragraph."],
    ["a list nested by indentation", "- one\n  - one.a\n    - one.a.i\n  - one.b\n- two"],
    ["bold and code", "Use **bold** and `code` here."],
    [
      "an unmatched bold marker and an unmatched backtick",
      "an **unmatched marker and a ` stray tick",
    ],
    ["an empty description", ""],
    [
      "paragraphs around a list with inline markers",
      "Intro with **bold**.\n\n- item with `code`\n  continued line\n  - child **strong**\n\nOutro.",
    ],
  ])("renders the same text the plain-text oracle gives for %s", (_name, source) => {
    const { container } = render(<RichText source={source} />);

    expect(container.textContent).toBe(richTextPlainText(source));
  });
});

// These catch a parser change that drops nesting or turns an unmatched marker into markup, against the behaviour
// documented on parseRichText in src/lib/rich-text.ts.
describe("parseRichText", () => {
  const text = (value: string) => ({ kind: "text", text: value });

  it("nests a `- ` item under the previous item when it is indented further, and returns to the outer list", () => {
    expect(parseRichText("- one\n  - one.a\n    - one.a.i\n  - one.b\n- two")).toEqual([
      {
        kind: "ul",
        items: [
          {
            inlines: [text("one")],
            children: [
              {
                kind: "ul",
                items: [
                  {
                    inlines: [text("one.a")],
                    children: [
                      { kind: "ul", items: [{ inlines: [text("one.a.i")], children: [] }] },
                    ],
                  },
                  { inlines: [text("one.b")], children: [] },
                ],
              },
            ],
          },
          { inlines: [text("two")], children: [] },
        ],
      },
    ]);
  });

  it("keeps an unmatched `**` as literal text after a matched pair", () => {
    expect(parseRichText("**done** and **open")).toEqual([
      { kind: "p", inlines: [{ kind: "strong", text: "done" }, text(" and **open")] },
    ]);
  });

  it("keeps an unmatched backtick as literal text after a matched pair", () => {
    expect(parseRichText("run `npm test` then `stop")).toEqual([
      {
        kind: "p",
        inlines: [text("run "), { kind: "code", text: "npm test" }, text(" then `stop")],
      },
    ]);
  });

  it("keeps a lone `**` and a lone backtick as one literal text inline", () => {
    expect(parseRichText("an **unmatched marker and a ` stray tick")).toEqual([
      { kind: "p", inlines: [text("an **unmatched marker and a ` stray tick")] },
    ]);
  });
});
