# MD3 Expressive UI Standardization (Surface Hierarchy, TabBar, and FileList)

*   **Author:** nguyentruongton
*   **Status:** Proposed
*   **Date:** 2026-11-13

--------------------------------------------------------------------------------

## Overview

This design standardizes the Material 3 File Explorer user interface around `@bug-on/m3-expressive` (`1.3.24`) without modifying library source inside `node_modules/@bug-on/m3-expressive`. It replaces manual borders and drop shadows with Material Design 3 `surface-container` tonal hierarchy across Light, Dark, and Matugen dynamic themes, rebuilds the browser-style tab strip with a connected pill `ButtonGroup`, and replaces `MD3Table` with a memoized, virtualized segmented `List` that preserves 4-column tabular scanning, native drag-and-drop, and single-indicator sorting across `Name`, `Date Modified`, `Type`, and `Size`.

## The Problem

The current interface breaks Material Design 3 Expressive visual conventions and contains structural UI defects across three areas:

1.  **Border and Shadow Clutter With Flat Tonal Layering:** `<main>` in `src/App.tsx`, `src/components/TabBar.tsx`, `src/components/ExplorerTab.tsx`, `src/components/StatusBar.tsx`, `src/components/SettingsDialog.tsx`, `src/components/Dashboard.tsx`, `src/components/QuickLook.tsx`, `src/components/ContextMenu.tsx`, and `src/components/FileList.tsx` rely on manual `border-*`, `shadow-*`, `ring-*`, and hairline `div` dividers to separate regions. Meanwhile, `Sidebar`, `<main>`, `TabBar`, and the `ExplorerTab` toolbar all sit on `surface-container-low` (or alpha-blended `/70`), so removing borders without reassigning tonal steps would merge adjacent panes into one flat surface. In addition, `TerminalPane` reads CSS variables only on mount, leaving its canvas out of sync when Light, Dark, or Matugen colors change.
2.  **Weak Tab Strip Visuals:** `src/components/TabBar.tsx` renders rectangular top-rounded tabs (`rounded-t-m3-md`) anchored to a bottom border line, which clashes with the pill-shaped expressive controls elsewhere in the app. The author wants pill-shaped connected tabs built on `ButtonGroup` (`variant="connected"`) with a separate Chrome-style `+` button, while still supporting horizontal scrolling, middle-click close, per-tab close, and full keyboard accessibility.
3.  **Duplicate Sort Indicators and Non-Expressive File Rows:** In `src/components/FileList.tsx`, passing `onSort` to `MD3TableHeaderCell` while also rendering `<MD3TableSortIndicator />` inside its children produces two side-by-side sort arrows on `Name`, `Date Modified`, and `Size`. The `Type` column cannot be sorted at all, and the file rows use `MD3Table` instead of `@bug-on/m3-expressive` `List` (`variant="expressive"`, `listStyle="segmented"`). Switching to `List`/`ListItem` introduces non-trivial rendering cost in large directories and conflicts with `ListItem`'s omitted drag events (`SafeHTMLLIAttrs`), single-click toggle behavior, and `Space`-key Quick Look binding unless explicitly engineered for memoization, virtualization, and desktop file-explorer interactions.

## Goals

*   **Tonal Depth Without Manual Chrome:** Remove manual borders, `h-px`/`w-px` divider `<div>`s, and `shadow-*` elevation overrides across the app shell and custom containers (`App.tsx`, `NavigationRail.tsx`, `Sidebar`, `TabBar`, `ExplorerTab`, `Omnibar`, `StatusBar`, `TerminalPane`, `SettingsDialog`, `Dashboard`, `QuickLook`, `ContextMenu`, `OpenWithDialog`, `PropertiesDialog`, `FileList`, and `FileListSkeleton`), separating regions through opaque MD3 `surface-container` tokens while retaining library-native outlines where semantically needed (`Button colorStyle="outlined"`, focus rings, color-input edges) and keeping `TerminalPane` synced with live theme updates.
*   **Connected Pill TabBar:** Rebuild `TabBar` with `@bug-on/m3-expressive` `ButtonGroup` (`variant="connected"`) and `rounded-m3-full` pill styling, a pinned Chrome-style external `+` `IconButton`, horizontal overflow scrolling with active-tab scroll-into-view, non-nested per-tab close and middle-click close, and keyboard arrow-key navigation.
*   **Virtualized Segmented FileList With 4-Column Alignment:** Replace `MD3Table` in `FileList` with memoized, virtualized `@bug-on/m3-expressive` `List` (`variant="expressive"`, `listStyle="segmented"`) and `ListItem` rows formatted into 4 aligned columns (`Name`, `Date Modified`, `Type`, `Size`), preserving group corner radii, multi-select (`Ctrl`/`Shift`), double-click open, context menu, native drag-and-drop (`api.startDrag`), and `Space`-bar Quick Look.
*   **Single-Indicator 4-Column Sorting:** Eliminate duplicate sort arrows so only the active sort column displays one direction indicator, and support `Type` sorting alongside `Name`, `Date Modified`, and `Size` across `ExplorerTab` and `FileList`.

## Non-Goals

*   Modifying or patching source files inside `node_modules/@bug-on/m3-expressive`.
*   Removing library-native `outlined` button variants, accessibility `focus-visible` indicators, or contrast outlines on custom color pickers.
*   Changing Electron or Tauri backend IPC protocols for filesystem enumeration or native OS drag operations.
*   Redesigning the Grid view layout beyond removing `shadow-xs` / `ring-2` chrome in favor of tonal selection styling and syncing `Type` sort state.

## Open Questions

None. Both architectural questions were resolved by the author before drafting the Technical Plan:

*   **Surface-Container Tonal Map (Option A):** Outer shell and `NavigationRail` use `surface-container`; `Sidebar` uses opaque `surface-container-low`; `<main>` chrome (`TabBar`, `ExplorerTab` toolbar, `StatusBar`) uses `surface-container`; the `FileList` scroll viewport uses `surface-container-low`; and `ListItem` retains its native `var(--md-sys-color-surface)` resting background.
*   **`Type` Sort Comparator (Option A):** Sort `'type'` by lowercase file extension, then `getSemanticGroup`, then natural `name`, preserving `GROUP_ORDER` when `groupingEnabled` is enabled and folders-first when `groupingEnabled` is disabled.

## Critical User Journeys (CUJs)

### CUJ 1: Navigating and Switching Directories With Tonal Shell Separation
*   **Given**: The application is open in Light, Dark, or a Matugen dynamic color palette, with `NavigationRail`, `Sidebar`, `<main>`, and `TerminalPane` visible.
*   **When**: The user toggles Dark/Light mode or picks a new seed color in `SettingsDialog`, then navigates between `Dashboard`, `Home`, and filesystem paths.
*   **Then**: Adjacent panes remain visually distinct through opaque `surface-container` tonal steps with no manual container borders or shadows, and `TerminalPane` updates its canvas background and text colors immediately to match the active palette.

### CUJ 2: Managing Multiple Explorer Tabs in a Connected Pill Strip
*   **Given**: The user has one or more tabs open in `TabBar`, including enough tabs with long folder names to overflow the available width.
*   **When**: The user opens a new tab via the external `+` button, switches tabs with mouse clicks or `ArrowLeft`/`ArrowRight` keys, middle-clicks a tab, or clicks a tab's close icon (when more than one tab exists).
*   **Then**: The active tab scrolls into view within the `ButtonGroup` strip without clipping pill corners or hiding the external `+` button, closing a tab never triggers accidental tab activation, and keyboard focus moves cleanly across tabs.

