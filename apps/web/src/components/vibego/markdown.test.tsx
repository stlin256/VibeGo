import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown.js';

describe('Markdown', () => {
  it('renders headings, emphasis, links and code blocks without raw HTML injection', () => {
    const html = renderToStaticMarkup(<Markdown text={'## Plan\n**bold** and *em* and ~~gone~~\n[site](https://example.com)\n```ts\nconst a = 1;\n```\n<script>alert(1)</script>'} />);
    expect(html).toContain('md-h2');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('md-code');
    expect(html).toContain('const a = 1;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders lists and tables', () => {
    const html = renderToStaticMarkup(<Markdown text={'- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |'} />);
    expect(html).toContain('<ul');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<table');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('turns file paths into clickable refs only when a handler is provided', () => {
    const withHandler = renderToStaticMarkup(<Markdown text={'see `src/main.ts` and apps/web/src/App.tsx:42'} onFileRef={() => undefined} />);
    expect(withHandler.match(/class="file-ref"/gu)?.length).toBe(2);
    expect(withHandler).toContain('title="apps/web/src/App.tsx:42"');
    const withoutHandler = renderToStaticMarkup(<Markdown text={'see src/main.ts here'} />);
    expect(withoutHandler).not.toContain('file-ref');
  });
});
