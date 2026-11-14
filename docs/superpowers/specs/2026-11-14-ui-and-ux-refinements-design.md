# UI & UX Refinements Design Spec (7 Improvements)

**Date:** 2026-11-14
**Status:** Draft (Pending User Approval)

---

## 1. Overview & Scope

This specification covers 7 targeted UI/UX and backend refinements in Material 3 File Explorer:

1. **New Tab opens Dashboard (`app://dashboard`)** by default instead of duplicating the currently active tab's path.
2. **Real-Time Archive Extraction Progress** with determinate percentage + file counter, streamed from both Tauri and Electron backends and rendered using `@bug-on/m3-expressive`'s wavy `ProgressIndicator`.
3. **Fix Clipped `TextField` Floating Label in `Dialog`** ("New Folder" and "Rename" modals).
4. **Toolbar Refinement (`ExplorerTab.tsx`)**: Convert all 3 `ButtonGroup` clusters (Navigation, Quick Actions, Sort) into standalone `IconButton`s (`toggle` + `selected` for stateful buttons).
5. **Icon `animateFill` and `fill={1}` on Active/Selected States**: Add spring-animated Material Symbols `FILL` axis (`0 <-> 1`) to `src/components/Icon.tsx` and apply it across active/selected UI states.
6. **Expressive Context Menu (`ContextMenu.tsx`)**: Refactor `ContextMenu` to use `VerticalMenu`, `VerticalMenuContent`, `VerticalMenuGroup`, and `MenuItem` from `@bug-on/m3-expressive`.
7. **System Theme Mode Detection Fix**: Resolve Light/Dark mode accurately when `themeMode === 'system'` on Linux desktops (Hyprland / Caelestia / Matugen / GTK) where `prefers-color-scheme` is stuck on dark.

---

## 2. Detailed Design by Feature

### 2.1. Item 1: New Tab Default Path (`app://dashboard`)

#### Problem
In `src/App.tsx`, `handleAddTab(path?: string)` computes:
```ts
const newPath = path || currentPath || '/';
```
When the user clicks the `+` button in `TabBar` (`onNewTab={() => handleAddTab()}`), presses `Ctrl+T` (if bound), or clicks "Open New Tab" in the empty state, `path` is `undefined`, causing the new tab to duplicate `currentPath`.

#### Solution
- Update `handleAddTab(path?: string)` in `src/App.tsx`:
  ```ts
  const handleAddTab = (path?: string) => {
    const newPath = path || 'app://dashboard';
    const newId = Math.random().toString(36).substr(2, 9);
    const title = getTabTitle(newPath);
    setTabs(prev => [...prev, { id: newId, path: newPath, title }]);
    setActiveTabId(newId);
  };
  ```
- Explicit calls such as `handleAddTab(homePath)` or `handleAddTab('app://dashboard')` from `NavigationRail` when `tabs.length === 0` continue to open the requested path.

---

### 2.2. Item 2: Archive Extraction Progress with Wavy `ProgressIndicator`

#### Problem
1. In Tauri (`src-tauri/src/commands/app.rs`), `extract_file` runs `std::process::Command::new(&cmd).args(&args).status()` synchronously on the main command thread without emitting progress events, freezing the UI until extraction finishes.
2. In Electron (`electron/main.ts`), `fs:extract` runs `execFile` without streaming stdout or reporting progress.
3. `ExplorerTab.tsx` only shows a static toast `"Extracting filename..."` before `await api.extractFile(file.path)`.

#### Architecture & Data Flow
1. **Shared Event Payload (`ExtractProgressPayload`)**:
   Defined in `src/api/types.ts` (and mirrored in Rust/Electron):
   ```ts
   export interface ExtractProgressEvent {
     path: string;          // Full path of archive being extracted
     archiveName: string;   // Basename of archive (e.g. "photos.zip")
     currentFile: string;   // Current entry being extracted
     extractedCount: number;// Number of entries processed so far
     totalCount: number;    // Total entries in archive (0 if unknown)
     percent?: number;      // 0..100 when totalCount > 0, undefined when indeterminate
     done: boolean;         // true when extraction finishes
     error?: string;        // Non-empty if extraction failed
   }
   ```
   Event channel name: `'fs:extract-progress'`.

