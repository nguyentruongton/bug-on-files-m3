# TabBar Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Chromium context menu on the tab bar with Material 3 Expressive `ContextMenu` actions for tabs (`Pin tab` / `Unpin tab`, `Close tab`, `Close Others`) and empty tab bar space (`About`, `Quit`).

**Architecture:** Extend `App.tsx`'s single global `contextMenu` state into a discriminated union (`file` | `tab` | `tabbar`) and pass optional `onTabContextMenu` / `onTabBarContextMenu` callbacks to `TabBar.tsx`. Keep tab state transformations (`togglePinTab`, `closeOtherTabs`) as pure functions in `src/utils/navigationHistory.ts`, add `AboutDialog.tsx` using the existing `Dialog` wrapper, and expose `quitApp` through `IApi` and Electron's `app:quit` IPC channel.

**Tech Stack:** React 19, TypeScript, `@bug-on/m3-expressive`, Electron IPC, Bun test runner (`bun test`).

**Spec:** [2026-11-14-tabbar-context-menu-design.md](file:///home/stark/Documents/GitHub/material-3-file-explorer/docs/superpowers/specs/2026-11-14-tabbar-context-menu-design.md)

## Global Constraints

- Reuse `ContextMenu` (`@bug-on/m3-expressive` `VerticalMenu`) and `Dialog` (`src/components/Dialog.tsx`); never use native Electron `Menu`.
- Keep only one global `ContextMenu` instance open at a time in `App.tsx`.
- Pinned tabs must keep their full title (`tab.title`), move to the left group, show a pin icon, and hide the quick `×` close button.
- `Close tab` is only available when `tabs.length > 1`.
- `Close Others` keeps the target tab and all `pinned === true` tabs, closing only other unpinned tabs.
- Ensure type-safety across `IApi` (`src/api/types.ts`), `electron/preload.ts`, `electron/main.ts`, and `src/api/tauriAdapter.ts`.

## Review Focus

- **Right-clicking a pinned tab vs. unpinned tab:** Pinned tab shows `Unpin tab` instead of `Pin tab`, hides the `×` button, and `Close tab` still works if `tabs.length > 1` (tested in Task 1 & Task 4).
- **Right-clicking a tab when `Close Others` has nothing closable:** When all other tabs are pinned or only 1 tab is open, `Close Others` is omitted so the user never sees a no-op menu item (tested in Task 5).
- **Right-clicking the `×` close button or `New tab` button:** Right-clicking a tab's `button[role="tab"]` stops propagation so the empty-space `tabbar` menu does not open instead (tested in Task 4).
- **Closing the active tab via `Close Others` on a background tab:** If the user right-clicks an inactive tab and chooses `Close Others` while the active tab is unpinned, `activeTabId` switches to the kept target tab and `terminalCwd` updates accordingly (tested in Task 1).
- **Unpinning a tab when multiple pinned and unpinned tabs exist:** Unpinning moves the tab into the unpinned section after all remaining pinned tabs without scrambling relative order (tested in Task 1).

---

### Task 1: Tab Pin & Close-Others Pure Helpers

**Files:**
- Modify: `src/utils/navigationHistory.ts:61-90`
- Test: `src/utils/__tests__/navigationHistory.test.ts`

**Interfaces:**
- Produces:
  - `togglePinTab<T extends { id: string; pinned?: boolean }>(tabs: T[], targetId: string): T[]`
  - `closeOtherTabs<T extends { id: string; path: string; pinned?: boolean }>(tabs: T[], activeTabId: string, keepId: string, currentTerminalCwd: string | undefined): { tabs: T[]; activeTabId: string; terminalCwd: string | undefined }`
  - `hasClosableOtherTabs<T extends { id: string; pinned?: boolean }>(tabs: T[], targetId: string): boolean`

- [ ] **Step 1: Write the failing tests**

Add `describe('togglePinTab, closeOtherTabs, and hasClosableOtherTabs', ...)` to `src/utils/__tests__/navigationHistory.test.ts` asserting:
1. `togglePinTab` pins an unpinned tab and moves it to the end of the pinned group (left side), preserving relative order of pinned and unpinned tabs.
2. `togglePinTab` unpins a pinned tab and moves it to the start of the unpinned group (after remaining pinned tabs).
3. `closeOtherTabs` keeps `keepId` and all `pinned: true` tabs, removing other unpinned tabs.
4. `closeOtherTabs` switches `activeTabId` to `keepId` and updates `terminalCwd` when the previously active tab was closed (and clears `terminalCwd` if `keepId` is `app://dashboard`).
5. `hasClosableOtherTabs` returns `false` when only `targetId` and pinned tabs exist, and `true` when at least one other unpinned tab exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/__tests__/navigationHistory.test.ts`
Expected: FAIL with missing export errors for `togglePinTab`, `closeOtherTabs`, `hasClosableOtherTabs`.

- [ ] **Step 3: Implement `togglePinTab`, `closeOtherTabs`, and `hasClosableOtherTabs` in `src/utils/navigationHistory.ts`**

- `togglePinTab`: map `targetId` to `{ ...t, pinned: !t.pinned }`, then partition `[...pinned, ...unpinned]` so pinned tabs stay grouped on the left while preserving relative order.
- `closeOtherTabs`: filter `tabs` keeping `t.id === keepId || Boolean(t.pinned)`. If `activeTabId` is still present in `newTabs`, preserve `activeTabId` and `currentTerminalCwd`; otherwise set `activeTabId = keepId` and derive `terminalCwd` from the kept tab's `path` (`undefined` if `app://` or empty).
- `hasClosableOtherTabs`: return `tabs.some((t) => t.id !== targetId && !t.pinned)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/__tests__/navigationHistory.test.ts`
Expected: PASS (all tests in `navigationHistory.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/utils/navigationHistory.ts src/utils/__tests__/navigationHistory.test.ts
git commit -m "feat: add togglePinTab and closeOtherTabs helpers"
```

---

### Task 2: Electron & API `quitApp` Support

**Files:**
- Modify: `src/api/types.ts:65-87`
- Modify: `src/api/tauriAdapter.ts:130-136`
- Modify: `electron/main.ts:473-478`
- Modify: `electron/preload.ts:24-28`

**Interfaces:**
- Produces: `IApi.quitApp: () => Promise<void>` in `src/api/types.ts`, implemented in `electron/preload.ts` (`ipcRenderer.invoke('app:quit')`), `electron/main.ts` (`ipcMain.handle('app:quit', () => app.quit())`), and `src/api/tauriAdapter.ts` (no-op or `window.close()` fallback).

- [ ] **Step 1: Add `quitApp: () => Promise<void>` to `IApi` in `src/api/types.ts`**
- [ ] **Step 2: Add `quitApp` IPC handler in `electron/main.ts` and expose `quitApp` in `electron/preload.ts`**
- [ ] **Step 3: Add `quitApp` implementation in `src/api/tauriAdapter.ts`** (calls `window.close()` as fallback if invoked outside Electron)
- [ ] **Step 4: Verify TypeScript compilation for both renderer and electron**

Run: `npx tsc -b && npx tsc -p electron/tsconfig.json`
Expected: Exit code 0 with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/tauriAdapter.ts electron/main.ts electron/preload.ts
git commit -m "feat: expose quitApp IPC for exiting the application"
```

---

### Task 3: `AboutDialog` Component

**Files:**
- Create: `src/components/AboutDialog.tsx`
- Modify: `src/components/__tests__/uiStandardization.test.tsx`

**Interfaces:**
- Produces: `AboutDialog: React.FC<{ open: boolean; onClose: () => void }>`

- [ ] **Step 1: Write the failing test in `src/components/__tests__/uiStandardization.test.tsx`**

Add a test asserting `AboutDialog` renders app name `Materials`, version `0.1.0`, and a `Close` action button when `open={true}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL because `../AboutDialog` does not exist.

- [ ] **Step 3: Create `src/components/AboutDialog.tsx`**

Use `Dialog` (`./Dialog`), `Button` (`./Button`), and `Icon` (`./Icon`) to render an M3 Expressive dialog titled `About Materials` with version `0.1.0`, short description (`Material 3 Expressive File Explorer`), and a `Close` button.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AboutDialog.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "feat: add AboutDialog component"
```

---

### Task 4: `TabBar` Pinned Rendering & Context Menu Handlers

**Files:**
- Modify: `src/components/TabBar.tsx:6-35,89-180`
- Modify: `src/components/__tests__/uiStandardization.test.tsx:73-135`

**Interfaces:**
- Consumes: `Tab` (`{ id: string; path: string; title: string; pinned?: boolean }`)
- Produces:
  - `Tab.pinned?: boolean`
  - `TabBarProps.onTabContextMenu?: (e: React.MouseEvent, tab: Tab) => void`
  - `TabBarProps.onTabBarContextMenu?: (e: React.MouseEvent) => void`

- [ ] **Step 1: Write the failing tests in `src/components/__tests__/uiStandardization.test.tsx`**

Add tests in `describe('TabBar standardization', ...)` asserting:
1. A tab with `pinned: true` still renders its `tab.title`, does NOT render `aria-label="Close <title>"` even when multiple tabs are open, and renders the pin icon (`keep`).
2. `TabBar` attaches `onContextMenu` handlers without breaking existing `role="tablist"` / `role="tab"` markup.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL (pinned tab still renders `aria-label="Close ..."` and lacks pin icon).

- [ ] **Step 3: Update `src/components/TabBar.tsx`**

- Add `pinned?: boolean` to `export interface Tab`.
- Add optional `onTabContextMenu?: (e: React.MouseEvent, tab: Tab) => void` and `onTabBarContextMenu?: (e: React.MouseEvent) => void` to `TabBarProps`.
- On the outer tab bar container `div`, attach `onContextMenu={(e) => { e.preventDefault(); onTabBarContextMenu?.(e); }}`.
- On each `Button[role="tab"]`, attach `onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onTabContextMenu?.(e, tab); }}`.
- For pinned tabs (`tab.pinned`), hide the close `span[role="button"]` (also block middle-click close when `tab.pinned`), keep `tab.title`, and render `<Icon name="keep" size={14} className="shrink-0 opacity-75" />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TabBar.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "feat: support pinned tabs and context menu callbacks in TabBar"
```

---

### Task 5: Wire Tab & TabBar ContextMenu + `AboutDialog` in `App.tsx`

**Files:**
- Create: `src/utils/tabContextMenu.ts`
- Test: `src/utils/__tests__/tabContextMenu.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes:
  - `ContextMenuItem` (`src/components/ContextMenu.tsx`)
  - `togglePinTab`, `closeOtherTabs`, `hasClosableOtherTabs` (`src/utils/navigationHistory.ts`)
  - `AboutDialog` (`src/components/AboutDialog.tsx`)
  - `api.quitApp()` (`src/api/types.ts`)
