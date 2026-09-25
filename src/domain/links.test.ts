import { describe, expect, it } from 'vitest';
import { webLink, workspaceFileLink } from './links';
describe('external web links', () => {
  it('preserves query strings and fragments with Unicode paths', () => {
    expect(webLink('https://example.com/文档?a=1&b=2#title')).toBe(
      'https://example.com/%E6%96%87%E6%A1%A3?a=1&b=2#title',
    );
  });
  it('rejects active content, local paths, credentials and oversized input', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,test',
      'file:///C:/test.md',
      '../README.md',
      'https://name:secret@example.com',
      'https://example.com/\n',
      'https://example.com/' + 'a'.repeat(8192),
      'https://example.com/' + '文'.repeat(1000),
    ]) {
      expect(webLink(value)).toBeNull();
    }
  });
});

describe('workspace file links', () => {
  it('decodes Unicode and spaces while retaining a relative project path', () => {
    expect(workspaceFileLink('./docs/%E8%AE%BE%E8%AE%A1%20%E6%96%87%E6%A1%A3.md#intro')).toBe(
      'docs/设计 文档.md',
    );
    expect(workspaceFileLink('README.md')).toBe('README.md');
  });
  it('rejects external schemes, absolute paths and traversal', () => {
    for (const value of [
      'https://example.com/doc',
      'file:///C:/secret.txt',
      'C:/secret.txt',
      '/absolute.md',
      '../private.txt',
      'docs/%2e%2e/private.txt',
      'docs/file.md?download=1',
      'docs/%00.md',
      '#section',
    ]) {
      expect(workspaceFileLink(value)).toBeNull();
    }
  });
});
