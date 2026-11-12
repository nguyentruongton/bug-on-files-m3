# M3 Expressive UI Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the entire `src/` frontend of Materials to follow the Material Design 3 Expressive standard using `@bug-on/m3-expressive`, Tailwind CSS v4, and `motion` with an Expressive Floating Canvas layout, organic morphing shapes across Dashboard and FileList, and hybrid dynamic HCT theming (Matugen priority + in-app sourceColor/mode controls).

**Architecture:** We execute a 4-layer foundation-first in-place migration: Layer 1 upgrades `index.css` to Tailwind v4 + `@bug-on/m3-expressive/index.css`, builds the hybrid Matugen/`MD3ThemeProvider` engine, and bridges `ToastContext` to `SnackbarProvider`. Layer 2 rewrites the App Shell (`App.tsx`, `NavigationRail`, `Sidebar`, `TabBar`, `Omnibar`, `Breadcrumbs`) into an Expressive Floating Canvas. Layer 3 rewrites the core views (`Dashboard`, `ExplorerTab`, `FileList`, `FileListSkeleton`, `StatusBar`, and contextual `HorizontalFloatingToolbar`). Layer 4 rewrites all dialogs (`SettingsDialog`, `PropertiesDialog`, `OpenWithDialog`, `ConflictDialog`, Rename/New Folder), `ContextMenu`, `QuickLook`, `TerminalPane`, and deletes all 15 legacy component CSS files.

