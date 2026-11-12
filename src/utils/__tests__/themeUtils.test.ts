import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SEED_COLOR,
  PRESET_SEED_COLORS,
  extractMatugenSeedColor,
  resolveEffectiveSeedColor,
  isModalDialogOpen,
} from '../themeUtils';

describe('themeUtils', () => {
  describe('extractMatugenSeedColor', () => {
    test('extracts 6-digit hex from --md-sys-color-primary', () => {
      const css = ':root {\n  --md-sys-color-primary: #a8c7fa;\n  --md-sys-color-surface: #111318;\n}';
      expect(extractMatugenSeedColor(css)).toBe('#A8C7FA');
    });

    test('expands 3-digit hex from --md-sys-color-primary to 6-digit uppercase hex', () => {
      const css = ':root { --md-sys-color-primary: #abc; }';
      expect(extractMatugenSeedColor(css)).toBe('#AABBCC');
    });

    test('returns null when css is null, empty, or lacks a valid hex primary token', () => {
      expect(extractMatugenSeedColor(null)).toBeNull();
      expect(extractMatugenSeedColor('')).toBeNull();
      expect(extractMatugenSeedColor(':root { --md-sys-color-primary: rgb(10, 20, 30); }')).toBeNull();
    });
  });

  describe('resolveEffectiveSeedColor', () => {
    test('returns matugenSeed when useMatugen is true and matugenSeed is present', () => {
      expect(
        resolveEffectiveSeedColor({
          useMatugen: true,
          matugenSeed: '#FFB4AB',
          userSeedColor: '#00639B',
        })
      ).toBe('#FFB4AB');
    });

    test('returns userSeedColor when useMatugen is false or matugenSeed is null', () => {
      expect(
        resolveEffectiveSeedColor({
          useMatugen: false,
          matugenSeed: '#FFB4AB',
          userSeedColor: '#00639B',
        })
      ).toBe('#00639B');
      expect(
        resolveEffectiveSeedColor({
          useMatugen: true,
          matugenSeed: null,
          userSeedColor: '#00639B',
        })
      ).toBe('#00639B');
    });

    test('falls back to DEFAULT_SEED_COLOR if userSeedColor is invalid hex', () => {
      expect(
        resolveEffectiveSeedColor({
          useMatugen: false,
          matugenSeed: null,
          userSeedColor: 'not-a-hex',
        })
      ).toBe(DEFAULT_SEED_COLOR);
    });
  });

  describe('PRESET_SEED_COLORS', () => {
    test('provides at least 8 valid 6-digit hex presets including DEFAULT_SEED_COLOR', () => {
      expect(PRESET_SEED_COLORS.length).toBeGreaterThanOrEqual(8);
      expect(PRESET_SEED_COLORS.some((c) => c.hex === DEFAULT_SEED_COLOR)).toBe(true);
      for (const preset of PRESET_SEED_COLORS) {
        expect(preset.hex).toMatch(/^#[0-9A-F]{6}$/i);
      }
    });
  });

  describe('isModalDialogOpen', () => {
    test('queries both native dialog[open] and Radix [role="dialog"][data-state="open"]', () => {
      const queried: string[] = [];
      const fakeRoot = {
        querySelector: (selector: string) => {
          queried.push(selector);
          return selector.includes('[data-state="open"]') ? ({} as Element) : null;
        },
      } as unknown as ParentNode;

      expect(isModalDialogOpen(fakeRoot)).toBe(true);
      expect(queried[0]).toContain('dialog[open]');
      expect(queried[0]).toContain('[role="dialog"][data-state="open"]');
    });
  });
});
