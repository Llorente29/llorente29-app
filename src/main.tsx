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
