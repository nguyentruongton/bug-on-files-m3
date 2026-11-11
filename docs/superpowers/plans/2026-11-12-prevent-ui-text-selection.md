# Prevent Accidental UI Text and Icon Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent accidental browser text/icon selection across the Electron UI on touchpad drag gestures while keeping inputs, text previews, and terminal selectable.

**Architecture:** Apply `user-select: none` globally on `:root` and `.material-symbols-rounded` in `src/index.css`, and explicitly opt in interactive text elements (`input`, `textarea`, `[contenteditable="true"]`, `.xterm`, `.xterm *`) with `user-select: text`.

**Tech Stack:** CSS, TypeScript, Bun Test

**Spec:** `docs/superpowers/specs/2026-11-12-prevent-ui-text-selection-design.md`

## Global Constraints

- Must not interfere with HTML5 drag-and-drop events in `FileList` / `ExplorerTab`.
- Must preserve `user-select: text` on `input`, `textarea`, `[contenteditable="true"]`, `.xterm`, `.xterm *`, `.quicklook-text-content`, and `PropertiesDialog` file location.

## Review Focus

- None beyond the global CSS rules and explicit opt-in selectors tested in Task 1.

---

### Task 1: Global `user-select` Rules and Opt-In Selectors

**Files:**
- Modify: `src/index.css:21-60`
- Test: `src/components/__tests__/userSelectCss.test.ts`

**Interfaces:**
- Consumes: `src/index.css`, `src/components/QuickLook.css`
- Produces: Global CSS rules preventing UI chrome selection while opting in editable/selectable regions.

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/userSelectCss.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/userSelectCss.test.ts`
Expected: FAIL on `:root` and `.material-symbols-rounded` matching `user-select: none`.

- [ ] **Step 3: Update `src/index.css` with global `user-select: none` and opt-in `user-select: text` rules**

In `src/index.css`:
- Add `-webkit-user-select: none;` and `user-select: none;` to `.material-symbols-rounded` and `:root`.
- Add rule block for `input, textarea, [contenteditable="true"], .xterm, .xterm *` with `-webkit-user-select: text;` and `user-select: text;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/userSelectCss.test.ts`
Expected: PASS (3 pass, 0 fail)

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/__tests__/userSelectCss.test.ts
git commit -m "fix(ui): prevent accidental text and icon selection across app chrome"
```