2. **Backend Entry Counting & Streaming (`src-tauri/src/extract.rs` & `src-tauri/src/commands/app.rs`)**:
   - Add helper functions in `src-tauri/src/extract.rs`:
     - `list_entries_command(file: &str) -> Option<(String, Vec<String>)>`:
       - `.zip` -> `("unzip", ["-Z1", file])`
       - `.tar` | `.gz` | `.xz` | `.tgz` -> `("tar", ["-tf", file])`
     - `extract_verbose_command(file: &str) -> Option<(String, Vec<String>)>`:
       - `.zip` -> `("unzip", ["-o", file, "-d", dir])` (note: default `unzip -o` prints one line per extracted/inflated/created entry to stdout; `-q` is not passed)
       - `.tar` | `.gz` | `.xz` | `.tgz` -> `("tar", ["-xvf", file, "-C", dir])`
     - `parse_extracted_entry_line(cmd: &str, line: &str) -> Option<String>`:
       - For `unzip`: matches lines starting with `inflating:`, `extracting:`, `creating:`, or `linking:` (after trimming), returning the entry path. Ignore `Archive:` header lines.
       - For `tar`: any non-empty trimmed line is an extracted entry name.
     - `extract_file_with_progress<F>(file: &str, mut on_progress: F) -> Result<bool, String>` where `F: FnMut(ExtractProgressPayload)`:
       - First runs `list_entries_command(file)` to count non-empty stdout lines (`total_count`). If listing fails or returns 0, `total_count = 0` (indeterminate fallback).
       - Emits initial progress event (`extracted_count: 0`, `total_count`, `percent: if total_count > 0 { Some(0.0) } else { None }`, `done: false`).
       - Spawns `extract_verbose_command(file)` with `Stdio::piped()` for stdout, reads lines via `BufReader::new(stdout).lines()`.
       - For each parsed entry line, increments `extracted_count`, computes `percent = ((extracted_count as f64 / total_count as f64) * 100.0).min(100.0)`, and throttles callback invocations to at most once every ~40ms (always emitting the first entry and when `extracted_count == total_count`) so large archives with 50,000 small files do not flood IPC.
       - Waits for child exit status; emits final `done: true` event (`percent: Some(100.0)` on success, or `error` on failure) and returns `Ok(status.success())`.
   - In `src-tauri/src/commands/app.rs`:
     - Change `extract_file` to `pub async fn extract_file(app: tauri::AppHandle, path: String) -> Result<bool, String>`.
     - Execute `extract_file_with_progress` inside `tokio::task::spawn_blocking`, calling `let _ = app.emit("fs:extract-progress", payload);`.
     - Note: Command name remains `extract_file`, so `COMMAND_MAP` and `commandParity.test.ts` (37 commands) stay unchanged.

3. **Electron Backend (`electron/main.ts` & `electron/preload.ts`)**:
   - In `electron/main.ts`, update `ipcMain.handle('fs:extract', ...)` to count entries with `unzip -Z1` / `tar -tf` and spawn `unzip -o` / `tar -xvf`, streaming stdout lines and sending `mainWindow?.webContents.send('fs:extract-progress', payload)`.
   - In `electron/preload.ts`, expose `onExtractProgress: (cb: (e: ExtractProgressEvent) => void) => () => void` listening on `'fs:extract-progress'`.

