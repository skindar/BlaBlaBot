import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { createContainer } from './bootstrap/container'
import { ServicesProvider } from './presentation/context'
import { ChatApp } from './presentation/ChatApp'

const container = createContainer()

// Dev-only inspection hook for smoke tests/E2E; never exposed in production.
if (import.meta.env.DEV) {
  ;(window as unknown as { __blablabot?: unknown }).__blablabot = container
}

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <ServicesProvider value={container}>
      <ChatApp />
    </ServicesProvider>
  </StrictMode>,
)
