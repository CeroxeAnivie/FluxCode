import { useEffect, useRef, useState } from 'react';
import { emptySession, type WorkspaceSession } from '../domain/workspaceSession';
import { loadWorkspaceSession, saveWorkspaceSession } from '../infrastructure/workspaceSession';
import { guardWorkspaceNavigation } from '../infrastructure/navigationGuard';

/** Persists only workspace context, never model history or credentials. */
export function useWorkspaceContinuity(report: (message: string) => void) {
  const [initial] = useState(() => {
    try {
      return { value: loadWorkspaceSession(), error: null };
    } catch (e) {
      return { value: emptySession(), error: String(e) };
    }
  });
  const [session, setSession] = useState(initial.value);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    if (initial.error) report(initial.error);
  }, []);
  const latest = useRef(session);
  latest.current = session;
  const save = () => {
    if (initial.error) return false;
    try {
      saveWorkspaceSession(latest.current);
      setSaveFailed(false);
      return true;
    } catch (e) {
      setSaveFailed(true);
      report(`工作现场保存失败：${String(e)}`);
      return false;
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(save, 250);
    return () => clearTimeout(timer);
  }, [session]);
  useEffect(() => {
    const removeGuard = guardWorkspaceNavigation(save);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!save()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', save);
    return () => {
      removeGuard();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, []);
  const update = (patch: Partial<WorkspaceSession>) => setSession((s) => ({ ...s, ...patch }));
  return {
    initial: initial.value,
    loadError: initial.error,
    session,
    update,
    setSession,
    saveFailed,
    retry: save,
  };
}