4. **Frontend API & Wavy Progress UI (`src/api/types.ts`, `src/api/tauriAdapter.ts`, `src/components/ExplorerTab.tsx`)**:
   - Add `onExtractProgress: (cb: (e: ExtractProgressEvent) => void) => () => void` to `IApi` in `src/api/types.ts` and implement it in `src/api/tauriAdapter.ts` using `wrapListener(listen('fs:extract-progress', ...))`.
   - In `src/components/ExplorerTab.tsx`:
     - Subscribe to `api.onExtractProgress` when the tab is active (or while an extraction triggered in this tab is active, matching `event.path`).
     - Maintain `extractProgress: ExtractProgressEvent | null` state.
     - While `extractProgress && !extractProgress.done` is active, render a floating M3 Expressive progress card at the bottom-right of the tab (`bg-m3-surface-container-high text-m3-on-surface rounded-[20px] p-4 w-80 z-30`):
       - Header row: `<Icon name="folder_zip" size={20} className="text-m3-primary shrink-0" />`, title `Extracting {extractProgress.archiveName}`, and percentage badge (`{Math.round(extractProgress.percent)}%` when `percent !== undefined`).
       - Subtitle row: current entry name (`truncate text-xs text-m3-on-surface-variant`) + counter (`{extractedCount} / {totalCount}` when `totalCount > 0`).
       - Progress bar:
         ```tsx
         <ProgressIndicator
           variant="linear"
           shape="wavy"
           value={extractProgress.percent !== undefined ? Math.round(extractProgress.percent) : undefined}
           aria-label={`Extracting ${extractProgress.archiveName}`}
           color="var(--md-sys-color-primary)"
           trackColor="var(--md-sys-color-secondary-container)"
         />
         ```
     - When extraction completes (`done: true` or `await api.extractFile` resolves), clear `extractProgress`, show completion toast, and call `loadFiles(currentPath, { silent: true })`.

---

### 2.3. Item 3: Fix Clipped `TextField` Floating Label in `Dialog`

#### Root Cause
In `@bug-on/m3-expressive` (`overlays.js`), `DialogBody` wraps `children` inside:
```tsx
<ScrollArea className={cn("max-h-[calc(85dvh-200px)] -mx-6", className)} viewportClassName="px-6">
  <div className={contentClassName}>{children}</div>
</ScrollArea>
```
Because `ScrollArea`'s viewport has `overflow: hidden / scroll` starting at `y = 0` and `contentClassName` has no top padding (`pt-0`), an `outlined` `TextField` placed as the first child of `DialogBody` (such as in "New Folder" and "Rename" dialogs in `App.tsx`) has its floating notch label (`top: 0; transform: translateY(-50%)`, extending ~8px above the input border) clipped in half by the `ScrollArea` viewport top edge.

#### Solution
- In `src/components/Dialog.tsx`, pass `contentClassName="pt-2"` to `DialogBody`:
  ```tsx
  <DialogBody contentClassName="pt-2">{children}</DialogBody>
  ```
  Adding `8px` (`pt-2`) of top padding inside the scroll viewport gives the floating label full vertical clearance without modifying `node_modules/@bug-on/m3-expressive`.

---

### 2.4. Item 4: Toolbar Refinement — Convert All 3 `ButtonGroup` Clusters to `IconButton`

#### Problem
In `src/components/ExplorerTab.tsx`, the toolbar currently wraps 3 button clusters inside `<ButtonGroup size="sm">` using a custom `ToolbarGroupButton` wrapper around `<Button variant="toggle" | "tonal">`. The user requested converting all 3 clusters into standalone `IconButton`s (`toggle` + `selected` where applicable).

