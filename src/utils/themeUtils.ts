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
