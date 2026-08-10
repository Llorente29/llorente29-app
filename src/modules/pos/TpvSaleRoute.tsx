// src/modules/pos/TpvSaleRoute.tsx
//
// Ruta autónoma /tpv — hermana de /cocina-tv y /estacion en cuanto a "pantalla
// a pantalla completa sin el Shell", pero con una diferencia deliberada: esas
// dos son de FRONTERA DE TOKEN (sin sesión, terminal de dispositivo); el TPV
// SÍ exige sesión (el guard de upsert_pos_sale/pos_item_config resuelve por
// auth.uid() qué empleado está cobrando). Por eso esta ruta NO vive en la
// lista de rutas públicas de App.tsx (antes del gate de sesión) sino justo
// después de que la sesión y el perfil estén listos, y ANTES del gate de rol
// worker (3-quater) — cualquier empleado (worker, manager o admin) debe poder
// abrir el TPV, no solo quien tenga Shell.
//
// Pendiente de que Julio autorice la línea de ruta en App.tsx (regla del
// proyecto: no tocar App.tsx sin permiso explícito) — ver diff propuesto en
// el parte de la encargo.

import { useNavigate } from 'react-router-dom'
import TpvSalePage from '@/modules/pos/pages/TpvSalePage'

export default function TpvSaleRoute() {
  const navigate = useNavigate()
  return <TpvSalePage onExit={() => navigate('/')} />
}
