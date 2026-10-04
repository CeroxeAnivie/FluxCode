import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

const DURATION = 180;

/** Retain outgoing content only for the short CSS transition. No frame-by-frame
 * React updates, snapshots, blur animation or persistent compositor layers. */
export function MotionPanel({
  open,
  size,
  axis = 'x',
  keepMounted = false,
  children,
}: {
  open: boolean;
  size?: string;
  axis?: 'x' | 'y';
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [present, setPresent] = useState(open || keepMounted);
  const [expanded, setExpanded] = useState(open);
  const [moving, setMoving] = useState(false);
  const content = useRef(children);
  useLayoutEffect(() => {
    if (open || keepMounted) content.current = children;
  }, [children, open, keepMounted]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    let frame = 0;
    let nextFrame = 0;
    setMoving(!reduced);
    if (open) {
      setPresent(true);
      if (reduced) setExpanded(true);
      else
        frame = requestAnimationFrame(() => {
          nextFrame = requestAnimationFrame(() => setExpanded(true));
        });
    } else setExpanded(false);
    const timer = setTimeout(
      () => {
        setMoving(false);
        setPresent(open || keepMounted);
      },
      reduced ? 0 : DURATION + 40,
    );
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      clearTimeout(timer);
    };
  }, [open, keepMounted, reduced]);
  if (!present) return null;
  return (
    <div
      className={`motion-panel motion-panel-${axis}`}
      data-expanded={expanded}
      data-moving={moving}
      hidden={!open && !moving}
      inert={!open}
      aria-hidden={!open || undefined}
      style={{ '--motion-size': size, '--motion-duration': `${DURATION}ms` } as CSSProperties}
    >
      <div className="motion-panel-content">{open || keepMounted ? children : content.current}</div>
    </div>
  );
}
