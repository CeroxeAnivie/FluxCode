import { useEffect, useRef, useState } from 'react';
import { bridge } from '../infrastructure/bridge';
import { mergeAttachmentPaths, validateAttachments, type Attachment } from '../domain/attachments';
import { loadAttachmentDrafts, saveAttachmentDrafts } from '../infrastructure/attachmentDrafts';
export function useContextAttachments(key: string, report: (message: string) => void) {
  const [initial] = useState(() => {
    try {
      return { value: loadAttachmentDrafts(), error: '' };
    } catch (e) {
      return { value: {}, error: String(e) };
    }
  });
  const [byDraft, setByDraft] = useState<Record<string, Attachment[]>>(initial.value);
  const [notice, setNotice] = useState<{
    key: string;
    added: number;
    duplicates: number;
  } | null>(null);
  const currentDrafts = useRef(byDraft);
  currentDrafts.current = byDraft;
  const previousKey = useRef(key);
  useEffect(() => {
    const previous = previousKey.current;
    previousKey.current = key;
    if (previous !== 'new:null' || key === previous || !key.startsWith('new:')) return;
    setByDraft((current) => {
      const unassigned = current[previous] ?? [];
      if (!unassigned.length) return current;
      const merged = [
        ...new Map(
          [...(current[key] ?? []), ...unassigned].map((item) => [item.path, item]),
        ).values(),
      ];
      try {
        validateAttachments(merged);
        return { ...current, [key]: merged, [previous]: [] };
      } catch (error) {
        queueMicrotask(() => report(String(error)));
        return current;
      }
    });
  }, [key]);
  useEffect(() => {
    if (initial.error) report(initial.error);
  }, []);
  useEffect(() => {
    if (!initial.error) {
      try {
        saveAttachmentDrafts(byDraft);
      } catch (e) {
        report(String(e));
      }
    }
  }, [byDraft]);
  const [pending, setPending] = useState(0);
  const items = byDraft[key] ?? [];
  function addMany(additions: (Pick<Attachment, 'path' | 'kind'> & { name?: string })[]) {
    if (!additions.length) return;
    try {
      const current = currentDrafts.current;
      const previous = current[key] ?? [];
      const next = mergeAttachmentPaths(previous, additions);
      currentDrafts.current = { ...current, [key]: next };
      setByDraft(currentDrafts.current);
      setNotice({
        key,
        added: next.length - previous.length,
        duplicates: additions.length - next.length + previous.length,
      });
    } catch (e) {
      setNotice(null);
      report(String(e));
    }
  }
  async function importPaths(additions: Pick<Attachment, 'path' | 'kind'>[]) {
    setPending((value) => value + 1);
    try {
      const imported = [];
      for (const item of additions) {
        imported.push(
          item.kind === 'image'
            ? {
                ...item,
                path: await bridge.storeChatImage(item.path),
                name: item.path.split(/[\\/]/).at(-1),
              }
            : item,
        );
      }
      addMany(imported);
    } catch (error) {
      report(String(error));
    } finally {
      setPending((value) => value - 1);
    }
  }
  async function addFiles(files: File[]) {
    setPending((value) => value + 1);
    try {
      if (files.length + (currentDrafts.current[key]?.length ?? 0) > 20)
        throw new Error('最多添加 20 个上下文引用。');
      const imported = [];
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type))
          throw new Error('仅支持 PNG、JPEG、WebP 和 GIF 图片');
        if (file.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MiB 上限');
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('无法读取图片'));
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(file);
        });
        imported.push({
          kind: 'image' as const,
          path: await bridge.storeChatImage(data),
          name: file.name || 'image.png',
        });
      }
      addMany(imported);
    } catch (error) {
      report(String(error));
    } finally {
      setPending((value) => value - 1);
    }
  }
  function add(path: string, kind?: Attachment['kind']) {
    void importPaths([
      { path, kind: kind ?? (/\.(png|jpe?g|webp|gif)$/i.test(path) ? 'image' : 'file') },
    ]);
  }
  async function choose() {
    try {
      const paths = await bridge.chooseAttachments();
      if (paths.length) await importPaths(await bridge.inspectDroppedPaths(paths));
    } catch (e) {
      setNotice(null);
      report(String(e));
    }
  }
  return {
    items,
    importing: pending > 0,
    importPaths,
    addFiles,
    notice: notice?.key === key ? notice : null,
    add,
    addMany,
    choose,
    remove: (id: string) => {
      setNotice(null);
      setByDraft((c) => ({ ...c, [key]: (c[key] ?? []).filter((i) => i.id !== id) }));
    },
    clear: (target = key) => {
      setNotice(null);
      setByDraft((c) => ({ ...c, [target]: [] }));
    },
    transfer: (next: string) => {
      setNotice(null);
      setByDraft((c) => ({ ...c, [next]: c[key] ?? [], [key]: [] }));
    },
  };
}
