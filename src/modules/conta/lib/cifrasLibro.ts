// src/modules/conta/lib/cifrasLibro.ts
//
// S02 · PR 3 («las cifras»): una sola fuente por concepto. Lo que el front
// decide con lo que devuelven las funciones de la tanda 0490, sin React ni red
// (las pruebas, contra la población real: tests/unit/modules/conta/s02/pr3-cifras.test.ts).
//
//   · conta_pendientes → las cuentas del menú (barra, pestañas, «Te toca hoy»
//     y «Pendiente de ti»): una lista y un total, la misma vara.
//   · conta_saldo_bancos → la tarjeta de bancos del Inicio y las palabras de
//     Bancos: «En contabilidad» es lo VALIDADO (y «X por validar» aparte);
//     «Según el banco, a dd/mm» es el extracto. Nunca la misma palabra para
//     las dos cosas.
//   · conta_saldos_terceros → «Te deben» (saldos DEUDORES de clientes, no el
//     neto), «Debes» (saldos ACREEDORES de proveedores y acreedores, sin la
//     407, que es un anticipo y es activo, y sin «por localizar», que se dice
//     aparte) y el «Te debe / Le debes» de cada contacto.
//
// Los nombres de la base viven en services/cifrasService.ts; aquí ya llegan en
// camelCase.

import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'

// ── conta_pendientes ────────────────────────────────────────────────────────

/** Lo que espera una acción de una persona, contado una vez. null: no se ha podido contar. */
export interface Pendientes {
  comprasDecidir: number | null
  facturasParaMirar: number | null
  facturasPorAclarar: number | null
  asientosPorValidar: number | null
  bancosConfirmar: number | null
  bancosAclarar: number | null
  bancosValidar: number | null
}

/** Las claves del menú que salen de conta_pendientes (Contactos, «terceros», se cuenta en el cliente). */
export const CLAVES_DE_PENDIENTES = ['compras', 'recibidas', 'aclarar', 'libros', 'bancos'] as const

/** Una suma de partes: si alguna no se ha podido contar, la suma tampoco (no dice menos de lo que hay). */
export function sumaEntera(partes: readonly (number | null | undefined)[]): number | null {
  if (partes.some((n) => typeof n !== 'number')) return null
  return (partes as number[]).reduce((s, n) => s + n, 0)
}

/**
 * Las cuentas del menú de lo que dice conta_pendientes. Bancos es una sola
 * cuenta (confirmar + aclarar + validar) y lleva sus partes al lado, para que
 * el chip diga qué son.
 */
export function cuentasDePendientes(p: Pendientes): CuentasMenu {
  return {
    compras: p.comprasDecidir,
    recibidas: p.facturasParaMirar,
    aclarar: p.facturasPorAclarar,
    libros: p.asientosPorValidar,
    bancos: sumaEntera([p.bancosConfirmar, p.bancosAclarar, p.bancosValidar]),
    bancosConfirmar: p.bancosConfirmar,
    bancosAclarar: p.bancosAclarar,
    bancosValidar: p.bancosValidar,
  }
}

// ── conta_saldo_bancos ──────────────────────────────────────────────────────

