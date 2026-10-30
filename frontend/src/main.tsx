import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import './styles/app.css'
import './styles/editor.css'
import './styles/templates.css'
import App from './App.tsx'
import { ConfirmProvider } from './ui/Confirm.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
)
