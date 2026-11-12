import { api } from '../api';

export const ThemeService = {
  async getMatugenCss(): Promise<string | null> {
    try {
      if (api.getThemeCss) {
        const css = await api.getThemeCss();
        return css || null;
      }
    } catch (e) {
      console.error('Failed to load Matugen theme CSS', e);
    }
    return null;
  },

  syncWindowIcon(effectiveMode: 'light' | 'dark'): void {
    try {
      if (api.setIcon) {
        void api.setIcon(effectiveMode);
      }
    } catch (e) {
      console.error('Failed to sync window icon', e);
    }
  },

  async loadTheme(): Promise<boolean> {
    const css = await this.getMatugenCss();
    if (!css) return false;
    const styleId = 'matugen-theme';
    let styleTag = document.getElementById(styleId);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = css;
    return true;
  },

  init(): void {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.syncWindowIcon(isDark ? 'dark' : 'light');
  },
};