**Tech Stack:** React 19, TypeScript 5.9, `@bug-on/m3-expressive@1.3.24`, `motion@14.12.0`, Tailwind CSS v4 (`@tailwindcss/vite`), `@fontsource/material-symbols-rounded`, `xterm.js`, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-11-12-m3-expressive-ui-rewrite-design.md`

## Global Constraints

- Do not modify `src-tauri/` or `src/api/` (32/32 Tauri Rust command parity is locked).
- Library versions pinned: `@bug-on/m3-expressive@1.3.24`, `motion@14.12.0`, `tailwindcss@^4.3.5`.
- Valid `MD3ShapeName` values from `@bug-on/m3-expressive` must be used: `'arch' | 'arrow' | 'boom' | 'bun' | 'burst' | 'circle' | 'clamshell' | 'diamond' | 'fan' | 'flower' | 'gem' | 'ghostish' | 'heart' | 'clover4Leaf' | 'clover8Leaf' | 'oval' | 'pentagon' | 'pill' | 'pixelCircle' | 'pixelTriangle' | 'puffyDiamond' | 'puffy' | 'semiCircle' | 'cookie12Sided' | 'cookie4Sided' | 'cookie6Sided' | 'cookie7Sided' | 'cookie9Sided' | 'slanted' | 'softBoom' | 'softBurst' | 'square' | 'sunny' | 'triangle' | 'verySunny'`.
- Preserve global text selection rules in `src/index.css`: `:root` and `.material-symbols-rounded` must declare `-webkit-user-select: none; user-select: none;`; `input, textarea, [contenteditable="true"]` must declare `-webkit-user-select: text; user-select: text;`; `.quicklook-text-content` must declare `user-select: text;`; no rule may set `user-select: text` on `.xterm` descendants.
- Preserve `userSelect: 'text'` inline styles on `{file.name}` and `{file.path}` in `src/components/PropertiesDialog.tsx`.
- All keyboard shortcut pre-flight modal checks in `ExplorerTab.tsx` and `QuickLook.tsx` must check `document.querySelector('dialog[open], [role="dialog"][data-state="open"]')` so Radix-based `@bug-on/m3-expressive` `Dialog` modals block background shortcuts.
- Large directory performance guard: in `FileList.tsx`, when `files.length > 300`, unselected items must not mount continuous hover morphing (`morphTo` is only passed when `files.length <= 300` or the item is selected/hovered) to keep 5,000-item folders smooth on WebKitGTK.

## Review Focus

1. **Matugen CSS with RGB/spaces or missing `--md-sys-color-primary`**: `extractMatugenSeedColor(css)` must handle 6-digit hex, 3-digit hex, and case variations, and return `null` cleanly (falling back to user `sourceColor`) when Matugen CSS is empty, malformed, or uses non-hex syntax.
2. **Radix Dialog open state vs global keyboard shortcuts**: Pressing `Space`, `Delete`, or `F2` while Rename, New Folder, Settings, or Conflict dialog is open must not trigger QuickLook or file deletion in `ExplorerTab`.
3. **Large directory (> 300 items) shape morphing guard**: `shouldEnableItemMorph(totalCount, isSelected)` must return `false` for unselected items when `totalCount > 300` and `true` when `totalCount <= 300` or `isSelected === true`.
4. **Deleted `QuickLook.css` in `userSelectCss.test.ts`**: Removing `src/components/QuickLook.css` in Layer 4 will break `src/components/__tests__/userSelectCss.test.ts` unless `.quicklook-text-content` is moved to `src/index.css` and `userSelectCss.test.ts` is updated to assert against `indexCss`.
5. **Valid `MD3ShapeName` mapping for semantic file groups**: Every semantic group returned by `getSemanticGroup(file)` (`Folders`, `Images`, `Videos`, `Audio`, `Archives`, `Documents`, `Code`, `Files`) must map to a valid `MD3ShapeName` from `@bug-on/m3-expressive` without runtime key errors.

---

## File Map

- **Create:**
  - `src/utils/themeUtils.ts` — Pure helpers for Matugen CSS primary hex extraction, effective seed resolution, and preset seed palette.
  - `src/utils/__tests__/themeUtils.test.ts` — Unit tests for `extractMatugenSeedColor`, `resolveEffectiveThemeConfig`, and `isModalDialogOpen`.
  - `src/contexts/AppThemeContext.tsx` — React context wrapping `MD3ThemeProvider` (`variant="expressive"`) + `SnackbarProvider`, managing `themeMode`, `sourceColor`, `useMatugen`, `matugenDetected`, and `customCssPath`.
  - `src/utils/shapeUtils.ts` — Pure helpers mapping file semantic groups and pinned items to valid `MD3ShapeName` rest/morph pairs and large-folder morph guard (`shouldEnableItemMorph`).
  - `src/utils/__tests__/shapeUtils.test.ts` — Unit tests verifying every shape name exists in `MD3Shapes` and testing `shouldEnableItemMorph`.
- **Modify:**
  - `src/index.css` — Import `tailwindcss`, `@bug-on/m3-expressive/index.css`, `@bug-on/m3-tailwind`, `@fontsource/material-symbols-rounded/index.css`, and retain `:root`, `.material-symbols-rounded`, `input/textarea`, and `.quicklook-text-content` `user-select` rules.
  - `src/services/ThemeService.ts` — Delegate to `api.getThemeCss()` and `api.setIcon()` for `AppThemeContext`.
  - `src/contexts/ToastContext.tsx` — Bridge `ToastProvider` and `useToast()` to `@bug-on/m3-expressive` `SnackbarProvider` / `useSnackbar()`.
  - `src/components/Icon.tsx`, `src/components/Button.tsx`, `src/components/IconButton.tsx`, `src/components/Dialog.tsx` — Re-implement as thin M3 Expressive adapters over `@bug-on/m3-expressive` primitives (`Button`, `IconButton`, `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogBody`, `DialogFooter`).
  - `src/components/NavigationRail.tsx`, `src/components/Sidebar.tsx`, `src/components/TabBar.tsx`, `src/components/Breadcrumbs.tsx`, `src/components/Omnibar.tsx` — Rewrite with `@bug-on/m3-expressive` navigation components and Tailwind v4.
  - `src/App.tsx` — Rewrite outer shell to Expressive Floating Canvas (`bg-m3-surface`, `rounded-m3-xl` canvas, `FABMenu` in rail, `AppThemeProvider` integration, M3 Expressive Rename/New Folder dialogs).
  - `src/components/Dashboard.tsx` — Rewrite as Expressive Bento grid (`Card`, `ProgressIndicator`, `ShapeMedia` morphing badges & pinned folders, `List`/`ListItem` recents).
  - `src/components/FileList.tsx`, `src/components/FileListSkeleton.tsx`, `src/components/StatusBar.tsx`, `src/components/ExplorerTab.tsx` — Rewrite with `ShapeMedia` organic shapes grid, `MD3Table` list view, `HorizontalFloatingToolbar` contextual selection bar, and `LoadingIndicator` skeleton.
  - `src/components/ContextMenu.tsx`, `src/components/SettingsDialog.tsx`, `src/components/PropertiesDialog.tsx`, `src/components/OpenWithDialog.tsx`, `src/components/ConflictDialog.tsx`, `src/components/QuickLook.tsx`, `src/components/TerminalPane.tsx` — Rewrite with `@bug-on/m3-expressive` components and Tailwind v4.
  - `src/components/__tests__/userSelectCss.test.ts` — Check `.quicklook-text-content` inside `src/index.css` once `QuickLook.css` is deleted.
- **Delete (in Task 8 after all components are migrated):**
  - `src/App.css`, `src/components/Breadcrumbs.css`, `src/components/Button.css`, `src/components/CircularProgress.css`, `src/components/ContextMenu.css`, `src/components/Dashboard.css`, `src/components/Dialog.css`, `src/components/FileList.css`, `src/components/IconButton.css`, `src/components/NavigationRail.css`, `src/components/Omnibar.css`, `src/components/QuickLook.css`, `src/components/Sidebar.css`, `src/components/Skeleton.css`, `src/components/TabBar.css`, `src/components/Toast.css`, `src/components/Toast.tsx`, `src/theme/fallback.css`.

---

### Task 1: Layer 1A — Theme Utilities, Hybrid Matugen Engine & Tailwind v4 CSS Foundation

**Files:**
- Create: `src/utils/themeUtils.ts`
- Create: `src/utils/__tests__/themeUtils.test.ts`
- Create: `src/contexts/AppThemeContext.tsx`
- Modify: `src/services/ThemeService.ts`
- Modify: `src/index.css`

**Interfaces:**
- Produces:
  - `src/utils/themeUtils.ts`:
    - `export const DEFAULT_SEED_COLOR = '#6750A4'`
    - `export const PRESET_SEED_COLORS: readonly { name: string; hex: string }[]`
    - `export function extractMatugenSeedColor(cssText: string | null | undefined): string | null`
    - `export function resolveEffectiveSeedColor(options: { useMatugen: boolean; matugenSeed: string | null; userSeedColor: string }): string`
    - `export function isModalDialogOpen(root?: ParentNode): boolean`
  - `src/contexts/AppThemeContext.tsx`:
    - `export interface AppThemeContextValue { themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void; sourceColor: string; setSourceColor: (hex: string) => void; useMatugen: boolean; setUseMatugen: (enabled: boolean) => void; matugenDetected: boolean; matugenSeedColor: string | null; effectiveSeedColor: string; customCssPath: string; importCustomCss: () => Promise<void>; clearCustomCss: () => void; refreshMatugen: () => Promise<void>; }`
    - `export const AppThemeProvider: React.FC<{ children: React.ReactNode }>`
    - `export function useAppTheme(): AppThemeContextValue`

- [ ] **Step 1: Write the failing unit tests in `src/utils/__tests__/themeUtils.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/__tests__/themeUtils.test.ts`
Expected: FAIL with `Cannot find module '../themeUtils'`

- [ ] **Step 3: Implement `src/utils/themeUtils.ts`**

Implement `DEFAULT_SEED_COLOR = '#6750A4'`, `PRESET_SEED_COLORS` (8 M3 Expressive swatches: Royal Purple `#6750A4`, Ocean Blue `#00639B`, Forest Green `#006E1C`, Crimson Red `#BA1A1A`, Plum Rose `#8E4585`, Terracotta `#B3261E`, Teal Cyan `#006A6A`, Warm Mauve `#7D5260`), `extractMatugenSeedColor`, `resolveEffectiveSeedColor`, and `isModalDialogOpen(root: ParentNode = document): boolean` querying `'dialog[open], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'`.

