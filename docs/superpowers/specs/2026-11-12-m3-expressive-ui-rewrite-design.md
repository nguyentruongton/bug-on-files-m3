# M3 Expressive UI Rewrite — Design Specification

Date: 2026-11-12 · Status: draft, awaiting owner approval

## 1. Intent and Why

Following the completion of the Tauri 2 + Rust backend migration (`src-tauri` with 32 commands, `media://` streaming protocol, and `src/api` seam), the frontend of **Materials** (`src/`) still uses ~3,850 lines of legacy TSX and 15 custom CSS files built with static Material 3 CSS variables.

The owner wants to **rewrite the entire UI in `src/` to follow the Material Design 3 Expressive standard** using **`@bug-on/m3-expressive` (`1.3.24`)**, **Tailwind CSS v4**, and **`motion` (`14.12.0`)**, adopting a bold **Expressive Floating Canvas** layout, organic morphing shapes across both the Dashboard and FileList, physics-based spring motion, and dynamic HCT theming that supports both in-app customization (`sourceColor` + Light/Dark/System mode) and automatic Linux **Matugen** theme synchronization.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Complete UI rewrite on `@bug-on/m3-expressive` + Tailwind CSS v4**: Replace all 15 legacy component `.css` files (`App.css`, `Button.css`, `Dialog.css`, `FileList.css`, `Sidebar.css`, `NavigationRail.css`, `TabBar.css`, `Omnibar.css`, `Breadcrumbs.css`, `Dashboard.css`, `ContextMenu.css`, `QuickLook.css`, `Toast.css`, `IconButton.css`, `Skeleton.css`, `CircularProgress.css`) and legacy primitive wrappers with `@bug-on/m3-expressive` components and Tailwind v4 utilities.
- **Expressive Floating Canvas App Shell**: A cohesive M3 Expressive desktop layout featuring `NavigationRail` + `FABMenu`, collapsible spring-animated `NavigationDrawer` (Places & Drives), elevated rounded-m3-xl main canvas, `Tabs`, expressive `Omnibar`, and a contextual `HorizontalFloatingToolbar` that springs up from the bottom when files are selected.
- **Expressive Organic Shapes Throughout**: Use `ShapeMedia` / `ShapeIcon` and M3 Expressive shape tokens across both the Bento `Dashboard` and `FileList` (morphing folder/media shapes on hover and selection).
- **Hybrid Dynamic Theming (Matugen + In-App Controls)**: Wrap the app in `MD3ThemeProvider` (`variant="expressive"`), allow choosing `sourceColor` and `mode` (`light` | `dark` | `system`) in Settings, and automatically prioritize extracting/applying colors from `~/.config/matugen/theme.css` when present on the system (with a toggle in Settings).
- **100% Feature Parity**: Preserve all existing file manager workflows, keyboard shortcuts, directory watching, multi-tab history, conflict resolution, archive extraction, QuickLook (`Space`), and `xterm.js` terminal pane.

### Non-Goals
- Modifying the Rust backend (`src-tauri/`) or the `src/api` seam (already complete and verified at 32/32 command parity).
- Implementing native OS file drag-out (`startDrag`), which remains deferred per the parent migration spec.
- Adding a permanent right-hand Inspector `SideSheet` (rejected in favor of Option A — Expressive Floating Canvas + `PropertiesDialog`).

### Anti-Goals (Failure Even If It Works)
- **Incomplete token coverage when Matugen is active**: Injecting raw Matugen CSS alone without feeding `MD3ThemeProvider` would leave Spec 2025 tokens (`--md-sys-color-*-dim`, `--md-sys-color-*-fixed`, `--color-m3-*`) undefined, breaking `@bug-on/m3-expressive` components.
- **Scroll/render jank in large folders**: Mounting heavy SVG morphing hooks on thousands of off-screen DOM nodes simultaneously.
- **Accidental text selection regression**: Losing global `user-select: none` on app chrome while keeping `user-select: text` on inputs, `QuickLook` text previews, and `PropertiesDialog` file name/path.
- **Breaking modal keyboard pre-flight**: `ExplorerTab` and `QuickLook` keyboard listeners (`Delete`, `F2`, `Space`, arrows) firing while a Radix-based `@bug-on/m3-expressive` `Dialog` is open.

