import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { configuration } from '../infrastructure/configuration';
import {
  defaultAppearance,
  parseAppearance,
  resolveLanguage,
  type Appearance,
} from '../domain/appearance';
import { english } from '../locales/en';
import { observeSystemTheme } from '../infrastructure/systemTheme';

const Context = createContext({
  preference: defaultAppearance,
  language: 'en',
  theme: 'dark',
  update: async (_next: Appearance): Promise<void> => {},
  saving: false,
  loadError: '',
  t: (text: string) => text,
});
export const useAppearance = () => useContext(Context);
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(!configuration.native);
  const [loadError, setLoadError] = useState('');
  const writeLock = useRef(false);
  const revision = useRef(0);
  const [preference, setPreference] = useState(() => {
    try {
      const saved = localStorage.getItem('fluxcode.appearance.v1');
      if (!saved) return defaultAppearance;
      return parseAppearance(JSON.parse(saved));
    } catch {
      return defaultAppearance;
    }
  });
  const [languages, setLanguages] = useState(navigator.languages);
  useEffect(() => {
    if (!configuration.native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const apply = (snapshot: Awaited<ReturnType<typeof configuration.load>>) => {
      if (disposed || snapshot.revision < revision.current) return;
      revision.current = snapshot.revision;
      setPreference(parseAppearance(snapshot.appearance));
      setLoadError('');
    };
    void (async () => {
      unlisten = await configuration.subscribe(apply);
      if (disposed) {
        unlisten();
        return;
      }
      let snapshot = await configuration.load();
      if (!snapshot.appearanceConfigured && !snapshot.error) {
        snapshot = await configuration.saveAppearance(preference, true);
      }
      apply(snapshot);
    })()
      .catch(() => {
        if (!disposed) setLoadError('外观设置未能载入，请检查配置文件。');
      })
      .finally(() => {
        if (!disposed) setReady(true);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const [dark, setDark] = useState(
    () => configuration.native || matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [themeReady, setThemeReady] = useState(!configuration.native);
  const language = resolveLanguage(preference.language, languages);
  const theme = preference.theme === 'system' ? (dark ? 'dark' : 'light') : preference.theme;
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void observeSystemTheme(
      (value) => {
        if (!disposed) {
          setDark(value);
          setThemeReady(true);
        }
      },
      () => {
        if (!disposed) {
          setLoadError('系统主题读取失败，请重新打开窗口或手动选择主题。');
          setThemeReady(true);
        }
      },
    )
      .then((off) => {
        if (disposed) off();
        else stop = off;
      })
      .catch(() => {
        if (!disposed) {
          setLoadError('系统主题读取失败，请重新打开窗口或手动选择主题。');
          setThemeReady(true);
        }
      });
    const localeChanged = () => setLanguages([...navigator.languages]);
    window.addEventListener('languagechange', localeChanged);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener('languagechange', localeChanged);
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
  }, [theme, language]);
  async function update(next: Appearance) {
    if (writeLock.current) return;
    const checked = parseAppearance(next);
    writeLock.current = true;
    setSaving(true);
    try {
      if (configuration.native) {
        const snapshot = await configuration.saveAppearance(checked);
        revision.current = snapshot.revision;
      } else {
        localStorage.setItem('fluxcode.appearance.v1', JSON.stringify(checked));
      }
      setPreference(checked);
      setLoadError('');
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  }
  const t = useCallback(
    (text: string) => (language === 'en' ? (english[text] ?? text) : text),
    [language],
  );
  if (!ready || (!themeReady && preference.theme === 'system'))
    return <div className="startup-surface" aria-busy="true" />;
  return (
    <Context.Provider value={{ preference, language, theme, update, saving, loadError, t }}>
      {children}
    </Context.Provider>
  );
}
