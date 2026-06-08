import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

function getOsDark(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyClass(isDark: boolean): void {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  root.classList.add(isDark ? 'theme-dark' : 'theme-light');
}

export function useThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('ts-theme');
    return (stored === 'light' || stored === 'dark') ? stored : 'system';
  });

  const [osDark, setOsDark] = useState(getOsDark);

  // Listen for OS theme changes.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && osDark);

  // Apply the class and persist whenever mode or OS preference changes.
  useEffect(() => {
    applyClass(isDark);
    if (mode === 'system') {
      localStorage.removeItem('ts-theme');
    } else {
      localStorage.setItem('ts-theme', mode);
    }
  }, [mode, isDark]);

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      if (prev === 'system') return osDark ? 'light' : 'dark';
      return prev === 'dark' ? 'light' : 'dark';
    });
  }, [osDark]);

  return { isDark, mode, toggleTheme };
}
