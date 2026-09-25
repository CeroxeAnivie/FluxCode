import { useReducer, useRef } from 'react';
import { bridge } from '../infrastructure/bridge';
import { useAppearance } from '../application/AppearanceProvider';

export function PanelResizeHandle({
  panel,
  report,
}: {
  panel: 'sidebar' | 'inspector';
  report: (error: string) => void;
}) {
  const { t } = useAppearance();
  const [, render] = useReducer((value) => value + 1, 0);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const pending = useRef<number | null>(null);
  const variable = `--${panel}-width`;
  const min = panel === 'sidebar' ? 190 : 230;
  const max = panel === 'sidebar' ? 360 : 600;
  const width = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable)) ||
    (panel === 'sidebar' ? 246 : 294);
  function apply(next: number) {
    const available = Math.max(min, window.innerWidth - 600);
    const value = Math.round(Math.max(min, Math.min(max, available, next)));
    document.documentElement.style.setProperty(variable, `${value}px`);
    pending.current = value;
    render();
  }
  function save() {
    const next = pending.current;
    pending.current = null;
    if (next !== null) void bridge.savePanelWidth(panel, next).catch((e) => report(String(e)));
  }
  return (
    <div
      className="panel-resize"
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      aria-label={t(panel === 'sidebar' ? '调整侧边栏宽度' : '调整文件面板宽度')}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width()}
      onDoubleClick={() => {
        apply(panel === 'sidebar' ? 246 : 294);
        save();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, width: width() };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (drag.current)
          apply(
            drag.current.width + (event.clientX - drag.current.x) * (panel === 'sidebar' ? 1 : -1),
          );
      }}
      onPointerUp={(event) => {
        if (drag.current) {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          save();
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        save();
      }}
      onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          apply(
            event.key === 'Home'
              ? min
              : event.key === 'End'
                ? max
                : width() +
                  (event.key === 'ArrowRight' ? 16 : -16) * (panel === 'sidebar' ? 1 : -1),
          );
          save();
        }
      }}
    />
  );
}
