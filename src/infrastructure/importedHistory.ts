import { invoke, isTauri } from '@tauri-apps/api/core';
import { parseImportedHistory } from '../domain/taskImport';
import type { ChatItem, Conversation } from '../domain/types';
import { emptyConversation } from '../domain/types';

const key = (id: string) => `fluxcode.imported-conversation.${id}`;

export async function saveImportedHistory(id: string, messages: ChatItem[]): Promise<void> {
  const content = JSON.stringify({ schemaVersion: 1, messages });
  parseImportedHistory(content);
  if (isTauri()) await invoke('save_imported_conversation', { id, content });
  else localStorage.setItem(key(id), content);
}

export async function loadImportedHistory(id: string): Promise<Conversation> {
  const content = isTauri()
    ? await invoke<string>('read_imported_conversation', { id })
    : localStorage.getItem(key(id));
  if (content === null) throw new Error('导入历史不存在，请检查程序数据目录或从备份恢复。');
  return { ...emptyConversation(), items: parseImportedHistory(content) };
}

export async function removeImportedHistory(id: string): Promise<void> {
  if (isTauri()) await invoke('remove_imported_conversation', { id });
  else localStorage.removeItem(key(id));
}
