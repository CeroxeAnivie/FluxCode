import type { LucideIcon } from 'lucide-react';
import {
  Cable,
  CalendarClock,
  Command,
  FolderKanban,
  Import,
  ListTodo,
  Search,
  Settings2,
  Shapes,
} from 'lucide-react';
import { useAppearance } from '../application/AppearanceProvider';

interface Props {
  projectsVisible: boolean;
  onProjects: () => void;
  onChannels: () => void;
  onSearch: () => void;
  onImport: () => void;
  onCommands: () => void;
  onSchedules: () => void;
  onActivity: () => void;
  onCapabilities: () => void;
  capabilitiesDisabled: boolean;
  onSettings: () => void;
}
function RailButton({
  icon: Icon,
  label,
  onClick,
  pressed,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="rail-button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
      <span className="rail-tooltip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
export function NavigationRail(props: Props) {
  const { t } = useAppearance();
  return (
    <nav className="navigation-rail" aria-label={t('主导航')}>
      <div className="rail-group">
        <RailButton
          icon={FolderKanban}
          label={t('项目与任务')}
          pressed={props.projectsVisible}
          onClick={props.onProjects}
        />
        <RailButton icon={Cable} label={t('渠道管理')} onClick={props.onChannels} />
        <RailButton icon={Search} label={t('搜索对话正文')} onClick={props.onSearch} />
        <RailButton icon={ListTodo} label={t('任务总览')} onClick={props.onActivity} />
        <RailButton icon={CalendarClock} label={t('定时任务')} onClick={props.onSchedules} />
        <RailButton
          icon={Shapes}
          label={t('模型与扩展')}
          disabled={props.capabilitiesDisabled}
          onClick={props.onCapabilities}
        />
      </div>
      <div className="rail-group rail-bottom">
        <RailButton icon={Import} label={t('导入对话')} onClick={props.onImport} />
        <RailButton icon={Command} label={t('命令面板')} onClick={props.onCommands} />
        <RailButton icon={Settings2} label={t('设置')} onClick={props.onSettings} />
      </div>
    </nav>
  );
}
