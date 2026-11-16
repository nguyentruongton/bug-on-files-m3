# UI Alignment Fixes Design

**Date:** 2026-11-16
**Scope:** Small change (3 localized layout/alignment fixes)

## Intent & Why
Fix three visual alignment issues in the main shell and explorer toolbar:
1. Vertical dividers between toolbar `IconButton`s are top-aligned instead of vertically centered.
2. The `Sidebar` drawer extends lower than the `StatusBar` at the bottom and slightly above the `TabBar` pills at the top.
3. Collapsing the `Sidebar` drawer leaves a `16px` double-gap (`gap-2` + `gap-2`) between `NavigationRail` and `main`.

## Goals & Non-Goals
- **Goals:**
  - Vertically center the two `orientation="vertical"` `<Divider>` elements in `ExplorerTab`.
  - Align `Sidebar`'s `NavigationDrawer` top edge with `TabBar` pills (`pt-1.5`) and bottom edge with `StatusBar` (`pb-2`).
  - Eliminate the collapsed drawer gap in `App` / `Sidebar` while preserving the `FAST_SPATIAL_SPRING` collapse/expand animation and `8px` spacing when expanded.
- **Non-Goals:**
  - Modifying `@bug-on/m3-expressive` library internals.
  - Changing `NavigationRail` internal width or `TabBar` / `StatusBar` internal spacing.

## Approaches
1. **Toolbar Divider (`ExplorerTab.tsx`):**
   - *Chosen:* Add `self-center` to `<Divider orientation="vertical" className="h-6 mx-0.5 self-center" />` (lines 825, 905) to override `@bug-on/m3-expressive`'s default `self-stretch`.
   - *Rejected:* Wrapper `div`s — unnecessary since `cn` (`tailwind-merge`) resolves `self-center` over `self-stretch`.
2. **Drawer Top/Bottom Alignment (`Sidebar.tsx`):**
   - *Chosen:* Add `pt-1.5 pb-2` on `<motion.aside>` (`box-border h-full`) so `NavigationDrawer` inside keeps `h-full` without overflowing `overflow-hidden`.
   - *Rejected:* Margin directly on `NavigationDrawer` — `h-full` + vertical margin exceeds 100% height and clips the rounded bottom corners.
3. **Collapsed Drawer Gap (`App.tsx`, `Sidebar.tsx`):**
   - *Chosen:* Remove `gap-2` from the outer flex container in `App.tsx` and animate `marginLeft: collapsed ? 0 : 8` and `marginRight: collapsed ? 0 : 8` on `<motion.aside>` in `Sidebar.tsx` using `FAST_SPATIAL_SPRING`.
   - *Rejected:* Unmounting `Sidebar` (loses spring animation) or negative margin `-8px` (risks layout jitter on spring overshoot).

## Verification
- Run existing unit/component tests (`npm test` / `bun test` — verify via `package.json`).
- Inspect the rendered classes / test assertions in `uiStandardization.test.tsx` if applicable.

