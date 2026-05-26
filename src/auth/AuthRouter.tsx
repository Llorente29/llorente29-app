// src/auth/AuthRouter.tsx
//
// Router de pantallas pre-sesión (D-S2.30 Opción B, Sprint 2).
// Se renderiza desde App.tsx cuando !authUserId.
//
// CHANGELOG:
//   - Sesión 7: Paso 1 — /login.
//   - Sesión 7: Paso 3 — /welcome.
//   - Sesión 9: Paso 5 (D3) — /reset-password.
//   - Sesión 9: /reset-password/confirm MOVIDO a App.tsx 1-bis (Opción 1.a).
//     Razón: la ruta debe ser accesible también con sesión activa (caso
//     "user logueado pulsa reset"). AuthRouter solo se monta cuando
//     !authUserId, lo que excluía ese caso y saltaba la pantalla.

import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from '../pages/LoginPage'
import WelcomePage from '../pages/WelcomePage'
import ResetPasswordPage from '../pages/ResetPasswordPage'
import AccesoTrabajadorPage from '../pages/AccesoTrabajadorPage'

export default function AuthRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/acceso" element={<AccesoTrabajadorPage />} />
      {/* Fallback: cualquier URL desconocida pre-sesión → login.
          /reset-password/confirm NO está aquí: vive en App.tsx 1-bis para
          ser accesible con o sin sesión activa. */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
