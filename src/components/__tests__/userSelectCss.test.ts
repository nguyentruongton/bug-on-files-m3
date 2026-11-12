import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CssRule {
  selectors: string[];
  body: string;
}

function parseCssRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const blockRegex = /([^{}@]+)\{([^{}]*)\}/g;

  for (const match of withoutComments.matchAll(blockRegex)) {
    const selectors = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    rules.push({ selectors, body: match[2] });
  }

  return rules;
}

describe('Global user-select CSS rules', () => {
  const indexCss = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8');
  const propertiesDialogTsx = readFileSync(resolve(__dirname, '../PropertiesDialog.tsx'), 'utf-8');
  const indexRules = parseCssRules(indexCss);

  test('disables text selection globally on :root and .material-symbols-rounded with webkit prefix', () => {
    for (const selector of [':root', '.material-symbols-rounded']) {
      const matchingRules = indexRules.filter((r) => r.selectors.includes(selector));
      const combinedBody = matchingRules.map((r) => r.body).join('\n');
      expect(combinedBody).toMatch(/(?:^|;|\s)-webkit-user-select:\s*none\b/);
      expect(combinedBody).toMatch(/(?:^|;|\s)user-select:\s*none\b/);
    }
  });

  test('enables text selection on editable elements with webkit prefix', () => {
    for (const selector of ['input', 'textarea', '[contenteditable="true"]']) {
      const matchingRules = indexRules.filter((r) => r.selectors.includes(selector));
      const combinedBody = matchingRules.map((r) => r.body).join('\n');
      expect(combinedBody).toMatch(/(?:^|;|\s)-webkit-user-select:\s*text\b/);
      expect(combinedBody).toMatch(/(?:^|;|\s)user-select:\s*text\b/);
    }
  });

  test('does not override xterm.css user-select: none on .xterm descendants', () => {
    const xtermTextRules = indexRules.filter(
      (r) =>
        r.selectors.some((s) => s.includes('.xterm')) &&
        /(?:^|;|\s)(?:-webkit-)?user-select:\s*text\b/.test(r.body)
    );
    expect(xtermTextRules).toEqual([]);
  });

  test('retains text selection in QuickLook text preview', () => {
    expect(indexCss).toMatch(/\.quicklook-text-content\s*\{[^}]*user-select:\s*text/s);
  });

  test('retains text selection for file name and location in PropertiesDialog', () => {
    expect(propertiesDialogTsx).toMatch(/userSelect:\s*['"]text['"][^>]*>\{file\.name\}/);
    expect(propertiesDialogTsx).toMatch(/userSelect:\s*['"]text['"][^>]*>\{file\.path\}/);
  });
});