- [ ] **Step 4: Update `src/index.css`, `src/services/ThemeService.ts`, and create `src/contexts/AppThemeContext.tsx`**

In `src/index.css`:
- Replace `@import './theme/fallback.css';` and the remote Google Fonts `@import url(...)` with:
  ```css
  @import "tailwindcss";
  @import "@bug-on/m3-expressive/index.css";
  @import "@bug-on/m3-tailwind";
  @import "@fontsource/material-symbols-rounded/index.css";
  ```
- Keep the exact `.material-symbols-rounded`, `:root`, `input, textarea, [contenteditable="true"]` rules with `-webkit-user-select` and `user-select` declarations, and add:
  ```css
  .quicklook-text-content {
    -webkit-user-select: text;
    user-select: text;
  }
  ```

In `src/contexts/AppThemeContext.tsx`:
- Manage `themeMode` (`useLocalStorage<ThemeMode>('settings.themeMode', 'system')`), `sourceColor` (`useLocalStorage<string>('settings.sourceColor', DEFAULT_SEED_COLOR)`), `useMatugen` (`useLocalStorage<boolean>('settings.useMatugen', true)`), and `customCssPath` (`useLocalStorage<string>('customCssPath', '')`).
- On mount and `refreshMatugen`, call `api.getThemeCss()`, extract `matugenSeedColor` via `extractMatugenSeedColor`, compute `effectiveSeedColor = resolveEffectiveSeedColor(...)`, and render `<MD3ThemeProvider sourceColor={effectiveSeedColor} defaultMode={themeMode} variant="expressive" persistToLocalStorage={false} enableSnackbar>` plus an inner sync component that calls `useTheme()` from `@bug-on/m3-expressive` to keep `setSourceColor(effectiveSeedColor)` and `setMode(themeMode)` synchronized when state changes, and updates `api.setIcon(effectiveMode)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/utils/__tests__/themeUtils.test.ts src/components/__tests__/userSelectCss.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/themeUtils.ts src/utils/__tests__/themeUtils.test.ts src/contexts/AppThemeContext.tsx src/services/ThemeService.ts src/index.css
git commit -m "feat(ui): add Tailwind v4 foundation and hybrid Matugen/MD3ThemeProvider context"
```

---

### Task 2: Layer 1B — Snackbar Bridge (`ToastContext`) & Core M3 Expressive Primitive Wrappers (`Icon`, `Button`, `IconButton`, `Dialog`)

**Files:**
- Modify: `src/contexts/ToastContext.tsx`
- Modify: `src/components/Icon.tsx`
- Modify: `src/components/Button.tsx`
- Modify: `src/components/IconButton.tsx`
- Modify: `src/components/Dialog.tsx`

**Interfaces:**
- Consumes: `MD3ThemeProvider` (`enableSnackbar`) from `src/contexts/AppThemeContext.tsx`
- Produces:
  - `src/contexts/ToastContext.tsx`: `export type ToastType = 'info' | 'success' | 'error'`, `export const ToastProvider: React.FC<{ children: React.ReactNode }>`, `export const useToast: () => { showToast: (message: string, type?: ToastType) => void }`
  - `src/components/Icon.tsx`: `export interface IconProps { name: string; className?: string; filled?: boolean; size?: number; style?: React.CSSProperties }`
  - `src/components/Button.tsx`: `export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'; colorStyle?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; icon?: React.ReactNode; }`
  - `src/components/IconButton.tsx`: `export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'standard' | 'filled' | 'tonal' | 'outlined'; colorStyle?: 'standard' | 'filled' | 'tonal' | 'outlined'; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; selected?: boolean; }`
  - `src/components/Dialog.tsx`: `export interface DialogProps { title: string; open: boolean; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; maxWidth?: string; }`

- [ ] **Step 1: Update `src/contexts/ToastContext.tsx` to use `@bug-on/m3-expressive` `SnackbarProvider` and `useSnackbar`**

Bridge `showToast(message, type)` to `showSnackbar({ message, duration: 'short', withDismissAction: type === 'error' })` from `@bug-on/m3-expressive`. Wrap children in `<SnackbarProvider>` if not already inside one so standalone tests and `App` both work cleanly.

- [ ] **Step 2: Upgrade `src/components/Icon.tsx`, `src/components/Button.tsx`, `src/components/IconButton.tsx`, and `src/components/Dialog.tsx`**

- `Icon.tsx`: Render `<span className={\`material-symbols-rounded select-none inline-flex items-center justify-center leading-none \${className}\`} style={{ fontVariationSettings: \`'FILL' \${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24\`, ...(size ? { fontSize: \`\${size}px\` } : {}), ...style }}>{name}</span>`.
- `Button.tsx`: Wrap `@bug-on/m3-expressive`'s `Button`, mapping legacy `variant` prop (`'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'`) to `colorStyle={colorStyle ?? variant ?? 'filled'}` and rendering optional leading `icon`.
- `IconButton.tsx`: Wrap `@bug-on/m3-expressive`'s `IconButton`, mapping `variant` to `colorStyle={colorStyle ?? variant ?? 'standard'}` and forwarding `selected`, `size`, `disabled`, `title`, `aria-label`, and `onClick`.
- `Dialog.tsx`: Wrap `@bug-on/m3-expressive`'s `Dialog`, `DialogContent`, `DialogHeader`, `DialogIcon`, `DialogTitle`, `DialogBody`, and `DialogFooter` so `open`, `onOpenChange={(isOpen) => !isOpen && onClose()}`, `title`, `icon`, `children`, and `actions` render with M3 Expressive spring physics and Radix accessibility.

