export function webLink(value: string | undefined): string | null {
  if (!value || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= 8192
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function workspaceFileLink(value: string | undefined, projectRoot?: string): string | null {
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f?#]/.test(value.split('#', 1)[0]))
    return null;
  const withoutFragment = value.split('#', 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment).replaceAll('\\', '/');
  } catch {
    return null;
  }
  if (projectRoot) {
    if (/^file:/i.test(decoded)) {
      try {
        const url = new URL(value!);
        if (url.hostname || url.search) return null;
        decoded = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, '$1');
      } catch {
        return null;
      }
    }
    const root = projectRoot.replaceAll('\\', '/').replace(/\/+$/, '');
    const windows = /^[a-z]:\//i.test(root);
    const compare = windows ? decoded.toLowerCase() : decoded;
    const prefix = (windows ? root.toLowerCase() : root) + '/';
    if (compare.startsWith(prefix)) decoded = decoded.slice(prefix.length);
  }
  if (
    !decoded ||
    decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    /[\u0000-\u001f\u007f:?#]/.test(decoded)
  )
    return null;
  const parts = decoded.split('/').filter((part) => part && part !== '.');
  return parts.length && parts.every((part) => part !== '..') ? parts.join('/') : null;
}
