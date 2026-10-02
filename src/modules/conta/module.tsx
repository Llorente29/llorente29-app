// src/modules/conta/module.tsx
//
// El módulo de contabilidad (C00, 02/10/2026). Trae su propio marco
// (`chrome: 'propio'`): menú, barra inferior y barra de la IA de sus maquetas.
// Sale en la barra de Folvy solo con el interruptor `conta`; sus rutas están
// montadas siempre y las protege la RLS. Solo administradores.
//
// No depende de Cocina para nada: se puede vender solo.

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Calculator } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import { CONTA } from '@/config/navegacion'
import '@/modules/conta/estilo'
import { MarcoConta } from '@/modules/conta/marco/MarcoConta'
import { EmpresasProveedor } from '@/modules/conta/empresa/EmpresasProveedor'
import TuEmpresaPage from '@/modules/conta/pages/TuEmpresaPage'
import TablasGeneralesPage from '@/modules/conta/pages/TablasGeneralesPage'

const enMarco = (pagina: ReactNode, ejemplo: string) => (
  <EmpresasProveedor><MarcoConta ejemplo={ejemplo}>{pagina}</MarcoConta></EmpresasProveedor>
)

export const contaModule: ModuleDefinition = {
  id: 'conta',
  name: 'Folvy Conta',
  icon: Calculator,
  topBarOrder: 10,
  requiredRole: 'admin',
  basePath: CONTA.modulo,
  chrome: 'propio',
  featureFlag: CONTA.interruptor,
  routes: [
    { path: '', element: <Navigate to={CONTA.rutas.empresa} replace /> },
    { path: CONTA.rutas.empresa, element: enMarco(<TuEmpresaPage />, 'Añade a Pablo como apoderado') },
    { path: CONTA.rutas.tablas, element: enMarco(<TablasGeneralesPage />, '¿Qué IVA lleva el pan?') },
    { path: CONTA.rutas.tabla, element: enMarco(<TablasGeneralesPage />, '¿Qué IVA lleva el pan?') },
    { path: '*', element: <Navigate to={`/${CONTA.modulo}/${CONTA.rutas.empresa}`} replace /> },
  ],
  sidebar: {
    // El Shell no pinta este menú (marco propio): sirve para decidir si el
    // módulo sale en la barra de Folvy. El menú de verdad es MENU_CONTA.
    items: [{ id: 'conta_ajustes', label: 'Ajustes', icon: Calculator, path: CONTA.rutas.empresa, requiredRole: 'admin' }],
  },
}
