# Phase 2 Design Spec: Material Design 3 UI/UX Redesign & Polish (Approach A)

**Date**: 2026-11-10
**Repository**: `material-3-file-explorer` (fork: `nguyentruongton/bug-on-files-m3`)
**Base Branch**: `phase1-cleanup` -> new branch `phase2-ui-ux`

---

## 1. Context & Problem Statement

Following the Phase 1 technical cleanup, a visual and UX audit of the running application (at `/home/stark` and in the `Settings` dialog) revealed several structural UI/UX flaws while using the existing 3-part layout (`NavigationRail` + `Sidebar` + `Main Content`):

1. **Sidebar Active-State Bug & XDG Path Collision**:
   - On Linux systems where XDG user directories (`DOCUMENTS`, `DOWNLOADS`, etc.) are unset or point to `$HOME`, `app.getPath('documents')` and `app.getPath('downloads')` in `electron/main.ts` return `/home/<user>` — identical to `Home`.
   - As a result, `Sidebar.tsx` renders duplicate React keys (`key={place.path}`), highlights `Home`, `Documents`, and `Downloads` simultaneously when viewing `/home/<user>`, and clicking `Documents` or `Downloads` navigates to `$HOME` instead of `~/Documents` or `~/Downloads`.
   - Additionally, `filled={currentPath.startsWith(place.path)}` keeps the `Home` icon filled for every subdirectory under `/home/<user>`, and `Dashboard` is duplicated in both `NavigationRail` and `Sidebar`.
   - For `Devices` (`drives`), `currentPath.startsWith(drive.mountpoint)` highlights `/` alongside any nested mountpoint at the same time.

2. **Lack of Collapsible Sidebar & Redundant Navigation**:
   - Users cannot collapse the `Places` sidebar to maximize horizontal space for the file area, and `NavigationRail` + `Sidebar` duplicate `Dashboard`.

3. **Boxy TabBar & Buried Toolbar Controls**:
   - `TabBar.tsx` / `TabBar.css` stretches tabs (`flex: 1`, `max-width: 200px`, flat top-rounded rectangles) with no leading contextual icon and no middle-click (`onAuxClick`) to close a tab.
   - Frequently used actions (`View Mode: Grid/List`, `Show/Hide Hidden Files`, `New Folder`, `Sort by Size`, sort direction indicator) are either buried inside `SettingsDialog` or missing from `ExplorerTab`'s top toolbar.

4. **FileList Grid & List View Deficiencies**:
   - **Grid View**: Card column minimum width is `${iconSize + 32}px` (`96px` at the default `64px` icon size) with `word-break: break-word`, causing filenames like `.bash_history` to wrap mid-word with a single-character orphan (`.bash_histor` / `y`).
   - **Dotfiles (Hidden Files)**: Hidden files/folders (starting with `.`) have the exact same visual prominence as standard folders/files, cluttering `/home/<user>` when `showHiddenFiles` is enabled.
   - **Monotone File Icons**: All non-folder icons share a single muted gray (`--md-sys-color-on-surface-variant`), making it slow to visually scan Media, Code, Archives, Documents, and Executables.
   - **List View**: Currently renders only 3 columns (`Icon`, `Name`, `Size`) with no table header row, no `Date Modified` column, no `Type` column, and no clickable column sorting.
   - **Empty States**: Empty directories or zero-result searches show a blank area with no visual feedback.

5. **Broken CSS Variables & Deferred Polish**:
   - `StatusBar.tsx` and `App.tsx` reference undefined CSS variables (`--border-color`, `--surface-color`, `--text-secondary`, `--surface-variant`) that do not exist in `src/theme/fallback.css`, leaving the status bar and terminal header transparent/borderless.
   - `ContextMenu.css` uses legacy spacing/radius and `App.tsx` shows `"Extract Here"` on all files instead of only archives.
   - Phase 1 deferred UI polish: `"New Folder"` dialog needs inline validation for `/` in folder names, and file operation failures (`mkdir`, `paste`, `rename`, `delete`) in `App.tsx` should display toast notifications via `useToast`.

---