- Produces:
  - `buildTabContextMenuItems(params): ContextMenuItem[]`
  - `buildTabBarContextMenuItems(params): ContextMenuItem[]`

- [ ] **Step 1: Write the failing tests in `src/utils/__tests__/tabContextMenu.test.ts`**

Test `buildTabContextMenuItems` and `buildTabBarContextMenuItems`:
1. For an unpinned tab when other unpinned tabs exist: returns `Pin tab`, `Close tab`, `Close Others`.
2. For a pinned tab when all other tabs are pinned: returns `Unpin tab` and `Close tab` (omits `Close Others`).
3. When only 1 tab is open: omits `Close tab` and `Close Others`, keeping `Pin tab` / `Unpin tab`.
4. For `buildTabBarContextMenuItems`: returns `About` and `Quit` items that invoke `onAbout` and `onQuit`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/__tests__/tabContextMenu.test.ts`
Expected: FAIL because `src/utils/tabContextMenu.ts` does not exist.

- [ ] **Step 3: Create `src/utils/tabContextMenu.ts` and wire into `src/App.tsx`**

- Implement `buildTabContextMenuItems` and `buildTabBarContextMenuItems` in `src/utils/tabContextMenu.ts`.
- In `src/App.tsx`:
  - Add `pinned?: boolean` to `TabState` and `aboutDialogOpen` boolean state.
  - Refactor `contextMenu` state to a discriminated union:
    - `{ kind: 'file'; x: number; y: number; item: IFile | null; selectedItems: IFile[] }`
    - `{ kind: 'tab'; x: number; y: number; tabId: string }`
    - `{ kind: 'tabbar'; x: number; y: number }`
  - Add `handleTogglePinTab`, `handleCloseOtherTabs`, `handleTabContextMenu`, `handleTabBarContextMenu`, and `handleQuitApp` (`api?.quitApp ? api.quitApp() : window.close()`).
  - Pass `onTabContextMenu={handleTabContextMenu}` and `onTabBarContextMenu={handleTabBarContextMenu}` to `<TabBar />`.
  - Compute `menuItems` for `tab` and `tabbar` using `buildTabContextMenuItems` / `buildTabBarContextMenuItems`, and render `<AboutDialog open={aboutDialogOpen} onClose={() => setAboutDialogOpen(false)} />`.

- [ ] **Step 4: Run all tests, lint, and build**

Run:
- `bun test`
- `npm run lint`
- `npm run build`
Expected: All tests pass, lint exits 0, and production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/utils/tabContextMenu.ts src/utils/__tests__/tabContextMenu.test.ts src/App.tsx
git commit -m "feat: wire tab and tabbar context menus and AboutDialog in App"
```

