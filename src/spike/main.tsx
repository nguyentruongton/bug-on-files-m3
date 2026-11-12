import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './spike.css'
import { SpikeApp } from './SpikeApp.tsx'

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <SpikeApp />
    </StrictMode>,
  )
}
