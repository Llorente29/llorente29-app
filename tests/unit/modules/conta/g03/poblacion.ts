// tests/unit/modules/conta/g03/poblacion.ts
//
// G03 · Las empresas de producción, leídas el 07/11/2026 (solo lectura:
// company.is_hospitality y accounts.tax_advisor_since, todas las cuentas,
// 7 empresas). Sin nombres de personas (T11): cada una por su cuenta.

import type { Empresa } from './medirMenu'

/** Hoy, sin la columna `sector`. */
export const HOY: Empresa[] = [
  { quien: 'Foodint', fila: { is_hospitality: true }, asesoria: false },
  { quien: 'Piri Piri (sus 3 empresas)', fila: { is_hospitality: true }, asesoria: false },
  { quien: 'Asesoría QBO (sus 2 empresas)', fila: { is_hospitality: false }, asesoria: true },
  { quien: 'Casa Lola', fila: { is_hospitality: null }, asesoria: false },
]
