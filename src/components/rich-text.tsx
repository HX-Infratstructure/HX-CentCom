import type { ReactNode } from "react";
import { parseRichText, type Block, type Inline } from "@/lib/rich-text";

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