export interface SaldoBanco {
  treasuryAccountId: string | null
  nombre: string
  /** La 572 del banco (57200003). */
  cuenta: string
  /** Lo validado (y anulado) hasta la fecha: lo del libro. null: el banco no tiene su 572. */
  libroValidado: number | null
  /** Lo que suman los propuestos en esa 572. null: sin 572, o no se sabe (la cuenta de hoy no lo lee). */
  libroPropuesto: number | null
  /** El saldo final del último extracto hasta la fecha, o null si no hay. */
  extractoSaldo: number | null
  extractoHasta: string | null
  sinCasar: number | null
  sinCasarN: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CifraBancos {
  /** «En contabilidad»: lo validado de todos los bancos. */
  validado: number
  /** Lo propuesto por validar (0 si no hay; null si no se sabe). */
  propuesto: number | null
  /** «Según el banco»: la suma de los extractos que hay, sus fechas y de cuántos bancos. */
  extracto: { saldo: number; desde: string; hasta: string; bancos: number; de: number } | null
}

export function cifraBancos(filas: readonly SaldoBanco[]): CifraBancos {
  const conExtracto = filas.filter((f) => f.extractoSaldo !== null && f.extractoHasta !== null)
  const fechas = conExtracto.map((f) => f.extractoHasta as string).sort()
  // El libro, de los bancos con su 572 (sin ella, libro_* null: no suman ni dicen 0).
  const conLibro = filas.filter((f) => f.libroValidado !== null)
  return {
    validado: r2(conLibro.reduce((s, f) => s + (f.libroValidado ?? 0), 0)),
    propuesto: conLibro.some((f) => f.libroPropuesto === null) ? null : r2(conLibro.reduce((s, f) => s + (f.libroPropuesto ?? 0), 0)),
    extracto: conExtracto.length === 0 ? null : {
      saldo: r2(conExtracto.reduce((s, f) => s + (f.extractoSaldo ?? 0), 0)),
      desde: fechas[0], hasta: fechas[fechas.length - 1], bancos: conExtracto.length, de: filas.length,
    },
  }
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** «y −4.353,83 € por validar»; nada si no hay propuestos (o no se sabe). */
export function frasePorValidar(propuesto: number | null, formato: (n: number) => string): string | null {
  return propuesto === null || propuesto === 0 ? null : `y ${formato(propuesto)} por validar`
}

/** «Según el banco, a 14/10: 1.496,17 €», con las fechas de cada extracto si no son la misma, y de cuántos bancos si faltan. */
export function fraseSegunElBanco(e: CifraBancos['extracto'], formato: (n: number) => string): string {
  if (!e) return 'Según el banco: sin extracto con saldo'
  const a = e.desde === e.hasta ? `a ${ddmm(e.hasta)}` : `del ${ddmm(e.desde)} al ${ddmm(e.hasta)}`
  const de = e.bancos < e.de ? ` (${e.bancos} de ${e.de} bancos)` : ''
  return `Según el banco, ${a}: ${formato(e.saldo)}${de}`
}

/**
 * Bancos › Movimientos: «En contabilidad» del cuadre lleva lo propuesto (lo
 * casado crea su asiento propuesto: sin él, «te falta por casar» contaría lo
 * ya casado). Con la fila de conta_saldo_bancos se dice de qué está hecho, con
 * las palabras del Inicio, SOLO si las dos partes suman lo del cuadre al
 * céntimo (con el punto de partida del corte no suman, y entonces no se dice).
 */
export function desgloseContable(fila: SaldoBanco | null | undefined, libroCent: number | null): { validado: number; propuesto: number } | null {
  if (!fila || libroCent === null || fila.libroValidado === null || fila.libroPropuesto === null || fila.libroPropuesto === 0) return null
  const suma = Math.round(fila.libroValidado * 100) + Math.round(fila.libroPropuesto * 100)
  return suma === libroCent ? { validado: fila.libroValidado, propuesto: fila.libroPropuesto } : null
}

// ── conta_saldos_terceros ───────────────────────────────────────────────────

export type GrupoTercero = 'cliente' | 'proveedor' | 'acreedor' | 'anticipo' | 'por_localizar'

export interface SaldoTercero {
  cuenta: string
  nombre: string
  partyId: string | null
  grupo: GrupoTercero | null
  saldoDeudor: number
  saldoAcreedor: number
}

const POR_LOCALIZAR = /por\s+localizar/i

/**
 * El grupo de una subcuenta, con la regla de conta_saldos_terceros (0490): 43/44
 * clientes; 407 anticipos (activo, NO deuda); la de «facturas por localizar»
 * (por su nombre; hoy la 40000099); el resto de 40, proveedores; 41,
 * acreedores. Lo demás del 4 no es de nadie aquí.
 */
export function grupoDeCuenta(codigo: string, nombre = ''): GrupoTercero | null {
  if (/^4[34]/.test(codigo)) return 'cliente'
  if (codigo.startsWith('407')) return 'anticipo'
  if (/^4[01]/.test(codigo) && (POR_LOCALIZAR.test(nombre) || codigo === '40000099')) return 'por_localizar'
  if (codigo.startsWith('40')) return 'proveedor'
  if (codigo.startsWith('41')) return 'acreedor'
  return null
}

/** Una fila por subcuenta con su saldo neto (debe − haber): deudor o acreedor, nunca los dos. */
export function filaDeSaldo(cuenta: string, nombre: string, neto: number, partyId: string | null = null): SaldoTercero {
  const n = r2(neto)
  return { cuenta, nombre, partyId, grupo: grupoDeCuenta(cuenta, nombre), saldoDeudor: n > 0 ? n : 0, saldoAcreedor: n < 0 ? -n : 0 }
}

export interface CifrasTerceros {
  /** «Te deben»: saldos deudores de clientes y deudores. */
  teDeben: number
  /** Aparte: lo que los clientes tienen a su favor (saldo acreedor de 43/44). */
  anticiposClientes: number
  /** «Debes»: saldos acreedores de proveedores y acreedores. */
  debes: number
  /** Aparte: «facturas por localizar». */
  porLocalizar: number
  /** Aparte: lo que has adelantado a proveedores (407). No resta de «Debes». */
  anticiposProveedores: number
}

export function cifrasTerceros(filas: readonly SaldoTercero[]): CifrasTerceros {
  const suma = (g: readonly GrupoTercero[], lado: 'saldoDeudor' | 'saldoAcreedor') =>
    r2(filas.filter((f) => f.grupo !== null && g.includes(f.grupo)).reduce((s, f) => s + f[lado], 0))
  return {
    teDeben: suma(['cliente'], 'saldoDeudor'),
    anticiposClientes: suma(['cliente'], 'saldoAcreedor'),
    debes: suma(['proveedor', 'acreedor'], 'saldoAcreedor'),
    porLocalizar: r2(suma(['por_localizar'], 'saldoAcreedor') - suma(['por_localizar'], 'saldoDeudor')),
    anticiposProveedores: r2(suma(['anticipo'], 'saldoDeudor') - suma(['anticipo'], 'saldoAcreedor')),
  }
}

/** Lo que va debajo de «Te deben»: los anticipos de clientes, dichos aparte. */
export function apoyoTeDeben(c: CifrasTerceros, formato: (n: number) => string): string {
  return c.anticiposClientes > 0 ? `aparte, ${formato(c.anticiposClientes)} de anticipos de clientes` : 'clientes y deudores, del libro'
}

/** Lo que va debajo de «Debes»: lo «por localizar», dicho aparte. */
export function apoyoDebes(c: CifrasTerceros, formato: (n: number) => string): string | null {
  return c.porLocalizar !== 0 ? `y ${formato(c.porLocalizar)} de facturas por localizar` : null
}

/**
 * El «Te debe / Le debes» de un contacto, del libro: lo deudor de sus
 * subcuentas le debe a la empresa; lo acreedor, la empresa a él. Las dos
 * cifras a la vez si tiene las dos (un cliente que es también proveedor).
 */
export function saldoDeContacto(filas: readonly SaldoTercero[], partyId: string): { teDebe: number; leDebes: number } {
  const suyas = filas.filter((f) => f.partyId === partyId && f.grupo !== null)
  return { teDebe: r2(suyas.reduce((s, f) => s + f.saldoDeudor, 0)), leDebes: r2(suyas.reduce((s, f) => s + f.saldoAcreedor, 0)) }
}
