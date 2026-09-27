import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAppearance } from '../application/AppearanceProvider';

type Setter<T> = Dispatch<SetStateAction<T>>;
export function ChannelModelList({
  models,
  labels,
  hiddenModels,
  setModels,
  setLabels,
  setHiddenModels,
  busy,
}: {
  models: string[];
  labels: Record<string, string>;
  hiddenModels: string[];
  setModels: Setter<string[]>;
  setLabels: Setter<Record<string, string>>;
  setHiddenModels: Setter<string[]>;
  busy: boolean;
}) {
  const { t } = useAppearance();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const search = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const visibleModels = models.filter((model) => !hiddenModels.includes(model));
  const [editing, setEditing] = useState<string | null>(null);
  const filtered = visibleModels.filter(
    (model) =>
      model === editing ||
      `${model} ${labels[model] ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  const virtualized = filtered.length > 12;
  const virtual = useVirtualizer({
    enabled: virtualized,
    count: filtered.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 64,
    getItemKey: (index) => filtered[index],
    overscan: 6,
  });
  useEffect(() => {
    virtual.scrollToOffset(0);
  }, [query]);
  return (
    <>
      {!!(visibleModels.length || hiddenModels.length) && (
        <label className="model-search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">{t('搜索模型')}</span>
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('按模型名称筛选')}
          />
        </label>
      )}
      {!!visibleModels.length && (
        <div className="channel-model-toolbar">
          <button
            type="button"
            disabled={busy || !filtered.length}
            onClick={() => setSelected((current) => new Set([...current, ...filtered]))}
          >
            {t(query ? '选择搜索结果' : '全选')}
          </button>
          {!!selected.size && (
            <>
              <span>
                {t('已选择')} {selected.size}
              </span>
              <button type="button" disabled={busy} onClick={() => setSelected(new Set())}>
                {t('取消选择')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setHiddenModels((current) => [...new Set([...current, ...selected])]);
                  setSelected(new Set());
                  search.current?.focus();
                }}
              >
                {t('移除所选模型')}
              </button>
            </>
          )}
          {!!query && (
            <button type="button" onClick={() => setQuery('')}>
              {t('清除搜索')}
            </button>
          )}
        </div>
      )}
      <div
        ref={viewport}
        className={`channel-model-list${virtualized ? ' virtualized' : ''}`}
        hidden={!visibleModels.length}
        role="list"
        aria-label={t('服务模型')}
      >
        <div
          style={virtualized ? { height: virtual.getTotalSize(), position: 'relative' } : undefined}
        >
          {(virtualized
            ? virtual.getVirtualItems()
            : filtered.map((_, index) => ({ index, start: 0, size: 64 }))
          ).map((row) => (
            <div
              role="listitem"
              className="channel-model-row"
              key={filtered[row.index]}
              style={
                virtualized
                  ? {
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${row.start}px)`,
                      height: row.size,
                      width: '100%',
                    }
                  : undefined
              }
              title={labels[filtered[row.index]] || filtered[row.index]}
            >
              <input
                type="checkbox"
                className="model-row-checkbox"
                aria-label={`${t('选择模型')} ${filtered[row.index]}`}
                checked={selected.has(filtered[row.index])}
                disabled={busy}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(filtered[row.index]);
                    else next.delete(filtered[row.index]);
                    return next;
                  })
                }
              />
              <div className="model-row-identity">
                <input
                  aria-label={`${t('模型显示名')} ${filtered[row.index]}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  value={labels[filtered[row.index]] ?? ''}
                  maxLength={120}
                  disabled={busy}
                  placeholder={filtered[row.index]}
                  title={t('点击名称修改显示名')}
                  onFocus={() => setEditing(filtered[row.index])}
                  onBlur={() => setEditing(null)}
                  onChange={(event) =>
                    setLabels((current) => ({
                      ...current,
                      [filtered[row.index]]: event.target.value,
                    }))
                  }
                />
                {labels[filtered[row.index]]?.trim() &&
                  labels[filtered[row.index]].trim() !== filtered[row.index] && (
                    <code title={filtered[row.index]}>{filtered[row.index]}</code>
                  )}
              </div>
              <button
                type="button"
                className="model-remove-button"
                title={t('移除模型')}
                aria-label={`${t('移除模型')} ${filtered[row.index]}`}
                disabled={busy}
                onClick={() => {
                  const id = filtered[row.index];
                  search.current?.focus();
                  setHiddenModels((current) => [...new Set([...current, id])]);
                  setSelected((current) => {
                    const next = new Set(current);
                    next.delete(id);
                    return next;
                  });
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        {!filtered.length && (
          <p>{t(visibleModels.length ? '没有匹配模型' : '获取模型列表，或手动添加模型。')}</p>
        )}
      </div>
      {!visibleModels.length && (
        <p className="field-help" role="status">
          {t(
            hiddenModels.length
              ? '请至少保留一个模型，或手动添加模型。'
              : '获取模型列表，或手动添加模型。',
          )}
        </p>
      )}
      {!!hiddenModels.length && (
        <div className="channel-hidden-models">
          <span>
            {t('已移除模型')}：{hiddenModels.length}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setModels((current) => [...new Set([...current, ...hiddenModels])]);
              setHiddenModels([]);
              search.current?.focus();
            }}
          >
            {t('全部撤销移除')}
          </button>
        </div>
      )}
      {!!hiddenModels.length && (
        <details>
          <summary>{t('管理已移除模型')}</summary>
          <div className="removed-model-list">
            {hiddenModels
              .filter((id) =>
                `${id} ${labels[id] ?? ''}`.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 50)
              .map((id) => (
                <div key={id}>
                  <span title={id}>{labels[id] || id}</span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`${t('恢复模型')} ${id}`}
                    onClick={() => {
                      search.current?.focus();
                      setModels((current) => [...new Set([...current, id])]);
                      setHiddenModels((current) => current.filter((value) => value !== id));
                    }}
                  >
                    {t('恢复')}
                  </button>
                </div>
              ))}
            {hiddenModels.length > 50 && <p>{t('输入模型名称筛选，或一次恢复全部。')}</p>}
          </div>
        </details>
      )}
    </>
  );
}
