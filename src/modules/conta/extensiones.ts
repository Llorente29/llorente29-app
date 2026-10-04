// src/modules/conta/extensiones.ts
//
// Lo que OTRO módulo puede añadir a la lista y a la ficha de proveedor.
//
// Respuesta 1 de Julio al C01: el módulo de contabilidad podrá venderse solo, a
// una cuenta sin Cocina, sin albaranes y sin pedidos. Así que la ficha NO
// importa nada de esos módulos: son ellos los que, al montarla, le pasan sus
// piezas. Una cuenta sin Cocina simplemente no las recibe, y la ficha funciona
// igual.
//
// Cada pieza decide sola si tiene algo que enseñar (`tieneAlgo`): si la cuenta
// no usa ese módulo, la pieza no aparece y no deja un hueco vacío.

import type { ReactNode } from 'react'

export interface ContextoExtension {
  accountId: string
  supplierId: string
  supplierName: string
  /** Para que la pieza avise a la ficha de que algo ha cambiado. */
  alCambiar: () => void
}

export interface SeccionDeFicha {
  id: string
  titulo: string
  /** ¿Tiene esta cuenta algo que enseñar aquí? Si no, la sección no se pinta. */
  tieneAlgo: (accountId: string) => Promise<boolean>
  render: (ctx: ContextoExtension) => ReactNode
}

export interface ColumnaDeLista {
  titulo: string
  /** Valor por proveedor. Si la cuenta no tiene nada (mapa vacío), la columna no se pinta. */
  valores: (accountId: string) => Promise<Record<string, number>>
}

export interface ExtensionesProveedor {
  /** Secciones que van debajo del Resumen de la ficha. */
  secciones?: SeccionDeFicha[]
  /** Una columna más en la lista de proveedores. */
  columna?: ColumnaDeLista
}
