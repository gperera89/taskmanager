import type { ReactNode } from "react";

// The assistant's replies use plain markdown (bold, numbered/bulleted lists, paragraphs) — this
// renders just enough of that for a chat bubble, without pulling in a full markdown dependency.

function renderInline(text: string, keyPrefix: string): ReactNode {
  // Splits on **bold** runs, keeping the delimiters so we know which parts to wrap.
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return part ? <span key={`${keyPrefix}-${i}`}>{part}</span> : null;
  });
}

const NUMBERED_RE = /^\d+[.)]\s+(.*)$/;
const BULLET_RE = /^[-*]\s+(.*)$/;

type Block = { type: "ol" | "ul" | "p"; lines: string[] };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const numbered = NUMBERED_RE.exec(line);
    const bulleted = numbered ? null : BULLET_RE.exec(line);
    const type = numbered ? "ol" : bulleted ? "ul" : "p";
    const content = numbered?.[1] ?? bulleted?.[1] ?? line;
    const last = blocks[blocks.length - 1];
    if (last?.type === type) last.lines.push(content);
    else blocks.push({ type, lines: [content] });
  }
  return blocks;
}

export function renderMarkdownLite(text: string): ReactNode {
  const blocks = toBlocks(text);

  return blocks.map((block, bi) => {
    if (block.type === "ol") {
      return (
        <ol key={bi} className="list-decimal space-y-1 py-0.5 pl-4">
          {block.lines.map((line, li) => (
            <li key={li}>{renderInline(line, `${bi}-${li}`)}</li>
          ))}
        </ol>
      );
    }
    if (block.type === "ul") {
      return (
        <ul key={bi} className="list-disc space-y-1 py-0.5 pl-4">
          {block.lines.map((line, li) => (
            <li key={li}>{renderInline(line, `${bi}-${li}`)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={bi} className={bi > 0 ? "mt-1.5" : undefined}>
        {block.lines.map((line, li) => (
          <span key={li}>
            {li > 0 && <br />}
            {renderInline(line, `${bi}-${li}`)}
          </span>
        ))}
      </p>
    );
  });
}
