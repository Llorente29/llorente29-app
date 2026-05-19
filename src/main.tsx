import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import App from './App'
import './index.css'

// BLOQUE C completo Fase 1 (17/05/2026):
//   Envolvemos toda la app en BrowserRouter con basename `/llorente29-app`
//   (el mismo `base` que tiene Vite en vite.config.ts).
//   El AppProvider va DENTRO del Router para que su useEffect tenga acceso
//   a useLocation/useNavigate al gestionar el slug de cuenta.
//
//   Deuda: cuando entremos en producción GitHub Pages, hace falta workaround
//   para que F5 en `/llorente29-app/llorente29/dashboard` no devuelva 404
//   (script en 404.html que redirige a index.html con la ruta como state).
//   Pendiente para Fase 5.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/llorente29-app">
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
)
