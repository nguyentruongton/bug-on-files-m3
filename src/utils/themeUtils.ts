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

export function extractMatugenSeedColor(cssText: string | null | undefined): string | null {
  if (!cssText) return null;
  const match = cssText.match(MATUGEN_PRIMARY_REGEX);
  if (!match?.[1]) return null;
  return normalizeHexColor(match[1]);
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
