import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function materialSymbolsRoundedOnly(): Plugin {
  const importPattern = /@import\s+["']@bug-on\/m3-fonts\/material-symbols\.css["'];?/
  return {
    name: 'material-symbols-rounded-only',
    enforce: 'pre',
    transform(code, id) {
      const cleanId = id.split('?')[0]
      if (!cleanId.endsWith('/src/index.css') && !cleanId.endsWith('\\src\\index.css')) {
        return null
      }
      if (!importPattern.test(code)) {
        return null
      }

      const cssPath = resolve(
        import.meta.dirname,
        'node_modules/@bug-on/m3-fonts/dist/material-symbols.css'
      )
      const rawCss = readFileSync(cssPath, 'utf-8')
      const filteredCss = rawCss
        .replace(
          /@font-face\s*\{[^}]*font-family:\s*["']Material Symbols (?:Outlined|Sharp)["'][^}]*\}\s*/g,
          ''
        )
        .replace(/url\((["']?)\.\/fonts\//g, 'url($1../node_modules/@bug-on/m3-fonts/dist/fonts/')

      if (!filteredCss.includes('Material Symbols Rounded')) {
        throw new Error(
          'material-symbols-rounded-only: expected "Material Symbols Rounded" @font-face to remain after filtering'
        )
      }

      return {
        code: code.replace(importPattern, filteredCss),
        map: null,
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [materialSymbolsRoundedOnly(), tailwindcss(), react()],
})