#### Solution
- Remove `ButtonGroup` import and `ToolbarGroupButton` helper from `src/components/ExplorerTab.tsx`.
- Render each cluster as a `<div className="flex items-center gap-1 shrink-0">` containing standalone `<IconButton variant="tonal" size="sm" ...>` buttons:
  1. **Cluster 1 — Navigation (`Back`, `Forward`, `Up`)**:
     - `Back`: `<IconButton variant="tonal" size="sm" onClick={goBack} disabled={historyIndex <= 0} aria-label="Back" title="Back (Alt+Left)">`
     - `Forward`: `<IconButton variant="tonal" size="sm" onClick={goForward} disabled={historyIndex >= history.length - 1} aria-label="Forward" title="Forward (Alt+Right)">`
     - `Up`: `<IconButton variant="tonal" size="sm" onClick={handleUp} disabled={currentPath === '/' || isDashboard || isTrash || currentPath.startsWith('search://')} aria-label="Up" title="Up (Alt+Up)">`
  2. **Cluster 2 — Quick Actions (`New Folder`, `Show/Hide Hidden Files`, `Category Grouping`)**:
     - `New Folder` (hidden in Trash/Dashboard): `<IconButton variant="tonal" size="sm" onClick={handleCreateFolderClick} disabled={!canCreateFolderInView} aria-label="New Folder" title="New Folder (Ctrl+Shift+N)">`
     - `Show/Hide Hidden Files`: `<IconButton variant="tonal" size="sm" toggle selected={showHiddenFiles} onClick={onToggleHiddenFiles} disabled={!onToggleHiddenFiles} aria-label={...} title={...}>`
     - `Enable/Disable Category Grouping`: `<IconButton variant="tonal" size="sm" toggle selected={groupingEnabled} onClick={handleToggleGrouping} aria-label={...} title={...}>`
  3. **Cluster 3 — Sort (`Sort by Name`, `Sort by Date`, `Sort by Type`, `Sort by Size`, `Toggle Sort Order`)**:
     - `Sort by Name`: `<IconButton variant="tonal" size="sm" toggle selected={sortBy === 'name'} onClick={() => setSortBy('name')} aria-label="Sort by Name" title="Sort by Name">`
     - `Sort by Date`: `<IconButton variant="tonal" size="sm" toggle selected={sortBy === 'date'} onClick={() => setSortBy('date')} aria-label="Sort by Date" title="Sort by Date">`
     - `Sort by Type`: `<IconButton variant="tonal" size="sm" toggle selected={sortBy === 'type'} onClick={() => setSortBy('type')} aria-label="Sort by Type" title="Sort by Type">`
     - `Sort by Size`: `<IconButton variant="tonal" size="sm" toggle selected={sortBy === 'size'} onClick={() => setSortBy('size')} aria-label="Sort by Size" title="Sort by Size">`
     - `Toggle Sort Order`: `<IconButton variant="tonal" size="sm" onClick={() => setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))} aria-label="Toggle Sort Order" title={...}>`
  4. **Cluster 4 — View Mode (`Switch to Grid/List View`)**:
     - `<IconButton variant="tonal" size="sm" toggle selected={viewMode === 'list'} onClick={() => onViewModeChange?.(viewMode === 'grid' ? 'list' : 'grid')} aria-label={...} title={...}>`
- Preserve the vertical `<Divider orientation="vertical" className="!h-6 mx-0.5" />` separators between the right-side action clusters.

---

### 2.5. Item 5: Icon `animateFill` and `fill={1}` on Active/Selected States

#### Problem
`src/components/Icon.tsx` currently supports only `filled?: boolean` via a static `<span>` without `fill?: 0 | 1` or `animateFill?: boolean`. Several active/selected icons in the app either do not set `fill={1}` or jump abruptly without animating the Material Symbols `FILL` axis.

