# Self-Hosted Google Sans Flex & Material Symbols Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-host Google Sans Flex (`font-md3-expressive`) and Material Symbols variable fonts via `@bug-on/m3-fonts` and `<MaterialSymbolsProvider source="local">` so typography and icons render immediately offline without any Google Fonts CDN requests.

**Architecture:** Replace `@fontsource/material-symbols-rounded` with `@bug-on/m3-fonts`, import the self-hosted font stylesheets and `@bug-on/m3-expressive/typography.css` in `src/index.css`, apply the built-in `font-md3-expressive` class on the root HTML/app container, wrap `MD3ThemeProvider` with `<MaterialSymbolsProvider source="local">` in `AppThemeContext`, and delegate `src/components/Icon.tsx` to `@bug-on/m3-expressive`'s `Icon`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, `@bug-on/m3-expressive@1.3.24`, `@bug-on/m3-fonts`, Bun Test.

**Spec:** `docs/superpowers/specs/2026-11-14-self-hosted-m3-fonts-design.md`

## Global Constraints

- Import `MaterialSymbolsProvider` and `Icon` from `@bug-on/m3-expressive` (same bundle entrypoint as the rest of `src/`) so `MaterialSymbolsSourceContext` is shared across all components.
- Remove `@fontsource/material-symbols-rounded` from `package.json` and `src/index.css`.
- Use the built-in `font-md3-expressive` class from `@bug-on/m3-expressive/typography.css` instead of manual `:root` `font-family` or `font-variation-settings` declarations.
- Preserve all existing `IconProps` (`name`, `className`, `filled`, `fill`, `weight`, `grade`, `opticalSize`, `animateFill`, `size`, `style`) so no caller in `src/` breaks.

## Review Focus