- [ ] **Step 3: Run typecheck and test suite**

Run: `bunx tsc -b && bun test`
Expected: PASS with 0 TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/contexts/ToastContext.tsx src/components/Icon.tsx src/components/Button.tsx src/components/IconButton.tsx src/components/Dialog.tsx
git commit -m "feat(ui): bridge ToastContext to M3 Snackbar and wrap Button, IconButton, Dialog"
```

---

### Task 3: Layer 2 — Expressive Floating Canvas App Shell (`NavigationRail`, `Sidebar`, `TabBar`, `Breadcrumbs`, `Omnibar`, `App.tsx`)

**Files:**
- Modify: `src/components/NavigationRail.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/TabBar.tsx`
- Modify: `src/components/Breadcrumbs.tsx`
- Modify: `src/components/Omnibar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `AppThemeProvider`, `useAppTheme` from `src/contexts/AppThemeContext.tsx`; M3 Expressive components from `@bug-on/m3-expressive` (`NavigationRail`, `NavigationRailItem`, `NavigationDrawer`, `NavigationDrawerContent`, `NavigationDrawerSectionHeader`, `NavigationDrawerItem`, `NavigationDrawerDivider`, `FABMenu`, `ScrollArea`, `TextField`).
- Produces:
  - `NavigationRail`: Renders `@bug-on/m3-expressive` `NavigationRail` (`shape="pill"`, `header={headerAction}`, `fab={fab}`) and `NavigationRailItem`s.
  - `Sidebar`: Renders spring-collapsible M3 Expressive `NavigationDrawer` (`Places` and `Devices` sections with drive size badges).
  - `TabBar`: Renders M3 Expressive pill/container tabs with middle-click close, close `IconButton`, and new-tab `IconButton`.
  - `Breadcrumbs` & `Omnibar`: Renders interactive M3 Expressive pill path segments that morph into a focused path/search input bar on click.
  - `App`: Expressive Floating Canvas layout (`bg-m3-surface p-2 gap-2`, `bg-m3-surface-container-low rounded-m3-xl` main canvas, `FABMenu` in rail for New Folder / Paste, `TextField` inside New Folder and Rename dialogs).

- [ ] **Step 1: Rewrite `src/components/NavigationRail.tsx` and `src/components/Sidebar.tsx`**

- In `NavigationRail.tsx`: Use `NavigationRail as M3NavigationRail` and `NavigationRailItem` from `@bug-on/m3-expressive` with `shape="pill"`, `header={headerAction}`, `fab={fab}`, and map `items` to `<NavigationRailItem key={index} selected={Boolean(item.active)} icon={item.icon} activeIcon={item.activeIcon} label={item.label} onClick={item.onClick} />`.
- In `Sidebar.tsx`: Use `NavigationDrawer`, `NavigationDrawerContent`, `NavigationDrawerSectionHeader`, `NavigationDrawerItem`, `NavigationDrawerDivider`, and `ScrollArea` from `@bug-on/m3-expressive` wrapped in a `motion.aside` container (`transition={FAST_SPATIAL_SPRING}`) that animates width between `240px` (`!collapsed`) and `0px` (`collapsed`). Display drive `size` as the `badge` prop on `NavigationDrawerItem`.

- [ ] **Step 2: Rewrite `src/components/TabBar.tsx`, `src/components/Breadcrumbs.tsx`, and `src/components/Omnibar.tsx`**

- In `TabBar.tsx`: Render a sleek M3 Expressive horizontal tab strip (`bg-m3-surface-container px-3 pt-2 pb-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-m3-outline-variant/30`) where each tab uses expressive pill/squircle styling (`rounded-m3-lg` when active with `bg-m3-secondary-container text-m3-on-secondary-container font-medium shadow-xs`, `hover:bg-m3-surface-container-high text-m3-on-surface-variant` when inactive), middle-click (`onAuxClick`) close, trailing close button, and an `IconButton` (`size="xs"`, `colorStyle="tonal"`) for `+ New Tab`.
- In `Breadcrumbs.tsx` and `Omnibar.tsx`: Style `Omnibar` as an M3 Expressive pill bar (`h-11 rounded-m3-full bg-m3-surface-container-high px-4 flex items-center gap-2 border border-transparent focus-within:border-m3-primary focus-within:bg-m3-surface-container-highest transition-all`). In breadcrumb mode, each path segment is an interactive pill button (`px-2.5 py-1 rounded-m3-full hover:bg-m3-secondary-container/60 text-sm font-medium truncate`) separated by `chevron_right` icons, with a trailing `search` / `edit` trigger badge.

- [ ] **Step 3: Rewrite `src/App.tsx` to Expressive Floating Canvas & `AppThemeProvider`**

- Wrap `<App />` in `<AppThemeProvider><ToastProvider><ClipboardProvider><AppContent /></ClipboardProvider></ToastProvider></AppThemeProvider>`.
- Add a `FABMenu` (`expanded={fabMenuOpen}`, `onToggle={setFabMenuOpen}`) to `NavigationRail`'s `fab` prop with items for **New Folder** (`create_new_folder`) and **Paste** (`content_paste`, when clipboard is non-empty).
- Style the main content container as the Floating Canvas: `flex-1 h-full bg-m3-surface-container-low rounded-m3-xl border border-m3-outline-variant/40 overflow-hidden flex flex-col shadow-xs relative`.
- Replace raw `<input>` elements in the **New Folder** and **Rename** dialogs with `@bug-on/m3-expressive` `TextField` (`variant="outlined"`, `label`, `value`, `onChange={(val) => ...}`, `error={!validation.valid && value.length > 0}`, `errorText={validation.error}`).

