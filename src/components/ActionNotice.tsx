import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

/** A visible prerequisite with an immediate next step; never relies on color alone. */
export function ActionNotice({
  children,
  action,
  className = '',
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`action-notice ${className}`} role="status">
      <Info size={18} aria-hidden="true" />
      <div className="action-notice-content">{children}</div>
      {action && <div className="action-notice-actions">{action}</div>}
    </div>
  );
}
