# Matugen Sync & ShapeMedia Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix automatic system color syncing on Arch/Caelestia/Matugen setups (with live refresh) and fix `ShapeMedia` container sizing so icons, badges, and video/file shapes render centered and unclipped.

**Architecture:** Extend the Tauri/Electron theme-reading backends to probe Matugen CSS, Caelestia `scheme.json`, and GTK4/GTK3 `gtk.css` in priority order, parse all three formats in `extractMatugenSeedColor()`, and poll/refetch on focus and visibility in `AppThemeContext`. Wrap `ShapeMedia` in an `ExpressiveShape` component that explicitly applies `width` and `height` CSS styles matching the `clipPath` dimensions across all app call sites.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, `@bug-on/m3-expressive`, Bun test, Rust (Tauri v2), Electron.

**Spec:** `docs/superpowers/specs/2026-11-13-matugen-sync-and-shape-sizing-design.md`

## Global Constraints
- Preserve existing `~/.config/matugen/theme.css` support as highest-priority source.
- Do not modify `node_modules/@bug-on/m3-expressive` directly.
- Derive light/dark tonal tokens via the existing M3 palette generator from the extracted primary seed color (no 26-token CSS override).
- Keep all existing tests passing (`bun test`, `cargo test`, `npm run build:web`, `npm run lint`).

## Review Focus
- Caelestia `scheme.json` writes 6-char hex values without a leading `#` (e.g. `"primary": "f9b6ae"`) alongside other keys like `"onPrimary"` — parser must match `"primary"` specifically and normalize to `#F9B6AE`.
- GTK `gtk.css` may contain `@define-color accent_color @primary;` (an alias) or `@define-color accent_color #f9b6ae;` — parser must ignore non-hex `@` references and fall through or return `null` cleanly.
- Empty or whitespace-only higher-priority theme files must not shadow a valid lower-priority file in the backend fallback loop.
- `AppThemeContext` auto-refresh must not trigger unnecessary state updates/re-renders when the extracted hex is unchanged, and must stop polling when `useMatugen` is disabled or the tab is hidden.
- `ExpressiveShape` must preserve caller-supplied `style` properties (like `backgroundColor` in `SettingsDialog.tsx`) while enforcing `width` and `height`.

---

### Task 1: Multi-Format System Color Extraction (`themeUtils.ts`)

**Files:**
- Modify: `src/utils/themeUtils.ts:16-36`
- Test: `src/utils/__tests__/themeUtils.test.ts:11-31`

**Interfaces:**
- Produces: `extractMatugenSeedColor(cssText: string | null | undefined): string | null` supporting Matugen CSS (`--md-sys-color-primary`), Caelestia `scheme.json` (`"primary": "f9b6ae"` or `"#f9b6ae"`), and GTK CSS (`@define-color accent_color #f9b6ae` / `@define-color primary #f9b6ae`).

- [ ] **Step 1: Write failing tests for Caelestia JSON and GTK CSS parsing**

Add to `describe('extractMatugenSeedColor', ...)` in `src/utils/__tests__/themeUtils.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/__tests__/themeUtils.test.ts`
Expected: FAIL on the 3 new extraction tests (returning `null` instead of `#F9B6AE` / `#A8C7FA` / `#85514B`).

- [ ] **Step 3: Extend `extractMatugenSeedColor` in `src/utils/themeUtils.ts`**

Match in priority order:
1. `--md-sys-color-primary\s*:\s*(#[0-9a-fA-F]{3,6})\b`
2. `"primary"\s*:\s*"#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})"` (prepend `#` before `normalizeHexColor`)
3. `@define-color\s+(?:accent_color|primary)\s+(#[0-9a-fA-F]{3,6})\b`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/utils/__tests__/themeUtils.test.ts`
Expected: PASS (all 13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/themeUtils.ts src/utils/__tests__/themeUtils.test.ts
git commit -m "fix(theme): parse Caelestia scheme.json and GTK css accent colors"
```

---

### Task 2: Multi-Source Backend Theme Discovery (Tauri & Electron)

**Files:**
- Modify: `src-tauri/src/commands/app.rs:115-120` (and add unit test in `mod tests`)
- Modify: `electron/main.ts:63-72`

**Interfaces:**
- Produces: `resolve_theme_css_from_home(home: &Path) -> Option<String>` (Rust helper tested in `app.rs::tests`), invoked by `get_theme_css()`, and matching candidate list in `electron/main.ts` `theme:get-css`.

- [ ] **Step 1: Write failing Rust unit test in `src-tauri/src/commands/app.rs`**

In `mod tests`, add tests for `resolve_theme_css_from_home(home: &Path)`:
- Prefers `.config/matugen/theme.css` over `.local/state/caelestia/scheme.json` and `.config/gtk-4.0/gtk.css`.
- Falls back to `.local/state/caelestia/scheme.json`, then `.config/gtk-4.0/gtk.css`, then `.config/gtk-3.0/gtk.css`.
- Skips empty/whitespace-only files and continues to the next candidate.

