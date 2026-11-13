# Unified 24px Shell Radius, TabBar Scroll Clipping & MD3 Connected ButtonGroups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize outer shell/panel corner radii to `24px`, `StatusBar` to `rounded-m3-full`, `TabBar` horizontal scroll clipping to rounded ends, and `TabBar` + `ExplorerTab` toolbar clusters to native `@bug-on/m3-expressive` `ButtonGroup variant="connected"`.

**Architecture:** Replace oversized `rounded-m3-xl` (`28px`) shell classes with `rounded-[24px]` (`!rounded-[24px]` on `NavigationDrawer` to override its built-in right-edge `rounded-r-m3-lg`), set `StatusBar` to `rounded-m3-full`, add `rounded-m3-full` to `TabBar`'s `role="tablist"` scroll container while removing `!rounded-m3-full` from individual tab buttons, and wrap `ExplorerTab` toolbar navigation, view/action, and sort clusters in `ButtonGroup variant="connected" size="sm"`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 (`@bug-on/m3-tailwind`), `@bug-on/m3-expressive` (`ButtonGroup`, `Button`, `IconButton`, `NavigationDrawer`), Bun test (`renderToStaticMarkup`), Vite.

**Spec:** [2026-11-13-radius-buttongroup-polish-design.md](file:///home/stark/Documents/GitHub/material-3-file-explorer/docs/superpowers/specs/2026-11-13-radius-buttongroup-polish-design.md)

## Global Constraints
- Outer shell containers (`main`, Terminal, `Sidebar` `NavigationDrawer`, `ExplorerTab` Dashboard/Skeleton/List-Grid viewports) must use `24px` (`rounded-[24px]` / `!rounded-[24px]`).
- `StatusBar` must use `rounded-m3-full`.
- `TabBar` `role="tablist"` must use `rounded-m3-full` for rounded horizontal scroll clipping, and tab `Button`s must not override `ButtonGroup` corner radii with `!rounded-m3-full`.
- `ExplorerTab` toolbar clusters must preserve all existing `aria-label`, `title`, disabled states, and click handlers while using `@bug-on/m3-expressive` `ButtonGroup variant="connected" size="sm"`.
- Non-shell modal/card radii (`QuickLook`, `Dashboard` inner Bento cards, `SettingsDialog`, `ContextMenu`) remain unchanged.

## Review Focus
- `NavigationDrawer` built-in `rounded-r-m3-lg` overriding `rounded-[24px]` on top-right / bottom-right corners — verify `!rounded-[24px]` wins cleanly.
- `ButtonGroup` icon-only `Button` children in `ExplorerTab` expanding too wide or losing `aria-label` / `disabled` — verify compact icon-only sizing (`!px-2.5 !min-w-0`) and `aria-label` preservation on every button.
- `ExplorerTab` conditional `onCreateFolderRequest` / `onToggleHiddenFiles` props leaving an empty or single-child `ButtonGroup` when omitted — render `ButtonGroup` only when at least one action exists and handle single-item case cleanly (`ButtonGroup` falls back to pill defaults when `count === 1`).
- `TabBar` `ButtonGroup` `overflow-visible` vs `role="tablist"` `overflow-x-auto rounded-m3-full` — verify horizontal scrolling still works and left/right edges clip with `rounded-m3-full`.
- Keyboard focus & `tabIndex` inside `ExplorerTab` toolbar `ButtonGroup` — verify `Button` click/disabled behavior matches previous `IconButton` controls.

---

### Task 1: Unified 24px Shell & Pill StatusBar Radius

**Files:**
- Modify: `src/App.tsx:496,562`
- Modify: `src/components/Sidebar.tsx:105`
- Modify: `src/components/StatusBar.tsx:22`
- Test: `src/components/__tests__/uiStandardization.test.tsx`

**Interfaces:**
- Produces: Consistent `rounded-[24px]` on `main` and Terminal in `App.tsx`, `!rounded-[24px]` on `NavigationDrawer` in `Sidebar.tsx`, and `rounded-m3-full` on `StatusBar`.

- [ ] **Step 1: Add failing test for `Sidebar` `!rounded-[24px]` and `StatusBar` `rounded-m3-full`**

Add a `describe('Shell & StatusBar radius standardization', ...)` block in `src/components/__tests__/uiStandardization.test.tsx`:
```tsx
describe('Shell & StatusBar radius standardization', () => {
    test('StatusBar uses rounded-m3-full and Sidebar NavigationDrawer uses !rounded-[24px]', () => {
        const statusHtml = renderToStaticMarkup(
            <StatusBar itemCount={5} selectedCount={0} />
        );
        expect(statusHtml).toContain('rounded-m3-full');
        expect(statusHtml).not.toContain('rounded-m3-lg');

        const sidebarHtml = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <Sidebar
                    currentPath="/tmp"
                    onNavigate={() => {}}
                    collapsed={false}
                />
            )
        );
        expect(sidebarHtml).toContain('!rounded-[24px]');
        expect(sidebarHtml).not.toContain('rounded-m3-xl');
    });
});
```
*(Import `StatusBar` and `Sidebar` at the top of `uiStandardization.test.tsx`.)*

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL (`Expected statusHtml to contain "rounded-m3-full"`).

- [ ] **Step 3: Update `App.tsx`, `Sidebar.tsx`, and `StatusBar.tsx`**

- In `src/App.tsx` lines `496` and `562`: replace `rounded-m3-xl` with `rounded-[24px]`.
- In `src/components/Sidebar.tsx` line `105`: replace `rounded-m3-xl` with `!rounded-[24px]` on `NavigationDrawer`.
- In `src/components/StatusBar.tsx` line `22`: replace `rounded-m3-lg` with `rounded-m3-full`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: PASS for `Shell & StatusBar radius standardization`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx src/components/StatusBar.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "style: unify shell and drawer radii to 24px and StatusBar to full pill"
```

---

### Task 2: TabBar Rounded Scroll Clipping & Native Connected ButtonGroup

**Files:**
- Modify: `src/components/TabBar.tsx:109,124`
- Test: `src/components/__tests__/uiStandardization.test.tsx:71-99`

**Interfaces:**
- Consumes: `@bug-on/m3-expressive` `ButtonGroup` (`variant="connected"`) and `Button` (`variant="toggle"`).
- Produces: Rounded horizontal scroll viewport (`rounded-m3-full`) and native MD3 connected corner radii across leading, middle, trailing, and selected tabs.

- [ ] **Step 1: Update `TabBar standardization` test in `src/components/__tests__/uiStandardization.test.tsx`**

In `src/components/__tests__/uiStandardization.test.tsx`:
- Assert `role="tablist"` container includes `rounded-m3-full` (e.g. `expect(html).toMatch(/role="tablist"[^>]*rounded-m3-full/)`).
- Replace `expect(html).toContain('!rounded-m3-full');` with `expect(html).not.toContain('!rounded-m3-full');` so `ButtonGroup` controls leading/middle/trailing corners.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL (`!rounded-m3-full` still present on tab `Button`, `rounded-m3-full` missing on `tablist`).

- [ ] **Step 3: Update `src/components/TabBar.tsx`**

- On `<div role="tablist" ...>` (line `109`): add `rounded-m3-full` to `className`.
- On `<Button ...>` inside `TabSegment` (line `124`): remove `!rounded-m3-full` from `className`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: PASS for `TabBar standardization`.

- [ ] **Step 5: Commit**

```bash
git add src/components/TabBar.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "fix: keep TabBar scroll edges rounded and restore connected ButtonGroup radii"
```

---

### Task 3: ExplorerTab 24px Viewport & Connected ButtonGroup Toolbar Clusters

**Files:**
- Modify: `src/components/ExplorerTab.tsx:10,668-794,798,802,824`
- Test: `src/components/__tests__/uiStandardization.test.tsx:214-242`

**Interfaces:**
- Consumes: `@bug-on/m3-expressive` `ButtonGroup`, `Button`, `IconButton`, `Divider`, `Icon`.
- Produces: `rounded-[24px]` viewports and three `ButtonGroup variant="connected" size="sm"` toolbar clusters (Navigation, Actions, Sort) preserving all `aria-label`, `title`, `disabled`, and `selected` states.

- [ ] **Step 1: Update `ExplorerTab standardization` test in `src/components/__tests__/uiStandardization.test.tsx`**

In `src/components/__tests__/uiStandardization.test.tsx` lines `236-242`:
- Update `expect(html).toContain('rounded-m3-xl overflow-hidden bg-m3-surface-container-low');` to `expect(html).toContain('rounded-[24px] overflow-hidden bg-m3-surface-container-low');`.
- Assert `<fieldset` (`ButtonGroup`) is rendered for the toolbar clusters (`expect(html.match(/<fieldset\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3);`) and `aria-label="Back"`, `aria-label="Forward"`, `aria-label="Up"`, `aria-label="Sort by Type"` remain present.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL (`rounded-[24px]` and `<fieldset` groups not yet rendered in `ExplorerTab`).

- [ ] **Step 3: Update `src/components/ExplorerTab.tsx`**

1. Import `Button, ButtonGroup` alongside `Divider, Icon, IconButton` from `@bug-on/m3-expressive`.
2. Replace `rounded-m3-xl` with `rounded-[24px]` at lines `798`, `802`, and `824`.
3. Wrap the Navigation buttons (`Back`, `Forward`, `Up`) in `<ButtonGroup variant="connected" size="sm" className="shrink-0 overflow-visible">` using compact icon-only `<Button variant="text" colorStyle="tonal" size="sm" className="!px-2.5 !min-w-0 !h-9" icon={<Icon ... />} ... />`.
4. Wrap the Quick Actions (`New Folder` if `onCreateFolderRequest`, `Hidden Files` if `onToggleHiddenFiles`, `Category Grouping`) in `<ButtonGroup variant="connected" size="sm" className="shrink-0 overflow-visible">` using `<Button variant="toggle" selected={...} colorStyle="tonal" selectedColorStyle="tonal" size="sm" className="!px-2.5 !min-w-0 !h-9" icon={<Icon ... />} ... />` (and `variant="text"` for `New Folder`).
5. Wrap the Sort controls (`Name`, `Date`, `Type`, `Size` with `variant="toggle" selected={sortBy === ...}` + `Sort Order` button) in `<ButtonGroup variant="connected" size="sm" className="shrink-0 overflow-visible">`, keeping `<Divider orientation="vertical" className="h-6 mx-1" />` and the standalone View Mode `IconButton` on the right.

- [ ] **Step 4: Run full verification gate**

Run: `npm run build && bun test && npx eslint src/App.tsx src/components/Sidebar.tsx src/components/StatusBar.tsx src/components/TabBar.tsx src/components/ExplorerTab.tsx src/components/__tests__/uiStandardization.test.tsx`
Expected: `tsc -b && vite build && tsc -p electron/tsconfig.json` exits 0; `bun test` passes all 184+ tests (0 fail); `eslint` reports 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ExplorerTab.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "style: apply 24px viewport radius and MD3 connected ButtonGroups in ExplorerTab"
```
