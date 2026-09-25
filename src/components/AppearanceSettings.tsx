import { Select } from './Select';
import { ErrorNotice } from './ErrorNotice';
import { useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import type { LanguagePreference, ThemePreference } from '../domain/appearance';

export function AppearanceSettings() {
  const { preference, update, saving, loadError, t } = useAppearance();
  const [error, setError] = useState('');
  const change = async (next: typeof preference) => {
    try {
      await update(next);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section className="appearance-settings">
      <label className="form-field">
        {t('语言')}
        <Select
          aria-label={t('语言')}
          disabled={saving}
          value={preference.language}
          onValueChange={(value) =>
            change({ ...preference, language: value as LanguagePreference })
          }
        >
          <option value="system">{t('跟随系统')}</option>
          <option value="zh-CN">{t('简体中文')}</option>
          <option value="en">{t('英文')}</option>
        </Select>
      </label>
      <label className="form-field">
        {t('主题')}
        <Select
          aria-label={t('主题')}
          disabled={saving}
          value={preference.theme}
          onValueChange={(value) => change({ ...preference, theme: value as ThemePreference })}
        >
          <option value="system">{t('跟随系统')}</option>
          <option value="light">{t('亮色')}</option>
          <option value="dark">{t('暗色')}</option>
        </Select>
      </label>
      {(error || loadError) && (
        <p role="alert">
          <ErrorNotice message={error || loadError} />
        </p>
      )}
    </section>
  );
}
