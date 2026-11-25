import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const rootEl = document.getElementById('root')!

if (!isTauriRuntime) {
  const splashEl = document.getElementById('app-splash')
  if (splashEl) splashEl.remove()
  createRoot(rootEl).render(
    <StrictMode>
      <div className="min-h-screen w-full flex items-center justify-center bg-m3-surface text-m3-on-surface p-6">
        <div className="max-w-md rounded-m3-xl bg-m3-surface-container p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold text-m3-on-surface">
            Bug On Files M3 requires the Tauri desktop runtime
          </h1>
          <p className="text-sm text-m3-on-surface-variant">
            Launch the desktop application instead of opening the Vite dev server directly in a browser:
          </p>
          <pre className="rounded-m3-md bg-m3-surface-container-highest px-3 py-2 text-xs font-mono text-m3-on-surface">
            bun run tauri:dev
          </pre>
        </div>
      </div>
    </StrictMode>,
  )
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
