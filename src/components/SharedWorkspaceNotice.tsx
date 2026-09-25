import { useAppearance } from '../application/AppearanceProvider';
import type { Task } from '../domain/types';

export function SharedWorkspaceNotice({
  tasks,
  onSelect,
  onInspect,
}: {
  tasks: Task[];
  onSelect: (id: string) => void;
  onInspect: () => void;
}) {
  const { t } = useAppearance();
  if (!tasks.length) return null;
  return (
    <aside className="shared-workspace-notice" aria-label={t('共享文件提醒')}>
      <p>
        {t(
          '其他任务正在使用此目录，同时修改文件可能互相覆盖。需要隔离时，可在 Git 面板创建独立工作树。',
        )}
      </p>
      <div>
        {tasks.slice(0, 3).map((task) => (
          <button key={task.id} onClick={() => onSelect(task.id)} title={task.title}>
            {t('查看任务')} · {task.title}
          </button>
        ))}
        <button onClick={onInspect}>{t('打开项目面板')}</button>
      </div>
    </aside>
  );
}
