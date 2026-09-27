import { webLink } from './links';

/** Only the address bar interprets text as a search. Links remain strict URLs. */
export function browserAddress(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 4096 || /[\u0000-\u001f\u007f]/.test(text)) return null;
  const direct = webLink(text);
  if (direct) return direct;
  const host = /^(?:localhost|\[[a-f\d:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(?::\d+)?(?:[/?#]|$)/i;
  if (host.test(text) && !/\s/.test(text)) return webLink(`https://${text}`);
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) return null;
  return webLink(`https://www.bing.com/search?q=${encodeURIComponent(text)}`);
}
