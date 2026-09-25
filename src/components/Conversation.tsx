import { ErrorNotice } from './ErrorNotice';
import { useAppearance } from '../application/AppearanceProvider';
import {
  ArrowUpRight,
  Check,
  Code2,
  Compass,
  FileCode2,
  LoaderCircle,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
const MarkdownContent = lazy(() =>
  import('./MarkdownContent').then((module) => ({ default: module.MarkdownContent })),
);
import type { Conversation as ConversationState, ChatItem } from '../domain/types';

const suggestions = [
  {
    icon: Compass,
    title: '了解这个项目',
    description: '梳理架构、入口和关键模块',
    prompt:
      '请先阅读项目约定，分析项目结构、技术栈、主要入口和模块边界，给出简明的架构说明。暂时不要修改文件。',
  },
  {
    icon: Wrench,
    title: '实现一个功能',
    description: '从需求到经过验证的代码',
    prompt: '我想在这个项目中实现一个新功能。请先了解现有代码和开发约定，然后与我确认具体需求。',
  },
  {
    icon: Code2,
    title: '审查代码质量',
    description: '寻找缺陷与关键回归风险',
    prompt:
      '请审查当前项目的代码和未提交变更，优先指出可验证的正确性、安全性和兼容性问题。先不要修改代码。',
  },
];

export function Welcome({
  project,
  onSuggestion,
}: {
  project?: string;
  onSuggestion: (prompt: string) => void;
}) {
  const { t } = useAppearance();
  return (
    <div className="welcome">
      <div className="welcome-symbol">
        <span>F</span>
        <i />
      </div>
      <p className="welcome-eyebrow">{t('开始构建你的想法')}</p>
      <h1>{t('让想法，在代码中发生。')}</h1>
      <p className="welcome-subtitle">
        {project ? (
          <>
            {t('与 FluxCode 一起，在')}
            <strong>{project}</strong>
            {t('中开始下一次构建。')}
          </>
        ) : (
          t('打开一个项目，让 FluxCode 帮你理解、构建与改进代码。')
        )}
      </p>
      <div className="suggestion-grid">
        {suggestions.map(({ icon: Icon, title, description, prompt }) => (
          <button className="suggestion-card" key={title} onClick={() => onSuggestion(t(prompt))}>
            <div>
              <Icon size={18} />
              <ArrowUpRight size={14} />
            </div>
            <strong>{t(title)}</strong>
            <span>{t(description)}</span>
          </button>
        ))}
      </div>
      <div className="welcome-hint">
        <span />
        {t('本地工作空间')}
        <span />
        {t('流式协作')}
        <span />
        {t('由你掌控')}
      </div>
    </div>
  );
}

function Item({ item, projectRoot }: { item: ChatItem; projectRoot?: string }) {
  const { t } = useAppearance();
  if (item.kind === 'compaction')
    return (
      <div className="compaction-marker" role="status">
        {item.status === 'inProgress' ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <Check size={14} />
        )}{' '}
        {t(
          item.status === 'inProgress'
            ? '正在压缩上下文…'
            : item.status === 'interrupted'
              ? '上下文压缩未完成'
              : '上下文已压缩',
        )}
      </div>
    );
  if (item.steps || item.kind === 'agent')
    return (
      <details className="tool-card" open={item.kind === 'plan'}>
        <summary>{t(item.kind === 'agent' ? '协作代理' : '执行计划')}</summary>
        {item.text && <p>{item.text}</p>}
        {item.steps && (
          <ol>
            {item.steps.map((step, index) => (
              <li key={index}>
                <span>
                  {t(
                    (
                      {
                        pending: '待处理',
                        inProgress: '进行中',
                        completed: '已完成',
                        running: '进行中',
                        errored: '失败',
                        shutdown: '已停止',
                      } as Record<string, string>
                    )[step.status] ?? '状态未知',
                  )}
                </span>{' '}
                · {step.text}
              </li>
            ))}
          </ol>
        )}
        {item.kind === 'agent' && item.detail && <code>{item.detail}</code>}
      </details>
    );
  if (item.kind === 'user')
    return (
      <article className="message user-message">
        <div className="message-label">
          <span className="mini-avatar">{t('你')}</span>
          <strong>{t('你')}</strong>
        </div>
        <div className="user-text markdown">
          <Suspense fallback={<p>{item.text}</p>}>
            <MarkdownContent text={item.text} projectRoot={projectRoot} />
          </Suspense>
        </div>
      </article>
    );
  if (item.kind === 'assistant')
    return (
      <article className="message assistant-message">
        <div className="message-label">
          <span className="mini-avatar flux">F</span>
          <strong>FluxCode</strong>
        </div>
        <div className="markdown">
          <Suspense fallback={<p>{item.text}</p>}>
            <MarkdownContent text={item.text} projectRoot={projectRoot} />
          </Suspense>
        </div>
      </article>
    );
  if (item.kind === 'reasoning' && !item.text) return null;
  const Icon = item.kind === 'command' ? Terminal : item.kind === 'file' ? FileCode2 : Sparkles;
  return (
    <details className={`tool-card ${item.kind}`}>
      <summary>
        <Icon size={15} />
        <span>
          {item.kind === 'reasoning'
            ? t('思考过程')
            : item.kind === 'plan'
              ? t('执行计划')
              : item.text.split('\n')[0] || t('工具执行')}
        </span>
        {item.status === 'inProgress' ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <Check size={13} />
        )}
      </summary>
      <pre>
        {item.kind === 'command' &&
          [
            item.cwd ? `${t('工作目录')}: ${item.cwd}` : null,
            item.exitCode != null ? `${t('退出码')}: ${item.exitCode}` : null,
            item.durationMs != null
              ? `${t('耗时')}: ${(item.durationMs / 1000).toFixed(2)} s`
              : null,
          ]
            .filter((line) => line !== null)
            .map((line) => `${line}\n`)
            .join('')}
        {item.kind === 'reasoning' || item.kind === 'plan' ? item.text : item.detail || item.text}
      </pre>
    </details>
  );
}