#### Solution
1. **Enhance `src/components/Icon.tsx`**:
   - Extend `IconProps`:
     ```ts
     interface IconProps {
       name: string;
       size?: number;
       className?: string;
       filled?: boolean;
       fill?: 0 | 1;
       weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
       grade?: -25 | 0 | 200;
       opticalSize?: 20 | 24 | 40 | 48;
       animateFill?: boolean;
     }
     ```
   - Resolve `effectiveFill: 0 | 1 = fill !== undefined ? fill : filled ? 1 : 0`.
   - Compute `fontVariationSettings = "'FILL' ${effectiveFill}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${resolvedOpsz}"`.
   - When `animateFill` is `true`, render `<motion.span>` from `motion/react` with `initial={false}`, `animate={{ fontVariationSettings }}`, and `transition={FAST_EFFECTS_TRANSITION}` (from `@bug-on/m3-expressive`, `{ type: 'spring', bounce: 0, duration: 0.15 }`), while keeping `style={{ fontSize: size, width: size, height: size, fontVariationSettings }}` so SSR (`renderToStaticMarkup`) and initial render immediately include the exact `font-variation-settings` without waiting for `document.fonts.load`.
2. **Apply `animateFill` and `fill={1}` (or `fill={isSelected ? 1 : 0}`) across active/selected states**:
   - `ExplorerTab.tsx`: All toggleable toolbar `IconButton` icons:
     - Hidden Files (`fill={showHiddenFiles ? 1 : 0}` `animateFill`)
     - Category Grouping (`fill={groupingEnabled ? 1 : 0}` `animateFill`)
     - Sort by Name / Date / Type / Size (`fill={sortBy === field ? 1 : 0}` `animateFill`)
     - View Mode toggle (`fill={viewMode === 'list' ? 1 : 0}` `animateFill`)
   - `App.tsx` (`NavigationRail` items):
     - Pass `fill={0} animateFill` on `icon` and `fill={1} animateFill` on `activeIcon` for Dashboard, Home, Files, Terminal, and Settings.
   - `Sidebar.tsx` (`NavigationDrawerItem`s):
     - Places (`fill={currentPath === place.path ? 1 : 0}` `animateFill`)
     - Trash (`fill={currentPath === 'app://trash' ? 1 : 0}` `animateFill`)
     - Mounted Drives (`fill={currentPath === drive.mountpoint ? 1 : 0}` `animateFill`)
   - `TabBar.tsx`:
     - Active tab icon (`fill={isActive ? 1 : 0}` `animateFill`).
   - `SettingsDialog.tsx`:
     - Appearance Mode buttons (`fill={themeMode === m.value ? 1 : 0}` `animateFill`)
     - Default View Mode buttons (`fill={viewMode === 'grid' ? 1 : 0}` / `fill={viewMode === 'list' ? 1 : 0}` `animateFill`).

---

### 2.6. Item 6: Expressive Context Menu (`ContextMenu.tsx`)

#### Problem
`src/components/ContextMenu.tsx` currently hand-rolls a `<div role="menu">` with `<button role="menuitem">` and `<Divider />` instead of using `@bug-on/m3-expressive`'s `VerticalMenu` components, missing the M3 Expressive segmented menu group geometry (`rounded-[16px]` outer corners, `rounded-[8px]` inner group corners, `2dp` group gap, `rounded-[12px]`/`rounded-[4px]` item corners, and built-in keyboard navigation).

#### Solution
- Refactor `src/components/ContextMenu.tsx` to use `VerticalMenu`, `VerticalMenuContent`, `VerticalMenuGroup`, and `MenuItem` from `@bug-on/m3-expressive`:
  - Split `items: ContextMenuItem[]` by `item.divider === true` into an array of non-empty `ContextMenuItem[][]` groups (`splitIntoMenuGroups(items)`).
  - Keep the outer positioning wrapper (`fixed z-50`) with viewport clamping (`useLayoutEffect` measuring bounds at `(x, y)`), outside-click dismissal, and `Escape` dismissal.
  - Render:
    ```tsx
    <div
      ref={menuRef}
      style={{ top: position.y, left: position.x }}
      className="fixed z-50 animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      <VerticalMenu className="min-w-[200px]">
        <VerticalMenuContent separatorStyle="gap">
          {groups.map((group, groupIdx) => (
            <VerticalMenuGroup key={groupIdx}>
              {group.map((item, itemIdx) => (
                <MenuItem
                  key={itemIdx}
                  leadingIcon={item.icon ? <Icon name={item.icon} size={18} /> : undefined}
                  trailingText={item.shortcut}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                >
                  {item.label}
                </MenuItem>
              ))}
            </VerticalMenuGroup>
          ))}
        </VerticalMenuContent>
      </VerticalMenu>
    </div>
    ```
  - Note: `VerticalMenu` sets `role="menu"` on `VerticalMenuContent`, `role="group"` on each `VerticalMenuGroup`, and `role="menuitem"` on each `MenuItem`, with `bg-m3-surface-container-low` segmented groups separated by a `gap-0.5` (`2px`) gap.
  - Update the `ContextMenu` test in `src/components/__tests__/uiStandardization.test.tsx` to assert the Expressive `VerticalMenu` structure (`role="menu"`, `role="group"`, `role="menuitem"`, segmented group classes, and zero `shadow-xl`/border).

