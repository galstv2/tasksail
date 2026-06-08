import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import MarkdownView from './MarkdownView';

afterEach(cleanup);

describe('MarkdownView — RG-05-xss', () => {
  it('renders h1 heading', () => {
    render(<MarkdownView content="# Hello World" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Hello World');
  });

  it('renders h2 heading', () => {
    render(<MarkdownView content="## Section" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Section');
  });

  it('renders h3 heading', () => {
    render(<MarkdownView content="### Sub" />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Sub');
  });

  it('renders meta label:value line', () => {
    render(<MarkdownView content="- Status: Active" />);
    expect(screen.getByText('Status:')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('renders bullet item', () => {
    render(<MarkdownView content="- first bullet" />);
    expect(screen.getByText('first bullet')).toBeTruthy();
  });

  it('renders numbered list item', () => {
    render(<MarkdownView content="1. Step one" />);
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('Step one')).toBeTruthy();
  });

  it('renders fenced code block', () => {
    const content = '```ts\nconst x = 1;\n```';
    render(<MarkdownView content={content} />);
    expect(screen.getByText('const x = 1;')).toBeTruthy();
  });

  it('renders paragraph text', () => {
    render(<MarkdownView content="Just a plain paragraph." />);
    expect(screen.getByText('Just a plain paragraph.')).toBeTruthy();
  });

  it('renders bold text as strong element', () => {
    const { container } = render(<MarkdownView content="This is **bold** text." />);
    const strong = container.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong!.textContent).toBe('bold');
  });

  it('renders inline code with correct class', () => {
    const { container } = render(<MarkdownView content="Use `npm install` to set up." />);
    const code = container.querySelector('code.task-md-view__inline-code');
    expect(code).toBeTruthy();
    expect(code!.textContent).toBe('npm install');
  });

  it('renders bold and inline code together in a paragraph', () => {
    const { container } = render(
      <MarkdownView content="Run **`npm install`** or just `yarn`." />,
    );
    const strong = container.querySelector('strong');
    expect(strong).toBeTruthy();
    const codes = container.querySelectorAll('code.task-md-view__inline-code');
    expect(codes.length).toBeGreaterThanOrEqual(1);
  });

  it('renders script tag as inert text, no script element in DOM', () => {
    const xss = '<script>alert("xss")</script> safe';
    const { container } = render(<MarkdownView content={xss} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>');
    expect(container.textContent).toContain('</script>');
  });

  it('renders img onerror payload as inert text, no img element in DOM', () => {
    const xss = '<img src=x onerror=alert(1)>';
    const { container } = render(<MarkdownView content={xss} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
  });

  it('renders html injection in bold as escaped text, not real HTML', () => {
    const payload = '**<em>not em</em>**';
    const { container } = render(<MarkdownView content={payload} />);
    const strong = container.querySelector('strong');
    if (strong) {
      expect(strong.querySelector('em')).toBeNull();
      expect(strong.textContent).toContain('not em');
    }
    expect(container.querySelector('em')).toBeNull();
  });

  it('renders inline-code payload as escaped text', () => {
    const payload = '`<script>bad()</script>`';
    const { container } = render(<MarkdownView content={payload} />);
    expect(container.querySelector('script')).toBeNull();
    const code = container.querySelector('code.task-md-view__inline-code');
    expect(code).toBeTruthy();
    expect(code!.textContent).toBe('<script>bad()</script>');
  });

  it('renders meta value with html payload as text, no injected element', () => {
    const { container } = render(
      <MarkdownView content="- Status: <b>bold</b>" />,
    );
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>bold</b>');
  });

  it('renders bullet with html payload as inert text', () => {
    const { container } = render(
      <MarkdownView content="- <script>evil()</script>" />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });

  it('renders numbered item with html payload as inert text', () => {
    const { container } = render(
      <MarkdownView content="1. <img src=x onerror=pwn()>" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
  });

  it('does not expose dangerouslySetInnerHTML in the rendered DOM', () => {
    const content = [
      '# Title',
      '',
      'Some **bold** and `code`.',
      '',
      '- bullet',
      '',
      '1. item',
    ].join('\n');
    const { container } = render(<MarkdownView content={content} />);
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code.task-md-view__inline-code')?.textContent).toBe('code');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
