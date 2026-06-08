import { useMemo } from 'react';

export type MarkdownViewProps = {
  content: string;
};

type Block =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'meta'; label: string; value: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; index: string; text: string }
  | { type: 'code'; lang: string; lines: string[] }
  | { type: 'paragraph'; text: string };

// Tokenizes inline text into React nodes — bold (**…**) and inline-code (`…`).
// Text nodes are plain strings; React escapes them by construction (no raw-HTML sink).
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches **bold** or `code` — whichever comes first.
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={match.index}>{match[1]}</strong>);
    } else {
      nodes.push(
        <code key={match.index} className="task-md-view__inline-code">
          {match[2]}
        </code>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}

function parseBlocks(raw: string): Block[] {
  const lines = raw.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', lang, lines: codeLines });
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2).trim() });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4).trim() });
      i++;
      continue;
    }

    // Metadata line: "- Label: Value"
    const metaMatch = line.match(/^-\s+([A-Za-z][A-Za-z0-9 ]+):\s+(.+)$/);
    if (metaMatch) {
      blocks.push({ type: 'meta', label: metaMatch[1], value: metaMatch[2] });
      i++;
      continue;
    }

    // Bullet item
    if (line.match(/^[-*]\s+/)) {
      blocks.push({ type: 'bullet', text: line.replace(/^[-*]\s+/, '') });
      i++;
      continue;
    }

    // Numbered list item
    const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      blocks.push({ type: 'numbered', index: numMatch[1], text: numMatch[2] });
      i++;
      continue;
    }

    // Empty line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph text
    blocks.push({ type: 'paragraph', text: line });
    i++;
  }

  return blocks;
}

export default function MarkdownView({ content }: MarkdownViewProps): JSX.Element {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="task-md-view">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'h1':
            return (
              <h1 key={idx} className="task-md-view__h1">
                {block.text}
              </h1>
            );
          case 'h2':
            return (
              <h2 key={idx} className="task-md-view__h2">
                {block.text}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={idx} className="task-md-view__h3">
                {block.text}
              </h3>
            );
          case 'meta':
            return (
              <div key={idx} className="task-md-view__meta-line">
                <span className="task-md-view__meta-label">{block.label}:</span>{' '}
                <span className="task-md-view__meta-value">{renderInline(block.value)}</span>
              </div>
            );
          case 'bullet':
            return (
              <div key={idx} className="task-md-view__bullet">
                <span className="task-md-view__bullet-marker" aria-hidden="true" />
                <span>{renderInline(block.text)}</span>
              </div>
            );
          case 'numbered':
            return (
              <div key={idx} className="task-md-view__numbered">
                <span className="task-md-view__numbered-index">{block.index}.</span>
                <span>{renderInline(block.text)}</span>
              </div>
            );
          case 'code':
            return (
              <pre key={idx} className="task-md-view__code-block">
                <code>{block.lines.join('\n')}</code>
              </pre>
            );
          case 'paragraph':
            return (
              <p key={idx} className="task-md-view__paragraph">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