- [ ] **Step 2: Run Cargo test to verify it fails**

Run: `cd src-tauri && cargo test resolve_theme_css`
Expected: FAIL (`resolve_theme_css_from_home` not defined).

- [ ] **Step 3: Implement `resolve_theme_css_from_home` in `src-tauri/src/commands/app.rs` and update `electron/main.ts`**

Candidate relative paths in order:
1. `.config/matugen/theme.css`
2. `.local/state/caelestia/scheme.json`
3. `.config/gtk-4.0/gtk.css`
4. `.config/gtk-3.0/gtk.css`

Return the first readable file whose trimmed content is non-empty. Update `theme:get-css` in `electron/main.ts` with the exact same candidate list and non-empty check.

- [ ] **Step 4: Run Cargo test & TypeScript check to verify they pass**

Run: `cd src-tauri && cargo test resolve_theme_css`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/app.rs electron/main.ts
git commit -m "fix(theme): discover Caelestia and GTK theme files when matugen css is absent"
```

---

### Task 3: Live System Theme Auto-Refresh & Settings Status (`AppThemeContext.tsx`, `SettingsDialog.tsx`)

**Files:**
- Modify: `src/contexts/AppThemeContext.tsx:106-150`
- Modify: `src/components/SettingsDialog.tsx:117-120`

**Interfaces:**
- Consumes: `ThemeService.getMatugenCss()` and `extractMatugenSeedColor()` from Task 1.
- Produces: Auto-refreshing `matugenSeedColor` on mount, `window` `focus`, `document` `visibilitychange`, and a 3s interval while `useMatugen` is `true` and `document.visibilityState === 'visible'`.

- [ ] **Step 1: Update `AppThemeContext.tsx` for live refresh**

In `refreshMatugen`, compare extracted color with previous state (`setMatugenSeedColor((prev) => (prev === extracted ? prev : extracted))`) to avoid unnecessary re-renders.
In a `useEffect` gated on `useMatugen`:
- Call `refreshMatugen()` immediately.
- Attach `window` `focus` and `document` `visibilitychange` listeners that call `refreshMatugen()` when visible.
- Run a `3000`ms `setInterval` calling `refreshMatugen()` only when `document.visibilityState === 'visible'`.
- Clean up listeners and interval on unmount or when `useMatugen` becomes `false`.

- [ ] **Step 2: Update `SettingsDialog.tsx` status copy**

Change line 118-119:
- Detected: `` `Synced from system: ${matugenSeedColor}` ``
- Not detected: `'No system Matugen/theme palette found'`

- [ ] **Step 3: Verify build and tests**

Run: `bun test && npm run build:web`
Expected: PASS and clean TypeScript/Vite build.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/AppThemeContext.tsx src/components/SettingsDialog.tsx
git commit -m "feat(theme): auto-refresh system Matugen/Caelestia palette on focus and poll"
```

---

### Task 4: `ExpressiveShape` Sizing Wrapper & Call-Site Migration

**Files:**
- Create: `src/components/ExpressiveShape.tsx`
- Modify: `src/components/Dashboard.tsx:128-139,199-212,234-243,285-297`
- Modify: `src/components/FileList.tsx:60-69,195-227,300-332`
- Modify: `src/components/QuickLook.tsx:228-237,330-339,359-368`
- Modify: `src/components/PropertiesDialog.tsx:57-70`
- Modify: `src/components/SettingsDialog.tsx:163-173`

**Interfaces:**
- Produces: `ExpressiveShape` component accepting `ShapeMediaProps` with required `width: number` and `height: number`, rendering `<ShapeMedia>` with `style={{ width, height, ...style }}` and `className` merged with `flex items-center justify-center shrink-0 overflow-hidden`.

- [ ] **Step 1: Create `src/components/ExpressiveShape.tsx`**

Wrap `ShapeMedia` from `@bug-on/m3-expressive` so `width` and `height` are always applied as CSS `style={{ width, height, ...style }}`, preventing the container from shrinking below its `clipPath` bounds.

- [ ] **Step 2: Replace `ShapeMedia` with `ExpressiveShape` across all app components**

Update imports and JSX in:
- `src/components/Dashboard.tsx` (System Storage %, Pinned Folders, Add Pin, Recent Activity)
- `src/components/FileList.tsx` (Empty state, List row icon/thumbnail, Grid item icon/thumbnail)
- `src/components/QuickLook.tsx` (Audio, Folder, Other preview badges)
- `src/components/PropertiesDialog.tsx` (Header icon badge)
- `src/components/SettingsDialog.tsx` (Accent preset color swatches)

- [ ] **Step 3: Verify build, lint, and all tests**

Run: `bun test && npm run lint && npm run build:web`
Expected: All tests pass, 0 lint errors, clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/ExpressiveShape.tsx src/components/Dashboard.tsx src/components/FileList.tsx src/components/QuickLook.tsx src/components/PropertiesDialog.tsx src/components/SettingsDialog.tsx
git commit -m "fix(ui): enforce ShapeMedia CSS width/height via ExpressiveShape wrapper"
```
