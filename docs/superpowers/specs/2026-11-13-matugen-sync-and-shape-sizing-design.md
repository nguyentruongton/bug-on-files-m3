# Design: System Matugen Color Sync & ShapeMedia Sizing Fix

**Date:** 2026-11-13
**Status:** Draft (awaiting user approval)

## Intent & Why
- **System color sync:** On Arch Linux setups using Caelestia (without `~/.config/matugen/theme.css`), the app falls back to the default purple (`#6750A4`) instead of syncing the system's active dynamic palette (e.g. pinkish-red `#f9b6ae`), and never updates if the user changes their wallpaper/scheme while the app is open.
- **Shape icon/video clipping:** `ShapeMedia` from `@bug-on/m3-expressive` uses `width`/`height` props to compute its `clipPath`, but does not apply CSS `width` and `height` to the rendered `<div>`. As a result, shape containers shrink to fit their inner `<Icon>` or text, causing the larger `clipPath` to slice off the shape and icon off-center.

## Goals, Non-Goals & Anti-Goals
- **Goals:**
  - Automatically detect and sync the active system accent/primary color from Matugen CSS, Caelestia `scheme.json`, or GTK4/GTK3 `gtk.css`.
  - Automatically refresh the synced color when the system scheme changes (without requiring an app restart).
  - Ensure every `ShapeMedia` container in the app has explicit CSS dimensions matching its `clipPath` dimensions so icons, text, and thumbnails render centered and unclipped.
- **Non-Goals:**
  - Full 26-token CSS override from `scheme.json` (we only extract the primary seed color and let `@bug-on/m3-expressive`'s M3 tonal palette generator derive consistent light/dark tokens).
  - Modifying `node_modules/@bug-on/m3-expressive` directly.
- **Anti-Goals:**
  - Breaking existing `~/.config/matugen/theme.css` support for standard Matugen users.

## Approaches Considered
- **Approach A (Chosen):** Multi-source fallback (`~/.config/matugen/theme.css` → `~/.local/state/caelestia/scheme.json` → `~/.config/gtk-4.0/gtk.css` → `~/.config/gtk-3.0/gtk.css`) + automatic refresh on window focus/visibility and lightweight interval polling. Works seamlessly across both Tauri and Electron without native file-watcher platform quirks.
- **Approach B (Rejected):** Read `scheme.json`/`gtk.css` only once at startup. Simpler, but fails to update when the user switches wallpapers while the file explorer is open.

## Design
1. **Backend theme discovery (`src-tauri/src/commands/app.rs`, `electron/main.ts`):**
   - Check candidate files in priority order:
     1. `~/.config/matugen/theme.css`
     2. `~/.local/state/caelestia/scheme.json`
     3. `~/.config/gtk-4.0/gtk.css`
     4. `~/.config/gtk-3.0/gtk.css`
   - Return the first readable, non-empty file's contents from `get_theme_css` / `theme:get-css`.
2. **Color extraction (`src/utils/themeUtils.ts`):**
   - Extend `extractMatugenSeedColor(rawText)` to match:
     - Matugen CSS: `--md-sys-color-primary: #XXXXXX`
     - Caelestia JSON: `"primary": "#?XXXXXX"` (normalizing 6-hex without `#`)
     - GTK CSS: `@define-color accent_color #XXXXXX` or `@define-color primary #XXXXXX`
   - Add unit tests in `src/utils/__tests__/themeUtils.test.ts`.
3. **Auto-refresh & UI status (`src/contexts/AppThemeContext.tsx`, `src/components/SettingsDialog.tsx`):**
   - In `AppThemeContext`, re-run `refreshMatugen()` on `window` `focus`, `document` `visibilitychange`, and a 3-second interval while `useMatugen` is enabled and the document is visible (updating state only when the extracted hex actually changes).
   - Update `SettingsDialog.tsx` subtitle from `"No ~/.config/matugen/theme.css found"` to `"No system Matugen/theme palette found"`.
4. **`ShapeMedia` sizing wrapper (`src/components/ExpressiveShape.tsx` + call sites):**
   - Create `ExpressiveShape` wrapping `ShapeMedia` that forwards `width` and `height` into `style={{ width, height, ...style }}` and includes `flex items-center justify-center shrink-0 overflow-hidden`.
   - Replace direct `ShapeMedia` usages in `Dashboard.tsx`, `FileList.tsx`, `QuickLook.tsx`, `PropertiesDialog.tsx`, and `SettingsDialog.tsx`.

## Left to the Builder
- Exact regex ordering and unit test cases in `themeUtils.test.ts` and `app.rs`.
- Verifying visual alignment of `pill` (video) and `arch` (documents) shapes at list (32px), pinned (52px), and grid sizes.
