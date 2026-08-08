import type { JSX, ReactNode } from 'react';

export interface MarkdownProps {
  readonly text: string;
  /** Called when a file-path token is clicked; the parent owns the audit view. */
  readonly onFileRef?: ((path: string) => void) | undefined;
}

const FILE_PATH_SOURCE = String.raw`(?:[A-Za-z]:[\\/])?(?:[\w$@~+.=-]+[\\/])+[\w$@~+.-]+\.[A-Za-z0-9]{1,8}(?::\d+(?:[-:]\d+)?)?`;
const FILE_PATH_EXACT = new RegExp(`^${FILE_PATH_SOURCE}$`, 'u');
const INLINE_PATTERN = new RegExp([
  String.raw`(` + '`[^`\\n]+`' + ')',
  String.raw`(\*\*[^*\n]+\*\*)`,
  String.raw`(~~[^~\n]+~~)`,
  String.raw`(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))`,
  String.raw`(https?:\/\/[^\s<>"')\]]+)`,
  String.raw`(\*[^*\n]+\*)`,
  String.raw`(_[^_\n]+_)`,
  `(${FILE_PATH_SOURCE})`,
].join('|'), 'gu');

function fileRef(path: string, key: string, onFileRef: ((path: string) => void) | undefined, inner?: ReactNode): ReactNode {
  if (!onFileRef) return inner ?? path;
  return <button key={key} type="button" className="file-ref" title={path} onClick={() => onFileRef(path)}>{inner ?? path}</button>;
}

function renderInline(text: string, keyPrefix: string, onFileRef: ((path: string) => void) | undefined): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    index += 1;
    if (token.startsWith('`')) {
      const code = token.slice(1, -1);
      nodes.push(FILE_PATH_EXACT.test(code)
        ? fileRef(code, key, onFileRef, <code>{code}</code>)
        : <code key={key}>{code}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), `${key}b`, onFileRef)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<s key={key}>{renderInline(token.slice(2, -2), `${key}s`, onFileRef)}</s>);
    } else if (token.startsWith('[')) {
      const close = token.indexOf('](');
      const label = token.slice(1, close);
      const url = token.slice(close + 2, -1);
      nodes.push(<a key={key} href={url} target="_blank" rel="noreferrer noopener">{label}</a>);
    } else if (token.startsWith('http')) {
      nodes.push(<a key={key} href={token} target="_blank" rel="noreferrer noopener">{token}</a>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), `${key}e`, onFileRef)}</em>);
    } else {
      nodes.push(fileRef(token, key, onFileRef));
    }
    last = at + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Block {
  readonly kind: 'code' | 'heading' | 'quote' | 'ul' | 'ol' | 'table' | 'paragraph';
  readonly level?: number;
  readonly language?: string;
  readonly lines: readonly string[];
}

function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') { index += 1; continue; }
    const fence = /^```(\S*)\s*$/u.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index] ?? '')) { body.push(lines[index] ?? ''); index += 1; }
      index += 1;
      blocks.push({ kind: 'code', ...(fence[1] !== undefined && fence[1] !== '' ? { language: fence[1] } : {}), lines: body });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/u.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, lines: [heading[2] ?? ''] });
      index += 1;
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/u.test(lines[index + 1] ?? '') && (lines[index + 1] ?? '').includes('-')) {
      const rows: string[] = [line];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim() !== '') { rows.push(lines[index] ?? ''); index += 1; }
      blocks.push({ kind: 'table', lines: rows });
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>\s?/u.test(lines[index] ?? '')) { body.push((lines[index] ?? '').replace(/^>\s?/u, '')); index += 1; }
      blocks.push({ kind: 'quote', lines: body });
      continue;
    }
    if (/^\s*[-*+]\s+/u.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/u.test(lines[index] ?? '')) { body.push((lines[index] ?? '').replace(/^\s*[-*+]\s+/u, '')); index += 1; }
      blocks.push({ kind: 'ul', lines: body });
      continue;
    }
    if (/^\s*\d+[.)]\s+/u.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/u.test(lines[index] ?? '')) { body.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/u, '')); index += 1; }
      blocks.push({ kind: 'ol', lines: body });
      continue;
    }
    const body: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '') break;
      if (body.length > 0 && (/^```/u.test(current) || /^(#{1,4})\s+/u.test(current) || /^>\s?/u.test(current) || /^\s*[-*+]\s+/u.test(current) || /^\s*\d+[.)]\s+/u.test(current))) break;
      body.push(current);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', lines: body });
  }
  return blocks;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/** Small safe Markdown renderer: everything is emitted as React text/element
 * nodes, so no HTML injection is possible by construction. */
export function Markdown({ text, onFileRef }: MarkdownProps): JSX.Element {
  const blocks = splitBlocks(text);
  return (
    <div className="md-body">
      {blocks.map((block, blockIndex) => {
        const key = `b${blockIndex}`;
        switch (block.kind) {
          case 'code':
            return <pre key={key} className="md-code" {...(block.language ? { 'data-language': block.language } : {})}><code>{block.lines.join('\n')}</code></pre>;
          case 'heading': {
            const level = Math.min(4, Math.max(1, block.level ?? 1));
            return <div key={key} className={`md-h md-h${level}`} role="heading" aria-level={level}>{renderInline(block.lines[0] ?? '', key, onFileRef)}</div>;
          }
          case 'quote':
            return <blockquote key={key} className="md-quote">{block.lines.map((line, lineIndex) => <p key={`${key}q${lineIndex}`}>{renderInline(line, `${key}q${lineIndex}`, onFileRef)}</p>)}</blockquote>;
          case 'ul':
            return <ul key={key} className="md-list">{block.lines.map((line, lineIndex) => <li key={`${key}u${lineIndex}`}>{renderInline(line, `${key}u${lineIndex}`, onFileRef)}</li>)}</ul>;
          case 'ol':
            return <ol key={key} className="md-list">{block.lines.map((line, lineIndex) => <li key={`${key}o${lineIndex}`}>{renderInline(line, `${key}o${lineIndex}`, onFileRef)}</li>)}</ol>;
          case 'table': {
            const [header, ...rows] = block.lines.map(splitTableRow);
            return (
              <div key={key} className="md-table-wrap"><table className="md-table">
                <thead><tr>{(header ?? []).map((cell, cellIndex) => <th key={`${key}h${cellIndex}`}>{renderInline(cell, `${key}h${cellIndex}`, onFileRef)}</th>)}</tr></thead>
                <tbody>{rows.map((row, rowIndex) => <tr key={`${key}r${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${key}r${rowIndex}c${cellIndex}`}>{renderInline(cell, `${key}r${rowIndex}c${cellIndex}`, onFileRef)}</td>)}</tr>)}</tbody>
              </table></div>
            );
          }
          default:
            return <p key={key} className="md-p">{block.lines.map((line, lineIndex) => <span key={`${key}p${lineIndex}`}>{lineIndex > 0 ? <br /> : null}{renderInline(line, `${key}p${lineIndex}`, onFileRef)}</span>)}</p>;
        }
      })}
    </div>
  );
}