const MemoItem = memo(Item);

export function Conversation({
  state,
  loading,
  projectRoot,
  initialPosition,
  onPosition,
  jumpTarget,
}: {
  state: ConversationState;
  loading: boolean;
  projectRoot?: string;
  initialPosition?: number;
  onPosition: (top: number) => void;
  jumpTarget?: string;
}) {
  const { t } = useAppearance();
  const viewport = useRef<HTMLDivElement>(null);
  const follows = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const virtual = state.items.length > 80;
  const rows = useVirtualizer({
    count: virtual ? state.items.length : 0,
    getScrollElement: () => viewport.current,
    estimateSize: () => 180,
    getItemKey: (index) => state.items[index].id,
    overscan: 5,
    initialOffset: initialPosition ?? 0,
  });
  const restored = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!restored.current && state.items.length && viewport.current) {
      restored.current = true;
      if (initialPosition !== undefined) {
        viewport.current.scrollTop = initialPosition;
        follows.current =
          viewport.current.scrollHeight - initialPosition - viewport.current.clientHeight < 100;
        return;
      }
    }
    if (follows.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [state.items, state.busy, loading]);
  useEffect(() => {
    if (!jumpTarget || loading || !viewport.current) return;
    const index = state.items.findIndex((item) => item.id === jumpTarget);
    if (index < 0) return;
    follows.current = false;
    if (virtual) rows.scrollToIndex(index, { align: 'center' });
    else
      viewport.current
        .querySelector(`[data-item-index="${index}"]`)
        ?.scrollIntoView({ block: 'center' });
  }, [jumpTarget, loading, state.items]);
  return (
    <div
      className="conversation-scroll"
      ref={viewport}
      onScroll={() => {
        const el = viewport.current;
        if (el) {
          follows.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          setAtEnd(follows.current);
          if (restored.current) onPosition(el.scrollTop);
        }
      }}
    >
      <div className="conversation-content">
        {loading && (
          <div className="inline-status" role="status" aria-live="polite">
            <LoaderCircle size={16} className="spin" />
            {t('正在恢复任务历史…')}
          </div>
        )}
        {virtual ? (
          <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
            {rows.getVirtualItems().map((row) => (
              <div
                key={row.key}
                data-index={row.index}
                data-item-index={row.index}
                ref={rows.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <MemoItem item={state.items[row.index]} projectRoot={projectRoot} />
              </div>
            ))}
          </div>
        ) : (
          state.items.map((item, index) => (
            <div
              key={item.id}
              data-item-index={index}
              className={jumpTarget === item.id ? 'search-target' : undefined}
            >
              <MemoItem item={item} projectRoot={projectRoot} />
            </div>
          ))
        )}
        {!atEnd && (
          <button
            className="jump-latest"
            onClick={() => {
              follows.current = true;
              if (virtual) rows.scrollToIndex(state.items.length - 1, { align: 'end' });
              else if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
              setAtEnd(true);
            }}
          >
            {t('回到最新消息')}
          </button>
        )}
        {state.busy && (
          <div
            className="working-indicator"
            role="status"
            aria-live="polite"
            aria-label={t('FluxCode 正在处理')}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span className="working-text">{t('FluxCode 正在处理')}</span>
          </div>
        )}
        {state.error && (
          <div className="inline-error" role="alert" aria-live="assertive">
            <ErrorNotice message={state.error} />
          </div>
        )}
        {!loading && !state.busy && !state.items.length && (
          <div className="inline-status" role="status" aria-live="polite">
            {t('任务已创建，发送消息开始。')}
          </div>
        )}
      </div>
    </div>
  );
}
