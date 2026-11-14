# Selection-Only Shape Morphing in FileList Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove hover-triggered shape morphing from `FileList` items so file and folder shapes only morph smoothly when their selection state changes.

**Architecture:** In `src/components/FileList.tsx`, both List view (`FileListRow`) and Grid view render item icons inside `<ExpressiveShape>` (which wraps `@bug-on/m3-expressive` `ShapeMedia`). `ShapeMedia`'s internal `useShapeMorph` hook already animates a smooth `requestAnimationFrame` morph whenever its `shape` prop changes. By switching item `<ExpressiveShape>` instances from `morphOn="hover"` + `morphTo={...}` to `morphOn="none"` (with no `morphTo`) and `shape={isSelected ? shapePair.morph : shapePair.rest}`, items no longer morph on pointer hover while still morphing smoothly once on selection/deselection.

**Tech Stack:** React 19, TypeScript, `@bug-on/m3-expressive` (`ShapeMedia`), `bun test`, Vite (`npm run build:web`).

**Spec:** `docs/superpowers/specs/2026-11-14-filelist-selection-shape-morph-design.md`

## Global Constraints
- Applies to all items (folders and files) in `src/components/FileList.tsx` (both List view and Grid view).
- Non-listing `ExpressiveShape` usages (`Dashboard`, `QuickLook`, `PropertiesDialog`, `SettingsDialog`, `App.tsx`, and `FileList` empty state) remain unchanged.
- `shouldEnableItemMorph` in `src/utils/shapeUtils.ts` continues to gate morph animation in large folders (>300 items) via `disabled={!morphEnabled}` / `disabled={!enableMorph}`.

## Review Focus
- Selected folder renders `shapePair.morph` (`flower`) and unselected folder renders `shapePair.rest` (`clover4Leaf`) in both grid and list views.
- Hovering an unselected or selected item does not attach hover morph listeners (`morphOn="none"`, `morphTo` omitted).
- Toggling `isSelected` changes `shape` prop between `rest` and `morph`, allowing `useShapeMorph` to animate the transition once.
- Large folder (>300 items) still passes `disabled={!enableMorph}` to avoid bulk animation overhead on unselected items.
- Existing `ExpressiveShape` usages outside `FileList` items are untouched.

---

### Task 1: Switch FileList Item ExpressiveShape to Selection-Only Morphing

**Files:**
- Modify: `src/components/FileList.tsx:153-175` (List view `FileListRow`)
- Modify: `src/components/FileList.tsx:711-731` (Grid view item)
- Test: `src/components/__tests__/uiStandardization.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test in `src/components/__tests__/uiStandardization.test.tsx` verifying that:
1. In both `grid` and `list` views, a selected folder (`Documents`) renders with the `morph` shape clip-path and an unselected folder (`Downloads`) renders with the `rest` shape clip-path.
2. `FileList.tsx` item `ExpressiveShape` instances (`FileListRow` and grid items) use `morphOn="none"` and do not pass `morphOn="hover"` or `morphTo`.

```tsx
    test('renders FileList item shapes by selection state without hover morphing', () => {
        const docs = makeFile('Documents', true);
        const downloads = makeFile('Downloads', true);
        const selected = new Set([docs.path]);

        const folderPair = getFileGroupShapePair('Folders', true);
        const expectedMorphHtml = renderToStaticMarkup(
            <ExpressiveShape shape={folderPair.morph} width={80} height={80} />
        );
        const expectedRestHtml = renderToStaticMarkup(
            <ExpressiveShape shape={folderPair.rest} width={80} height={80} />
        );
        const morphClip = expectedMorphHtml.match(/clip-path:([^;"]+)/)?.[1];
        const restClip = expectedRestHtml.match(/clip-path:([^;"]+)/)?.[1];
        expect(morphClip).toBeTruthy();
        expect(restClip).toBeTruthy();
        expect(morphClip).not.toBe(restClip);

        const gridHtml = renderToStaticMarkup(
            <FileList
                files={[docs, downloads]}
                selectedFiles={selected}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="grid"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );
        expect(gridHtml).toContain(morphClip!);
        expect(gridHtml).toContain(restClip!);

        const fileListSource = readFileSync(
            resolve(import.meta.dir, '../FileList.tsx'),
            'utf8'
        );
        const rowMatch = fileListSource.match(/const leadingContent = \(\s*<ExpressiveShape[\s\S]*?<\/ExpressiveShape>/);
        const gridMatch = fileListSource.match(/aria-pressed=\{isSelected\}[\s\S]*?<ExpressiveShape[\s\S]*?<\/ExpressiveShape>/);
        expect(rowMatch?.[0]).toContain('morphOn="none"');
        expect(rowMatch?.[0]).not.toContain('morphOn="hover"');
        expect(rowMatch?.[0]).not.toContain('morphTo=');
        expect(gridMatch?.[0]).toContain('morphOn="none"');
        expect(gridMatch?.[0]).not.toContain('morphOn="hover"');
        expect(gridMatch?.[0]).not.toContain('morphTo=');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL because `FileList.tsx` still has `morphOn="hover"` and `morphTo={...}`.

- [ ] **Step 3: Update `FileList.tsx` List view and Grid view `ExpressiveShape` props**

In `src/components/FileList.tsx`:
- In `FileListRow` (`leadingContent`, lines 153-167):
```tsx
        const leadingContent = (
            <ExpressiveShape
                shape={isSelected ? shapePair.morph : shapePair.rest}
                morphOn="none"
                disabled={!morphEnabled}
                width={32}
                height={32}
                className={shapePair.containerClass}
            >
```
- In Grid view item (lines 711-724):
```tsx
                            <ExpressiveShape
                                shape={isSelected ? shapePair.morph : shapePair.rest}
                                morphOn="none"
                                disabled={!enableMorph}
                                width={containerSize}
                                height={containerSize}
                                className={`${shapePair.containerClass} mb-2`}
                            >
```

- [ ] **Step 4: Run unit tests to verify pass**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full test suite and web build**

Run: `bun test && npm run build:web`
Expected: All tests pass (0 failures) and Vite web build succeeds.

- [ ] **Step 6: Commit changes**

```bash
git add src/components/FileList.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "feat(filelist): morph item shapes on selection only without hover jitter"
```