---

### 2.7. Item 7: System Theme Mode Detection Fix (`themeMode === 'system'`)

#### Root Cause
On Linux desktops using Hyprland + Caelestia / Matugen (such as the user's environment), switching the system theme to Light updates `~/.local/state/caelestia/scheme.json` (`"mode": "light"`, `"background": "fff8f7"`, `"surface": "fff8f7"`) and/or `~/.config/matugen/theme.css` / `~/.config/gtk-4.0/gtk.css`, while `org.gnome.desktop.interface color-scheme` remains `'prefer-dark'`.
Because `@bug-on/m3-expressive`'s `MD3ThemeProvider` and `AppThemeContext.tsx` rely solely on `window.matchMedia('(prefers-color-scheme: dark)').matches` when `themeMode === 'system'`, the app always resolves `'system'` to `'dark'`.

#### Solution
1. **Add `extractSystemThemeMode(cssText: string | null | undefined): 'light' | 'dark' | null` in `src/utils/themeUtils.ts`**:
   - **Step 1 (Caelestia JSON `"mode"` field)**: If `cssText` starts with `{`, parse JSON and check `parsed.mode`:
     - If `parsed.mode === 'light'` -> return `'light'`.
     - If `parsed.mode === 'dark'` -> return `'dark'`.
     - If `parsed.colours?.surface` or `parsed.colours?.background` (or top-level `surface` / `background`) is a valid 6-digit hex, compute relative luminance and return `'light'` if luminance > `0.5`, else `'dark'`.
   - **Step 2 (Matugen CSS / GTK CSS background/surface variables)**:
     - Match `--md-sys-color-surface:\s*(#[0-9a-fA-F]{6})`, `--md-sys-color-background:\s*(#[0-9a-fA-F]{6})`, `@define-color\s+window_bg_color\s+(#[0-9a-fA-F]{6})`, or `@define-color\s+view_bg_color\s+(#[0-9a-fA-F]{6})`.
     - Compute relative luminance from the matched hex color (`0.2126 * R + 0.7152 * G + 0.0722 * B` normalized to `0..1`); return `'light'` if `> 0.5`, else `'dark'`.
   - Return `null` if no mode or surface/background color can be determined.
2. **Resolve `'system'` mode in `src/contexts/AppThemeContext.tsx`**:
   - Track `detectedSystemMode: 'light' | 'dark' | null` (derived via `extractSystemThemeMode` from `ThemeService.getMatugenCss()`, polled every 2000ms whenever `useMatugen || themeMode === 'system'`) and `mediaQueryDark: boolean` (from `window.matchMedia('(prefers-color-scheme: dark)')` with a `change` listener).
   - Compute `resolvedMode: 'light' | 'dark'`:
     - If `themeMode === 'light'` -> `'light'`
     - If `themeMode === 'dark'` -> `'dark'`
     - If `themeMode === 'system'` -> `detectedSystemMode ?? (mediaQueryDark ? 'dark' : 'light')`
   - Pass `initialMode={resolvedMode}` to `MD3ThemeProvider` and sync `setMode(resolvedMode)` inside `ThemeProviderSync` (while keeping `themeMode` in `AppThemeContext` as `'light' | 'dark' | 'system'` so the Settings UI still highlights the `"System"` button).
   - Also use `resolvedMode === 'dark'` when selecting the window icon (`api.setIcon(resolvedMode === 'dark' ? 'dark' : 'light')`).

---

## 3. Files to Modify

- `src/App.tsx`:
  - Default `handleAddTab` to `'app://dashboard'`.
  - Add `animateFill` + `fill={0}` / `fill={1}` to `NavigationRail` icons.
- `src/components/Dialog.tsx`:
  - Add `contentClassName="pt-2"` to `DialogBody` so outlined `TextField` floating labels are never clipped.
- `src/components/Icon.tsx`:
  - Add `fill?: 0 | 1` and `animateFill?: boolean` using `motion.span` + `FAST_EFFECTS_TRANSITION`.
- `src/components/ExplorerTab.tsx`:
  - Convert all 3 toolbar `ButtonGroup` clusters (`ToolbarGroupButton`) to standalone `IconButton`s (`toggle` + `selected` for stateful buttons).
  - Add `animateFill` + `fill` to toolbar toggle icons.
  - Subscribe to `api.onExtractProgress` and render the floating extraction progress card with wavy `ProgressIndicator`.
- `src/components/ContextMenu.tsx`:
  - Replace custom menu markup with `VerticalMenu`, `VerticalMenuContent`, `VerticalMenuGroup`, and `MenuItem`.
- `src/components/Sidebar.tsx`, `src/components/TabBar.tsx`, `src/components/SettingsDialog.tsx`:
  - Add `animateFill` and `fill={isSelected ? 1 : 0}` to active/selected icons.
- `src/utils/themeUtils.ts` & `src/contexts/AppThemeContext.tsx`:
  - Implement `extractSystemThemeMode` and resolve `'system'` mode using Caelestia/Matugen/GTK theme data before falling back to `matchMedia`.
- `src-tauri/src/extract.rs`, `src-tauri/src/commands/app.rs`, `electron/main.ts`, `electron/preload.ts`, `src/api/types.ts`, `src/api/tauriAdapter.ts`:
  - Implement streaming archive extraction progress (`fs:extract-progress`) and `api.onExtractProgress`.
- Unit tests:
  - `src/utils/__tests__/themeUtils.test.ts`
  - `src/api/__tests__/tauriAdapter.test.ts`
  - `src/components/__tests__/uiStandardization.test.tsx`
  - `src-tauri/src/extract.rs` & `src-tauri/src/commands/app.rs`

---

## 4. Verification Strategy

1. **Rust Backend Tests (`cargo test`)**:
   - Unit tests for `list_entries_command`, `extract_verbose_command`, `parse_extracted_entry_line`, and `extract_file_with_progress` (verifying progress callbacks with `extracted_count`, `total_count`, `percent`, and `done: true` on a real `.tar` / `.zip` archive).
2. **Frontend Unit Tests (`bun test`)**:
   - `themeUtils.test.ts`: Test `extractSystemThemeMode` across Caelestia JSON (`"mode": "light"`, `"mode": "dark"`, surface hex fallback), Matugen CSS (`--md-sys-color-surface`), and GTK CSS (`@define-color window_bg_color`).
   - `tauriAdapter.test.ts`: Test `onExtractProgress` subscription and payload forwarding.
   - `uiStandardization.test.tsx`: Test `Dialog` `pt-2` body padding, `Icon` `animateFill` / `fill={1}`, `ExplorerTab` standalone `IconButton` toolbar buttons (`aria-pressed`), `ContextMenu` `VerticalMenu` / `VerticalMenuGroup` / `MenuItem` rendering.
3. **Build & Lint Verification**:
   - `npm run lint` and `npm run build:web`.
