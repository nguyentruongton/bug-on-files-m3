# Design: Unified 24px Shell Radius, TabBar Scroll Clipping & MD3 Connected ButtonGroups

**Date:** 2026-11-13  
**Size:** Small change  
**Status:** Draft (awaiting approval)

## Intent & Why
Align outer shell corner radii to `24px` (down from `28px` / `m3-xl`) so container corners feel proportional to inner content, fix uneven left/right drawer corners, prevent square horizontal scroll clipping on `TabBar`, and restore true MD3 Expressive connected `ButtonGroup` corner geometry across both `TabBar` and the `ExplorerTab` toolbar.

## Goals, Non-Goals & Anti-Goals
- **Goals:**
  - Unify `main` panel, Terminal panel, `Sidebar` drawer (`NavigationDrawer`), and `ExplorerTab` scroll/dashboard/skeleton viewports to `24px` (`rounded-[24px]`, using `!rounded-[24px]` on `NavigationDrawer` to override its built-in `rounded-r-m3-lg`).
  - Set `StatusBar` to `rounded-m3-full`.
  - Keep `TabBar` horizontal scroll clipping rounded at both left and right edges (`rounded-m3-full` on `role="tablist"`).
  - Restore native `@bug-on/m3-expressive` `ButtonGroup variant="connected"` corner radii on `TabBar` (full outer ends, small inner corners, pill on selected) and apply the same `ButtonGroup variant="connected"` pattern to `ExplorerTab` toolbar clusters.
- **Non-Goals:** Changing color tokens, spacing/padding scales outside toolbar groups, or non-shell modal/card radii (`QuickLook`, `Dashboard` inner cards, `SettingsDialog`, `ContextMenu`).
- **Anti-Goals:** Do not re-implement custom CSS corner-radius rules when `@bug-on/m3-expressive` `ButtonGroup` already provides MD3 connected shapes and press/selection morphing.

## Constraints
- Must preserve existing `ExplorerTab` `aria-label` / `title` / `data-tab-id` / `role="tab"` accessibility attributes and keyboard navigation.
- Must update/verify existing unit/component tests in `src/components/__tests__/uiStandardization.test.tsx`.

## Approaches Considered
1. **Option 1 (Chosen): Native `@bug-on/m3-expressive` `ButtonGroup` + unified `24px` / `full` classes.**  
   Uses `ButtonGroup variant="connected"` directly in `TabBar` (removing `!rounded-m3-full` override) and `ExplorerTab` toolbar clusters (using icon-only `Button` children), plus `rounded-[24px]` / `!rounded-[24px]` / `rounded-m3-full` for shell geometry. Chosen for exact MD3 Expressive spring morphing and zero duplicated corner logic.
2. **Option 2 (Rejected): CSS-only corner overrides on standalone `IconButton`s.**  
   Rejected because it lacks MD3 Expressive press/selection corner morphing and duplicates `ButtonGroup` styling.

## Changes by File
- `src/App.tsx`: Change `main` shell panel and Terminal panel from `rounded-m3-xl` to `rounded-[24px]`.
- `src/components/Sidebar.tsx`: Change `NavigationDrawer` `rounded-m3-xl` to `!rounded-[24px]` so top-right and bottom-right match top-left and bottom-left (`24px`).
- `src/components/StatusBar.tsx`: Change `rounded-m3-lg` to `rounded-m3-full`.
- `src/components/TabBar.tsx`: Add `rounded-m3-full` to the `role="tablist"` `overflow-x-auto` container; remove `!rounded-m3-full` from `Button` inside `TabSegment` so `ButtonGroup variant="connected"` drives leading/middle/trailing/selected radii.
- `src/components/ExplorerTab.tsx`:
  - Change Dashboard, `FileListSkeleton`, and main list/grid viewport wrappers from `rounded-m3-xl` to `rounded-[24px]`.
  - Group toolbar clusters using `ButtonGroup variant="connected" size="sm"` with icon-only `Button`s:
    - Navigation group: Back, Forward, Up
    - View/Actions group: New Folder (when present), Hidden Files (toggle), Category Grouping (toggle)
    - Sort group: Name, Date, Type, Size (`variant="toggle"`, `selected={sortBy === ...}`) + Sort Order
    - Keep View Mode (`grid` / `list`) as a standalone `IconButton` after a `Divider`.
- `src/components/__tests__/uiStandardization.test.tsx`: Update `rounded-m3-xl` viewport assertion to `rounded-[24px]` and add assertions for `ButtonGroup` / `StatusBar` `rounded-m3-full` / `Sidebar` `!rounded-[24px]`.
