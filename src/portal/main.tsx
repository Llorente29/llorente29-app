// src/portal/main.tsx
//
// GP · Tarea 3 · La entrada de Vite del portal del cliente (portal.html):
// aparte de la app (no pasa por App.tsx, nº 2 punto 5), así carga solo el
// portal y abre antes.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './portal.css'
import { App } from './App'

createRoot(document.getElementById('portal')!).render(<StrictMode><App /></StrictMode>)
