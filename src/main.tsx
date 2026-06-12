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