- [ ] **Step 4: Run typecheck, tests, and production web build**

Run: `bunx tsc -b && bun test && bun run build:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/NavigationRail.tsx src/components/Sidebar.tsx src/components/TabBar.tsx src/components/Breadcrumbs.tsx src/components/Omnibar.tsx src/App.tsx
git commit -m "feat(ui): rewrite App shell, NavigationRail, Sidebar, TabBar, and Omnibar in M3 Expressive"
```

---

### Task 4: Layer 3A — Organic Shape Utilities & Expressive Bento `Dashboard`

**Files:**
- Create: `src/utils/shapeUtils.ts`
- Create: `src/utils/__tests__/shapeUtils.test.ts`
- Modify: `src/components/Dashboard.tsx`

**Interfaces:**
- Produces:
  - `src/utils/shapeUtils.ts`:
    - `export const LARGE_FOLDER_MORPH_LIMIT = 300`
    - `export interface ShapePair { rest: MD3ShapeName; morph: MD3ShapeName; containerClass: string }`
    - `export function getFileGroupShapePair(group: string, isDirectory: boolean): ShapePair`
    - `export function getPinnedIndexShapePair(index: number): { rest: MD3ShapeName; morph: MD3ShapeName }`
    - `export function shouldEnableItemMorph(totalItems: number, isSelected: boolean): boolean`

- [ ] **Step 1: Write the failing unit tests in `src/utils/__tests__/shapeUtils.test.ts`**

```typescript
import { describe, expect, test } from 'bun:test';
import { MD3Shapes } from '@bug-on/m3-expressive';
import { GROUP_ORDER } from '../fileUtils';
import {
  LARGE_FOLDER_MORPH_LIMIT,
  getFileGroupShapePair,
  getPinnedIndexShapePair,
  shouldEnableItemMorph,
} from '../shapeUtils';

describe('shapeUtils', () => {
  test('every semantic group in GROUP_ORDER maps to valid MD3Shapes keys', () => {
    const validKeys = new Set(Object.keys(MD3Shapes));
    for (const group of GROUP_ORDER) {
      const pair = getFileGroupShapePair(group, group === 'Folders');
      expect(validKeys.has(pair.rest)).toBe(true);
      expect(validKeys.has(pair.morph)).toBe(true);
      expect(pair.containerClass.length).toBeGreaterThan(0);
    }
  });

  test('getPinnedIndexShapePair cycles through valid MD3Shapes keys', () => {
    const validKeys = new Set(Object.keys(MD3Shapes));
    for (let i = 0; i < 10; i++) {
      const pair = getPinnedIndexShapePair(i);
      expect(validKeys.has(pair.rest)).toBe(true);
      expect(validKeys.has(pair.morph)).toBe(true);
    }
  });

  test('shouldEnableItemMorph disables morph on unselected items when folder exceeds 300 items', () => {
    expect(shouldEnableItemMorph(150, false)).toBe(true);
    expect(shouldEnableItemMorph(LARGE_FOLDER_MORPH_LIMIT, false)).toBe(true);
    expect(shouldEnableItemMorph(LARGE_FOLDER_MORPH_LIMIT + 1, false)).toBe(false);
    expect(shouldEnableItemMorph(5000, true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/__tests__/shapeUtils.test.ts`
Expected: FAIL with `Cannot find module '../shapeUtils'`

- [ ] **Step 3: Implement `src/utils/shapeUtils.ts`**

Map each semantic group to valid `MD3ShapeName` pairs:
- `Folders` (`isDirectory: true`): `{ rest: 'cookie4Sided', morph: 'flower', containerClass: 'bg-m3-primary-container text-m3-on-primary-container' }`
- `Images`: `{ rest: 'clover4Leaf', morph: 'sunny', containerClass: 'bg-m3-tertiary-container text-m3-on-tertiary-container' }`
- `Videos`: `{ rest: 'pill', morph: 'softBurst', containerClass: 'bg-m3-secondary-container text-m3-on-secondary-container' }`
- `Audio`: `{ rest: 'cookie6Sided', morph: 'verySunny', containerClass: 'bg-m3-tertiary-container text-m3-on-tertiary-container' }`
- `Archives`: `{ rest: 'pentagon', morph: 'cookie9Sided', containerClass: 'bg-m3-secondary-container text-m3-on-secondary-container' }`
- `Documents`: `{ rest: 'arch', morph: 'clover8Leaf', containerClass: 'bg-m3-surface-container-highest text-m3-primary' }`
- `Code`: `{ rest: 'slanted', morph: 'diamond', containerClass: 'bg-m3-secondary-container text-m3-on-secondary-container' }`
- `Files` (default): `{ rest: 'square', morph: 'cookie4Sided', containerClass: 'bg-m3-surface-container-highest text-m3-on-surface-variant' }`

- [ ] **Step 4: Rewrite `src/components/Dashboard.tsx` using Bento `Card`s, `ProgressIndicator`, `ShapeMedia`, and `List`/`ListItem`**

- Use `@bug-on/m3-expressive` `Card`, `CardContent`, `ProgressIndicator`, `ShapeMedia`, `List`, `ListItem`, `ScrollArea`, and `IconButton`.
- Render the Hero + System Storage Bento card (`col-span-12 lg:col-span-5`) with a morphing `ShapeMedia` (`shape="flower"` → `morphTo="verySunny"` `morphOn="hover"`) percentage badge and `ProgressIndicator` (`variant="linear"`, `value={getUsagePercent()}`).
- Render the Pinned Folders Bento card (`col-span-12 lg:col-span-7`) where each pin uses `ShapeMedia` with `getPinnedIndexShapePair(idx)` (`morphOn="hover"`), an unpin `IconButton` on hover, and an expressive "Add Pin" tile.
- Render the Recent Files Bento card (`col-span-12`) using `List` and `ListItem` (`headline={file.name}`, `supportingText={file.path}`, leading `ShapeMedia` icon).