- **CDN preinit leak from entrypoint mismatch:** Rendering `<Icon>` inside `<AppThemeProvider>` must not emit a `fonts.googleapis.com` `<link>` tag during `renderToStaticMarkup` (which happens if `source="local"` is missing or provided on a different entrypoint's context).
- **`fill` vs `filled` prop precedence on `Icon`:** Explicit `fill={0}` or `fill={1}` must override the boolean `filled` prop (`fill ?? (filled ? 1 : 0)`).
- **Automatic `opticalSize` clamping from `size`:** When `opticalSize` is omitted, `size <= 20` maps to `20`, `size >= 48` maps to `48`, `size >= 40` maps to `40`, and all other sizes map to `24`.
- **Root `font-md3-expressive` class & stylesheet imports:** `index.html` must have `class="font-md3-expressive"`, and `src/index.css` must import `@bug-on/m3-fonts/typography.css`, `@bug-on/m3-fonts/material-symbols.css`, and `@bug-on/m3-expressive/typography.css` without `:root { font-family: ... }` or `.material-symbols-rounded`.
- **`className` and `style` forwarding on `Icon`:** Custom `className` and `style` props must merge cleanly with `@bug-on/m3-expressive`'s `md-icon` class and inline styles in both static and `animateFill` modes.

---

### Task 1: Self-Host `@bug-on/m3-fonts`, Apply `font-md3-expressive`, and Standardize `MaterialSymbolsProvider` & `Icon`

**Files:**
- Modify: `package.json`
- Modify: `index.html`
- Modify: `src/index.css`
- Modify: `src/spike/spike.css`
- Modify: `src/App.tsx:470-475`
- Modify: `src/contexts/AppThemeContext.tsx:1-5,250-264`
- Modify: `src/components/Icon.tsx`
- Test: `src/components/__tests__/uiStandardization.test.tsx`

**Interfaces:**
- Consumes: `MaterialSymbolsProvider`, `Icon as M3Icon`, `type IconProps as M3IconProps` from `@bug-on/m3-expressive`
- Produces:
  - `export interface IconProps` in `src/components/Icon.tsx`:
    ```ts
    export interface IconProps extends Omit<M3IconProps, 'fill' | 'opticalSize' | 'size'> {
      name: string;
      className?: string;
      filled?: boolean;
      fill?: 0 | 1;
      weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
      grade?: -50 | -25 | 0 | 100 | 200;
      opticalSize?: 20 | 24 | 40 | 48;
      animateFill?: boolean;
      size?: number;
      style?: React.CSSProperties;
    }
    ```
  - `export const Icon: React.FC<IconProps>` in `src/components/Icon.tsx`

- [ ] **Step 1: Write the failing tests in `src/components/__tests__/uiStandardization.test.tsx`**

Add a `describe('Self-hosted M3 fonts & Icon standardization', ...)` block in `src/components/__tests__/uiStandardization.test.tsx`:

```tsx
describe('Self-hosted M3 fonts & Icon standardization', () => {
    test('AppThemeProvider wraps tree in MaterialSymbolsProvider source="local" and suppresses Google Fonts CDN preinit', () => {
        const html = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <AppThemeProvider>
                    <Icon name="folder" filled />
                </AppThemeProvider>
            )
        );

        expect(html).not.toContain('fonts.googleapis.com');
        expect(html).toContain('md-icon');
        expect(html).toContain('data-icon="folder"');
        expect(html).toMatch(/(&#x27;|')FILL(&#x27;|')\s*1/);
    });

    test('Icon resolves fill vs filled precedence, opticalSize from size, and forwards className and style', () => {
        const explicitZero = renderToStaticMarkup(<Icon name="folder" filled fill={0} size={16} />);
        expect(explicitZero).toMatch(/(&#x27;|')FILL(&#x27;|')\s*0/);
        expect(explicitZero).toMatch(/(&#x27;|')opsz(&#x27;|')\s*20/);
        expect(explicitZero).toContain('font-size:16px');

        const largeFilled = renderToStaticMarkup(
            <Icon name="movie" filled size={48} className="text-m3-primary" style={{ opacity: 0.5 }} />
        );
        expect(largeFilled).toMatch(/(&#x27;|')FILL(&#x27;|')\s*1/);
        expect(largeFilled).toMatch(/(&#x27;|')opsz(&#x27;|')\s*48/);
        expect(largeFilled).toContain('md-icon');
        expect(largeFilled).toContain('text-m3-primary');
        expect(largeFilled).toContain('opacity:0.5');
    });

    test('index.html and src/index.css configure self-hosted @bug-on/m3-fonts and font-md3-expressive without legacy overrides', async () => {
        const indexHtml = await Bun.file('index.html').text();
        const indexCss = await Bun.file('src/index.css').text();

        expect(indexHtml).toContain('font-md3-expressive');
        expect(indexCss).toContain('@import "@bug-on/m3-fonts/typography.css";');
        expect(indexCss).toContain('@import "@bug-on/m3-fonts/material-symbols.css";');
        expect(indexCss).toContain('@import "@bug-on/m3-expressive/typography.css";');
        expect(indexCss).not.toContain('@fontsource/material-symbols-rounded');
        expect(indexCss).not.toContain('.material-symbols-rounded');
        expect(indexCss).not.toContain("font-family: 'Roboto'");
    });
});
```

- [ ] **Step 2: Run the test suite to verify the new tests fail**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL (`expect(html).toContain('md-icon')` and stylesheet assertions fail).

- [ ] **Step 3: Install `@bug-on/m3-fonts` and remove `@fontsource/material-symbols-rounded`**

Run: `npm install @bug-on/m3-fonts && npm uninstall @fontsource/material-symbols-rounded`

- [ ] **Step 4: Update `index.html`, `src/index.css`, `src/spike/spike.css`, and `src/App.tsx`**

1. In `index.html`, add `class="font-md3-expressive"` to `<html>`:
   `<html lang="en" class="font-md3-expressive">`
2. In `src/index.css`:
   - Replace `@import "@fontsource/material-symbols-rounded/index.css";` with:
     ```css
     @import "@bug-on/m3-fonts/typography.css";
     @import "@bug-on/m3-fonts/material-symbols.css";
     @import "@bug-on/m3-expressive/typography.css";
     ```
   - Remove the `.material-symbols-rounded { ... }` rule block.
   - Remove `font-family: 'Roboto', 'Inter', system-ui, Avenir, Helvetica, Arial, sans-serif;` from `:root`.
3. In `src/spike/spike.css`, add the same three `@import` lines for `@bug-on/m3-fonts/typography.css`, `@bug-on/m3-fonts/material-symbols.css`, and `@bug-on/m3-expressive/typography.css`.
4. In `src/App.tsx` (line 472), include `font-md3-expressive` on the root shell `<div>`.

- [ ] **Step 5: Wrap `MD3ThemeProvider` with `<MaterialSymbolsProvider source="local">` in `src/contexts/AppThemeContext.tsx` and delegate `src/components/Icon.tsx` to `@bug-on/m3-expressive`**

1. In `src/contexts/AppThemeContext.tsx`:
   - Import `MaterialSymbolsProvider` from `'@bug-on/m3-expressive'`.
   - Wrap `<MD3ThemeProvider ...>` inside `<MaterialSymbolsProvider source="local">`.
2. In `src/components/Icon.tsx`:
   - Import `{ Icon as M3Icon, type IconProps as M3IconProps } from '@bug-on/m3-expressive'`.
   - Compute `effectiveFill: 0 | 1 = fill !== undefined ? fill : filled ? 1 : 0`.
   - Compute `resolvedOpsz: 20 | 24 | 40 | 48 = opticalSize ?? (size && size <= 20 ? 20 : size && size >= 48 ? 48 : size && size >= 40 ? 40 : 24)`.
   - Render `<M3Icon name={name} variant={variant} fill={effectiveFill} weight={weight} grade={grade} opticalSize={resolvedOpsz} size={size} animateFill={animateFill} className={className} style={style} {...rest} />` and set `(Icon as { isMD3Icon?: boolean }).isMD3Icon = true`.

- [ ] **Step 6: Run tests and production build to verify everything passes**

Run: `bun test && npm run build:web`
Expected: All unit tests PASS and Vite production build succeeds with bundled `.woff2`/`.ttf` font assets.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json index.html src/index.css src/spike/spike.css src/App.tsx src/contexts/AppThemeContext.tsx src/components/Icon.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "feat(fonts): self-host Google Sans Flex and Material Symbols via @bug-on/m3-fonts"
```