### CUJ 3: Browsing, Sorting, Selecting, and Dragging Files in Large Directories
*   **Given**: The user opens a directory containing 1,000+ mixed files and folders in List view (with or without semantic grouping enabled).
*   **When**: The user scrolls the list, clicks column headers (`Name`, `Date Modified`, `Type`, `Size`) to sort, selects ranges with `Ctrl`/`Shift`, presses `Space` for Quick Look or `Enter`/double-click to open, right-clicks for the context menu, or drags an item to a folder or external app.
*   **Then**: Only visible windowed rows render with intact segmented group corners (`leading`/`middle`/`trailing`/`solo`), all 4 columns stay aligned under the sticky header, only the active sort column shows one arrow indicator, and selection, Quick Look, context menu, and native drag-and-drop behave without regressions.

## Technical Plan (Architecture)

### 1. Opaque Surface-Container Tonal Map & Chrome Cleanup

All manual `border-*`, `shadow-*`, and alpha-blended container fills (`/70`, `/60`, `/50`) are removed from custom layouts and replaced by solid MD3 tokens under Option A:

```text
+-----------------------------------------------------------------------------+
| App Shell & NavigationRail: bg-m3-surface-container (no outer border)       |
|  +-----------------+ +---------------------------------------------------+  |
|  | Sidebar         | | <main> (rounded-m3-xl, no border, no shadow-sm)   |  |
|  | (Drawer)        | |  +---------------------------------------------+  |  |
|  | bg-m3-surface-  | |  | TabBar + ExplorerTab Toolbar                |  |  |
|  | container-low   | |  | bg-m3-surface-container                     |  |  |
|  | (opaque)        | |  +---------------------------------------------+  |  |
|  |                 | |  | FileList Viewport: bg-m3-surface-container- |  |  |
|  |                 | |  | low -> ListItem rows: var(--md-sys-color-   |  |  |
|  |                 | |  | surface) resting / secondary-container sel. |  |  |
|  |                 | |  +---------------------------------------------+  |  |
|  |                 | |  | TerminalPane (optional): header surface-    |  |  |
|  |                 | |  | container-high / xterm surface-container-   |  |  |
|  |                 | |  | lowest (live MutationObserver theme sync)   |  |  |
|  |                 | |  +---------------------------------------------+  |  |
|  |                 | |  | StatusBar: bg-m3-surface-container          |  |  |
|  +-----------------+ +---------------------------------------------------+  |
+-----------------------------------------------------------------------------+
```

*   **Shell & Explorer Chrome:** Remove `border border-m3-outline-variant/30 shadow-sm` on `<main>` (`src/App.tsx`), `border-b` on `TabBar` (`src/components/TabBar.tsx`), `border-b` and manual `w-px` divider `<div>`s on `ExplorerTab` toolbar and search banner (`src/components/ExplorerTab.tsx`), `border-t` on `StatusBar` (`src/components/StatusBar.tsx`), and `border-t`/`border-b` on the Terminal drawer wrapper (`src/App.tsx`). Replace `/70` opacity on `Sidebar` (`src/components/Sidebar.tsx`) with opaque `bg-m3-surface-container-low`. Where vertical toolbar or list dividers remain semantically helpful, use `@bug-on/m3-expressive` `Divider` (`orientation="vertical"` in the toolbar, default horizontal in menus/dialogs) rather than custom hairline `<div>`s.
*   **Secondary Views & Overlays:**
    *   `Dashboard` (`src/components/Dashboard.tsx`): Standardize all three Bento cards onto `Card variant="filled"` (removing `variant="elevated"` drop shadows and `variant="outlined"` borders), replace the dashed border on "Add Pin" with a `bg-m3-surface-container-high` tonal surface tile, and remove `shadow-xs` on `ExpressiveShape`.
    *   `SettingsDialog` (`src/components/SettingsDialog.tsx`): Remove the five `border-t` dividers, `ring-2 ring-m3-on-surface`, and `shadow-xs` on color shapes; group setting blocks inside opaque `bg-m3-surface-container` (`rounded-m3-lg`) sections with `bg-m3-surface-container-low` (`rounded-m3-md`) sub-blocks separated by spacing; upgrade the loaded CSS badge to opaque `bg-m3-secondary-container text-m3-on-secondary-container`; and preserve `Button colorStyle="outlined"` on unselected mode toggles and the `1px` edge contrast outline on the custom `<input type="color">` swatch.
    *   `ContextMenu` (`src/components/ContextMenu.tsx`), `QuickLook` (`src/components/QuickLook.tsx`), `OpenWithDialog` (`src/components/OpenWithDialog.tsx`), and `PropertiesDialog` (`src/components/PropertiesDialog.tsx`): Remove manual `border`, `shadow-*`, and `h-px` `<div>` dividers; migrate `OpenWithDialog` rows to `List`/`ListItem` + `Divider`, keep `ContextMenu`'s coordinate-positioned floating surface with `bg-m3-surface-container-high` + `Divider` + keyboard menu navigation (avoiding Radix trigger wrapping that breaks explicit `(x, y)` state invocation), and step `QuickLook` header/body with `bg-m3-surface-container` vs. `bg-m3-surface-container-high` without `shadow-2xl border`.
    *   `Omnibar` (`src/components/Omnibar.tsx`) & `FileList` Grid (`src/components/FileList.tsx`): Replace `ring-2` and `shadow-xs` selection/focus styles with tonal fills (`bg-m3-secondary-container` for selected grid items, `bg-m3-surface-container-highest` for active Omnibar edit state), keeping `:focus-visible` accessibility rings.
*   **Reactive `TerminalPane` Theme Sync, Diagnostics, & Low-Contrast Cushion:** Add a `MutationObserver` on `document.documentElement` (`style` and `class` attributes) inside `TerminalPane.tsx` (matching the container's `bg-m3-surface-container-lowest` and the `App.tsx` terminal header's `bg-m3-surface-container-high` without borders) so `term.options.theme = readTerminalTheme()` re-runs immediately on Light/Dark/Matugen changes. In `src/utils/themeUtils.ts`, emit a deduplicated development warning when non-empty Matugen CSS fails primary seed extraction and falls back to `DEFAULT_SEED_COLOR`. Add a `@media (prefers-contrast: more)` / `@media (forced-colors: active)` CSS rule targeting `.shell-panel` and `[role="tablist"]` in `src/index.css` so high-contrast pane outlines appear automatically when OS high-contrast mode is requested.

### 2. Connected Pill `TabBar` (`ButtonGroup variant="connected"`)

Because `@bug-on/m3-expressive` `ButtonGroup` renders `<fieldset>`, clones direct children with `Button` props + Motion corner styles, and defaults `tabIndex` to `0` on child 0 and `-1` on children `1..N` with no arrow-key handler, `TabBar.tsx` wraps each tab in `Button asChild`:

