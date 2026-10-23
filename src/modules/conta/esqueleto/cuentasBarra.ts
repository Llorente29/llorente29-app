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
//
// S02 · PR 3: las cuentas salen de conta_pendientes (useCuentasMenu). Compras
// suma lo que hay que decidir, las facturas para mirar y las por aclarar, y su
// chip DICE qué es cada parte (frasesDeLaBarra, regla 7): la pantalla a la que
// lleva (Facturas recibidas) las enseña en sus pestañas «Por revisar» y «Por
// aclarar», y lo de decidir cuelga de ella (Compras › Por revisar).

import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import type { IdProducto } from './productos'

/** De qué cuentas sale el chip de cada producto. */
export const CUENTAS_DE: Partial<Record<IdProducto, readonly string[]>> = {
  contabilidad: ['libros'],
  compras: ['compras', 'recibidas', 'aclarar'],
  bancos: ['bancos'],
  contactos: ['terceros'],
}

/** Todas las que se suman en Inicio: las mismas claves que los chips del «Te toca hoy». */
export const CUENTAS_DEL_INICIO: readonly string[] = ['compras', 'recibidas', 'aclarar', 'libros', 'bancos', 'terceros']

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

/** Cómo se dice cada parte de una cuenta del menú («9 facturas para mirar»). */
const PARTES: Readonly<Record<string, (n: number) => string>> = {
  compras: (n) => `${n} ${n === 1 ? 'cosa de compras por decidir' : 'cosas de compras por decidir'}`,
  recibidas: (n) => `${n} ${n === 1 ? 'factura para mirar' : 'facturas para mirar'}`,
  aclarar: (n) => `${n} ${n === 1 ? 'factura por aclarar' : 'facturas por aclarar'}`,
  libros: (n) => `${n} ${n === 1 ? 'asiento por validar' : 'asientos por validar'}`,
  bancosConfirmar: (n) => `${n} para confirmar`,
  bancosAclarar: (n) => `${n} por aclarar`,
  bancosValidar: (n) => `${n} por validar`,
  terceros: (n) => `${n} por revisar`,
}

/** Las partes de una lista de claves que tienen algo, dichas una a una. */
export function frasePartes(c: CuentasMenu, claves: readonly string[]): string | null {
  const partes = claves.flatMap((k) => { const n = c[k]; return typeof n === 'number' && n > 0 && PARTES[k] ? [PARTES[k](n)] : [] })
  return partes.length ? partes.join(', ') : null
}

/**
 * S02 · PR 3 · Lo que dice el chip de cada apartado al lector y al pasar el
 * ratón: QUÉ son las que cuenta, no solo cuántas («Compras y gastos · 9
 * facturas para mirar, 91 facturas por aclarar»). Bancos, con sus tres partes
 * si se saben. Sin partes que decir, la frase de siempre.
 */
export function frasesDeLaBarra(c: CuentasMenu): Partial<Record<IdProducto, string>> {
  const fuera: Partial<Record<IdProducto, string>> = {}
  const de: Partial<Record<IdProducto, readonly string[]>> = { ...CUENTAS_DE, bancos: ['bancosConfirmar', 'bancosAclarar', 'bancosValidar'] }
  for (const [p, claves] of Object.entries(de) as [IdProducto, readonly string[]][]) {
    const f = frasePartes(c, claves)
    if (f) fuera[p] = f
  }
  return fuera
}
