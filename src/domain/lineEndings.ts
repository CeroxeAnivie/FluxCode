/** Preserve the original file convention when browser editing normalizes newlines. */
export function preserveLineEndings(text: string, original: string): string {
  const ending = original.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  return text.replace(/\r\n|\n|\r/g, ending);
}
