/**
 * Theme control (DESIGN_SPEC §11/§14): dark default; a toggle stamps `data-theme`
 * on `:root` and persists the choice. Initial value is set pre-paint in index.html.
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'oncall-theme';

export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable; the attribute is still applied */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
