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
  const items = byDraft[key] ?? [];
  function addMany(additions: Pick<Attachment, 'path' | 'kind'>[]) {
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
  function add(path: string, kind?: Attachment['kind']) {
    addMany([{ path, kind: kind ?? (/\.(png|jpe?g|webp|gif)$/i.test(path) ? 'image' : 'file') }]);
  }
  async function choose() {
    try {
      const paths = await bridge.chooseAttachments();
      if (paths.length) addMany(await bridge.inspectDroppedPaths(paths));
    } catch (e) {
      setNotice(null);
      report(String(e));
    }
  }
  return {
    items,
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
