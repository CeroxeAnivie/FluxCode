import { expect, it } from 'vitest';
import { browserAddress } from './browserAddress';

it('searches ordinary words and numbers with Bing', () => {
  for (const query of ['1122', '如何使用 Rust', 'two words']) {
    expect(new URL(browserAddress(query)!).searchParams.get('q')).toBe(query);
    expect(new URL(browserAddress(query)!).hostname).toBe('www.bing.com');
  }
});
it('opens addresses and rejects unsafe explicit schemes', () => {
  expect(browserAddress('example.com/docs')).toBe('https://example.com/docs');
  expect(browserAddress('http://localhost:8080')).toBe('http://localhost:8080/');
  for (const value of ['', 'javascript:alert(1)', 'file:///C:/secret', 'data:text/html,test'])
    expect(browserAddress(value)).toBeNull();
});