- [ ] **Step 5: Run tests and verify build**

Run: `bun test src/utils/__tests__/shapeUtils.test.ts src/utils/__tests__/dashboardUtils.test.ts && bunx tsc -b`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/shapeUtils.ts src/utils/__tests__/shapeUtils.test.ts src/components/Dashboard.tsx
git commit -m "feat(ui): add M3 Expressive shape utilities and Bento Dashboard with ShapeMedia"
```

---

### Task 5: Layer 3B — `FileList` (Organic Shapes Grid + `MD3Table` List), `FileListSkeleton`, `StatusBar`, and Contextual `HorizontalFloatingToolbar` in `ExplorerTab`

**Files:**
- Modify: `src/components/FileListSkeleton.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/components/FileList.tsx`
- Modify: `src/components/ExplorerTab.tsx`

**Interfaces:**
- Consumes: `getFileGroupShapePair`, `shouldEnableItemMorph` from `src/utils/shapeUtils.ts`; `isModalDialogOpen` from `src/utils/themeUtils.ts`; `ShapeMedia`, `MD3Table`, `MD3TableHead`, `MD3TableHeaderCell`, `MD3TableBody`, `MD3TableRow`, `MD3TableCell`, `MD3TableSortIndicator`, `HorizontalFloatingToolbar`, `ToolbarIconButton`, `ToolbarDivider`, `PlainTooltip`, `TooltipTrigger`, `TooltipBox`, `LoadingIndicator`, `Chip`, `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuDivider` from `@bug-on/m3-expressive`.
- Produces:
  - `ExplorerTabProps` extended with optional callbacks `onRenameRequest?: (file: IFile) => void`, `onPropertiesRequest?: (file: IFile) => void`, `onOpenWithRequest?: (file: IFile) => void` (wired from `App.tsx`) so the contextual `HorizontalFloatingToolbar` can trigger Rename, Properties, and Open With directly.

- [ ] **Step 1: Rewrite `src/components/FileListSkeleton.tsx` and `src/components/StatusBar.tsx`**

- In `FileListSkeleton.tsx`: Render `@bug-on/m3-expressive` `LoadingIndicator` centered at the top of the skeleton view plus pulsing `bg-m3-surface-container-high rounded-m3-lg animate-pulse` grid cards or list rows matching `viewMode`.
- In `StatusBar.tsx`: Render a Tailwind v4 M3 Expressive footer (`h-8 px-5 bg-m3-surface-container border-t border-m3-outline-variant/40 text-xs text-m3-on-surface-variant flex items-center justify-between select-none shrink-0`) with item count, hidden files pill, and selected count + byte size badge.

- [ ] **Step 2: Rewrite `src/components/FileList.tsx` with Organic `ShapeMedia` Grid and `MD3Table` List View**

- Preserve `.file-list-item` class on each item root so `ExplorerTab.tsx`'s click-outside selection clear (`!(e.target as HTMLElement).closest('.file-list-item')`) continues to work identically.
- **Empty State**: Render `ShapeMedia` (`shape="clover4Leaf"`, `morphTo="flower"`, `morphOn="hover"`, `width={88}`, `height={88}`) wrapping `search_off` or `folder_open` `Icon`.
- **Grid View**:
  - Render group headers with an expressive pill chip (`bg-m3-secondary-container/70 text-m3-on-secondary-container text-xs font-semibold px-3 py-1 rounded-m3-full`) and divider line when `groupingEnabled` is true.
  - Render each file item inside an interactive card (`file-list-item group relative flex flex-col items-center p-2.5 rounded-m3-lg transition-all cursor-pointer select-none`).
  - Wrap the folder/file icon or lazy image thumbnail inside `<ShapeMedia shape={isSelected ? shapePair.morph : shapePair.rest} morphTo={enableMorph ? (isSelected ? shapePair.rest : shapePair.morph) : undefined} morphOn="hover" width={effectiveIconSize + 16} height={effectiveIconSize + 16} className={...}>` where `enableMorph = shouldEnableItemMorph(sortedFiles.length, isSelected)`.
- **List View**:
  - Render `<MD3Table density="compact">` with `<MD3TableHead sticky>` and `<MD3TableHeaderCell>` columns for Icon, Name (sortable with `MD3TableSortIndicator`), Date Modified (sortable), Type, and Size (right-aligned, sortable).
  - Render `<MD3TableRow className="file-list-item ...">` with leading small `ShapeMedia` (`width={32}`, `height={32}`), file name, formatted date, semantic group badge, and formatted size.

- [ ] **Step 3: Rewrite `src/components/ExplorerTab.tsx` with M3 Expressive Toolbar, `HorizontalFloatingToolbar`, and Modal Keyboard Guard**

- Replace `document.querySelector('dialog[open]')` in the `Space` handler (and add the guard to `Delete`, `Ctrl+A`, `Ctrl+C`, `Ctrl+X`, `Ctrl+V`) with `isModalDialogOpen()` from `src/utils/themeUtils.ts`.
- Style the top navigation bar with M3 Expressive `IconButton`s, `Omnibar`, and compact action buttons (New Folder, Hidden Files toggle, Grouping toggle, Sort controls, View Mode toggle).
- Add the contextual **`HorizontalFloatingToolbar`** at the bottom of `ExplorerTab` (`absolute bottom-10 left-1/2 -translate-x-1/2 z-20`) when `selectedFiles.size > 0`:
  - Leading selection count chip (`{selectedFiles.size} selected` with close icon to clear selection).
  - `ToolbarIconButton` actions: **Open** (when 1 selected), **Quick Look** (`visibility`, when 1 selected), **Copy** (`content_copy`), **Cut** (`content_cut`), **Rename** (`edit`, when 1 selected and `onRenameRequest` provided), **Properties** (`info`, when 1 selected and `onPropertiesRequest` provided), and **Delete** (`delete`, moves selected items to Trash).
- Pass `onRenameRequest`, `onPropertiesRequest`, and `onOpenWithRequest` from `src/App.tsx` into `<ExplorerTab />`.

- [ ] **Step 4: Run tests and verify build**

Run: `bun test && bunx tsc -b && bun run build:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/FileListSkeleton.tsx src/components/StatusBar.tsx src/components/FileList.tsx src/components/ExplorerTab.tsx src/App.tsx
git commit -m "feat(ui): rewrite FileList with ShapeMedia and MD3Table and add HorizontalFloatingToolbar"
```

---

### Task 6: Layer 4A — Rewrite `SettingsDialog` (with Theme Mode, Matugen Toggle & Source Color Picker), `PropertiesDialog`, `OpenWithDialog`, and `ConflictDialog`

**Files:**
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/components/PropertiesDialog.tsx`
- Modify: `src/components/OpenWithDialog.tsx`
- Modify: `src/components/ConflictDialog.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAppTheme` from `src/contexts/AppThemeContext.tsx`; `PRESET_SEED_COLORS` from `src/utils/themeUtils.ts`; `Switch`, `Slider`, `Checkbox`, `TextField`, `List`, `ListItem`, `ScrollArea`, `ShapeMedia`, `Chip` from `@bug-on/m3-expressive`.