## 2. Scope & Architecture (Approach A)

Phase 2 preserves the 3-column desktop shell (`NavigationRail` + collapsible `Sidebar` + `Main Content`) and upgrades the component hierarchy and Material Design 3 styling across 5 focused modules.

### Module 1: XDG Places Resolution, NavigationRail & Collapsible Sidebar
- **XDG Place Path Resolution (`electron/systemUtils.ts` & `electron/main.ts`)**:
  - Add pure helper `resolvePlaces(homeDir: string, getSystemPath: (key: PlaceKey) => string)` in `electron/systemUtils.ts`:
    - Supported keys: `'home' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'`.
    - For `'home'`, path is `homeDir`.
    - For any other place (`Desktop`, `Documents`, `Downloads`, `Music`, `Pictures`, `Videos`), if `getSystemPath(key)` throws, returns empty, or returns a path equal to `homeDir` (normalized without trailing slash), fall back to `path.join(homeDir, PlaceName)` (e.g., `/home/stark/Documents`).
  - Wire `ipcMain.handle('fs:get-places')` in `electron/main.ts` to use `resolvePlaces`.
- **Sidebar Matching & Deduplication (`src/utils/navigationHistory.ts` or `src/utils/sidebarUtils.ts`, `src/components/Sidebar.tsx`, `src/components/Sidebar.css`)**:
  - Remove the duplicate `Dashboard` item from `Sidebar.tsx` (`Dashboard` remains the primary top destination in `NavigationRail`).
  - Use `key={`${place.name}:${place.path}`}` on place buttons.
  - Mark a place as active and `filled` **only** on exact path match (`normalizePath(currentPath) === normalizePath(place.path)`).
  - For `Devices` (`drives`), add a pure helper `getActiveDriveMountpoint(currentPath: string, mountpoints: string[]): string | null` that returns the longest mountpoint that is a path-prefix of `currentPath` (so `/home` or `/run/media/stark/USB` wins over `/`).
  - Add a `collapsed?: boolean` prop to `Sidebar.tsx` (controlled by `sidebarOpen` in `App.tsx`, persisted in `localStorage` under `'settings.sidebarOpen'` defaulting to `true`). When collapsed, `.sidebar` smoothly transitions width/padding/opacity to `0` (`overflow: hidden`).
- **NavigationRail Updates (`src/components/NavigationRail.tsx`, `src/components/NavigationRail.css`, `src/App.tsx`)**:
  - Add a top menu/drawer toggle button (`menu_open` / `dock_to_right`) or allow toggling the Places sidebar from `NavigationRail` so users can collapse/expand `Sidebar` at any time.
  - Ensure `Home` and `Files` active states in `NavigationRail` are mutually clear (`Dashboard` active when `currentPath === 'app://dashboard'`, `Home` active when `currentPath.startsWith(homePath)`, `Files` active when browsing non-dashboard, non-home paths such as `/` or `/mnt`).

