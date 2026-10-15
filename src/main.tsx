import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './mouse.css'
import { installExoHid } from './exo-hid'
import { App } from './App'

// Every HID device Windows lists; the drivers' own support checks pick the mice.
installExoHid([])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
