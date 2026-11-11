import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Global user-select CSS rules', () => {
  const indexCss = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8');
  const quickLookCss = readFileSync(resolve(__dirname, '../QuickLook.css'), 'utf-8');

  test('disables text selection globally on :root and .material-symbols-rounded', () => {
    expect(indexCss).toMatch(/\.material-symbols-rounded\s*\{[^}]*user-select:\s*none/s);
    expect(indexCss).toMatch(/:root\s*\{[^}]*user-select:\s*none/s);
  });

  test('explicitly enables text selection on inputs, contenteditable, and xterm', () => {
    expect(indexCss).toMatch(
      /input,\s*textarea,\s*\[contenteditable="true"\],\s*\.xterm,\s*\.xterm\s*\*\s*\{[^}]*user-select:\s*text/s
    );
  });

  test('retains text selection in QuickLook text preview', () => {
    expect(quickLookCss).toMatch(/\.quicklook-text-content\s*\{[^}]*user-select:\s*text/s);
  });
});
