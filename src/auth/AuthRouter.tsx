// src/auth/AuthRouter.tsx
//
// Router de pantallas pre-sesión (D-S2.30 Opción B, Sprint 2).
// Se renderiza desde App.tsx cuando !authUserId.
//
// CHANGELOG:
//   - Sesión 7: Paso 1 — /login.
//   - Sesión 7: Paso 3 — /welcome.
//   - Sesión 9: Paso 5 (D3+D4) — /reset-password + /reset-password/confirm.
//
// NOTA SOBRE /reset-password/confirm:
//   Esta ruta se monta DENTRO de AuthRouter aunque el user aterriza con
//   sesión activa (PKCE ya procesó el code en URL). Razón: AuthRouter solo
//   se renderiza si !authUserId; cuando llega el email de reset, ANTES de
//   procesar el code el cliente no tiene sesión, así que cae a AuthRouter
//   y entonces detectSessionInUrl: true procesa el code y onAuthStateChange
//   propaga authUserId. Para evitar que el guard de App.tsx saque al user
//   del flow durante esta transición (ms entre PKCE OK y rerender), la
//   pantalla se monta también dentro del flujo post-sesión via App.tsx
//   3-bis si fuese necesario, PERO: como /reset-password/confirm valida
//   isAuthenticated declarativamente con <Navigate>, si la transición es
//   instantánea el flow funciona limpio aquí.

import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from '../pages/LoginPage'
import WelcomePage from '../pages/WelcomePage'
import ResetPasswordPage from '../pages/ResetPasswordPage'
import ResetPasswordConfirmPage from '../pages/ResetPasswordConfirmPage'

export default function AuthRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/reset-password/confirm" element={<ResetPasswordConfirmPage />} />
      {/* Fallback: cualquier URL desconocida pre-sesión → login. */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
