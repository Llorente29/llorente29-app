import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import App from './App'
import './index.css'

// Bloque C completo Fase 1 (17/05/2026):
//   Envolvemos toda la app en BrowserRouter. El AppProvider va DENTRO del
//   Router para que su useEffect tenga acceso a useLocation/useNavigate al
//   gestionar el slug de cuenta.
//
// Bloque K Sprint 3 (20/05/2026):
//   Eliminado basename "/llorente29-app". La app se sirve ahora desde raiz
//   en el dominio app.folvy.app (Vercel). El base de Vite tambien quedo en
//   '/' (ver vite.config.ts). URLs reales:
//     - Antes: app.folvy.app/llorente29-app/{slug}/{rest}
//     - Ahora: app.folvy.app/{slug}/{rest}

// ─────────────────────────────────────────────────────────────────────────────
// PWA — CAPTURA GLOBAL TEMPRANA de beforeinstallprompt (12/06/2026).
//
// El navegador dispara `beforeinstallprompt` EN CUANTO decide que la app es
// instalable. Si esperásemos al useEffect del botón (que monta más tarde),
// podríamos perder el evento y el botón nunca tendría el prompt nativo → caía
// al modal de instrucciones. Por eso lo capturamos AQUÍ, antes de montar React,
// y lo guardamos en `window` para que InstallAppButton lo lea al montar.
//
// Además emitimos eventos propios (`folvy:installable` / `folvy:installed`)
// para avisar al botón tanto si ya estaba montado como si monta después.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    __folvyInstallPrompt?: Event | null
    __folvyAppInstalled?: boolean
  }
}

window.__folvyInstallPrompt = window.__folvyInstallPrompt ?? null
window.__folvyAppInstalled = window.__folvyAppInstalled ?? false

window.addEventListener('beforeinstallprompt', (e) => {
  // Evitamos el mini-banner por defecto; usamos nuestro botón.
  e.preventDefault()
  window.__folvyInstallPrompt = e
  window.dispatchEvent(new Event('folvy:installable'))
})

window.addEventListener('appinstalled', () => {
  window.__folvyInstallPrompt = null
  window.__folvyAppInstalled = true
  window.dispatchEvent(new Event('folvy:installed'))
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
)

// PWA: registrar el service worker para que la app sea INSTALABLE (Android
// muestra "Instalar app"; iOS permite "Añadir a inicio" abriéndose como app).
// Se registra tras 'load' para no competir con la carga inicial. Solo en
// producción (en dev molesta con el caché del propio Vite). Si el navegador no
// soporta service workers, no pasa nada: la app funciona igual sin instalarse.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] No se pudo registrar el service worker:', err)
    })
  })
}
