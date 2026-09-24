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
import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  return (
    <div className="welcome">
      <div className="welcome-symbol">
        <span>F</span>
        <i />
      </div>
      <p className="welcome-eyebrow">LET’S BUILD SOMETHING</p>
      <h1>让想法，在代码中发生。</h1>
      <p className="welcome-subtitle">
        {project ? (
          <>
            与 FluxCode 一起，在 <strong>{project}</strong> 中开始下一次构建。
          </>
        ) : (
          '打开一个项目，让 FluxCode 帮你理解、构建与改进代码。'
        )}
      </p>
      <div className="suggestion-grid">
        {suggestions.map(({ icon: Icon, title, description, prompt }) => (
          <button className="suggestion-card" key={title} onClick={() => onSuggestion(prompt)}>
            <div>
              <Icon size={18} />
              <ArrowUpRight size={14} />
            </div>
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <div className="welcome-hint">
        <span />
        本地工作空间
        <span />
        流式协作
        <span />
        由你掌控
      </div>
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  if (item.kind === 'user')
    return (
      <article className="message user-message">
        <div className="message-label">
          <span className="mini-avatar">你</span>
          <strong>你</strong>
        </div>
        <div className="user-text">{item.text}</div>
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children }) => <span className="rendered-link">{children}</span>,
              img: ({ alt }) => <span>[图片：{alt}]</span>,
            }}
          >
            {item.text}
          </ReactMarkdown>
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
            ? '思考过程'
            : item.kind === 'plan'
              ? '执行计划'
              : item.text.split('\n')[0] || '工具执行'}
        </span>
        {item.status === 'inProgress' ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <Check size={13} />
        )}
      </summary>
      <pre>
        {item.kind === 'command' && item.cwd
          ? `工作目录：${item.cwd}\n${item.exitCode !== null && item.exitCode !== undefined ? `退出码：${item.exitCode}  ` : ''}${item.durationMs !== null && item.durationMs !== undefined ? `耗时：${(item.durationMs / 1000).toFixed(2)}s` : ''}\n\n`
          : ''}
        {item.kind === 'reasoning' || item.kind === 'plan' ? item.text : item.detail || item.text}
      </pre>
    </details>
  );
}

export function Conversation({ state, loading }: { state: ConversationState; loading: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const follows = useRef(true);
  useEffect(() => {
    if (follows.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [state.items, state.busy]);
  return (
    <div
      className="conversation-scroll"
      ref={viewport}
      onScroll={() => {
        const el = viewport.current;
        if (el) follows.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      }}
    >
      <div className="conversation-content">
        {loading && (
          <div className="inline-status">
            <LoaderCircle size={16} className="spin" />
            正在恢复任务历史…
          </div>
        )}
        {state.items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        {state.busy && (
          <div className="working-indicator">
            <span />
            <span />
            <span />
            <span className="working-text">FluxCode 正在处理</span>
          </div>
        )}
        {state.error && (
          <div className="inline-error" role="alert">
            {state.error}
          </div>
        )}
        {!loading && !state.busy && !state.items.length && (
          <div className="inline-status">任务已创建，发送消息开始。</div>
        )}
      </div>
    </div>
  );
}
