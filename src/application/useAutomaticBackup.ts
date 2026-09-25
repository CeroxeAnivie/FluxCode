import { useEffect, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { backups } from '../infrastructure/backup';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const START_DELAY_MS = 30 * 1000;

export function useAutomaticBackup(idle: boolean, report: (message: string) => void) {
  const idleRef = useRef(idle);
  const reportRef = useRef(report);
  idleRef.current = idle;
  reportRef.current = report;
  useEffect(() => {
    if (!isTauri()) return;
    let running = false;
    async function check() {
      if (!idleRef.current || running) return;
      running = true;
      try {
        await backups.create(true);
      } catch (cause) {
        const message = String(cause);
        if (!message.includes('任务或终端正在运行')) {
          reportRef.current(`自动备份失败：${message}`);
        }
      } finally {
        running = false;
      }
    }
    const first = window.setTimeout(() => void check(), START_DELAY_MS);
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);
}
