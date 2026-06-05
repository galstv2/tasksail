import { useMemo } from 'react';

type XmlSegment =
  | { kind: 'bracket'; text: string }
  | { kind: 'tagName'; text: string }
  | { kind: 'attributeName'; text: string }
  | { kind: 'attributeValue'; text: string }
  | { kind: 'equals'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'cdata'; text: string }
  | { kind: 'processing'; text: string };

type XmlLine = {
  indent: number;
  segments: XmlSegment[];
};

const XML_TOKEN_RE = /(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[^>]+?>)/g;
const WRAP_COLUMN = 112;

function tokenizeXml(content: string): string[] {
  const tokens: string[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(XML_TOKEN_RE)) {
    if (match.index > lastIndex) {
      tokens.push(content.slice(lastIndex, match.index));
    }
    tokens.push(match[0]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    tokens.push(content.slice(lastIndex));
  }
  return tokens.filter((token) => token.trim() !== '');
}

function tagName(token: string, closing: boolean): string | null {
  const match = token.match(closing ? /^<\/([A-Za-z_][\w:.-]*)\s*>$/ : /^<([A-Za-z_][\w:.-]*)(?:\s|\/?>)/);
  return match?.[1] ?? null;
}

function isClosingTag(token: string): boolean {
  return /^<\/[A-Za-z_][\w:.-]*\s*>$/.test(token);
}

function isOpeningTag(token: string): boolean {
  return /^<[A-Za-z_][\w:.-]*(?:\s[^>]*)?>$/.test(token) && !/\/>$/.test(token);
}

function isSelfClosingTag(token: string): boolean {
  return /^<[A-Za-z_][\w:.-]*(?:\s[^>]*)?\/>$/.test(token);
}

function isProcessingToken(token: string): boolean {
  return token.startsWith('<?');
}

function isCommentToken(token: string): boolean {
  return token.startsWith('<!--');
}

function isCdataToken(token: string): boolean {
  return token.startsWith('<![CDATA[');
}

function cleanText(token: string): string {
  return token.replace(/\s+/g, ' ').trim();
}

function wrapXmlText(text: string, indent: number): string[] {
  const maxLength = Math.max(48, WRAP_COLUMN - indent * 2);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length > maxLength) {
      lines.push(current);
      current = word;
      continue;
    }
    current += ` ${word}`;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function textSegments(text: string): XmlSegment[] {
  return [{ kind: 'text', text }];
}

function tagSegments(token: string): XmlSegment[] {
  if (isProcessingToken(token)) {
    return [{ kind: 'processing', text: token }];
  }
  if (isCommentToken(token)) {
    return [{ kind: 'comment', text: token }];
  }

  const match = token.match(/^<(\/?)([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/);
  if (!match) {
    return [{ kind: 'text', text: token }];
  }

  const [, slash, name, rawAttrs, selfClose] = match;
  const segments: XmlSegment[] = [
    { kind: 'bracket', text: `<${slash}` },
    { kind: 'tagName', text: name },
  ];

  const attrRe = /(\s+)([^\s=/>]+)(=)("[^"]*"|'[^']*')/g;
  let cursor = 0;
  for (const attr of rawAttrs.matchAll(attrRe)) {
    if (attr.index > cursor) {
      segments.push({ kind: 'bracket', text: rawAttrs.slice(cursor, attr.index) });
    }
    segments.push(
      { kind: 'bracket', text: attr[1] },
      { kind: 'attributeName', text: attr[2] },
      { kind: 'equals', text: attr[3] },
      { kind: 'attributeValue', text: attr[4] },
    );
    cursor = attr.index + attr[0].length;
  }
  if (cursor < rawAttrs.length) {
    segments.push({ kind: 'bracket', text: rawAttrs.slice(cursor) });
  }
  segments.push({ kind: 'bracket', text: `${selfClose}>` });
  return segments;
}

function cdataLines(token: string, indent: number): XmlLine[] {
  const body = token.slice('<![CDATA['.length, -']]>'.length);
  const lines: XmlLine[] = [
    { indent, segments: [{ kind: 'cdata', text: '<![CDATA[' }] },
  ];
  for (const rawLine of body.split(/\r?\n/)) {
    if (rawLine.trim() === '') {
      lines.push({ indent: indent + 1, segments: [{ kind: 'cdata', text: '' }] });
      continue;
    }
    lines.push({ indent: indent + 1, segments: [{ kind: 'cdata', text: rawLine.trimEnd() }] });
  }
  lines.push({ indent, segments: [{ kind: 'cdata', text: ']]>' }] });
  return lines;
}

function formatXmlLines(content: string): XmlLine[] {
  const tokens = tokenizeXml(content.trim());
  const lines: XmlLine[] = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const trimmed = token.trim();

    if (isCdataToken(trimmed)) {
      lines.push(...cdataLines(trimmed, depth));
      continue;
    }
    if (isCommentToken(trimmed) || isProcessingToken(trimmed) || isSelfClosingTag(trimmed)) {
      lines.push({ indent: depth, segments: tagSegments(trimmed) });
      continue;
    }
    if (isClosingTag(trimmed)) {
      depth = Math.max(depth - 1, 0);
      lines.push({ indent: depth, segments: tagSegments(trimmed) });
      continue;
    }
    if (isOpeningTag(trimmed)) {
      const nextText = tokens[i + 1] ? cleanText(tokens[i + 1]) : '';
      const nextClosing = tokens[i + 2]?.trim() ?? '';
      const currentName = tagName(trimmed, false);
      if (
        currentName
        && nextText
        && nextText.length <= WRAP_COLUMN - depth * 2
        && tagName(nextClosing, true) === currentName
      ) {
        lines.push({
          indent: depth,
          segments: [...tagSegments(trimmed), ...textSegments(nextText), ...tagSegments(nextClosing)],
        });
        i += 2;
        continue;
      }
      lines.push({ indent: depth, segments: tagSegments(trimmed) });
      depth += 1;
      continue;
    }

    const text = cleanText(trimmed);
    if (!text) continue;
    for (const wrapped of wrapXmlText(text, depth)) {
      lines.push({ indent: depth, segments: textSegments(wrapped) });
    }
  }

  return lines;
}

function classNameForSegment(kind: XmlSegment['kind']): string {
  return `task-xml-view__${kind}`;
}

export default function XmlArtifactView({ content }: { content: string }): JSX.Element {
  const lines = useMemo(() => formatXmlLines(content), [content]);
  return (
    <div className="task-xml-view">
      <pre className="task-md-view__code-block task-xml-view__code-block">
        <code>
          {lines.map((line, lineIndex) => (
            <span key={lineIndex} className="task-xml-view__line">
              {'  '.repeat(line.indent)}
              {line.segments.map((segment, segmentIndex) => (
                <span key={segmentIndex} className={classNameForSegment(segment.kind)}>
                  {segment.text}
                </span>
              ))}
              {lineIndex < lines.length - 1 ? '\n' : null}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
