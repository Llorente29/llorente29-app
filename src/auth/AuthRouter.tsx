// src/auth/AuthRouter.tsx
//
// Router de pantallas pre-sesión (D-S2.30 Opción B, Sprint 2).
// Se renderiza desde App.tsx cuando !authUserId.
//
// Paso 3: /login + /welcome operativos.
// Paso 5 (D3): /reset-password + /reset-password/confirm — pendiente.

import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from '../pages/LoginPage'
import WelcomePage from '../pages/WelcomePage'

export default function AuthRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/welcome" element={<WelcomePage />} />
      {/* Fallback: cualquier URL desconocida pre-sesión → login. */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
