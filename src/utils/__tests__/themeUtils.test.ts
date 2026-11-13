import { describe, expect, spyOn, test } from 'bun:test';
import {
  DEFAULT_SEED_COLOR,
  PRESET_SEED_COLORS,
  extractMatugenSeedColor,
  resetMatugenWarningState,
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

    test('matches --md-sys-color-primary case-insensitively', () => {
      expect(extractMatugenSeedColor(':root { --MD-SYS-COLOR-PRIMARY: #006a6a; }')).toBe('#006A6A');
    });

    test('returns null when css is null, empty, or lacks a valid hex primary token', () => {
      expect(extractMatugenSeedColor(null)).toBeNull();
      expect(extractMatugenSeedColor('')).toBeNull();
      expect(extractMatugenSeedColor(':root { --md-sys-color-primary: rgb(10, 20, 30); }')).toBeNull();
    });

    test('extracts primary hex without # from Caelestia scheme.json', () => {
      const json = '{"name":"dynamic","colours":{"onPrimary":"61332e","primary":"f9b6ae"}}';
      expect(extractMatugenSeedColor(json)).toBe('#F9B6AE');
    });

    test('extracts primary hex with # from JSON', () => {
      const json = '{ "primary": "#a8c7fa" }';
      expect(extractMatugenSeedColor(json)).toBe('#A8C7FA');
    });

    test('extracts @define-color accent_color or primary from GTK css', () => {
      const gtkCss = '@define-color accent_color #f9b6ae;\n@define-color window_bg_color #130c0c;';
      expect(extractMatugenSeedColor(gtkCss)).toBe('#F9B6AE');
      expect(extractMatugenSeedColor('@define-color primary #85514b;')).toBe('#85514B');
    });

    test('ignores GTK @define-color alias without hex', () => {
      expect(extractMatugenSeedColor('@define-color accent_color @primary;')).toBeNull();
    });

    test('emits deduplicated console.warn in DEV only on non-empty failure and resets on valid recovery', () => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const prevDev = process.env.DEV;
      process.env.DEV = 'true';
      resetMatugenWarningState();

      try {
        // Suppresses empty and null inputs
        expect(extractMatugenSeedColor(null)).toBeNull();
        expect(extractMatugenSeedColor('')).toBeNull();
        expect(extractMatugenSeedColor('   \n  ')).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(0);

        // Warns once per non-empty failed payload across repeated polling
        const badPayload = ':root { --md-sys-color-primary: rgb(1, 2, 3); }';
        expect(extractMatugenSeedColor(badPayload)).toBeNull();
        expect(extractMatugenSeedColor(badPayload)).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(1);

        // Valid extraction resets deduplication cache so subsequent failure warns again
        expect(extractMatugenSeedColor(':root { --md-sys-color-primary: #6750a4; }')).toBe('#6750A4');
        expect(extractMatugenSeedColor(badPayload)).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(2);
      } finally {
        if (prevDev === undefined) {
          delete process.env.DEV;
        } else {
          process.env.DEV = prevDev;
        }
        resetMatugenWarningState();
        warnSpy.mockRestore();
      }
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
