import { useLayoutEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, ChevronRight, FileCode2, Folder } from 'lucide-react';
import type { Entry } from '../domain/types';
import { useAppearance } from '../application/AppearanceProvider';

/** Windowed directory entries with one tab stop and complete arrow-key navigation. */
export function WorkspaceFileList({
  entries,
  parent,
  onOpen,
  onParent,
  restorePath,
}: {
  entries: Entry[];
  parent: boolean;
  onOpen: (entry: Entry) => void;
  onParent: () => void;
  restorePath?: string;
}) {
  const { t } = useAppearance();
  const host = useRef<HTMLDivElement>(null);
  const initial = Math.max(
    0,
    entries.findIndex((entry) => entry.path === restorePath),
  );
  const [focused, setFocused] = useState(initial);
  const focusPending = useRef(false);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => host.current,
    estimateSize: () => 34,
    getItemKey: (index) => entries[index].path,
    overscan: 6,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), focused])]
        .filter((index) => index < entries.length)
        .sort((a, b) => a - b),
  });
  useLayoutEffect(() => {
    if (initial) virtualizer.scrollToIndex(initial, { align: 'center' });
  }, []);
  useLayoutEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    host.current?.querySelector<HTMLButtonElement>(`[data-index="${focused}"]`)?.focus();
  }, [focused]);
  return (
    <div className="file-list" ref={host}>
      {parent && (
        <button className="file-row" onClick={onParent}>
          <ArrowLeft size={14} />
          {t('上一级')}
        </button>
      )}
      <div
        role="list"
        aria-label={t('文件')}
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const entry = entries[row.index];
          return (
            <div
              key={entry.path}
              role="listitem"
              aria-setsize={entries.length}
              aria-posinset={row.index + 1}
              style={{
                position: 'absolute',
                width: '100%',
                top: 0,
                transform: `translateY(${row.start}px)`,
              }}
            >
              <button
                className="file-row"
                data-path={entry.path}
                data-index={row.index}
                tabIndex={row.index === focused ? 0 : -1}
                title={entry.name}
                style={{ height: 34 }}
                onFocus={() => setFocused(row.index)}
                onClick={() => onOpen(entry)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowDown'
                      ? Math.min(entries.length - 1, row.index + 1)
                      : event.key === 'ArrowUp'
                        ? Math.max(0, row.index - 1)
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? entries.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  if (next === focused) return;
                  focusPending.current = true;
                  virtualizer.scrollToIndex(next, { align: 'auto' });
                  setFocused(next);
                }}
              >
                {entry.directory ? (
                  <Folder size={15} className="folder-icon" />
                ) : (
                  <FileCode2 size={15} />
                )}
                <span>{entry.name}</span>
                {entry.directory && <ChevronRight size={12} />}
              </button>
            </div>
          );
        })}
      </div>
      {!entries.length && <p className="panel-note">{t('此目录没有可显示的文件。')}</p>}
    </div>
  );
}
