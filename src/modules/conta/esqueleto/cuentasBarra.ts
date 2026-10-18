// src/modules/conta/esqueleto/cuentasBarra.ts
//
// S01c · El chip de cada entrada de la barra (encargo S01b, 18/10): lo que
// pide una decisión en ese producto, con la misma vara que el «Te toca hoy»
// del Inicio (useCuentasMenu, regla 31). Inicio lleva la suma de todo, y esa
// suma es la de los chips del «Te toca hoy»: lo que dice la barra cuadra con
// lo que enseña el Inicio (Julio: «el contador tiene que cuadrar»).
//
// Un número que no se ha podido contar no suma ni dice 0: si nada de un
// producto se ha podido contar, su chip no sale (null).

import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import type { IdProducto } from './productos'

/** De qué cuentas sale el chip de cada producto. */
export const CUENTAS_DE: Partial<Record<IdProducto, readonly string[]>> = {
  contabilidad: ['libros'],
  compras: ['compras', 'recibidas'],
  bancos: ['bancos'],
  contactos: ['terceros'],
}

/** Todas las que se suman en Inicio: las mismas claves que los chips del «Te toca hoy». */
export const CUENTAS_DEL_INICIO: readonly string[] = ['compras', 'recibidas', 'libros', 'bancos', 'terceros']

function suma(c: CuentasMenu, claves: readonly string[]): number | null {
  const ns = claves.map((k) => c[k]).filter((n): n is number => typeof n === 'number')
  return ns.length === 0 ? null : ns.reduce((s, n) => s + n, 0)
}

export function cuentasDeLaBarra(c: CuentasMenu): Partial<Record<IdProducto, number | null>> {
  const fuera: Partial<Record<IdProducto, number | null>> = { inicio: suma(c, CUENTAS_DEL_INICIO) }
  for (const [p, claves] of Object.entries(CUENTAS_DE) as [IdProducto, readonly string[]][]) fuera[p] = suma(c, claves)
  return fuera
}

/** Lo que dice el chip al lector y al pasar el ratón. */
export function frasePendientes(n: number): string {
  return n === 1 ? '1 por revisar' : `${n} por revisar`
}
