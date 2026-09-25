import { invoke } from '@tauri-apps/api/core';
import { webLink } from '../domain/links';

export async function openWebLink(value: string): Promise<void> {
  const url = webLink(value);
  if (!url) throw new Error('网页链接无效');
  await invoke('open_external_link', { url });
}
