import { AgentStatus } from './AgentStatus';
import { agentOperationLabels } from '../domain/subagents';
import { ChatImage } from './ChatImage';
import { WorkingIndicator } from './WorkingIndicator';
import { BrandMark } from './BrandMark';
import { ErrorNotice } from './ErrorNotice';
import { useAppearance } from '../application/AppearanceProvider';
import {
  Check,
  CircleAlert,
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

export function Welcome({ onSuggestion }: { onSuggestion: (prompt: string) => void }) {
  const { t } = useAppearance();
  return (
    <div className="welcome welcome-compact">
      <div className="welcome-symbol">
        <BrandMark />
      </div>
      <h1>{t('开始一个新任务')}</h1>
      <p className="welcome-subtitle">{t('描述你想完成的事情，或选择一个起点。')}</p>
      <div className="suggestion-grid">
        {suggestions.map(({ icon: Icon, title, description, prompt }) => (
          <button
            className="suggestion-card"
            key={title}
            title={t(description)}
            onClick={() => onSuggestion(t(prompt))}
          >
            <Icon size={16} />
            <span>{t(title)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ItemBody({
  item,
  projectRoot,
  onOpenAgent,
  assistantName,
}: {
  item: ChatItem;
  projectRoot?: string;
  onOpenAgent?: (id: string) => void;
  assistantName?: string;
}) {
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
  if (item.kind === 'agent')
    return (
      <details className="tool-card agent-card" open={item.status === 'failed'}>
        <summary>
          <Sparkles size={15} />
          <span>{t(agentOperationLabels[item.agentOperation ?? ''] ?? '协作代理')}</span>
          {item.status === 'inProgress' && <LoaderCircle size={13} className="spin" />}
          <span className="agent-count">{item.agents?.length || ''}</span>
        </summary>
        <div className="tool-card-content">
          {item.text && <p>{item.text}</p>}
          {item.status === 'failed' && (
            <div role="alert">
              <ErrorNotice
                message={
                  item.failure || '子智能体操作失败，服务未提供具体原因。请查看子智能体详情。'
                }
              />
            </div>
          )}
          {item.agents?.map((agent, index) => (
            <div className="agent-card-row" key={agent.threadId}>
              {onOpenAgent ? (
                <button className="agent-open" onClick={() => onOpenAgent(agent.threadId)}>
                  <span>{agent.name || `${t('子智能体')} ${index + 1}`}</span>
                  <span>{t('查看运行内容')}</span>
                </button>
              ) : (
                <span>{agent.name || `${t('子智能体')} ${index + 1}`}</span>
              )}
              <AgentStatus status={agent.status} />
              {agent.message && <p>{agent.message}</p>}
            </div>
          ))}
        </div>
      </details>
    );
  if (item.steps)
    return (
      <details className="tool-card" open={item.kind === 'plan'}>
        <summary>{t('执行计划')}</summary>
        <div className="tool-card-content">
          {item.text && <p>{item.text}</p>}
          <ol>
            {item.steps.map((step, index) => (
              <li key={index}>
                <span>
                  {t(
                    (
                      { pending: '待处理', inProgress: '进行中', completed: '已完成' } as Record<
                        string,
                        string
                      >
                    )[step.status] ?? '等待状态',
                  )}
                </span>{' '}
                · {step.text}
              </li>
            ))}
          </ol>
        </div>
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
  if (item.kind === 'assistant' && !item.text && !item.images?.length) return null;
  if (item.kind === 'assistant')
    return (
      <article className="message assistant-message">
        <div className="message-label">
          <span className="mini-avatar flux">
            <BrandMark />
          </span>
          <strong>{item.identity?.model ?? assistantName ?? t('模型未记录')}</strong>
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
    <details
      className={`tool-card ${item.kind}`}
      open={item.status === 'failed' || (item.kind === 'command' && !!item.exitCode)}
    >
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
        ) : item.status === 'failed' || (item.kind === 'command' && !!item.exitCode) ? (
          <CircleAlert size={13} aria-label={t('失败')} />
        ) : (
          <Check size={13} />
        )}
      </summary>
      {(item.status === 'failed' || (item.kind === 'command' && !!item.exitCode)) &&
        !(item.kind === 'command' && item.detail && !item.failure) && (
          <div className="tool-card-content" role="alert">
            <ErrorNotice
              message={
                item.failure ||
                (item.kind === 'tool' ? item.detail : '') ||
                '工具执行失败，但未返回具体原因。请查看运行记录。'
              }
            />
          </div>
        )}
      {item.kind === 'reasoning' || item.kind === 'plan' ? (
        <div className="tool-card-content markdown">
          <Suspense fallback={<p>{item.text}</p>}>
            <MarkdownContent text={item.text} projectRoot={projectRoot} />
          </Suspense>
        </div>
      ) : item.kind === 'tool' && item.status === 'failed' ? null : (
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
          {item.detail || item.text}
        </pre>
      )}
    </details>
  );
}

function Item(props: Parameters<typeof ItemBody>[0]) {
  return (
    <>
      <ItemBody {...props} />
      {!!props.item.images?.length && (
        <div className="message-images">
          {props.item.images.map((image, index) => (
            <ChatImage key={index + ':' + image.source.slice(0, 100)} {...image} />
          ))}
        </div>
      )}
    </>
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
  onOpenAgent,
  assistantName,
}: {
  onOpenAgent?: (id: string) => void;
  assistantName?: string;
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
                <MemoItem
                  item={state.items[row.index]}
                  projectRoot={projectRoot}
                  onOpenAgent={onOpenAgent}
                  assistantName={assistantName}
                />
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
              <MemoItem
                item={item}
                projectRoot={projectRoot}
                onOpenAgent={onOpenAgent}
                assistantName={assistantName}
              />
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
          <WorkingIndicator
            key={state.turnId ?? 'working'}
            name={state.activeIdentity?.model ?? assistantName}
          />
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
