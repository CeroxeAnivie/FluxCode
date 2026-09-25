import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { MergeView } from '@codemirror/merge';
import { useAppearance } from '../application/AppearanceProvider';

/** Disk is read-only; resolving never writes until the user explicitly saves. */
export function ConflictEditor({
  disk,
  draft,
  onChange,
  onSave,
}: {
  disk: string;
  draft: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t, theme } = useAppearance();
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    if (!host.current) return;
    const common = [
      lineNumbers(),
      EditorView.theme(
        {
          '&': { background: 'var(--input)', color: 'var(--text)' },
          '.cm-gutters': { background: 'var(--surface)', color: 'var(--muted)' },
          '.cm-scroller': { overflow: 'auto', fontSize: 'var(--font-size, 14px)' },
        },
        { dark: theme === 'dark' },
      ),
    ];
    const merge = new MergeView({
      parent: host.current,
      a: {
        doc: disk,
        extensions: [
          ...common,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ 'aria-label': t('磁盘版本') }),
        ],
      },
      b: {
        doc: draft,
        extensions: [
          ...common,
          EditorState.lineSeparator.of(draft.includes('\r\n') ? '\r\n' : '\n'),
          history(),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                save.current();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({ 'aria-label': t('合并结果') }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changed.current(u.state.sliceDoc());
          }),
        ],
      },
      highlightChanges: true,
      gutter: true,
    });
    return () => merge.destroy();
  }, [disk, theme, t]);
  return (
    <div className="conflict-editor">
      <div className="conflict-labels">
        <strong>{t('磁盘版本')}</strong>
        <strong>{t('合并结果')}</strong>
      </div>
      <div ref={host} />
    </div>
  );
}