### Module 2: TabBar & Explorer Toolbar Redesign
- **TabBar (`src/components/TabBar.tsx`, `src/components/TabBar.css`)**:
  - Pass `tabs` with `id`, `title`, and `path` (already in `App.tsx`'s `TabState`).
  - Render a leading contextual icon per tab:
    - `dashboard` when `tab.path === 'app://dashboard'`
    - `home` when `tab.path` is the home directory (or `title === 'Home'`)
    - `folder` for standard directory tabs
  - Support middle-click (`onAuxClick` with `e.button === 1`) on `.tab-item` to close the tab.
  - Redesign `.tab-bar` and `.tab-item` in `TabBar.css`:
    - Compact M3 pill/card tabs (`height: 38px`, `border-radius: 12px`, `max-width: 220px`, `min-width: 120px`, `gap: 8px`, subtle active elevation/surface-container-high background with `1px solid var(--md-sys-color-outline-variant)`).
- **Explorer Toolbar (`src/components/ExplorerTab.tsx`, `src/App.tsx`)**:
  - Pass `onToggleHiddenFiles: () => void` and `onViewModeChange: (mode: 'grid' | 'list') => void` into `ExplorerTab`.
  - Add `Ctrl+H` keyboard shortcut in `ExplorerTab.tsx` (when active and focus is not in an input/terminal) to call `onToggleHiddenFiles()`.
  - Upgrade the right-side toolbar action cluster in `ExplorerTab.tsx`:
    1. **New Folder** button (`create_new_folder`, title `"New Folder (Ctrl+Shift+N)"`, triggers `onCreateFolderRequest`).
    2. **Toggle Hidden Files** button (`visibility` / `visibility_off`, variant `showHiddenFiles ? 'tonal' : 'standard'`, title `"Toggle Hidden Files (Ctrl+H)"`).
    3. **Toggle Grouping** button (`view_agenda`, variant `groupingEnabled ? 'tonal' : 'standard'`, title `"Toggle Grouping"`).
    4. Divider (`1px` vertical line).
    5. **Sort Controls**:
       - Sort by Name (`sort_by_alpha`), Sort by Date (`schedule` / `calendar_today`), Sort by Size (`straighten` / `data_usage`), plus a compact sort direction indicator (`arrow_upward` / `arrow_downward`).
    6. Divider (`1px` vertical line).
    7. **View Mode Toggle** button (`view_list` when in grid mode, `grid_view` when in list mode, clicking switches between `'grid'` and `'list'`).

### Module 3: FileList Grid & List View Overhaul
- **File Metadata & Icon Helpers (`src/utils/fileUtils.ts` & `src/utils/__tests__/fileUtils.test.ts`)**:
  - Add pure, unit-tested helpers in `src/utils/fileUtils.ts`:
    - `isHiddenFile(name: string): boolean` (`name.startsWith('.')`)
    - `isArchiveFile(name: string): boolean` (checks `.zip`, `.tar`, `.gz`, `.xz`, `.tgz`, `.tar.gz`, `.tar.xz` — matching `electron/systemUtils.ts` extraction support)
    - `getFileIconInfo(file: IFile): { icon: string; colorClass: string }`:
      - Directories: `{ icon: 'folder', colorClass: 'folder-icon' }`
      - Media (images/audio/video): `{ icon: 'image' | 'audio_file' | 'movie', colorClass: 'media-icon' }`
      - Documents (`pdf` -> `'picture_as_pdf'`, ` 'pdf-icon'`; text/docs/spreadsheets -> `'description'` / `'article'`, `'doc-icon'`)
      - Code: `{ icon: 'code', colorClass: 'code-icon' }`
      - Archives: `{ icon: 'folder_zip', colorClass: 'archive-icon' }`
      - Executables: `{ icon: 'terminal', colorClass: 'exec-icon' }`
      - Others: `{ icon: 'insert_drive_file', colorClass: 'other-icon' }`
    - `formatFileSize(bytes: number): string` (human-readable `0 B`, `1.5 KB`, `2.3 MB`, etc.)
    - `formatFileDate(mtime: Date | string | number): string` (concise desktop date/time format, e.g., `YYYY-MM-DD HH:mm` or locale short date + time, handling invalid dates gracefully)
- **Grid View Improvements (`src/components/FileList.tsx`, `src/components/FileList.css`)**:
  - Increase grid column minimum width from `${iconSize + 32}px` to `${Math.max(112, iconSize + 48)}px` so `64px` icons get at least `112px` width.
  - Add `title={file.name}` to `.file-list-item` so hovering any truncated filename reveals the full name.
  - Add `.is-hidden` class when `isHiddenFile(file.name)` is true (`opacity: 0.65`, restored to `0.95` on hover/selection).
  - Fix `.file-list.grid .file-name` typography: `font-size: 13px`, `line-height: 1.35`, `overflow-wrap: anywhere`, `word-break: normal`, `-webkit-line-clamp: 2`.
  - Style semantic icon color classes in `FileList.css` using M3 tokens (`--md-sys-color-primary`, `--md-sys-color-tertiary`, `--md-sys-color-secondary`, etc., with harmonious fallbacks).
- **List View Table Header & Columns (`src/components/FileList.tsx`, `src/components/FileList.css`, `src/components/ExplorerTab.tsx`)**:
  - Pass optional `sortBy?: 'name' | 'size' | 'date'`, `sortOrder?: 'asc' | 'desc'`, and `onSortChange?: (field: 'name' | 'size' | 'date') => void` to `FileList`.
  - When `viewMode === 'list'`, render a sticky `.file-list-header` row at the top of `.file-list.list` with columns:
    - `Icon` (`${iconSize + 16}px`)
    - `Name` (`1fr`, clickable to sort by `'name'`)
    - `Date Modified` (`160px`, clickable to sort by `'date'`)
    - `Type` (`110px`, displays `'Folder'` or `getSemanticGroup(file)`)
    - `Size` (`100px`, right-aligned, clickable to sort by `'size'`)
  - Each `.file-list-item` in `list` mode uses matching `grid-template-columns: ${iconSize + 16}px 1fr 160px 110px 100px` and displays `file.name`, `formatFileDate(file.mtime)`, type label, and `file.isDirectory ? '—' : formatFileSize(file.size)`.
- **Empty Directory / Empty Search State (`src/components/FileList.tsx`, `src/components/FileList.css`)**:
  - When `files.length === 0`, render a centered `.file-list-empty` state inside `FileList` with a subtle icon (`folder_open` or `search_off` when `isSearch` is true) and message (`"This folder is empty"` or `"No matching files found"`).

### Module 4: StatusBar, ContextMenu, Dialog Validation & Token Consistency
- **StatusBar (`src/components/StatusBar.tsx`)**:
  - Replace undefined `--border-color`, `--surface-color`, `--text-secondary` with valid M3 tokens:
    - `backgroundColor: 'var(--md-sys-color-surface-container-low)'`
    - `borderTop: '1px solid var(--md-sys-color-outline-variant)'`
    - `color: 'var(--md-sys-color-on-surface-variant)'`
  - Also accept optional `hiddenCount?: number` or `selectedSize?: number` to display richer status info (e.g., `20 items (12 hidden)` or `3 selected (4.2 MB)`).
- **App.tsx Token & UX Fixes (`src/App.tsx`, `src/components/ContextMenu.css`)**:
  - Replace `--text-secondary`, `--border-color`, `--surface-variant` in `App.tsx` with `--md-sys-color-on-surface-variant`, `--md-sys-color-outline-variant`, and `--md-sys-color-surface-container-high`.
  - Use `useToast()` inside `AppContent` in `App.tsx` to show user-facing error/success feedback on `mkdir`, `paste`, `rename`, `delete`, and `extract`.
  - Filter `"Extract Here"` in `menuItems` so it is only included when `contextMenu?.item && !contextMenu.item.isDirectory && isArchiveFile(contextMenu.item.name)`.
  - In the `"New Folder"` and `"Rename"` dialogs in `App.tsx`, validate that the input does not contain `/` (and is not `.` or `..`): show an inline error message (`"Name cannot contain '/'"`) and disable the submit button when invalid.
  - Polish `ContextMenu.css` with M3 menu styling (`border-radius: 12px`, `padding: 6px`, item `border-radius: 8px`, `height: 38px`, smooth fade/scale animation).

### Module 5: Font Fallback & Lint/Test Verification
- **Local Material Symbols Font Fallback (`src/index.css`)**:
  - Import `@fontsource/material-symbols-rounded/index.css` alongside the Google Fonts variable icon stylesheet so icons remain visible even when offline while preserving variable `FILL` axis support when online.
- **Verification**:
  - Add unit tests for `resolvePlaces`, `getActiveDriveMountpoint`, and `fileUtils` helpers (`isHiddenFile`, `isArchiveFile`, `getFileIconInfo`, `formatFileSize`, `formatFileDate`).
  - Run `bun test`, `npm run build`, and `npx eslint` on all touched files.

---

## 3. Out of Scope (Deferred to Phase 3)
- Dual-pane split view, Quick Look preview panel (`Space` key), live `fs.watch` directory auto-refresh, and paste conflict resolution dialog remain scheduled for **Phase 3 (Feature Additions)**.