- [ ] **Step 1: Rewrite `src/components/SettingsDialog.tsx` with M3 Expressive Controls & Hybrid Theme Settings**

- Consume `useAppTheme()` inside `SettingsDialog` (`themeMode`, `setThemeMode`, `sourceColor`, `setSourceColor`, `useMatugen`, `setUseMatugen`, `matugenDetected`, `matugenSeedColor`, `customCssPath`, `importCustomCss`, `clearCustomCss`).
- Organize into 3 M3 Expressive sections inside `Dialog`:
  1. **Theme & Dynamic Color**:
     - **Theme Mode**: 3-button segmented row (`System` with `brightness_auto`, `Light` with `light_mode`, `Dark` with `dark_mode`) using `Button` (`colorStyle={themeMode === mode ? 'filled' : 'outlined'}`).
     - **Matugen System Sync**: Row with `@bug-on/m3-expressive` `Switch` (`checked={useMatugen}`, `onCheckedChange={setUseMatugen}`), status badge (`Matugen detected: ${matugenSeedColor}` when `matugenDetected` is true, or `No ~/.config/matugen/theme.css found` when false).
     - **Source Color Palette**: Preset swatch buttons from `PRESET_SEED_COLORS` (morphing circle/flower indicator on active swatch) + custom `<input type="color" value={sourceColor} onChange={(e) => { setUseMatugen(false); setSourceColor(e.target.value); }} />`.
  2. **Explorer & Layout**:
     - **View Mode**: `Grid` / `List` buttons.
     - **Icon Size**: `@bug-on/m3-expressive` `Slider` (`min={32}`, `max={128}`, `step={8}`, `value={iconSize}`, `onValueChange={onIconSizeChange}`).
     - **Show Hidden Files**: `@bug-on/m3-expressive` `Switch` (`checked={showHiddenFiles}`, `onCheckedChange={onToggleHiddenFiles}`).
     - **Filled Icons**: `@bug-on/m3-expressive` `Switch` (`checked={filledIcons}`, `onCheckedChange={onToggleFilledIcons}`).
  3. **Custom Stylesheet**:
     - Import CSS `Button` + Clear CSS `Button` (when `customCssPath` is set) + truncated path display.

- [ ] **Step 2: Rewrite `src/components/PropertiesDialog.tsx`, `src/components/OpenWithDialog.tsx`, and `src/components/ConflictDialog.tsx`**

- In `PropertiesDialog.tsx`:
  - Render header with `<ShapeMedia shape="cookie4Sided" morphTo="flower" morphOn="hover" width={64} height={64}>` wrapping the file/folder icon.
  - **Preserve exact test contract for `userSelectCss.test.ts`**: keep `style={{ userSelect: 'text' }}>{file.name}</div>` and `style={{ userSelect: 'text' }}>{file.path}</div>` on the filename and location elements.
- In `OpenWithDialog.tsx`:
  - Use `@bug-on/m3-expressive` `TextField` (`variant="outlined"`, `placeholder="Search applications..."`, `value={search}`, `onChange={(val) => setSearch(val)}`) and `ScrollArea` containing recommended and all applications styled with M3 Expressive selection states (`bg-m3-secondary-container text-m3-on-secondary-container rounded-m3-md`).
- In `ConflictDialog.tsx`:
  - Use `@bug-on/m3-expressive` `Checkbox` (`checked={applyToAll}`, `onCheckedChange={setApplyToAll}`, `label="Apply to all remaining items"`) and M3 `Button` actions (`Skip`, `Keep both`, `Replace`).

- [ ] **Step 3: Run tests and verify `userSelectCss.test.ts` passes**

