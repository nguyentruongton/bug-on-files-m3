# TabBar Button Icon Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `Button` in `src/components/TabBar.tsx` to use the `@bug-on/m3-expressive` `icon` and `iconPosition="leading"` props for the leading tab icon while keeping the trailing pin/close UI in `children`.

**Architecture:** `TabBar` continues to render `<ButtonGroup variant="connected" size="sm">` with `<Button variant="toggle">`. Each tab passes `<Icon name={getTabIconName(tab.path)} size={16} fill={isActive ? 1 : 0} animateFill />` to `Button`'s `icon` prop (`iconPosition="leading"`), and renders the truncated title plus trailing pin indicator or `<span role="button">` close trigger inside `children`.

**Tech Stack:** React 19, TypeScript, `@bug-on/m3-expressive`, Tailwind CSS, `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-16-tabbar-button-icon-design.md`

---

### Task 1: Refactor `TabBar` to use `Button`'s native `icon` prop

**Files:**
- Modify: `src/components/TabBar.tsx:114-188`
- Test: `src/components/__tests__/uiStandardization.test.tsx:74-159`

- [ ] **Step 1: Verify baseline `TabBar standardization` tests pass**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx -t "TabBar standardization"`
Expected: 3 pass, 0 fail.

- [ ] **Step 2: Update `TabBar.tsx` to pass `icon` and `iconPosition="leading"` to `Button`**

In `src/components/TabBar.tsx`, pass:
```tsx
icon={
    <Icon
        name={getTabIconName(tab.path)}
        size={16}
        fill={isActive ? 1 : 0}
        animateFill
    />
}
iconPosition="leading"
```
and simplify `children` to:
```tsx
<span className="flex items-center gap-1.5 w-full min-w-0 justify-between">
    <span className="truncate flex-1 text-left">{tab.title}</span>
    {tab.pinned ? (
        <span
            aria-label={`${tab.title} pinned`}
            title="Pinned tab"
            className="shrink-0 inline-flex items-center justify-center w-5 h-5 opacity-75"
        >
            <Icon name="keep" size={14} />
        </span>
    ) : canClose ? (
        <span
            role="button"
            tabIndex={-1}
            aria-label={`Close ${tab.title}`}
            title="Close tab"
            onPointerDown={(e) => {
                e.stopPropagation();
            }}
            onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
            }}
            className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-m3-full opacity-70 hover:opacity-100 hover:bg-m3-surface-container-highest cursor-pointer"
        >
            <Icon name="close" size={14} />
        </span>
    ) : null}
</span>
```

- [ ] **Step 3: Run `TabBar standardization` tests and TypeScript check**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx -t "TabBar standardization"`
Expected: 3 pass, 0 fail.

Run: `npx tsc --noEmit`
Expected: Exit code 0 (no TypeScript errors).