```text
<div className="flex items-center gap-2 px-3 py-1.5 bg-m3-surface-container">
  <div role="tablist" aria-label="Open tabs" className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <ButtonGroup variant="connected" size="sm" className="w-max overflow-visible">
      {tabs.map(tab => (
        <TabSegment key={tab.id} selected={isActive}>
          {/* TabSegment accepts { selected?: boolean; children: React.ReactElement } and renders <>{children}</>, absorbing ButtonGroup's cloned tabIndex/colorStyle/motion props so they do not overwrite <div role="tab"> */}
          <Button
            asChild
            variant="toggle"
            selected={isActive}
            shape={isActive ? 'square' : 'round'} // Keeps Button effectiveShape === 'round'
            colorStyle="tonal"
            className="!rounded-m3-full min-w-[120px] max-w-[220px] [&>span]:w-full [&>span]:min-w-0"
          >
            <div role="tab" aria-selected={isActive} aria-label={tab.title} tabIndex={isActive ? 0 : -1} className="min-w-0">
              <span className="flex items-center gap-1.5 w-full min-w-0 justify-between">
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  <Icon ... /> {tab.title}
                </span>
                {canClose && <IconButton ... />}  // sibling inside non-button div; stops pointerdown, click, and Enter/Space keydown propagation
              </span>
            </div>
          </Button>
        </TabSegment>
      ))}
    </ButtonGroup>
  </div>
  <IconButton aria-label="New tab" ... />       // External Chrome-style '+' button pinned right
</div>
```

