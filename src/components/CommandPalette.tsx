import { Command } from 'cmdk';
import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useAppearance } from '../application/AppearanceProvider';
import type { Task } from '../domain/types';
import { useModalDialog } from './useModalDialog';

export function CommandPalette({
  actions,
  tasks,
  onTask,
  onClose,
}: {
  actions: { id: string; label: string; shortcut?: string; run: () => void; disabled?: boolean }[];
  tasks: Task[];
  onTask: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useModalDialog(true, input);
  function execute(run: () => void) {
    onClose();
    run();
  }
  return (
    <dialog ref={dialog} className="command-dialog" aria-label={t('命令面板')} onCancel={onClose}>
      <Command label={t('搜索命令或任务')} loop>
        <div className="command-search">
          <Search size={18} />
          <Command.Input
            ref={input}
            placeholder={t('搜索命令或任务')}
            aria-label={t('搜索命令或任务')}
          />
          <button className="icon-button" aria-label={t('关闭')} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <Command.List aria-label={t('命令面板')}>
          <Command.Empty>{t('没有匹配结果')}</Command.Empty>
          <Command.Group heading={t('常用操作')}>
            {actions.map((action) => (
              <Command.Item
                key={action.id}
                value={`${action.id} ${action.label}`}
                disabled={action.disabled}
                onSelect={() => execute(action.run)}
              >
                <span>{action.label}</span>
                <kbd>{action.shortcut}</kbd>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading={t('最近任务')}>
            {tasks
              .filter((task) => !task.archived)
              .toSorted((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 100)
              .map((task) => (
                <Command.Item
                  key={task.id}
                  value={`${task.id} ${task.title}`}
                  onSelect={() => execute(() => onTask(task.id))}
                >
                  {task.title}
                </Command.Item>
              ))}
          </Command.Group>
        </Command.List>
      </Command>
    </dialog>
  );
}
