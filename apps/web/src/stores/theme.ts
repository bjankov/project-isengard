import { create } from 'zustand';
import { readPreference, writePreference } from '@/hooks/use-preference';

/**
 * Light / dark / system theme, remembered per browser (a viewing preference, not library
 * data). The resolved theme is the `dark` class on <html>; `index.html` applies it before the
 * first paint with the same key, so there is no flash of the wrong theme.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'app.theme';

const media = (): MediaQueryList | undefined =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined;

function readStored(): ThemePreference {
  const v = readPreference(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  return media()?.matches ? 'dark' : 'light';
}

function apply(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const preference = readStored();
  const resolved = resolve(preference);
  apply(resolved);
  media()?.addEventListener('change', () => {
    const next = resolve(get().preference);
    apply(next);
    set({ resolved: next });
  });
  return {
    preference,
    resolved,
    setPreference: (p) => {
      writePreference(THEME_KEY, p);
      const next = resolve(p);
      apply(next);
      set({ preference: p, resolved: next });
    },
  };
});