## 3. Constraints

- **Library Version & Peer Stack**: `@bug-on/m3-expressive@1.3.24`, `motion@14.12.0`, `tailwindcss@^4.3.5`, `@tailwindcss/vite@^4.3.5`, React 19.
- **Offline / Bundled Icons**: Must continue working offline on Linux using `@fontsource/material-symbols-rounded` + `<MaterialSymbolsProvider source="local">` (or `.material-symbols-rounded` font-face rules in `src/index.css`) rather than requiring a live Google Fonts CDN connection.
- **Dialog DOM Selector Change**: Legacy `Dialog.tsx` used native `<dialog open>`, so `ExplorerTab.tsx` and `QuickLook.tsx` guarded global shortcuts via `document.querySelector('dialog[open]')`. `@bug-on/m3-expressive` `Dialog` is built on `@radix-ui/react-dialog` (`role="dialog"[data-state="open"]`). All modal pre-flight guards must check `document.querySelector('dialog[open], [role="dialog"][data-state="open"]')`.
- **Single-Main-Entry Cleanup**: Once the UI rewrite is complete, `spike.html` and `src/spike/` (from the earlier benchmark phase) should either be kept isolated or cleaned up if no longer needed by the test suite (builder's call: keep `src/spike/` if `bun test` runs `SpikeApp.test.ts`, or remove both together cleanly).

## 4. Approaches Considered

### Approach 1: Layered Foundation-First In-Place Rewrite — **Chosen by Owner**
1. **Layer 1 (Foundation, CSS & Theme Engine)**: Replace `src/index.css` with Tailwind v4 + `@bug-on/m3-expressive/index.css` + `@bug-on/m3-tailwind`. Build the unified `ThemeProvider` / `ThemeService` (Matugen seed extraction + `MD3ThemeProvider` + custom CSS support) and bridge `ToastContext` to `@bug-on/m3-expressive`'s `SnackbarProvider` / `useSnackbar`.
2. **Layer 2 (App Shell & Navigation)**: Rewrite `App.tsx` layout into the **Expressive Floating Canvas**, replacing `NavigationRail`, `Sidebar` (`NavigationDrawer`), `TabBar` (`Tabs`), and `Omnibar` (`Breadcrumbs` + `SearchBar` + view/sort/group controls).
3. **Layer 3 (Core Views — Dashboard & ExplorerTab / FileList)**: Rewrite `Dashboard` (Bento cards + `ShapeMedia` pinned items + `List` recent items) and `ExplorerTab` + `FileList` (Grid view with `ShapeMedia` organic morphing, List view with `MD3Table`, bottom `HorizontalFloatingToolbar` on selection, and `StatusBar`).
4. **Layer 4 (Dialogs, Menus, Overlays & CSS Cleanup)**: Rewrite `ContextMenu`, `SettingsDialog`, `PropertiesDialog`, `OpenWithDialog`, `ConflictDialog`, Rename/New Folder dialogs, `QuickLook`, and `TerminalPane`. Delete all 15 legacy `.css` files and update tests.
- **Pros**: App builds and runs at every commit; design tokens and Tailwind v4 utilities are live from step 1; easy to verify each layer independently.
- **Cons**: Brief transitional styling between Layer 1 and Layer 3 while legacy components coexist with rewritten ones.

### Approach 2: Parallel Directory (`src/v2/`) & Big-Bang Cutover — Rejected
- Build a duplicate component tree in `src/v2/` and switch `main.tsx` at the end. Rejected because duplicating stateful containers (`App.tsx`, `ExplorerTab.tsx`) risks state drift and delays integration feedback until the final step.

### Approach 3: Bottom-Up Leaf-First Replacement — Rejected
- Replace leaf buttons/inputs first inside legacy CSS layouts. Rejected because legacy `.css` files conflict with Tailwind v4 preflight and `@bug-on/m3-expressive` layout primitives, causing throwaway styling work.

## 5. Detailed Design (Owner Decisions & Architecture)

### 5.1. Layer 1: Styling Foundation, Theming & Snackbar Bridge

#### `src/index.css`
- Import order:
  ```css
  @import "tailwindcss";
  @import "@bug-on/m3-expressive/index.css";
  @import "@bug-on/m3-tailwind";
  @import "@fontsource/material-symbols-rounded/index.css";
  ```
- Preserve the global text-selection protection rules required by `src/components/__tests__/userSelectCss.test.ts`:
  - `:root` and `.material-symbols-rounded` must explicitly declare `-webkit-user-select: none; user-select: none;`.
  - `input, textarea, [contenteditable="true"]` must explicitly declare `-webkit-user-select: text; user-select: text;`.
  - Never apply `user-select: text` to `.xterm` descendants.

#### Hybrid Theming (`MD3ThemeProvider` + Matugen Priority + Settings)
- State persisted in `localStorage`:
  - `settings.themeMode`: `'system' | 'light' | 'dark'` (default `'system'`)
  - `settings.sourceColor`: hex string (default `'#6750A4'`)
  - `settings.useMatugen`: `boolean` (default `true`)
- **Matugen Detection & Priority Logic**:
  - On startup (and when toggled in Settings), call `api.getThemeCss()`.
  - If `api.getThemeCss()` returns non-empty CSS:
    - Mark `matugenAvailable = true`.
    - Parse `--md-sys-color-primary:\s*(#[0-9a-fA-F]{6})` from the Matugen CSS string.
    - When `useMatugen === true` and a valid hex is extracted, pass that hex as `sourceColor` into `<MD3ThemeProvider sourceColor={effectiveSeed} defaultMode={themeMode} variant="expressive">`. This guarantees that all 50+ Spec 2025 tokens (`dim`, `fixed`, `--color-m3-*`) are generated harmoniously from the user's Matugen wallpaper palette.
    - Also optionally inject any explicit overrides or custom user CSS (`custom-user-css`) after provider mount.
  - When `useMatugen === false` or Matugen is not installed (`api.getThemeCss()` returns `null`), `<MD3ThemeProvider>` uses the user's chosen `settings.sourceColor` and `settings.themeMode`.
- Keep window icon synchronization (`api.setIcon(effectiveMode)`) reactive to `effectiveMode`.

#### Toast / Snackbar Bridge (`src/contexts/ToastContext.tsx`)
- Mount `<SnackbarProvider>` (or `enableSnackbar` on `MD3ThemeProvider`).
- Keep `useToast()` exporting `{ showToast(message, type) }` so existing hooks (`usePaste`, `ExplorerTab`, `App`) require zero signature changes, while internally delegating to `@bug-on/m3-expressive`'s `useSnackbar()`.

---

### 5.2. Layer 2: Expressive Floating Canvas App Shell (`App.tsx` & Navigation)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [Rail]  │  [Drawer (Collapsible)]  │  ╭─ Floating Main Canvas ───────╮  │
│  [≡]     │  Places                  │  │ [Tabs: Home × | Docs × | + ] │  │
│  [+ FAB] │   • Home                 │  │ [‹][›][↑] [Omnibar/Search] [⋮]│  │
│          │   • Desktop              │  │ ──────────────────────────── │  │
│  (Home)  │   • Documents            │  │                              │  │
│  (Dash)  │   • Downloads            │  │   Dashboard OR FileList      │  │
│  (Term)  │  Devices                 │  │   (Grid w/ Organic Shapes    │  │
│          │   • NVMe (512 GB)        │  │    or MD3Table List View)    │  │
│   ...    │                          │  │                              │  │
│  (⚙️)    │                          │  │      ╭────────────────────╮  │  │
│          │                          │  │      │ FloatingToolbar    │  │  │
│          │                          │  │      ╰────────────────────╯  │  │
│          │                          │  │ [StatusBar: 24 items]        │  │
│          │                          │  ╰──────────────────────────────╯  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Outer Frame**: `h-screen w-screen overflow-hidden bg-m3-surface text-m3-on-surface flex p-2 gap-2`.
- **`NavigationRail.tsx`**:
  - Built with `@bug-on/m3-expressive` `NavigationRail` and `NavigationRailItem` (`shape="pill"`).
  - Header action: `IconButton` (`menu` / `menu_open`) toggling `sidebarOpen`.
  - FAB slot: `@bug-on/m3-expressive` `FABMenu` (or `FAB` when on Dashboard) with quick actions: **New Folder** (`create_new_folder`) and **Paste** (`content_paste`, enabled when clipboard has items).
  - Rail destinations: **Home** (`home`), **Dashboard** (`dashboard`), **Terminal** (`terminal` — toggles bottom `TerminalPane`), and **Settings** (`settings` — opens `SettingsDialog`).
- **`Sidebar.tsx` (`NavigationDrawer`)**:
  - Uses `@bug-on/m3-expressive` `NavigationDrawer`, `NavigationDrawerContent`, `NavigationDrawerSectionHeader`, `NavigationDrawerItem`, `NavigationDrawerDivider`, and `ScrollArea`.
  - Smooth width/opacity spring transition (`FAST_SPATIAL_SPRING`) when `collapsed` toggles.
  - Sections: **Places** (Home, Desktop, Documents, Downloads, Music, Pictures, Videos) and **Devices** (mounted drives with USB/SSD icons and capacity subtitle/badge).
- **Floating Main Canvas**:
  - `flex-1 flex flex-col min-w-0 bg-m3-surface-container-low rounded-m3-xl border border-m3-outline-variant/40 overflow-hidden shadow-sm relative`.
- **`TabBar.tsx`**:
  - Built using `@bug-on/m3-expressive` `Tabs`, `TabsList`, `Tab` (variant `"primary"` or pill-styled container tabs) + middle-click (`onAuxClick`) to close + trailing close `IconButton` + `IconButton` (`add`) for new tab.
- **`Omnibar.tsx` & `Breadcrumbs.tsx` & Top Action Bar**:
  - Navigation buttons (`arrow_back`, `arrow_forward`, `arrow_upward`, `refresh`) using `IconButton` (`variant="standard"` / `"tonal"`).
  - **Expressive Omnibar**:
    - Default mode: Pill-shaped container (`bg-m3-surface-container-high rounded-m3-full`) rendering interactive `Breadcrumbs` chips/segments + trailing search/edit trigger icon.
    - Edit/Search mode: Morphs smoothly into `@bug-on/m3-expressive` `SearchBar` / input with leading icon (`folder_open` when input starts with `/` or `~`, `search` otherwise) and clear/escape handling.
  - **Right Action Controls**:
    - View mode toggle (`ButtonGroup` or `ToolbarToggleButton` switching `grid` / `list`).
    - Sort & Group menu (`Menu`, `MenuTrigger`, `MenuContent`, `MenuItem` for Sort by Name/Date/Size, Ascending/Descending, and Group by Type ` category` toggle) + Hidden files toggle (`visibility` / `visibility_off`).

---

### 5.3. Layer 3: Core Views — `Dashboard`, `ExplorerTab`, `FileList`, `FloatingToolbar`

#### `Dashboard.tsx` (Expressive Bento + Organic Shapes)
- Built inside `ScrollArea` with responsive Bento grid (`grid-cols-1 md:grid-cols-12 gap-4 p-6`).
- **Hero & System Storage Card** (`Card variant="filled"` or tonal gradient container):
  - Time-of-day greeting (`Typography` display/headline) + subtitle.
  - Storage usage visualization using `@bug-on/m3-expressive` `ProgressIndicator` (linear wave/track) and a morphing `ShapeMedia` (`shape="flower"` → `morphTo="pillStar"` on hover) badge showing used percentage, plus formatted used/free/total GB.
- **Pinned Folders Card** (`Card variant="elevated"`):
  - Grid of pinned folders where each folder icon is rendered inside a **`ShapeMedia`** container cycling through expressive shapes (`circle`, `cookie4`, `clover4`, `pill`) that **morphs on hover** (`morphOn="hover"`, e.g. `circle` → `flower`).
  - Unpin button (`IconButton` size `xs`) on hover + **Add Pin** tile with dashed outline and `add` icon calling `api.openDirectoryDialog()`.
- **Recent Files Card** (`Card variant="outlined"`):
  - Uses `@bug-on/m3-expressive` `List` and `ListItem` (with leading `ShapeIcon`, headline `file.name`, supporting text `file.path`, and click-to-navigate).

#### `FileList.tsx` & `FileListSkeleton.tsx`
- **Empty State**: Expressive `ShapeMedia` (`shape="clover4"`, `morphTo="flower"`, `morphOn="hover"`) wrapping `search_off` or `folder_open` icon, with headline and subtitle.
- **Loading Skeleton (`FileListSkeleton.tsx`)**: Uses `@bug-on/m3-expressive` `LoadingIndicator` + pulsing `rounded-m3-lg bg-m3-surface-container-highest` placeholder cards/rows.
- **Grid View (Expressive Organic Shapes)**:
  - Responsive CSS Grid (`repeat(auto-fill, minmax(max(116px, iconSize + 48px), 1fr))`).
  - When `groupingEnabled` is active, section headers render with `Divider` and expressive label `Chip` / badge.
  - Each file/folder item is an interactive M3 card (`rounded-m3-lg p-3 transition-colors`) with `motion` spring scale feedback on tap and an **Organic Shape icon/thumbnail container**:
    - **Folders & File Icons**: Wrapped in `@bug-on/m3-expressive` `ShapeMedia` (or `ShapeIcon` / SVG clip-path from `MD3Shapes`) that morphs between resting shape (e.g., `squircle` / `circle` / `arch`) and active/hover shape (`flower` / `clover` / `cookie`) on hover or when `selectedFiles.has(file.path)` is true.
    - **Image Thumbnails**: Loaded lazily via `toMediaUrl(file.path)` inside `ShapeMedia` (`shape="square"` / rounded polygon morphing to `flower` or `clover` when selected/hovered).
    - **Performance Guard for Large Directories**: If `files.length > 300`, disable continuous SVG path interpolation on unselected items (use static CSS clip-path/border-radius at rest and only attach active morphing to hovered/selected items) so 5,000-file folders remain 60fps on WebKitGTK.
- **List View (`MD3Table`)**:
  - Uses `@bug-on/m3-expressive` `MD3Table`, `MD3TableHead`, `MD3TableHeaderCell`, `MD3TableBody`, `MD3TableRow`, `MD3TableCell`, and `MD3TableSortIndicator`.
  - Columns: Leading Icon/Thumbnail (`ShapeIcon`), **Name** (sortable), **Date Modified** (sortable), **Type** (semantic group badge), **Size** (right-aligned, sortable).
  - Supports multi-select (`selected` row styling), double-click to open, right-click context menu, and group header divider rows when `groupingEnabled` is on.

#### Contextual `HorizontalFloatingToolbar` (Inside `ExplorerTab.tsx`)
- Rendered at `absolute bottom-10 left-1/2 -translate-x-1/2 z-20` using `@bug-on/m3-expressive` `HorizontalFloatingToolbar` (with `vibrantFloatingToolbarColors` or `surfaceContainerHighFloatingToolbarColors`) animated via `AnimatePresence` + `FAST_SPATIAL_SPRING`.
- **When `selectedFiles.size > 0`**:
  - Shows selection count chip (`{n} selected`, click to clear selection).
  - Contextual `ToolbarIconButton` actions with `PlainTooltip`:
    - **Open** (`open_in_new`, when 1 item selected)
    - **Quick Look** (`visibility`, when 1 item selected)
    - **Copy** (`content_copy`)
    - **Cut** (`content_cut`)
    - **Rename** (`edit`, when 1 item selected)
    - **Extract** (`folder_zip`, when 1 archive selected)
    - **Properties** (`info`, when 1 item selected)
    - **Move to Trash** (`delete`, error-tinted)
- **When `clipboard` has items (even if `selectedFiles.size === 0`)**:
  - Shows a compact floating action pill or `ExtendedFAB` to **Paste ({clipboard.files.length})** into the current directory.

#### `StatusBar.tsx`
- Clean M3 bottom bar (`h-8 px-5 bg-m3-surface-container border-t border-m3-outline-variant/40 text-xs text-m3-on-surface-variant flex items-center justify-between`) displaying total/visible item count, hidden item count badge, and selected count + total selected byte size.

---

### 5.4. Layer 4: Dialogs, ContextMenu, QuickLook & TerminalPane

- **`ContextMenu.tsx`**:
  - Styled to match `@bug-on/m3-expressive` `Menu` tokens (`bg-m3-surface-container-high rounded-m3-lg shadow-lg border border-m3-outline-variant/50 p-1.5`) with spring entry (`MENU_CONTAINER_VARIANTS`), leading `Icon`, keyboard shortcut hint, and `Divider` support, positioned at cursor `(x, y)` with viewport boundary clamping.
- **`SettingsDialog.tsx`**:
  - Built with `@bug-on/m3-expressive` `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogBody`, `DialogFooter`.
  - **Theme & Color Section (New)**:
    - **Theme Mode**: `ButtonGroup` / segmented buttons for `System`, `Light`, `Dark`.
    - **Matugen Priority Toggle**: `Switch` for *"Use System Matugen Theme (`~/.config/matugen/theme.css`)"* with status badge (*Detected* / *Not found*).
    - **Source Color Picker**: Row of expressive preset color swatches (`#6750A4`, `#00639B`, `#006E1C`, `#BA1A1A`, `#8E4585`, `#B3261E`, `#006A6A`, `#7D5260`) + native `<input type="color">` seed picker (enabled whenever Matugen override is off or Matugen file is absent).
  - **Explorer Preferences Section**:
    - `Switch` for **Show Hidden Files**
    - `Switch` for **Filled Icons**
    - `ButtonGroup` for **Default View Mode** (`Grid` / `List`)
    - `Slider` (`@bug-on/m3-expressive` `Slider` with wave/value indicator, range `32`–`128`, step `8`) for **Icon Size**
    - **Custom CSS**: Import button + Clear button + active path label.
- **`PropertiesDialog.tsx`**:
  - Uses `@bug-on/m3-expressive` `Dialog` + `ShapeMedia` (`flower` / `cookie`) around the file type icon/thumbnail + structured M3 metadata cards.
  - **Important test contract**: Keep explicit `style={{ userSelect: 'text' }}` (or exact match for `userSelectCss.test.ts`: `style={{ ... userSelect: 'text' }}>{file.name}` and `>{file.path}`) so the user can copy the filename and location path and the unit test continues to pass.
- **`OpenWithDialog.tsx`**:
  - Uses `Dialog` + `TextField` (search filter) + `ScrollArea` + `List` / `ListItem` for **Recommended Applications** and **All Applications**.
- **`ConflictDialog.tsx`**:
  - Uses `Dialog` + `@bug-on/m3-expressive` `Checkbox` (*"Apply to all remaining items"*) + `Button` actions (`colorStyle="text"` for Skip, `colorStyle="tonal"` for Keep both, `colorStyle="filled"` for Replace).
- **Rename & New Folder Dialogs (in `App.tsx`)**:
  - Uses `@bug-on/m3-expressive` `Dialog` + `TextField` (with validation error state via `validateFileName`) + `Button` actions.
- **`QuickLook.tsx`**:
  - Styled with Tailwind v4 and M3 Expressive tokens (`bg-m3-surface-container-high rounded-m3-xl shadow-2xl border border-m3-outline-variant/50`), `Button` (`colorStyle="tonal"`), `IconButton`, and `LoadingIndicator` for async folder/text loads.
  - Preserves `<pre className="quicklook-text-content select-text">` (with `.quicklook-text-content { user-select: text; }` in `src/index.css`) to satisfy `userSelectCss.test.ts`.
  - Updates modal pre-flight check to `document.querySelector('dialog[open], [role="dialog"][data-state="open"]')`.
- **`TerminalPane.tsx`**:
  - Wraps the `xterm.js` container in an M3 Expressive bottom drawer/pane header (showing current `cwd` chip and a close `IconButton`) and syncs terminal background/foreground/cursor colors with the active `MD3ThemeProvider` surface/onSurface tokens.

## 6. Left to the Builder

- Whether to keep a thin wrapper in `src/components/Icon.tsx` around `@bug-on/m3-expressive`'s `Icon` or `.material-symbols-rounded` ligature span for backward compatibility across components.
- Exact preset hex palette list in `SettingsDialog` and exact `MD3ShapeName` pairings per semantic file group (`Folders` → `cookie4`/`flower`, `Images` → `clover4`, `Audio` → `pillStar`, `Archives` → `hexagon`, etc.).
- Breakdown of unit/component tests for the new theme resolver (Matugen CSS parser + fallback) and updated `userSelectCss.test.ts` (removing the deleted `QuickLook.css` file read or moving `.quicklook-text-content` rule into `src/index.css`).
