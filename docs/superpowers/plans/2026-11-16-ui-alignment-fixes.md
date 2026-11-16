# UI Alignment Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix vertical divider centering in `ExplorerTab`, align `Sidebar` drawer top/bottom edges with `TabBar` and `StatusBar`, and remove the double-gap when `Sidebar` is collapsed.

**Architecture:** Three localized Tailwind/Motion layout fixes across `ExplorerTab.tsx`, `Sidebar.tsx`, and `App.tsx`, with `renderToStaticMarkup` assertions in `uiStandardization.test.tsx` and a TypeScript/Vite build check.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, `motion/react`, `@bug-on/m3-expressive`, `bun test`.

**Spec:** [docs/superpowers/specs/2026-11-16-ui-alignment-fixes-design.md](file:///home/stark/Documents/GitHub/material-3-file-explorer/docs/superpowers/specs/2026-11-16-ui-alignment-fixes-design.md)

## Global Constraints
- Do not modify `@bug-on/m3-expressive` internals.
- Preserve `FAST_SPATIAL_SPRING` collapse/expand animation on `Sidebar`.
- Preserve `8px` spacing around `Sidebar` when expanded.

## Review Focus
- `ExplorerTab` with `onViewModeChange` omitted: only the first `<Divider orientation="vertical">` renders; both occurrences (lines 825 and 905) must include `self-center`.
- `Sidebar` collapsed vs expanded state: `collapsed={true}` must set `marginLeft: 0` and `marginRight: 0` alongside `width: 0`, while `collapsed={false}` sets `marginLeft: 8` and `marginRight: 8`.
- `Sidebar` vertical padding (`pt-1.5 pb-2`): must be on `<motion.aside>` (`box-border h-full`) rather than `NavigationDrawer`, so `NavigationDrawer` keeps `h-full` without clipping rounded corners.

---

### Task 1: Center vertical dividers in `ExplorerTab` toolbar

**Files:**
- Modify: `src/components/ExplorerTab.tsx:825,905`
- Test: `src/components/__tests__/uiStandardization.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/__tests__/uiStandardization.test.tsx` inside `describe('ExplorerTab standardization', ...)` (after line 354 `expect(html).toContain('aria-orientation="vertical"');`), add:

```ts
        const verticalDividers = html.match(/<div[^>]*aria-orientation="vertical"[^>]*>/g) ?? [];
        expect(verticalDividers.length).toBe(2);
        for (const divider of verticalDividers) {
            expect(divider).toContain('self-center');
            expect(divider).not.toContain('self-stretch');
        }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx -t "renders standalone IconButtons"`
Expected: FAIL (`Expected to contain: "self-center"`).

- [ ] **Step 3: Add `self-center` to both vertical `<Divider>` elements in `src/components/ExplorerTab.tsx`**

Update lines 825 and 905 from `className="h-6 mx-0.5"` to `className="h-6 mx-0.5 self-center"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx -t "renders standalone IconButtons"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ExplorerTab.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "fix(ui): vertically center toolbar dividers in ExplorerTab"
```

---

### Task 2: Align `Sidebar` vertical edges and remove collapsed gap

**Files:**
- Modify: `src/components/Sidebar.tsx:92-101`
- Modify: `src/App.tsx:546`
- Test: `src/components/__tests__/uiStandardization.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/__tests__/uiStandardization.test.tsx` inside `describe('Shell & StatusBar radius standardization', ...)`, add a test:

```tsx
    test('Sidebar aligns top/bottom with TabBar/StatusBar and collapses horizontal margins to 0', () => {
        const expandedHtml = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <Sidebar currentPath="/tmp" onNavigate={() => {}} collapsed={false} />
            )
        );
        expect(expandedHtml).toContain('pt-1.5 pb-2');
        expect(expandedHtml).toMatch(/style="[^"]*width:244px[^"]*margin-left:8px[^"]*margin-right:8px/);

        const collapsedHtml = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <Sidebar currentPath="/tmp" onNavigate={() => {}} collapsed={true} />
            )
        );
        expect(collapsedHtml).toMatch(/style="[^"]*width:0px[^"]*margin-left:0px[^"]*margin-right:0px/);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx -t "Sidebar aligns top/bottom"`
Expected: FAIL (`Expected to contain: "pt-1.5 pb-2"`).

- [ ] **Step 3: Update `src/components/Sidebar.tsx` and `src/App.tsx`**

In `src/components/Sidebar.tsx` (`<motion.aside>` lines 92-101):
- Animate `marginLeft: collapsed ? 0 : 8` and `marginRight: collapsed ? 0 : 8` alongside `width` and `opacity`.
- Add `box-border pt-1.5 pb-2` to `className`.

In `src/App.tsx` (line 546):
- Remove `gap-2` from the outer flex container `className` (`font-md3-expressive flex h-screen w-screen bg-m3-surface-container text-m3-on-surface p-2 overflow-hidden`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx -t "Sidebar aligns top/bottom"`
Expected: PASS.

- [ ] **Step 5: Run build verification**

Run: `npm run build:web`
Expected: `tsc -b && vite build` exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "fix(ui): align Sidebar vertical padding and remove collapsed gap"
```

