// src/auth/AuthRouter.tsx
//
// Router de pantallas pre-sesión (D-S2.30 Opción B, Sprint 2).
// Se renderiza desde App.tsx cuando !authUserId.
//
// CHANGELOG:
//   - Sesión 7: Paso 1 — /login.
//   - Sesión 7: Paso 3 — /welcome.
//   - Sesión 9: Paso 5 (D3) — /reset-password.
//   - I01b (18/10): /conta/asesoria, aceptar la invitación a una asesoría.
//   - L1a · PR 2 (28/10): /inspeccion, el enlace del registro de jornada para la Inspección.
//   - Sesión 9: /reset-password/confirm MOVIDO a App.tsx 1-bis (Opción 1.a).
//     Razón: la ruta debe ser accesible también con sesión activa (caso
//     "user logueado pulsa reset"). AuthRouter solo se monta cuando
//     !authUserId, lo que excluía ese caso y saltaba la pantalla.

import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from '../pages/LoginPage'
import WelcomePage from '../pages/WelcomePage'
import ResetPasswordPage from '../pages/ResetPasswordPage'
import AccesoTrabajadorPage from '../pages/AccesoTrabajadorPage'
import { isPairedEstacion } from '../native/print/printWorker'
import { CON_MARCA } from '../marca/marca'
import EntrarMarca from '../marca/EntrarMarca'
import AceptarAsesoriaPage from '../modules/conta/impuestos/AceptarAsesoriaPage'
import InspeccionPage from '../modules/personal/laboral/InspeccionPage'

export default function AuthRouter() {
  // PERSISTENCIA DE ESTACIÓN (tablet de cocina): si esta app nativa ya está
  // vinculada como Estación (token + device_mode=estacion), abre DIRECTO en
  // /estacion en vez del login. Sólo nativo; en web nunca secuestra el login.
  // Si el token estuviera revocado, /estacion muestra la pantalla de vincular.
  if (isPairedEstacion()) {
    return <Navigate to="/estacion" replace />
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      {/* C06: con una marca propia, su entrada (N18); con Folvy, la de siempre. */}
      <Route path="/login" element={CON_MARCA ? <EntrarMarca /> : <LoginPage />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/reset-password" element={CON_MARCA ? <EntrarMarca modoInicial="olvido" /> : <ResetPasswordPage />} />
      <Route path="/acceso" element={<AccesoTrabajadorPage />} />
      {/* I01b: aceptar la invitación de una empresa a su asesoría, sin sesión (el enlace del correo). */}
      <Route path="/conta/asesoria" element={<AceptarAsesoriaPage />} />
      {/* L1a · PR 2: el registro de jornada para la Inspección, de solo lectura y sin sesión (?t=<token>, caduca solo). */}
      <Route path="/inspeccion" element={<InspeccionPage />} />
      {/* Fallback: cualquier URL desconocida pre-sesión → login.
          /reset-password/confirm NO está aquí: vive en App.tsx 1-bis para
          ser accesible con o sin sesión activa. */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