Run: `bun test && bunx tsc -b`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsDialog.tsx src/components/PropertiesDialog.tsx src/components/OpenWithDialog.tsx src/components/ConflictDialog.tsx src/App.tsx
git commit -m "feat(ui): rewrite Settings, Properties, OpenWith, and Conflict dialogs in M3 Expressive"
```

---

### Task 7: Layer 4B — Rewrite `ContextMenu`, `QuickLook`, and `TerminalPane`

**Files:**
- Modify: `src/components/ContextMenu.tsx`
- Modify: `src/components/QuickLook.tsx`
- Modify: `src/components/TerminalPane.tsx`

**Interfaces:**
- Consumes: `isModalDialogOpen` from `src/utils/themeUtils.ts`; `ShapeMedia`, `LoadingIndicator`, `Button`, `IconButton`, `FAST_SPATIAL_SPRING` from `@bug-on/m3-expressive`; `motion` from `motion/react`.

- [ ] **Step 1: Rewrite `src/components/ContextMenu.tsx` with M3 Expressive Menu Styling & Spring Motion**

- Replace `ContextMenu.css` with Tailwind v4 classes and `motion.div` (`initial={{ opacity: 0, scale: 0.92 }}`, `animate={{ opacity: 1, scale: 1 }}`, `transition={FAST_SPATIAL_SPRING}`) using `fixed z-50 min-w-[200px] max-w-[280px] bg-m3-surface-container-high text-m3-on-surface rounded-m3-lg p-1.5 shadow-xl border border-m3-outline-variant/40 select-none`.
- Render dividers as `my-1 h-px bg-m3-outline-variant/40` and items as `w-full flex items-center gap-3 px-3 py-2 rounded-m3-md text-sm font-medium hover:bg-m3-secondary-container hover:text-m3-on-secondary-container transition-colors text-left cursor-pointer`.

- [ ] **Step 2: Rewrite `src/components/QuickLook.tsx` with M3 Expressive Overlay, `ShapeMedia`, and Modal Keyboard Guard**

- Replace `document.querySelector('dialog[open]')` in `QuickLook.tsx` with `isModalDialogOpen()` from `src/utils/themeUtils.ts`.
- Replace `QuickLook.css` classes with Tailwind v4 M3 Expressive classes (`fixed inset-0 z-40 bg-black/55 backdrop-blur-xs flex items-center justify-center p-6`) and `motion.div` card (`w-full max-w-4xl max-h-[85vh] bg-m3-surface-container-high text-m3-on-surface rounded-m3-xl shadow-2xl border border-m3-outline-variant/40 flex flex-col overflow-hidden`).
- Use `ShapeMedia` (`shape="clover4Leaf"`, `morphTo="flower"`, `morphOn="hover"`, `width={96}`, `height={96}`) in the folder/file info preview panel and `LoadingIndicator` while text preview loads.
- Keep `className="quicklook-text-content ..."` on the `<pre>` element so `.quicklook-text-content { user-select: text; }` in `src/index.css` continues to apply.

- [ ] **Step 3: Update `src/components/TerminalPane.tsx` and Terminal Drawer Header in `src/App.tsx`**

- In `TerminalPane.tsx`: Read computed `--md-sys-color-surface-container-lowest` and `--md-sys-color-on-surface` from `getComputedStyle(document.documentElement)` to theme the `xterm` instance (`background`, `foreground`, `cursor`) and fit automatically on container resize (`ResizeObserver`).
- In `src/App.tsx`: Style the collapsible Terminal bottom panel header with M3 Expressive classes (`bg-m3-surface-container-high border-t border-m3-outline-variant/40 px-4 py-1.5 flex items-center justify-between`) showing a terminal icon, active `cwd` badge, and close `IconButton`.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test && bunx tsc -b`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ContextMenu.tsx src/components/QuickLook.tsx src/components/TerminalPane.tsx src/App.tsx
git commit -m "feat(ui): rewrite ContextMenu, QuickLook, and TerminalPane with M3 Expressive styling"
```

---

### Task 8: Layer 4C — Legacy CSS Cleanup, Test Updates & Full Production Verification

**Files:**
- Delete: `src/App.css`, `src/components/Breadcrumbs.css`, `src/components/Button.css`, `src/components/CircularProgress.css`, `src/components/ContextMenu.css`, `src/components/Dashboard.css`, `src/components/Dialog.css`, `src/components/FileList.css`, `src/components/IconButton.css`, `src/components/NavigationRail.css`, `src/components/Omnibar.css`, `src/components/QuickLook.css`, `src/components/Sidebar.css`, `src/components/Skeleton.css`, `src/components/TabBar.css`, `src/components/Toast.css`, `src/components/Toast.tsx`, `src/theme/fallback.css`
- Modify: `src/components/__tests__/userSelectCss.test.ts`

**Interfaces:**
- Consumes: `src/index.css` (which now defines `.quicklook-text-content { user-select: text; }`) and `src/components/PropertiesDialog.tsx`.

- [ ] **Step 1: Update `src/components/__tests__/userSelectCss.test.ts` to read `.quicklook-text-content` from `src/index.css`**

In `src/components/__tests__/userSelectCss.test.ts`, remove `const quickLookCss = readFileSync(resolve(__dirname, '../QuickLook.css'), 'utf-8');` and assert `expect(indexCss).toMatch(/\.quicklook-text-content\s*\{[^}]*user-select:\s*text/s);`.

- [ ] **Step 2: Delete all 17 legacy CSS files and `src/components/Toast.tsx`**

Run:
```bash
git rm src/App.css src/components/Breadcrumbs.css src/components/Button.css src/components/CircularProgress.css src/components/ContextMenu.css src/components/Dashboard.css src/components/Dialog.css src/components/FileList.css src/components/IconButton.css src/components/NavigationRail.css src/components/Omnibar.css src/components/QuickLook.css src/components/Sidebar.css src/components/Skeleton.css src/components/TabBar.css src/components/Toast.css src/components/Toast.tsx src/theme/fallback.css
```

- [ ] **Step 3: Verify zero remaining imports of deleted CSS files and run full test + lint + build suite**

Run:
```bash
bun test && bunx tsc -b && bun run lint && bun run build:web && export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: All frontend tests pass, 0 TypeScript errors, 0 ESLint errors, Vite production bundle succeeds, and all 110 Rust tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(ui): remove legacy CSS files and finalize M3 Expressive UI rewrite"
```
