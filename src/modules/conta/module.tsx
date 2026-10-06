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
import AjustesPage from '@/modules/conta/pages/AjustesPage'
import PlanContablePage from '@/modules/conta/pages/PlanContablePage'
import MayorPage from '@/modules/conta/pages/MayorPage'
import AlMayor from '@/modules/conta/plan/AlMayor'
import QueVaACadaSitioPage from '@/modules/conta/pages/QueVaACadaSitioPage'
import TablasGeneralesPage from '@/modules/conta/pages/TablasGeneralesPage'
import AltaPage from '@/modules/conta/pages/AltaPage'
import TercerosPage from '@/modules/conta/terceros/TercerosPage'
import FichaTerceroPage from '@/modules/conta/terceros/FichaTerceroPage'

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
    // Ajustes como índice lateral (C02 §5a): cada entrada en ajustes/:entrada;
    // Plan contable y Tablas generales tienen su propia página dentro del marco.
    { path: CONTA.rutas.empresa, element: enMarco(<AjustesPage />, 'Añade a Pablo como apoderado') },
    { path: CONTA.rutas.empresaApartado, element: enMarco(<AjustesPage />, 'Añade a Pablo como apoderado') },
    { path: CONTA.rutas.tablas, element: enMarco(<TablasGeneralesPage />, '¿Qué IVA lleva el pan?') },
    { path: CONTA.rutas.tabla, element: enMarco(<TablasGeneralesPage />, '¿Qué IVA lleva el pan?') },
    { path: CONTA.rutas.plan, element: enMarco(<PlanContablePage />, '¿Dónde va el alquiler?') },
    { path: CONTA.rutas.planSitio, element: enMarco(<QueVaACadaSitioPage />, '¿Dónde va el alquiler?') },
    { path: CONTA.rutas.planCuenta, element: <AlMayor /> },
    // Una cuenta del plan (respuesta 5): su Mayor, o «Sumas y saldos» si tiene hijas.
    { path: CONTA.rutas.mayor, element: enMarco(<MayorPage />, '¿Cuánto debo a mis proveedores?') },
    { path: CONTA.rutas.terceros, element: enMarco(<TercerosPage />, '¿Quién me debe dinero?') },
    { path: CONTA.rutas.tercero, element: enMarco(<FichaTerceroPage />, '¿Cuánto me debe la plataforma?') },
    { path: CONTA.rutas.terceroApartado, element: enMarco(<FichaTerceroPage />, '¿Cuánto me debe la plataforma?') },
    { path: CONTA.rutas.ajustesEntrada, element: enMarco(<AjustesPage />, '¿Dónde cambio el plazo de pago?') },
    // El alta va sin el menú del módulo, como la maqueta N1: es una conversación a pantalla completa.
    { path: CONTA.rutas.alta, element: <EmpresasProveedor><AltaPage /></EmpresasProveedor> },
    { path: '*', element: <Navigate to={`/${CONTA.modulo}/${CONTA.rutas.empresa}`} replace /> },
  ],
  sidebar: {
    // El Shell no pinta este menú (marco propio): sirve para decidir si el
    // módulo sale en la barra de Folvy. El menú de verdad es MENU_CONTA.
    items: [{ id: 'conta_ajustes', label: 'Ajustes', icon: Calculator, path: CONTA.rutas.empresa, requiredRole: 'admin' }],
  },
}
