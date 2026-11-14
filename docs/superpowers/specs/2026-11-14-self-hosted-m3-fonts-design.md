# Self-Hosted Google Sans Flex & Material Symbols (`@bug-on/m3-fonts`) — Design Spec

- **Date:** 2026-11-14
- **Size:** Small change
- **Status:** Approved

## 1. Intent & Why

Set up **Google Sans Flex** (`"ROND" 100`) and **Material Symbols** variable fonts in the application using the official `@bug-on/m3-expressive` + `@bug-on/m3-fonts` self-hosted workflow so that typography and icons render immediately offline without waiting for or making network requests to Google Fonts CDN.

## 2. Goals, Non-Goals & Anti-Goals

- **Goals:**
  - Install `@bug-on/m3-fonts` and remove `@fontsource/material-symbols-rounded` (which only provided static weights 100–400 without the variable `FILL` axis).
  - Load self-hosted Google Sans Flex (`@bug-on/m3-fonts/typography.css`) and Material Symbols (`@bug-on/m3-fonts/material-symbols.css`) plus MD3 Expressive typography utilities (`@bug-on/m3-expressive/typography.css`) in `src/index.css`.
  - Apply the built-in `font-md3-expressive` class (from `@bug-on/m3-expressive/typography.css`) on the root element (`index.html` / app root) and remove the legacy `:root { font-family: 'Roboto', 'Inter', ... }` override in `src/index.css`.
  - Wrap the application root in `<MaterialSymbolsProvider source="local">` so `@bug-on/m3-expressive` never triggers `ReactDOM.preinit()` requests to `fonts.googleapis.com`.
  - Standardize `src/components/Icon.tsx` to delegate to `<Icon>` from `@bug-on/m3-expressive` while preserving the existing `filled?: boolean` convenience prop used across the codebase.
- **Non-Goals:**
  - Setting up the Python `fonttools`/`brotli` build pipeline for `m3-symbols` subsetting.
  - Redesigning any UI screens or changing icon names.
- **Anti-Goals:**
  - Any runtime network request to `fonts.googleapis.com` or `fonts.gstatic.com` when rendering icons.
  - Breaking existing `Icon` props (`filled`, `fill`, `weight`, `grade`, `opticalSize`, `size`, `animateFill`, `className`, `style`) or SSR/static-markup unit tests.

## 3. Constraints

- In `@bug-on/m3-expressive@1.3.24`, `MaterialSymbolsSourceContext` is instantiated per bundle entrypoint (`dist/index.mjs` vs `dist/core.mjs`). Since all application components import from `@bug-on/m3-expressive` (`dist/index.mjs`), `MaterialSymbolsProvider` and `Icon` **must** be imported from `@bug-on/m3-expressive` (or wrapped with both if needed) so all internal and app icons read `source="local"` from the same React context instance.
- Existing tests in `src/components/__tests__/uiStandardization.test.tsx` use `renderToStaticMarkup` and assert on `'FILL' 1` / `'FILL' 0` in `font-variation-settings` and ligature text content.

## 4. Approaches Considered

1. **Direct `@bug-on/m3-fonts` CSS imports + `<MaterialSymbolsProvider source="local">` (Selected)**
   - *How it works:* Install `@bug-on/m3-fonts`, import `@bug-on/m3-fonts/typography.css`, `@bug-on/m3-fonts/material-symbols.css`, and `@bug-on/m3-expressive/typography.css` in `src/index.css`, wrap `AppThemeProvider` with `<MaterialSymbolsProvider source="local">`, and delegate `src/components/Icon.tsx` to `@bug-on/m3-expressive`'s `Icon`.
   - *Trade-offs:* Zero extra build tooling (no Python/FontTools required); full variable font axes (`FILL`, `wght`, `GRAD`, `opsz`, and `ROND`) work out of the box offline. Vite copies the font assets into `dist/`, while the browser only loads the `Rounded` variant actually used at runtime.
   - *Why chosen:* Matches the official `@bug-on/m3-expressive` Option B documentation directly and keeps the desktop/web build pipeline simple and self-contained.
2. **Subset generation via `m3-symbols` CLI**
   - *How it works:* Configure `m3-symbols.config.json` and run `m3-symbols` before `dev`/`build` using Python `fonttools` + `brotli`.
   - *Trade-offs:* Smaller font files in `dist/`, but requires Python dependencies on every developer/CI machine and manual manifest maintenance for dynamic file-type icons.

## 5. Architecture & Changes Decided

1. **`package.json`**:
   - Add `"@bug-on/m3-fonts"` to `dependencies`.
   - Remove `"@fontsource/material-symbols-rounded"` from `dependencies`.
2. **`src/index.css`, `index.html`, & `src/spike/spike.css`**:
   - Replace `@import "@fontsource/material-symbols-rounded/index.css";` with:
     ```css
     @import "@bug-on/m3-fonts/typography.css";
     @import "@bug-on/m3-fonts/material-symbols.css";
     @import "@bug-on/m3-expressive/typography.css";
     ```
   - Remove the legacy `font-family: 'Roboto', 'Inter', ...` override from `:root` in `src/index.css` and apply the built-in `font-md3-expressive` class (provided by `@bug-on/m3-expressive/typography.css`) to `<html lang="en" class="font-md3-expressive">` in `index.html` and the root container in `src/App.tsx`.
   - Remove the redundant manual `.material-symbols-rounded` block in `src/index.css` (handled by `@bug-on/m3-expressive`'s `<Icon>` / `.md-icon`).
3. **`src/contexts/AppThemeContext.tsx`**:
   - Import `MaterialSymbolsProvider` from `@bug-on/m3-expressive` and wrap `<MD3ThemeProvider>` with `<MaterialSymbolsProvider source="local">`.
4. **`src/components/Icon.tsx`**:
   - Delegate rendering to `Icon as M3Icon` from `@bug-on/m3-expressive`, mapping `filled` (`fill ?? (filled ? 1 : 0)`) and auto-resolving `opticalSize` from `size` (`<= 20 -> 20`, `>= 48 -> 48`, `>= 40 -> 40`, default `24`) while forwarding all standard props.

## 6. Left to the Builder

- Updating or adding unit tests in `src/components/__tests__/uiStandardization.test.tsx` to verify that `AppThemeProvider` provides `source="local"` (no Google Fonts CDN `<link>` hoisted during SSR) and that `Icon` renders with `@bug-on/m3-expressive`'s `md-icon` class and `font-variation-settings`.