*   **HTML Validity, Library Integration, & Close Action:** Import `Button` directly from `@bug-on/m3-expressive` (not `./Button`, which does not support `asChild`, `variant="toggle"`, `selected`, or `shape`). `@bug-on/m3-expressive` `Button` requires `variant="toggle"` when passing `selected`, and inverts `shape` from `"round"` to `"square"` when selected; passing `shape={isActive ? 'square' : 'round'}` keeps `effectiveShape === 'round'`, while `!rounded-m3-full` locks static pill corners (overriding `Slot`'s inline `style.borderRadius` motion updates). Defining `<TabSegment>` with `{ selected?: boolean; children: React.ReactElement }` and returning `<>{children}</>` lets `ButtonGroup` read `element.props.selected === true` while absorbing `ButtonGroup`'s cloned `tabIndex`, `colorStyle`, `selectedColorStyle`, and motion props without overwriting `<div role="tab">` `tabIndex`. Rendering `<div role="tab">` instead of `<button>` keeps the close `<IconButton>` as a valid sibling rather than a nested `<button>`. On the close `<IconButton>`, `onPointerDown`, `onClick`, and `onKeyDown` (for `Enter`/`Space`) call `e.stopPropagation()` so neither mouse clicks nor keyboard activation bubble to `<div role="tab">` or `role="tablist"`. Middle-click (`onMouseDown` `e.button === 1`) continues closing tabs when `tabs.length > 1`.
*   **Roving Keyboard Navigation & Overflow:** `TabBar` tracks tab refs and handles `ArrowLeft`, `ArrowRight`, `Home`, and `End` on the `role="tablist"` container to move focus and activate the target tab (`onTabClick`). `Enter`/`Space` on `role="tablist"` activates the focused tab only when `!(e.target as HTMLElement).closest('button')`. On `activeTabId` change, `activeTabRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })` keeps newly created or switched tabs visible inside the horizontal scroll viewport.
*   **Pill Radii, Tonal States, & Accessibility:** Each tab sets `aria-label={tab.title}` explicitly, adds `[&>span]:w-full [&>span]:min-w-0` so `Button`'s inner `<m.span layout="position" className="inline-flex items-center h-full gap-[inherit]">` spans the full tab width and propagates `min-w-0` truncation, enforces `rounded-m3-full` pill styling, and overrides `BUTTON_COLOR_TOKENS.tonal.selected` (`bg-m3-secondary`) with explicit tonal classes (`!bg-m3-secondary-container !text-m3-on-secondary-container` active vs. `!bg-m3-surface-container-high !text-m3-on-surface-variant` inactive). The external `+` `IconButton` stays pinned right outside the scroll viewport.

### 3. Virtualized Segmented `FileList` + 4-Column Sort Header + `Type` Sort

*   **Canonical Sort State & Option A `Type` Comparator (`ExplorerTab.tsx` & `FileList.tsx`):**
    *   Update `SortField = 'name' | 'date' | 'type' | 'size'` in `ExplorerTab.tsx`, `FileList.tsx`, and the `ExplorerTab` toolbar sort buttons (adding a `Type` sort `IconButton` alongside `Name`, `Date`, `Size`, and `Direction`).
    *   In `sortedFiles`, keep `GROUP_ORDER` partitioning when `groupingEnabled` is `true` and folders-first when `groupingEnabled` is `false`. For `sortBy === 'type'`, compare `getFileExtension(a.name).toLowerCase()` vs. `getFileExtension(b.name).toLowerCase()`, tie-break by `getSemanticGroup(a)` vs. `getSemanticGroup(b)`, and tie-break again by `a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })`, reversing by `sortOrder`.
*   **Flattened Virtualized Model & Group-Aware `position`:**
    *   To avoid O(N) `React.Children.toArray` and `ListIndexContext.Provider` re-renders on large directories (1,000+ files), build a flattened display list `DisplayEntry[]` where each entry is either `{ kind: 'header', group, key }` (`36px` element height + `2px` List gap = `38px` stride) or `{ kind: 'file', file, position, fileIndex, key }` (`56px` element height matching `LIST_TOKENS.oneLineHeight` + `2px` segmented gap = `58px` stride).
    *   Precompute `position: 'solo' | 'leading' | 'middle' | 'trailing'` for every file entry based on adjacent entries within its contiguous group (resetting at every `{ kind: 'header' }` boundary, or across the whole list when `groupingEnabled` is `false`). Because `ListItem` (`dist/layout.mjs`) prioritizes explicit `position` over `getListItemPosition`, virtualized slices preserve exact 16px outer and 4px inner segmented corner radii even when top/bottom items are scrolled out of the DOM.
    *   A heterogeneous fixed-height `useVirtualWindow` hook (using prefix-sum cumulative offsets over `DisplayEntry[]`, `topOffset = 40` for the sticky header, `totalHeight = itemCount > 0 ? offsets[itemCount] - 2 : 0`, and `fallbackHeight = 600` when `viewportHeight === 0` for non-layout test/SSR renders) attached to `ExplorerTab`'s scroll container computes `[startIdx, endIdx]` with overscan and renders `<List variant="expressive" listStyle="segmented" selectionMode="multi-select" value={selectedArray} onChange={noop}>` containing a top spacer (`<li role="presentation" aria-hidden="true">` omitted when `0`, subtracting `2px` `gap-[2px]` so scroll height stays exact), visible group headers (`<li role="presentation" className="h-9 ...">` stopping click propagation), visible memoized rows (`React.memo` `FileListRow` accepting `file: IFile`, `isSelected`, `position`, `morphEnabled` — never `value` or `_m3ListItem = true` — enforcing fixed `h-14`), and a bottom spacer (`<li role="presentation" aria-hidden="true">` when `> 0`, subtracting `2px` `gap-[2px]`). `morphEnabled` is computed via `shouldEnableItemMorph(sortedFiles.length, isSelected)` (`src/utils/shapeUtils.ts`) and passed only to `FileListRow` to gate `<ExpressiveShape morphTo={...}>`, never forwarded to `ListItem`.
*   **Synchronized 3-Slot Flex Header + `.file-meta-grid`, Interaction Guards, & Skeleton:**
    *   `ListItem` renders a 3-slot horizontal flex layout (`px-4 flex items-center gap-3`): `LeadingSlot` (`w-8 shrink-0` holding the 32px `ExpressiveShape` icon/thumbnail), `ItemContent` (`flex-1 min-w-0` holding the truncated file name), and `TrailingSlot` (`trailingType="custom"` `trailingContent` holding a shared `.file-meta-grid` 3-column grid: `Date Modified` with `hidden md:block truncate`, `Type` with `hidden sm:block truncate`, and `Size` with `text-right tabular-nums`).
    *   Mirror that exact 3-slot geometry in the sticky custom sort header (`.file-list-header`, `sticky top-0 z-10 h-10 bg-m3-surface-container px-4 flex items-center gap-3`): a `w-8 shrink-0` leading offset, `flex-1 min-w-0` Name `<button>`, and `.file-meta-grid` for `Date Modified` (`hidden md:block`), `Type` (`hidden sm:block`), and `Size` (`text-right`) `<button>` headers (removing `py-2` on the list wrapper and keeping `scrollbar-gutter: stable` on the scroll viewport). Clicking anywhere inside `.file-list-header` calls `e.stopPropagation()` so sorting or header clicks never clear `selectedFiles` in `ExplorerTab.tsx`.
    *   Pass `asChild` to `ListItem` with `<div role="option" aria-selected={isSelected} data-file-path={file.path} draggable onDragStart={...} onClick={...} onDoubleClick={...} onContextMenu={...} onKeyDown={...} className="file-list-item h-14">`, preserving `ExplorerTab.tsx`'s `.closest('.file-list-item')` hit-testing and `api.startDrag(file.path, file.path)`. Suppress `List`'s default `onChange` by passing a no-op `onChange` and handling single-click replace, `Ctrl`/`Cmd`-toggle, `Shift`-range, and click-selected-to-navigate inside the row `onClick`. Intercept `ArrowUp`/`ArrowDown`/`Home`/`End` on the row with `e.stopPropagation()` to move keyboard focus only (`aria-selected` unchanged), storing `pendingFocusPathRef`, scrolling the target `DisplayEntry` into view via `scrollContainerRef` (subtracting `40px` header height when moving upward), and resolving focus in `useLayoutEffect` by scanning `[data-file-path]` nodes with `getAttribute('data-file-path') === targetPath`. Intercept `Space` with `e.preventDefault()` on `.file-list-item` to open Quick Look (primary `selectedFiles` via `resolveQuickLookTarget`, falling back to the focused `.file-list-item`'s `data-file-path` when `selectedFiles` is empty).
    *   Replace `MD3TableHeaderCell` + duplicate `<MD3TableSortIndicator>` with the 4 `<button>` column headers (`aria-sort` mapped to `'ascending' | 'descending' | 'none'`), rendering strictly **one** `<Icon name={sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'} />` only on the active column. Update `FileListSkeleton.tsx` list rows from `h-11` (`44px`) to `h-14` (`56px`) segmented placeholders matching the 3-slot + `.file-meta-grid` layout.

## Alternatives Considered

### Alternative A: Keep `Tabs`, `TabsList`, and `Tab` (Restyled as Pills) for `TabBar`
*   **Pros**: Preserves `@bug-on/m3-expressive` `role="tablist"` / `role="tab"` ARIA attributes, built-in `ArrowLeft`/`ArrowRight` roving focus, and `TabsList` horizontal scrolling without writing custom keyboard handlers or `Button asChild` close-button wrappers.
*   **Cons**: Uses the library's tab indicator layout rather than the connected segmented `ButtonGroup` geometry requested for the tab strip.
*   **Reason for Rejection**: Rejected by author: the design explicitly mandates `@bug-on/m3-expressive` `ButtonGroup` (`variant="connected"`) with `rounded-m3-full` pill geometry and an external Chrome-style `+` button, accepting the responsibility to supply `Button asChild` close-button separation and custom roving keyboard navigation.

### Alternative B: Keep `MD3Table` (3-Line Duplicate-Indicator Fix + Borderless Restyle) for `FileList`
*   **Pros**: Removes the duplicate sort arrow in 3 deleted lines (dropping the manual `<MD3TableSortIndicator>` children), keeps native `<table>`/`<thead>`/`<tbody>` column auto-alignment, `aria-sort`, and `MD3TableRow` selection/drag wiring, and aligns with `node_modules/@bug-on/m3-expressive/llms-full.txt` guidance for tabular data.
*   **Cons**: Does not use `@bug-on/m3-expressive` `List` (`variant="expressive"`, `listStyle="segmented"`) or segmented 16dp/4dp group corner morphing for directory items.
*   **Reason for Rejection**: Rejected by author: the design explicitly targets expressive segmented `List`/`ListItem` presentation arranged in 4 table-like columns, accepting the extra work for `trailingType="custom"` grid synchronization, `asChild` DnD/selection wrappers, and windowed virtualization.

### Alternative C: Unvirtualized `List` Rendering for Directory Rows
*   **Pros**: Lets `<List>` manage `_listIndex` and `position` automatically via `React.Children` cloning with less custom indexing code.
*   **Cons**: Forces `List` to clone all `N` elements and wrap every row in `ListIndexContext.Provider` on every single-file selection change, causing O(N) render stalls in directories with 1,000+ entries.
*   **Reason for Rejection**: Rejected by author: memoization (`React.memo`) and windowed virtualization with explicit `position` props are mandatory to bound render work to visible rows.

### Alternative D: Tonal Surface Ladders With Inverted Main Sheet (`surface-container` Main) or Overridden `ListItem` (`surface-container-lowest`)
*   **Pros**: A `surface-container` `<main>` sheet gives 2 tonal steps under `surface` `ListItem` rows without overrides, while `surface-container-lowest` makes file rows brightest in Light mode.
*   **Cons**: A `surface-container` `<main>` makes the main workspace darker than `Sidebar` (`surface-container-low`) in Light mode, whereas overriding `ListItem` to `surface-container-lowest` requires local CSS token overrides and renders rows darker than the viewport in Dark mode.
*   **Reason for Rejection**: Rejected by author: Option A keeps `ListItem` on its native `var(--md-sys-color-surface)` resting fill, places the scroll viewport on `surface-container-low`, and steps outer shell, `TabBar`, toolbar, and `StatusBar` to `surface-container`.

### Alternative E: Sorting `Type` by Displayed Group (`getSemanticGroup`) or Reordering `GROUP_ORDER`
*   **Pros**: Matches the semantic category name (`Archive`, `Code`, `Document`) alphabetically or reverses group blocks visually on `desc`.
*   **Cons**: When `groupingEnabled` is true, every item inside a group shares the same `getSemanticGroup` value (making `Type` sort identical to `Name` sort inside groups), and reordering `GROUP_ORDER` moves `Folders` away from the top on descending sort.
*   **Reason for Rejection**: Rejected by author: sorting `'type'` by extension first, then `getSemanticGroup`, then natural `name` keeps `GROUP_ORDER` and folders-first intact while still grouping identical file extensions together within each section.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Performance & Latency**: `FileList` List mode must render O(visible + overscan) `ListItem` rows via fixed-height windowing (`56px` item rows + `2px` segmented gap, `36px` group headers) and `React.memo` row components keyed on primitive props (`isSelected`, `position`, `morphEnabled`). Per-item shape morphing remains gated by `shouldEnableItemMorph(sortedFiles.length, isSelected)` so large directories avoid running `N` simultaneous morph springs.
*   **Accessibility & Contrast**: Removing manual borders and shadows must preserve keyboard operability (`ArrowLeft`/`ArrowRight`/`Home`/`End` roving focus in `TabBar`; `ArrowUp`/`ArrowDown` cross-group navigation, `Enter`, and `Space` Quick Look in `FileList`), `:focus-visible` outlines, and `@media (prefers-contrast: more)` / `forced-colors` fallback pane boundaries across Light, Dark, and Matugen themes.
*   **Compatibility & Rollback**: Zero edits inside `node_modules/@bug-on/m3-expressive`. Legacy `sortBy` values outside `'name' | 'date' | 'type' | 'size'` fall back safely to `'name'`. All UI changes remain isolated to `src/` components and `src/index.css`, allowing clean git revert per component without touching IPC or stored settings schemas.

--------------------------------------------------------------------------------

### Additional Resources

*   `@bug-on/m3-expressive` AI API Specification: `node_modules/@bug-on/m3-expressive/llms-full.txt`
*   `@bug-on/m3-expressive` TypeScript Declarations: `node_modules/@bug-on/m3-expressive/dist/*.d.ts`

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Implementation is partitioned into **four incremental phases**. Each phase ends with a mandatory build, test, and lint gate (`npm run build && bun test && npm run lint`) before advancing to the next phase.

### Phase 1: Utilities, Virtualization Hook, & Tonal Shell Foundation

#### 1. `src/index.css` (Modify)
*   **Type / Scope**: Global Stylesheet & Tailwind v4 Theme Utilities
*   **Proposed Changes**:
    *   Define `.file-meta-grid` with synchronized column tracks (`grid-cols-[5.5rem] gap-3 items-center`, `sm:grid-cols-[6.5rem_5.5rem]`, and `md:grid-cols-[9.5rem_6.5rem_5.5rem]`) so `Date Modified` (`9.5rem`), `Type` (`6.5rem`), and `Size` (`5.5rem`) align identically between `.file-list-header` and `ListItem` `trailingContent` (`TrailingSlot`), paired with explicit cell visibility classes (`hidden md:block truncate` on `Date Modified`, `hidden sm:block truncate` on `Type`, `text-right tabular-nums` on `Size`).
    *   Add `@media (prefers-contrast: more)` (`outline: 1px solid var(--md-sys-color-outline)`) and `@media (forced-colors: active)` (`outline: 1px solid CanvasText`) fallback rules targeting `.shell-panel` and `[role="tablist"]` when OS high-contrast accessibility is active, leaving standard mode borderless without touching `node_modules/@bug-on/m3-expressive`.
*   **Rationale**: Locks list column widths across header and rows to one source of truth and restores explicit `1px` pane boundaries when OS high-contrast mode is active.

#### 2. `src/utils/fileListUtils.ts` (Create)
*   **Type / Scope**: Pure File Sorting & Virtualized Display Model Module
*   **Proposed Changes**:
    *   Export `SortField = 'name' | 'date' | 'type' | 'size'`, `DisplayEntry` union (`{ kind: 'header'; group: FileGroup; key: string }` | `{ kind: 'file'; file: IFile; fileIndex: number; position: ListItemPosition; key: string }`), and `normalizeSortField(value: unknown): SortField` (defaulting unknown values to `'name'`).
    *   Export `compareFiles(a, b, sortBy, sortOrder, groupingEnabled)`: handles `'name'` via `a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })`, handles `'type'` via lowercase `getFileExtension` -> `getSemanticGroup` -> natural `name` (`{ numeric: true, sensitivity: 'base' }`), applies the same natural `name` tie-breaker on `'size'` and `'date'` equality, reverses only within-group item order for `sortOrder === 'desc'`, preserves `GROUP_ORDER` when `groupingEnabled` is `true`, and places folders before files when `false`.
    *   Export `buildDisplayEntries(files, groupingEnabled)`: flattens sorted files (and section headers when grouped), assigning sequential `fileIndex` across file entries and resetting `position` (`'solo' | 'leading' | 'middle' | 'trailing'`) at every `{ kind: 'header' }` boundary so contiguous group corner radii remain invariant under virtualization.
*   **Rationale**: Decouples sorting and segmented corner-radius precomputation from React DOM rendering so virtualized slices render exact group corners and can be unit tested in isolation without React/DOM state.

#### 3. `src/hooks/useVirtualWindow.ts` (Create)
*   **Type / Scope**: Heterogeneous Fixed-Height Virtualization Hook
*   **Proposed Changes**:
    *   Export pure `calculateVirtualRange(offsets: number[], totalHeight: number, scrollTop: number, viewportHeight: number, overscan: number, fallbackHeight = 600)` and `useVirtualWindow({ containerRef, itemCount, getItemHeight, overscan = 6, topOffset = 0, fallbackHeight = 600 })` returning `{ startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, totalHeight, offsets }` tracked via `scroll` + `ResizeObserver`.
    *   Build prefix-sum `offsets` (`offsets[0] = 0`, `offsets[i + 1] = offsets[i] + getItemHeight(i)`, where `getItemHeight` returns `58` for file entries = `56px` row + `2px` List gap and `38` for group headers = `36px` header + `2px` List gap). Compute `totalHeight = itemCount > 0 ? offsets[itemCount] - 2 : 0` (the last item has no trailing `2px` `<List>` gap). Return `{ startIndex: 0, endIndex: -1, topSpacerHeight: 0, bottomSpacerHeight: 0, totalHeight: 0, offsets: [0] }` when `itemCount === 0`, subtract `topOffset` (`40px` sticky `.file-list-header`) from `scrollTop` (`Math.max(0, scrollTop - topOffset)`) and available `viewportHeight`, use `fallbackHeight = 600` when `viewportHeight === 0` (ensuring `renderToStaticMarkup` renders visible items in `bun:test`), and subtract `2px` from non-zero spacer heights (`Math.max(0, rawSpacer - 2)`) so `<List>`'s `gap-[2px]` produces zero drift.
*   **Rationale**: Bounds `List` / `ListItem` DOM nodes and context consumers to `O(visible + overscan)` rows across heterogeneous headers/rows with exact scrollbar geometry.

#### 4. `src/utils/__tests__/fileListUtils.test.ts` (Create)
*   **Type / Scope**: Unit Tests (`bun:test`)
*   **Proposed Changes**: Test `compareFiles` across `'name'` and `'type'` (grouped and ungrouped), `'size'`/`'date'` tie-breakers, `sortOrder` invariants, `normalizeSortField`, `buildDisplayEntries` `position` resets at group boundaries (plus ungrouped lists), and `calculateVirtualRange` (mixed `58px`/`38px` offsets, `totalHeight` trailing-gap subtraction, `topOffset` adjustment, `itemCount === 0`, `viewportHeight === 0` fallback, and spacer height calculations).
*   **Rationale**: Validates Phase 1 sorting and virtualization primitives before wiring UI components.

#### 5. `src/App.tsx` (Modify)
*   **Type / Scope**: Application Shell Layout
*   **Proposed Changes**: Update root container from `bg-m3-surface` to `bg-m3-surface-container`. Mark outer shell regions (`<main>` and the Terminal drawer wrapper) with `.shell-panel`, remove `border border-m3-outline-variant/30 shadow-sm` from `<main>`, change `<header>` from `bg-m3-surface-container-low` to `bg-m3-surface-container`, and keep `<main>`'s `ExplorerTab` scroll viewport (`FileList` body) on `bg-m3-surface-container-low`. Remove `border-t` on the Terminal drawer wrapper and `border-b` on the Terminal header (`bg-m3-surface-container-high` remains unchanged). Replace the inline-styled `"No tabs open"` fallback block with MD3 typography, `ExpressiveShape`, and `bg-m3-surface-container-low`.
*   **Rationale**: Removes shell borders/shadows while establishing Option A tonal stepping across adjacent panes.

#### 6. `src/components/NavigationRail.tsx` (Modify)
*   **Type / Scope**: Navigation Shell Component
*   **Proposed Changes**: Change `M3NavigationRail` container background from `bg-m3-surface` to `bg-m3-surface-container`, retain `border-0`, and apply `.shell-panel`.
*   **Rationale**: Unifies the left rail with the outer shell frame against the `bg-m3-surface-container-low` `Sidebar`.

#### 7. `src/components/Sidebar.tsx` (Modify)
*   **Type / Scope**: Places & Devices Drawer
*   **Proposed Changes**: Replace semi-transparent `bg-m3-surface-container-low/70` with opaque `bg-m3-surface-container-low` on `NavigationDrawer` and apply `.shell-panel`.
*   **Rationale**: Prevents alpha blending from washing out tonal separation across Light, Dark, and Matugen palettes.

#### 8. `src/components/StatusBar.tsx` (Modify)
*   **Type / Scope**: Bottom Directory Status Strip
*   **Proposed Changes**: Remove `border-t border-m3-outline-variant/40` while retaining `bg-m3-surface-container`.
*   **Rationale**: Aligns the footer bar with the Option A `surface-container` frame without hairline borders.

#### 9. `src/components/TerminalPane.tsx` (Modify)
*   **Type / Scope**: Embedded xterm.js Terminal Panel
*   **Proposed Changes**: Preserve `bg-m3-surface-container-lowest` on the container and add a `MutationObserver` on `document.documentElement` (`style` and `class` attributes) calling `readTerminalTheme()` to update `term.options.theme` live when Light, Dark, or Matugen tokens change.
*   **Rationale**: Keeps `TerminalPane` palette colors synchronized with the `bg-m3-surface-container-high` terminal header and `<main>` viewport across live theme switches.

**Phase 1 Checkpoint**: Run `npm run build && bun test && npm run lint` before starting Phase 2.

---

### Phase 2: `TabBar` Connected Pill Strip

#### 10. `src/components/TabBar.tsx` (Modify)
*   **Type / Scope**: Browser Tab Strip (`ButtonGroup variant="connected"`)
*   **Proposed Changes**:
    *   Import `Button` directly from `@bug-on/m3-expressive` (not `./Button`). Remove `border-b border-m3-outline-variant/40` and set outer wrapper background to `bg-m3-surface-container`.
    *   Replace `Tabs`/`TabsList`/`M3Tab` with a `role="tablist"` horizontal scroll container (`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`) wrapping `<ButtonGroup variant="connected" size="sm" className="w-max overflow-visible">`.
    *   Define `<TabSegment>` with props `{ selected?: boolean; children: React.ReactElement }` returning `<>{children}</>` so `ButtonGroup` reads `selected` without forwarding cloned `tabIndex`, `colorStyle`, `selectedColorStyle`, or motion props onto `<Button>` or DOM nodes.
    *   Inside `<TabSegment>`, render `<Button asChild variant="toggle" selected={isActive} shape={isActive ? 'square' : 'round'} colorStyle="tonal" className="!rounded-m3-full min-w-[120px] max-w-[220px] [&>span]:w-full [&>span]:min-w-0">` over `<div role="tab" aria-selected={isActive} aria-label={tab.title} tabIndex={isActive ? 0 : -1} className="min-w-0">`. Override `BUTTON_COLOR_TOKENS.tonal.selected` with `!bg-m3-secondary-container !text-m3-on-secondary-container` (active) and `!bg-m3-surface-container-high !text-m3-on-surface-variant` (inactive).
    *   Place the icon+truncated title and sibling close `<IconButton>` (shown when `tabs.length > 1`, calling `e.stopPropagation()` on `onPointerDown`, `onClick`, and `onKeyDown` when `e.key === 'Enter' || e.key === ' '`) inside `<span className="flex items-center gap-1.5 w-full min-w-0 justify-between">`. Preserve middle-click (`e.button === 1`) close, handle `ArrowLeft`/`ArrowRight`/`Home`/`End` roving focus + `Enter`/`Space` tab activation (ignoring events whose target matches `closest('button')`) on `role="tablist"`, call `scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })` on `activeTabId` changes, and keep the external `+` `IconButton` pinned outside the scroll container.
*   **Rationale**: Implements connected `ButtonGroup` pill tabs with valid non-nested HTML, roving keyboard focus, safe close-button keyboard/mouse isolation, smooth overflow scrolling, and tonal hierarchy.

#### 11. `src/components/__tests__/uiStandardization.test.tsx` (Create — Phase 2 Scope)
*   **Type / Scope**: Component Markup Tests (`bun:test`)
*   **Proposed Changes**: Assert `TabBar` `renderToStaticMarkup` output (`rounded-m3-full`, `aria-label`, no nested `<button>` tags inside tabs, close button presence guarded by `tabs.length > 1`, external `+` button outside `role="tablist"`).
*   **Rationale**: Verifies `TabBar` markup and library integration before moving to Phase 3.

**Phase 2 Checkpoint**: Run `npm run build && bun test && npm run lint` before starting Phase 3.

---

### Phase 3: Segmented Virtualized `FileList`, 4-Column Sort Header, `Omnibar`, & `FileListSkeleton`

#### 12. `src/components/ExplorerTab.tsx` (Modify)
*   **Type / Scope**: Explorer Tab State, Toolbar, & Scroll Container
*   **Proposed Changes**:
    *   Update `sortBy` state and `handleSortChange` to `SortField` via `normalizeSortField`, replace inline comparator logic with `compareFiles` from `../utils/fileListUtils`, and add a `Type` sort `IconButton` (`<Icon name="category" />`, `aria-label="Sort by Type"`, `title="Sort by Type"`) to the toolbar.
    *   Pass `scrollContainerRef` (attached to the `overflow-auto [scrollbar-gutter:stable] bg-m3-surface-container-low` viewport) to `FileList`.
    *   Change toolbar and search banner backgrounds to `bg-m3-surface-container` with zero `border-b`, and replace manual `w-px` divider `<div>`s with `<Divider orientation="vertical" className="h-6 mx-1" />`.
    *   Guard background click deselection with `!target.closest('.file-list-item, .file-list-header')`. Update the `window` `Space` Quick Look handler so when `selectedFiles.size > 0`, Quick Look uses `resolveQuickLookTarget` on `selectedFiles`, and when `selectedFiles.size === 0`, it falls back to `(document.activeElement as HTMLElement | null)?.closest('.file-list-item')?.getAttribute('data-file-path')` matched against `sortedFiles`.
*   **Rationale**: Synchronizes 4-column sorting, removes toolbar borders/dividers, and prevents header clicks or `Space` key presses from clearing selection or mis-toggling `ListItem`.

#### 13. `src/components/FileList.tsx` (Modify)
*   **Type / Scope**: Segmented Expressive List, Sort Header, & Grid View Cleanup
*   **Proposed Changes**:
    *   Remove `MD3Table*` imports, duplicate `<MD3TableSortIndicator>` JSX, and the outer `py-2` padding wrapper on the list container so `<List>` starts directly beneath `topOffset = 40`. Extend `FileListProps` with `sortBy?: SortField`, `sortOrder?: 'asc' | 'desc'`, `onSortChange?: (field: SortField) => void`, and `scrollContainerRef?: React.RefObject<HTMLDivElement | null>`.
    *   Render a sticky `.file-list-header` bar (`sticky top-0 z-10 h-10 bg-m3-surface-container px-4 flex items-center gap-3`) mirroring `ListItem`'s 3-slot geometry: a `w-8 shrink-0` leading offset, a `flex-1 min-w-0` Name sort `<button>`, and `.file-meta-grid` for `Date Modified` (`hidden md:block`), `Type` (`hidden sm:block`), and `Size` (`text-right`) `<button>`s (`aria-sort` mapped to `'ascending' | 'descending' | 'none'`, `e.stopPropagation()` on click, rendering strictly **one** `<Icon name={sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'} />` solely on the active column).
    *   Define `FileListRowProps` explicitly (`file: IFile`, `isSelected: boolean`, `position: ListItemPosition`, `morphEnabled: boolean`, plus stable callbacks) — **never** accept a `value` prop or set `_m3ListItem = true` on `FileListRow`, passing `value={file.path}` only internally to `<ListItem>` so `<List>` does not inject `_listIndex` on scroll and invalidate `React.memo`. Render `<List variant="expressive" listStyle="segmented" selectionMode="multi-select" value={selectedArray} onChange={noop}>` containing `<li role="presentation" aria-hidden="true">` top/bottom spacers (omitted when `0`, subtracting `2px` List gap), visible group header `<li role="presentation" className="h-9 ...">` elements (`onClick` `e.stopPropagation()`), and `FileListRow` items (`selected={isSelected}`, `leadingType="custom"` `ExpressiveShape` gated by `shouldEnableItemMorph(sortedFiles.length, isSelected)` imported from `../utils/shapeUtils`, `headline` file name, and `trailingType="custom"` `trailingContent` `.file-meta-grid` cells with matching `hidden md:block truncate`, `hidden sm:block truncate`, and `text-right tabular-nums`). Do **not** pass `morphEnabled` directly to `ListItem`.
    *   Wrap each `ListItem` via `asChild` `<div role="option" aria-selected={isSelected} data-file-path={file.path} draggable onDragStart={...} onClick={...} onDoubleClick={...} onContextMenu={...} onKeyDown={...} className="file-list-item h-14">` preserving `api.startDrag`, click/`Ctrl`/`Shift` selection rules, `Enter` open, and `Space` `e.preventDefault()`. On `ArrowUp`/`ArrowDown`/`Home`/`End`, move keyboard focus only (`aria-selected` unchanged), call `e.stopPropagation()`, store `pendingFocusPathRef.current = nextFile.path`, scroll `scrollContainerRef.current` accounting for the `40px` sticky header when moving upward, and focus the matching `[data-file-path]` node inside `useLayoutEffect` by iterating `[data-file-path]` elements (`el.getAttribute('data-file-path') === targetPath`, avoiding `SyntaxError` on paths with quotes/brackets); clear `pendingFocusPathRef` on directory change or manual scroll.
    *   In Grid view, delete the sibling `<div className="h-px ...">` group rule entirely so group headers render only opaque `bg-m3-secondary-container text-m3-on-secondary-container` chips, add `data-file-path={file.path}` to each grid item, replace `ring-2 ring-m3-primary/50` with `bg-m3-secondary-container text-m3-on-secondary-container` + `focus-visible:ring-2 focus-visible:ring-m3-primary`, and remove `shadow-xs`.
*   **Rationale**: Fixes the duplicate sort indicator bug, keeps 4-column scanning and native drag/keyboard navigation intact at 1,000+ file scale, and eliminates remaining shadows/rings.

#### 14. `src/components/FileListSkeleton.tsx` (Modify)
*   **Type / Scope**: Loading Placeholder Component
*   **Proposed Changes**: Update list-mode skeleton rows from `h-11` (`44px`) to `h-14` (`56px`) with `gap-[2px]`, segmented placeholder radii, `w-8 shrink-0` leading circle, `flex-1` name bar, and `.file-meta-grid` placeholder cells (`hidden md:block`, `hidden sm:block`, `text-right`) matching `FileList`.
*   **Rationale**: Eliminates layout shift when transitioning from loading skeletons to `56px` segmented `ListItem` rows.

#### 15. `src/components/Omnibar.tsx` (Modify)
*   **Type / Scope**: Address Bar & Path Breadcrumb Input
*   **Proposed Changes**: Replace `isEditing` `ring-2 ring-m3-primary/70` border-ring emphasis with tonal `bg-m3-surface-container-highest` while retaining `:focus-visible` keyboard focus accessibility.
*   **Rationale**: Aligns the Explorer address bar with tonal state feedback rather than manual rings.

#### 16. `src/components/__tests__/uiStandardization.test.tsx` (Modify — Phase 3 Scope)
*   **Type / Scope**: Component Markup & Scale Tests (`bun:test`)
*   **Proposed Changes**: Extend `uiStandardization.test.tsx` with `FileList` (`arrow_upward`/`arrow_downward` single sort arrow across all 4 fields, `.file-list-header` and `.file-list-item` presence, `O(visible + overscan)` mounted row bound for 1,500 files via `fallbackHeight`, `shouldEnableItemMorph` gating), `FileListSkeleton` (`h-14` segmented rows), `ExplorerTab` (`Type` sort button + `Space` Quick Look fallback target resolution), and `Omnibar` (`bg-m3-surface-container-highest` edit state without `ring-2`).
*   **Rationale**: Verifies Phase 3 list virtualization, sorting, and interaction markup before Phase 4.

**Phase 3 Checkpoint**: Run `npm run build && bun test && npm run lint` before starting Phase 4.

---

### Phase 4: Secondary Views, Overlays, & Diagnostics

#### 17. `src/components/Dashboard.tsx` (Modify)
*   **Type / Scope**: Dashboard Bento View
*   **Proposed Changes**: Convert Bento Card 2 (`variant="elevated"`) and Card 3 (`variant="outlined"` + `border-m3-outline-variant/50`) to `variant="filled"` with `bg-m3-surface-container` matching Card 1; switch the unpin `IconButton` to opaque `bg-m3-surface-container-highest`; replace the dashed border on "Add Pin" with `bg-m3-surface-container-high hover:bg-m3-surface-container-highest`; and remove `shadow-xs` on the storage `ExpressiveShape`.
*   **Rationale**: Removes elevated shadows and outlined/dashed card borders across the Dashboard Bento grid.

#### 18. `src/components/SettingsDialog.tsx` (Modify)
*   **Type / Scope**: Application Settings Modal
*   **Proposed Changes**: Upgrade the three `<section>` containers (`rounded-m3-lg`) from `bg-m3-surface-container-high/60` to opaque `bg-m3-surface-container`; remove the five `border-t border-m3-outline-variant/40` rules using `gap-4` and `bg-m3-surface-container-low rounded-m3-md p-3` sub-blocks; remove `ring-2 ring-m3-on-surface` and `shadow-xs` from swatch shapes (keeping the existing `'flower'` shape, `<Icon name="check" />`, `scale-110`, and `focus-visible:ring-2`); make the loaded CSS badge opaque `bg-m3-secondary-container text-m3-on-secondary-container`; and retain `colorStyle="outlined"` on inactive button toggles plus the `1px` edge border on `<input type="color">`.
*   **Rationale**: Removes manual section borders and shadows while keeping semantic outlined toggles and color-picker edge legibility.

#### 19. `src/components/ContextMenu.tsx` (Modify)
*   **Type / Scope**: Coordinate-Anchored Floating Context Menu
*   **Proposed Changes**: Keep the `(x, y)` viewport-clamped `motion.div` container API used by `App.tsx`, upgrade surface/elevation to opaque `bg-m3-surface-container-high`, remove `shadow-xl border border-m3-outline-variant/40`, replace manual `h-px bg-m3-outline-variant/40` dividers with `@bug-on/m3-expressive` `<Divider role="separator" />`, focus `menuRef` (or first `[role="menuitem"]`) on open, add `role="menu"` / `role="menuitem"`, skip separators and wrap at boundaries on `ArrowUp`/`ArrowDown`, and attach a `document` `keydown` listener for `Escape` that calls `e.stopPropagation()` and `onClose()`.
*   **Rationale**: Removes custom menu border/shadow chrome while preserving imperative `(x, y)` positioning and keyboard accessibility.

#### 20. `src/components/QuickLook.tsx` (Modify)
*   **Type / Scope**: File Preview Modal
*   **Proposed Changes**: Retain the modal scrim (`bg-black/55 backdrop-blur-xs`) and `bg-m3-surface-container-lowest`/`low` preview wells, remove `shadow-2xl border border-m3-outline-variant/40` on the dialog container (`bg-m3-surface-container-high`), remove `border-b border-m3-outline-variant/40` on the header (`bg-m3-surface-container`), and remove `shadow-md` on preview `<img>` elements.
*   **Rationale**: Replaces modal outer borders/shadows with `surface-container` stepping.

#### 21. `src/components/OpenWithDialog.tsx` (Modify)
*   **Type / Scope**: Application Picker Modal
*   **Proposed Changes**: Render two separate `<List variant="expressive" listStyle="segmented" selectionMode="single-select" value={selectedAppKey} onChange={noop}>` instances (`Recommended` and `All Applications`) with section `<div>` headings and `<Divider className="my-2" />` placed outside `<ul>` (so `<ul role="listbox">` contains only valid `<ListItem>` elements and keeps `leading`/`trailing` outer `16px` corners per section). Key each `<ListItem>` with a unique per-section+index key (`rec:${idx}:${app.exec}` / `all:${idx}:${app.exec}`) and track `selectedAppKey` state alongside `selectedApp` (`leadingType="custom"` 32x32 `apps` icon, `headline={app.name}`, `onClick`, `onDoubleClick`) so shared `app.exec` entries never highlight twice.
*   **Rationale**: Standardizes application rows on `@bug-on/m3-expressive` `ListItem` and `Divider` with valid `<ul>` ARIA and accurate single-row selection.

#### 22. `src/components/PropertiesDialog.tsx` (Modify)
*   **Type / Scope**: File Properties Modal
*   **Proposed Changes**: Replace semi-transparent `bg-m3-surface-container-high/50` detail block surfaces with opaque `bg-m3-surface-container`.
*   **Rationale**: Eliminates translucent tonal washout inside file properties.

#### 23. `src/utils/themeUtils.ts` & `src/utils/__tests__/themeUtils.test.ts` (Modify)
*   **Type / Scope**: Dynamic Seed & Matugen Diagnostics + Unit Tests
*   **Proposed Changes**: In `extractMatugenSeedColor(cssText)`, when non-empty `cssText` fails primary hex seed extraction and falls back to `null` / `DEFAULT_SEED_COLOR`, emit a deduplicated `console.warn` under `import.meta.env?.DEV` (suppressing empty/`null` inputs and repeating identical failed payloads across 3s polling). Add unit tests verifying empty suppression, non-empty fallback warning once per payload, and recovery reset.
*   **Rationale**: Surfaces malformed Matugen stylesheets without flooding logs during polling.

#### 24. `src/components/__tests__/uiStandardization.test.tsx` (Modify — Phase 4 Scope)
*   **Type / Scope**: Component Markup Tests (`bun:test`)
*   **Proposed Changes**: Add assertions for Phase 4 components: `ContextMenu` (`role="menu"`, `role="menuitem"`, `role="separator"`, zero `shadow-xl`), `OpenWithDialog` (two separate segmented `<List>` sections with unique selection keys), and tonal border/shadow removal on `Dashboard`, `SettingsDialog`, `QuickLook`, and `PropertiesDialog`.
*   **Rationale**: Establishes automated regression protection across secondary views and overlays.

**Phase 4 Checkpoint**: Run `npm run build && bun test && npm run lint` and perform final desktop verification.

### Verification Plan

*   **Compilation/Build**: `npm run build` (`tsc -b && vite build && tsc -p electron/tsconfig.json`) must exit `0` with zero TypeScript errors at each phase gate.
*   **Unit & Component Tests**: `bun test` must pass all existing suites (`src/components/__tests__/ExpressiveShape.test.tsx`, `src/components/__tests__/ExplorerTabSilentReload.test.ts`, `src/components/__tests__/userSelectCss.test.ts`, plus all `src/utils/__tests__/*` and `src/api/__tests__/*`) along with the new `src/utils/__tests__/fileListUtils.test.ts`, updated `src/utils/__tests__/themeUtils.test.ts`, and `src/components/__tests__/uiStandardization.test.tsx`.
*   **Static Analysis & Linting**: `npm run lint` (`eslint .`) must pass with zero errors at each phase gate.
*   **Manual Desktop Verification (Electron/Vite)**:
    *   Verify zero manual container borders/shadows across Light Mode, Dark Mode, and multiple Matugen seeds (`#F9B6AE`, `#6750A4`, neutral `#757575`), including live `TerminalPane` theme switching and OS high-contrast (`prefers-contrast: more`) outline restoration.
    *   Verify `TabBar` with 1 tab and 10+ overflowing tabs: `rounded-m3-full` connected pills, `ArrowLeft`/`ArrowRight`/`Home`/`End` focus movement, close button (`tabs.length > 1`) without activating tab via mouse or `Enter`/`Space`, middle-click close, and Chrome-style external `+` button.
    *   Verify `FileList` on a 1,000+ file directory: single sort arrow on `Name`/`Date Modified`/`Type`/`Size`, synchronized 3-slot + `.file-meta-grid` header-to-row alignment across responsive widths, segmented group corner radii while scrolling, `Ctrl`/`Shift` selection, header click preserving selection, off-screen `ArrowUp`/`ArrowDown` focus scrolling past sticky header, `Space` Quick Look (selected and empty-selection focused fallback), `Enter`/double-click open, coordinate `ContextMenu` (`ArrowUp`/`ArrowDown`/`Escape`), and native OS drag-out.

--------------------------------------------------------------------------------

*Drafted with EGM*
