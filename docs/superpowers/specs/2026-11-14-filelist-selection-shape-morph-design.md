# Design: Selection-Only Shape Morphing in FileList

**Date:** 2026-11-14  
**Scope:** `src/components/FileList.tsx` (List view & Grid view items), `src/utils/shapeUtils.ts`, and related unit tests.

## Problem
Currently, file and folder items in `FileList.tsx` pass `morphOn="hover"` and `morphTo={isSelected ? shapePair.rest : shapePair.morph}` to `ExpressiveShape` (`ShapeMedia`). Moving the pointer across items continuously triggers shape morph animations (including morphing selected items back toward their resting shape on hover), causing visual jitter.

## Design

### 1. Scope
- Applies to **all items (both folders and files)** in `FileList.tsx` (List view `FileRow` and Grid view items).
- Non-listing `ExpressiveShape` usages (`Dashboard`, `QuickLook`, `PropertiesDialog`, `SettingsDialog`, and empty-state illustrations) remain unchanged.

### 2. Selection-Only Smooth Morph
- Remove `morphOn="hover"` and `morphTo` from item `<ExpressiveShape>` instances in `FileList.tsx`, setting `morphOn="none"` instead.
- Keep `shape={isSelected ? shapePair.morph : shapePair.rest}`.
- `@bug-on/m3-expressive`'s `useShapeMorph` hook already runs a `requestAnimationFrame` morph transition whenever the `shape` prop changes (and respects `isMotionReduced` / `disabled`). Thus, toggling `isSelected` smoothly morphs once between `rest` and `morph` with zero hover listeners.
- Pass `disabled={!enableMorph}` (from `shouldEnableItemMorph(sortedFiles.length, isSelected)`) so unselected/bulk transitions in very large folders (>300 items) remain guarded if needed, without needing hover observers.

### 3. Verification
- Update/add component tests verifying `FileList` items do not attach `morphOn="hover"` / `morphTo` and switch `shape` between `shapePair.rest` and `shapePair.morph` based on selection state.
- Run `bun test` and `npm run build:web` to confirm all tests and build pass.
