import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { MD3ThemeProvider, useTheme, type ThemeMode } from '@bug-on/m3-expressive';
import { api } from '../api';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { ThemeService } from '../services/ThemeService';
import {
  DEFAULT_SEED_COLOR,
  extractMatugenSeedColor,
  normalizeHexColor,
  resolveEffectiveSeedColor,
} from '../utils/themeUtils';

export interface AppThemeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  sourceColor: string;
  setSourceColor: (hex: string) => void;
  useMatugen: boolean;
  setUseMatugen: (enabled: boolean) => void;
  matugenDetected: boolean;
  matugenSeedColor: string | null;
  effectiveSeedColor: string;
  customCssPath: string;
  importCustomCss: () => Promise<void>;
  clearCustomCss: () => void;
  refreshMatugen: () => Promise<void>;
}

const AppThemeContext = createContext<AppThemeContextValue | undefined>(undefined);

const CUSTOM_CSS_ELEMENT_ID = 'custom-user-css';

function applyCustomCssElement(cssText: string | null) {
  let style = document.getElementById(CUSTOM_CSS_ELEMENT_ID);
  if (!cssText) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = CUSTOM_CSS_ELEMENT_ID;
    document.head.appendChild(style);
  }
  style.textContent = cssText;
}

function ThemeProviderSync({
  effectiveSeedColor,
  themeMode,
}: {
  effectiveSeedColor: string;
  themeMode: ThemeMode;
}) {
  const {
    sourceColor: providerSourceColor,
    setSourceColor: setProviderSourceColor,
    mode: providerMode,
    setMode: setProviderMode,
    effectiveMode,
  } = useTheme();

  useEffect(() => {
    if (providerSourceColor.toUpperCase() !== effectiveSeedColor.toUpperCase()) {
      setProviderSourceColor(effectiveSeedColor);
    }
  }, [effectiveSeedColor, providerSourceColor, setProviderSourceColor]);

  useEffect(() => {
    if (providerMode !== themeMode) {
      setProviderMode(themeMode);
    }
  }, [themeMode, providerMode, setProviderMode]);

  useEffect(() => {
    ThemeService.syncWindowIcon(effectiveMode);
  }, [effectiveMode]);

  return null;
}

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeMode] = useLocalStorage<ThemeMode>('settings.themeMode', 'system');
  const [rawSourceColor, setRawSourceColor] = useLocalStorage<string>(
    'settings.sourceColor',
    DEFAULT_SEED_COLOR
  );
  const [useMatugen, setUseMatugen] = useLocalStorage<boolean>('settings.useMatugen', true);
  const [customCssPath, setCustomCssPath] = useLocalStorage<string>('customCssPath', '');
  const [matugenSeedColor, setMatugenSeedColor] = useState<string | null>(null);

  const sourceColor = useMemo(
    () => normalizeHexColor(rawSourceColor) ?? DEFAULT_SEED_COLOR,
    [rawSourceColor]
  );

  const setSourceColor = useCallback(
    (hex: string) => {
      const normalized = normalizeHexColor(hex);
      if (normalized) {
        setRawSourceColor(normalized);
      }
    },
    [setRawSourceColor]
  );

  const refreshMatugen = useCallback(async () => {
    const css = await ThemeService.getMatugenCss();
    const extracted = extractMatugenSeedColor(css);
    setMatugenSeedColor((prev) => (prev === extracted ? prev : extracted));
  }, []);

  const loadCustomCssFromPath = useCallback(async (path: string) => {
    if (!path) {
      applyCustomCssElement(null);
      return;
    }
    try {
      const css = await api.readFile(path);
      if (css) {
        applyCustomCssElement(css);
      }
    } catch (err) {
      console.error('Failed to load custom css', err);
    }
  }, []);

  const importCustomCss = useCallback(async () => {
    const path = await api.openFileDialog();
    if (path) {
      await loadCustomCssFromPath(path);
      setCustomCssPath(path);
    }
  }, [loadCustomCssFromPath, setCustomCssPath]);

  const clearCustomCss = useCallback(() => {
    applyCustomCssElement(null);
    setCustomCssPath('');
  }, [setCustomCssPath]);

  useEffect(() => {
    if (!useMatugen) return;
    let cancelled = false;

    const syncNow = () => {
      ThemeService.getMatugenCss().then((css) => {
        if (cancelled) return;
        const extracted = extractMatugenSeedColor(css);
        setMatugenSeedColor((prev) => (prev === extracted ? prev : extracted));
      });
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };

    syncNow();
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    }, 3000);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.clearInterval(timer);
    };
  }, [useMatugen]);

  useEffect(() => {
    if (customCssPath) {
      void loadCustomCssFromPath(customCssPath);
    }
  }, [customCssPath, loadCustomCssFromPath]);

  const effectiveSeedColor = useMemo(
    () =>
      resolveEffectiveSeedColor({
        useMatugen,
        matugenSeed: matugenSeedColor,
        userSeedColor: sourceColor,
      }),
    [useMatugen, matugenSeedColor, sourceColor]
  );

  const value = useMemo<AppThemeContextValue>(
    () => ({
      themeMode,
      setThemeMode,
      sourceColor,
      setSourceColor,
      useMatugen,
      setUseMatugen,
      matugenDetected: matugenSeedColor !== null,
      matugenSeedColor,
      effectiveSeedColor,
      customCssPath,
      importCustomCss,
      clearCustomCss,
      refreshMatugen,
    }),
    [
      themeMode,
      setThemeMode,
      sourceColor,
      setSourceColor,
      useMatugen,
      setUseMatugen,
      matugenSeedColor,
      effectiveSeedColor,
      customCssPath,
      importCustomCss,
      clearCustomCss,
      refreshMatugen,
    ]
  );

  return (
    <AppThemeContext.Provider value={value}>
      <MD3ThemeProvider
        sourceColor={effectiveSeedColor}
        defaultMode={themeMode}
        variant="expressive"
        persistToLocalStorage={false}
        enableSnackbar
      >
        <ThemeProviderSync effectiveSeedColor={effectiveSeedColor} themeMode={themeMode} />
        {children}
      </MD3ThemeProvider>
    </AppThemeContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within an AppThemeProvider');
  }
  return ctx;
}
