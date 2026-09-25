export type LanguagePreference = 'system' | 'zh-CN' | 'en';
export type ThemePreference = 'system' | 'light' | 'dark';
export interface Appearance {
  language: LanguagePreference;
  theme: ThemePreference;
}
export const defaultAppearance: Appearance = { language: 'zh-CN', theme: 'system' };
export function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') throw new Error('Invalid appearance preferences');
  const p = value as Appearance;
  if (
    !['system', 'zh-CN', 'en'].includes(p.language) ||
    !['system', 'light', 'dark'].includes(p.theme)
  )
    throw new Error('Invalid appearance preferences');
  return { language: p.language, theme: p.theme };
}
export const resolveLanguage = (preference: LanguagePreference, languages: readonly string[]) =>
  preference === 'system'
    ? languages[0]?.toLowerCase().startsWith('zh')
      ? 'zh-CN'
      : 'en'
    : preference;
