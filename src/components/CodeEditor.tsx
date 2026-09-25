import { useEffect, useRef, useState } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from '@codemirror/language';
import { useAppearance } from '../application/AppearanceProvider';

async function language(path: string): Promise<Extension> {
  const ext = path.split('.').at(-1)?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'mjs':
    case 'cjs':
      return (await import('@codemirror/lang-javascript')).javascript({
        typescript: ext === 'ts' || ext === 'tsx',
        jsx: ext === 'jsx' || ext === 'tsx',
      });
    case 'json':
      return (await import('@codemirror/lang-json')).json();
    case 'md':
      return (await import('@codemirror/lang-markdown')).markdown();
    case 'py':
      return (await import('@codemirror/lang-python')).python();
    case 'rs':
      return (await import('@codemirror/lang-rust')).rust();
    case 'java':
      return (await import('@codemirror/lang-java')).java();
    case 'html':
      return (await import('@codemirror/lang-html')).html();
    case 'css':
      return (await import('@codemirror/lang-css')).css();
    default:
      return [];
  }
}

const chinesePhrases = {
  Find: '查找',
  Replace: '替换',
  next: '下一处',
  previous: '上一处',
  all: '全部',
  'match case': '区分大小写',
  regexp: '正则表达式',
  'by word': '全词匹配',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'Go to line': '跳转到行',
  go: '跳转',
  'Selection deleted': '已删除选中内容',
  'Fold line': '折叠行',
  'Unfold line': '展开行',
  to: '至',
  'replaced $ matches': '已替换 $ 处匹配',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'on line': '所在行',
  'No matches found': '没有匹配项',
};

export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  readOnly = false,
  label,
}: {
  path: string;
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  label?: string;
}) {
  const { language: locale, theme, t } = useAppearance();
  const host = useRef<HTMLDivElement>(null);
  const [languageError, setLanguageError] = useState(false);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  const config = useRef(new Compartment());
  const syntax = useRef(new Compartment());
  const configuration = () => [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      'aria-label': label ?? t('文件内容'),
      'aria-multiline': 'true',
    }),
    EditorState.phrases.of(locale === 'zh-CN' ? chinesePhrases : {}),
    EditorView.theme(
      {
        '&': { height: '100%', backgroundColor: 'var(--input)', color: 'var(--text)' },
        '.cm-scroller': {
          fontFamily: "'Cascadia Code', Consolas, monospace",
          fontSize: 'var(--font-size, 14px)',
          overflow: 'auto',
        },
        '.cm-content': { caretColor: 'var(--text)', padding: '12px 0' },
        '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--muted)', border: 'none' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--control-hover)' },
        '.cm-cursor': { borderLeftColor: 'var(--text)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
          backgroundColor: 'var(--focus-ring)',
        },
        '.cm-panels': {
          backgroundColor: 'var(--surface)',
          color: 'var(--text)',
          borderColor: 'var(--border)',
        },
        '.cm-textfield': {
          background: 'var(--input)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
        },
        '.cm-button': {
          background: 'var(--surface-hover)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
        },
      },
      { dark: theme === 'dark' },
    ),
  ];
  useEffect(() => {
    if (!host.current) return;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          bracketMatching(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle),
          highlightSelectionMatches(),
          search({ top: true }),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                callbacks.current.onSave?.();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          EditorState.lineSeparator.of(value.includes('\r\n') ? '\r\n' : '\n'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange?.(update.state.sliceDoc());
          }),
          config.current.of(configuration()),
          syntax.current.of([]),
        ],
      }),
    });
    view.current = instance;
    return () => {
      view.current = null;
      instance.destroy();
    };
  }, []);
  useEffect(() => {
    view.current?.dispatch({ effects: config.current.reconfigure(configuration()) });
  }, [locale, theme, readOnly, label]);
  useEffect(() => {
    let active = true;
    setLanguageError(false);
    void language(path)
      .then((extension) => {
        if (active) view.current?.dispatch({ effects: syntax.current.reconfigure(extension) });
      })
      .catch(() => {
        // Editing stays available when an optional language chunk cannot load.
        if (active) {
          view.current?.dispatch({ effects: syntax.current.reconfigure([]) });
          setLanguageError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    const instance = view.current;
    if (instance && instance.state.sliceDoc() !== value)
      instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
  }, [value]);
  return (
    <div className="code-editor-container">
      {languageError && <small role="status">{t('语法高亮暂不可用，仍可编辑和保存。')}</small>}
      <div className="code-editor" ref={host} />
    </div>
  );
}
