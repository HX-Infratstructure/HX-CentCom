import type { ReactNode } from "react";

export type Inline = { readonly kind: "text" | "strong" | "code"; readonly text: string };
export type ListItem = { readonly inlines: readonly Inline[]; readonly children: readonly Block[] };
export type Block =
  | { readonly kind: "p"; readonly inlines: readonly Inline[] }
  | { readonly kind: "ul"; readonly items: readonly ListItem[] };

type DraftItem = { text: string; children: DraftList | null };
type DraftList = { items: DraftItem[] };
type DraftBlock = { kind: "p"; text: string } | { kind: "ul"; list: DraftList };

const LIST_LINE = /^(\s*)- (.*)$/;

/**
 * The four constructs the decision descriptions use: paragraphs, `- ` lists nested by indentation, `**bold**` and
 * `` `code` ``. Anything else, including an unmatched marker, stays literal text. It returns data, never HTML, so
 * agent-written text cannot inject markup.
 */
function parseRichText(source: string): readonly Block[] {
  const blocks: DraftBlock[] = [];
  let paragraph: { kind: "p"; text: string } | null = null;
  let lists: { indent: number; list: DraftList }[] = [];
  let afterBlank = false;

  function addItem(indent: number, text: string) {
    if (lists.length === 0) {
      const list: DraftList = { items: [] };
      blocks.push({ kind: "ul", list });
      lists = [{ indent, list }];
    }
    while (lists.length > 1 && (lists.at(-1)?.indent ?? 0) > indent) lists.pop();
    let top = lists.at(-1);
    const parent = top?.list.items.at(-1);
    if (top !== undefined && parent !== undefined && indent > top.indent) {
      parent.children ??= { items: [] };
      top = { indent, list: parent.children };
      lists.push(top);
    }
    top?.list.items.push({ text, children: null });
  }

  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === "") {
      paragraph = null;
      afterBlank = true;
      continue;
    }
    const item = LIST_LINE.exec(line);
    if (item !== null) {
      paragraph = null;
      addItem(item[1]?.length ?? 0, item[2] ?? "");
    } else if (lists.length > 0 && !afterBlank) {
      const open = lists.at(-1)?.list.items.at(-1);
      if (open !== undefined) open.text = `${open.text} ${line.trim()}`;
    } else {
      // A blank line followed by text closes any open list, even when the text is indented (D-11 relies on this).
      lists = [];
      if (paragraph === null) {
        paragraph = { kind: "p", text: line.trim() };
        blocks.push(paragraph);
      } else {
        paragraph.text = `${paragraph.text} ${line.trim()}`;
      }
    }
    afterBlank = false;
  }
  return blocks.map(finishBlock);
}

function finishBlock(block: DraftBlock): Block {
  return block.kind === "p"
    ? { kind: "p", inlines: parseInlines(block.text) }
    : { kind: "ul", items: finishList(block.list) };
}

function finishList(list: DraftList): readonly ListItem[] {
  return list.items.map((item): ListItem => ({
    inlines: parseInlines(item.text),
    children: item.children === null ? [] : [{ kind: "ul", items: finishList(item.children) }],
  }));
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`/g;

function parseInlines(text: string): readonly Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    const strong = match[1];
    out.push(
      strong !== undefined
        ? { kind: "strong", text: strong }
        : { kind: "code", text: match[2] ?? "" },
    );
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function RichText({ source }: { source: string }): ReactNode {
  return (
    <div className="rich-text">
      {parseRichText(source).map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }): ReactNode {
  if (block.kind === "p") {
    return (
      <p>
        <Inlines inlines={block.inlines} />
      </p>
    );
  }
  return (
    <ul>
      {block.items.map((item, i) => (
        <li key={i}>
          <Inlines inlines={item.inlines} />
          {item.children.map((child, j) => (
            <BlockView key={j} block={child} />
          ))}
        </li>
      ))}
    </ul>
  );
}

function Inlines({ inlines }: { inlines: readonly Inline[] }): ReactNode {
  return inlines.map((inline, i) => {
    if (inline.kind === "strong") return <strong key={i}>{inline.text}</strong>;
    if (inline.kind === "code") return <code key={i}>{inline.text}</code>;
    return inline.text;
  });
}
