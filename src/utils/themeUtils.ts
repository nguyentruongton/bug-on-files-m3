export const DEFAULT_SEED_COLOR = '#6750A4';

export const PRESET_SEED_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'Royal Purple', hex: '#6750A4' },
  { name: 'Ocean Blue', hex: '#00639B' },
  { name: 'Forest Green', hex: '#006E1C' },
  { name: 'Crimson Red', hex: '#BA1A1A' },
  { name: 'Plum Rose', hex: '#8E4585' },
  { name: 'Terracotta', hex: '#B3261E' },
  { name: 'Teal Cyan', hex: '#006A6A' },
  { name: 'Warm Mauve', hex: '#7D5260' },
] as const;

const HEX_6_REGEX = /^#[0-9A-F]{6}$/i;
const HEX_3_REGEX = /^#[0-9A-F]{3}$/i;
const MATUGEN_PRIMARY_REGEX = /--md-sys-color-primary\s*:\s*(#[0-9a-fA-F]{3,6})\b/i;
const CAELESTIA_PRIMARY_REGEX = /"primary"\s*:\s*"#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})"/i;
const GTK_ACCENT_REGEX = /@define-color\s+(?:accent_color|primary)\s+(#[0-9a-fA-F]{3,6})\b/i;

export function normalizeHexColor(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const trimmed = hex.trim();
  if (HEX_6_REGEX.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (HEX_3_REGEX.test(trimmed)) {
    const [, r, g, b] = trimmed.toUpperCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

let lastFailedMatugenPayload: string | null = null;

function isDevMode(): boolean {
  return Boolean((import.meta as { env?: { DEV?: boolean | string } }).env?.DEV);
}

export function resetMatugenWarningState(): void {
  lastFailedMatugenPayload = null;
}

/** Extracts a normalized #RRGGBB seed color from Matugen CSS, Caelestia scheme.json, or GTK CSS. */
export function extractMatugenSeedColor(cssText: string | null | undefined): string | null {
  if (!cssText || !cssText.trim()) return null;

  const matugenMatch = cssText.match(MATUGEN_PRIMARY_REGEX);
  if (matugenMatch?.[1]) {
    const normalized = normalizeHexColor(matugenMatch[1]);
    if (normalized) {
      lastFailedMatugenPayload = null;
      return normalized;
    }
  }

  const caelestiaMatch = cssText.match(CAELESTIA_PRIMARY_REGEX);
  if (caelestiaMatch?.[1]) {
    const normalized = normalizeHexColor(`#${caelestiaMatch[1]}`);
    if (normalized) {
      lastFailedMatugenPayload = null;
      return normalized;
    }
  }

  const gtkMatch = cssText.match(GTK_ACCENT_REGEX);
  if (gtkMatch?.[1]) {
    const normalized = normalizeHexColor(gtkMatch[1]);
    if (normalized) {
      lastFailedMatugenPayload = null;
      return normalized;
    }
  }

  if (isDevMode() && lastFailedMatugenPayload !== cssText) {
    lastFailedMatugenPayload = cssText;
    console.warn(
      '[themeUtils] Failed to extract primary hex seed color from Matugen/theme payload; falling back to default.'
    );
  }

  return null;
}

function hexLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const MATUGEN_SURFACE_REGEX = /--md-sys-color-(?:surface|background)\s*:\s*(#[0-9a-fA-F]{3,6})\b/i;
const GTK_BG_REGEX = /@define-color\s+(?:window_bg_color|view_bg_color)\s+(#[0-9a-fA-F]{3,6})\b/i;

/**
 * Infers the desktop theme polarity ('light' | 'dark') from Caelestia scheme.json,
 * Matugen CSS variables, or GTK @define-color definitions. Returns null when unknown.
 */
export function extractSystemThemeMode(cssText: string | null | undefined): 'light' | 'dark' | null {
  if (!cssText || !cssText.trim()) return null;
  const trimmed = cssText.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        mode?: unknown;
        surface?: unknown;
        background?: unknown;
        colours?: { surface?: unknown; background?: unknown };
      };
      if (parsed.mode === 'light' || parsed.mode === 'dark') {
        return parsed.mode;
      }
      const rawSurface =
        parsed.colours?.surface ??
        parsed.colours?.background ??
        parsed.surface ??
        parsed.background;
      if (typeof rawSurface === 'string') {
        const prefixed = rawSurface.startsWith('#') ? rawSurface : `#${rawSurface}`;
        const normalized = normalizeHexColor(prefixed);
        if (normalized) {
          return hexLuminance(normalized) > 0.5 ? 'light' : 'dark';
        }
      }
    } catch {
      // Fall through to CSS pattern matching if JSON is malformed
    }
  }

  const cssMatch = trimmed.match(MATUGEN_SURFACE_REGEX) ?? trimmed.match(GTK_BG_REGEX);
  if (cssMatch?.[1]) {
    const normalized = normalizeHexColor(cssMatch[1]);
    if (normalized) {
      return hexLuminance(normalized) > 0.5 ? 'light' : 'dark';
    }
  }

  return null;
}

export function resolveEffectiveSeedColor(options: {
  useMatugen: boolean;
  matugenSeed: string | null;
  userSeedColor: string;
}): string {
  if (options.useMatugen) {
    const normalizedMatugen = normalizeHexColor(options.matugenSeed);
    if (normalizedMatugen) return normalizedMatugen;
  }
  return normalizeHexColor(options.userSeedColor) ?? DEFAULT_SEED_COLOR;
}

export function isModalDialogOpen(root: ParentNode = document): boolean {
  return Boolean(
    root.querySelector(
      'dialog[open], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
    )
  );
}
