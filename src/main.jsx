import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.jsx'
import { installUsageBeacon } from './lib/usage.js'

// Here rather than in App: the one anonymous request the app makes is a fact
// about the page load, not about any component, and App.test.jsx's no-request
// assertion keeps rendering App on its own. See lib/usage.js.
installUsageBeacon()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
