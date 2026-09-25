import React, { useCallback, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppearanceProvider, useAppearance } from './application/AppearanceProvider';
import { defaultAppearance, parseAppearance, resolveLanguage } from './domain/appearance';
import { errorMessage } from './domain/errors';
import { backups, applyUiState } from './infrastructure/backup';
import { isTauri } from '@tauri-apps/api/core';
import { ErrorNotice } from './components/ErrorNotice';
import { initializeUiStateMirror, recoverPreviousUiState } from './infrastructure/uiStateMirror';
import './styles.css';
import './controls.css';
import { isWorkspaceWindow } from './infrastructure/workspaceWindows';
import { WorkspaceWindow } from './components/WorkspaceWindow';

function startupLanguage() {
  try {
    const saved = localStorage.getItem('fluxcode.appearance.v1');
    const preference = saved ? parseAppearance(JSON.parse(saved)) : defaultAppearance;
    return resolveLanguage(preference.language, navigator.languages);
  } catch {
    return 'zh-CN';
  }
}

function FatalFallback({
  restoring,
  initialError = '',
  canRecoverMirror = false,
}: {
  restoring: boolean;
  initialError?: string;
  canRecoverMirror?: boolean;
}) {
  const english = startupLanguage() === 'en';
  const [error, setError] = useState(initialError);
  const [recovering, setRecovering] = useState(false);
  return (
    <div className="restore-startup" role="alert">
      <div className="restore-startup-content">
        <h1>{english ? 'The workspace could not open' : '工作空间未能打开'}</h1>
        <p>
          {restoring
            ? english
              ? 'Restart FluxCode to reopen local workspace data.'
              : '重新启动 FluxCode 以重新打开本地工作空间数据。'
            : english
              ? 'Your task history remains on this device.'
              : '任务历史仍保存在本机。'}
        </p>
        {error && <p role="alert">{errorMessage(error, english ? 'en' : 'zh-CN')}</p>}
        <div className="restore-startup-actions">
          {canRecoverMirror && (
            <button
              type="button"
              disabled={recovering}
              onClick={() => {
                setRecovering(true);
                void recoverPreviousUiState()
                  .then(() => window.location.reload())
                  .catch((cause) => {
                    setError(String(cause));
                    setRecovering(false);
                  });
              }}
            >
              {english ? 'Restore previous workspace index' : '恢复上一份工作空间索引'}
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (!restoring) {
                window.location.reload();
                return;
              }
              void backups.restartUnconfirmed().catch((cause) => setError(String(cause)));
            }}
          >
            {english ? 'Restart FluxCode' : '重新启动 FluxCode'}
          </button>
          {restoring && (
            <button type="button" onClick={() => window.location.reload()}>
              {english ? 'Reload interface' : '重新加载界面'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; restoring: boolean },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <FatalFallback restoring={this.props.restoring} />;
    return this.props.children;
  }
}

type RestorePhase = 'loading' | 'confirming' | 'ready' | 'failed' | 'restarting';

function RecoveryGate() {
  const { t } = useAppearance();
  const [phase, setPhase] = useState<RestorePhase>('loading');
  const [error, setError] = useState('');
  const [startupFailed, setStartupFailed] = useState(false);
  const phaseRef = useRef<RestorePhase>('loading');
  const confirm = useCallback(() => {
    if (phaseRef.current !== 'loading') return;
    phaseRef.current = 'confirming';
    setPhase('confirming');
    void backups
      .finishUiRestore()
      .then(() => {
        phaseRef.current = 'ready';
        setPhase('ready');
      })
      .catch((cause) => {
        phaseRef.current = 'failed';
        setStartupFailed(false);
        setError(String(cause));
        setPhase('failed');
      });
  }, []);
  const failStartup = useCallback((message: string) => {
    if (phaseRef.current !== 'loading') return;
    phaseRef.current = 'failed';
    setStartupFailed(true);
    setError(message);
    setPhase('failed');
  }, []);

  return (
    <div className="restore-shell">
      <div className="restore-content" inert={phase !== 'ready'} aria-hidden={phase !== 'ready'}>
        <App onStartupReady={confirm} onStartupFailure={failStartup} />
      </div>
      {phase !== 'ready' && (
        <div className="restore-startup" role={phase === 'failed' ? 'alert' : 'status'}>
          <div className="restore-startup-content">
            <h1>
              {t(
                phase === 'failed'
                  ? '恢复尚未确认'
                  : phase === 'restarting'
                    ? '正在重新启动…'
                    : '正在载入恢复的数据…',
              )}
            </h1>
            {phase === 'failed' ? (
              <>
                <p>{t('恢复确认未完成。请重试，或重新启动应用继续处理。')}</p>
                <p role="alert">
                  <ErrorNotice message={error} />
                </p>
                <div className="restore-startup-actions">
                  {!startupFailed && (
                    <button
                      type="button"
                      onClick={() => {
                        phaseRef.current = 'loading';
                        confirm();
                      }}
                    >
                      {t('重试确认')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      phaseRef.current = 'restarting';
                      setPhase('restarting');
                      void backups.restartUnconfirmed().catch((cause) => {
                        phaseRef.current = 'failed';
                        setError(String(cause));
                        setPhase('failed');
                      });
                    }}
                  >
                    {t('重新启动 FluxCode')}
                  </button>
                </div>
              </>
            ) : (
              <p>{t('正在检查本地工作空间，请稍候。')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function start() {
  let restoring = false;
  if (isTauri()) {
    const restored = isWorkspaceWindow ? null : await backups.restoredUi();
    if (restored) {
      applyUiState(restored);
      await initializeUiStateMirror(restored);
      restoring = true;
    } else await initializeUiStateMirror();
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary restoring={restoring}>
        <AppearanceProvider>
          {isWorkspaceWindow ? <WorkspaceWindow /> : restoring ? <RecoveryGate /> : <App />}
        </AppearanceProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
void start().catch((cause) => {
  const root = document.getElementById('root');
  if (root)
    ReactDOM.createRoot(root).render(
      <FatalFallback
        restoring={isTauri()}
        initialError={String(cause)}
        canRecoverMirror={isTauri() && String(cause).includes('本地界面索引')}
      />,
    );
});
