// src/modules/conta/lib/contratos.ts
//
// S01d · Préstamos y aplazamientos (tablero 3). Lo que no es pantalla: leer
// el cuadro de amortización de un Excel (el de BBVA, con el mismo lector que
// el extracto), comprobar que el capital suma lo aplazado, y lo que dice la
// cabecera: cuotas del mes, próxima cuota y lo que queda por pagar. En
// céntimos, para no perder ninguno.

import { leerImporte } from '@/modules/conta/lib/reparto'

export type TipoContrato = 'prestamo' | 'aplazamiento' | 'poliza' | 'alquiler' | 'otro'

export interface FilaCuadro { fecha: string; cuotaCent: number; capitalCent: number; interesesCent: number; pendienteCent?: number | null }

export interface ContratoVista {
  id: string; tipo: TipoContrato; nombre: string; contiene: string
  importeCent: number | null; principalCent: number | null; cuotas: number | null
  cuadro: FilaCuadro[] | null; bancoId: string | null
  cuentaCorto: string | null; cuentaLargo: string | null; cuentaIntereses: string | null
  documento: string | null
}

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Una fecha de una celda: «05/11/2026», «5-11-2026», «2026-11-05». Con el año
 * en dos cifras («11/5/26») es el formato corto de Excel, que pone el mes
 * delante. null si no es una fecha.
 */
export function leerFecha(t: string): string | null {
  const s = t.trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return fecha(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return fecha(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (m) return fecha(2000 + +m[3], +m[1], +m[2])
  return null
}
function fecha(a: number, mes: number, d: number): string | null {
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const COLUMNAS: Record<'fecha' | 'cuota' | 'capital' | 'intereses', RegExp> = {
  fecha: /^fecha|vencimiento|^venc/,
  cuota: /^cuota|^importe cuota|^recibo|^total/,
  capital: /capital|amortiza|principal/,
  intereses: /interes/,
}

/**
 * El cuadro de una hoja: busca la fila de títulos (fecha, cuota, capital e
 * intereses, con los nombres que usan los bancos) y lee las de debajo que
 * tienen fecha. Si no encuentra los títulos, dice cuál falta.
 */
export function leerCuadro(filas: readonly (readonly string[])[]): { cuadro: FilaCuadro[] } | { error: string } {
  for (const [i, f] of filas.entries()) {
    const t = f.map(normal)
    // «Capital pendiente» o «vivo» es el saldo, no el capital de la cuota.
    const col = (k: keyof typeof COLUMNAS) => t.findIndex((c) => COLUMNAS[k].test(c) && !/pendiente|vivo/.test(c))
    const c = { fecha: col('fecha'), cuota: col('cuota'), capital: col('capital'), intereses: col('intereses') }
    if (c.fecha < 0 || c.capital < 0 || c.intereses < 0) continue
    const cuadro: FilaCuadro[] = []
    for (const r of filas.slice(i + 1)) {
      const d = leerFecha(r[c.fecha] ?? '')
      if (!d) continue
      const capitalCent = leerImporte(r[c.capital] ?? '') ?? 0
      const interesesCent = leerImporte(r[c.intereses] ?? '') ?? 0
      const cuotaCent = c.cuota >= 0 ? (leerImporte(r[c.cuota] ?? '') ?? capitalCent + interesesCent) : capitalCent + interesesCent
      if (cuotaCent === 0 && capitalCent === 0) continue
      cuadro.push({ fecha: d, cuotaCent, capitalCent, interesesCent })
    }
    if (cuadro.length === 0) return { error: 'He encontrado los títulos del cuadro, pero ninguna fila con fecha debajo.' }
    return { cuadro: cuadro.sort((a, b) => a.fecha.localeCompare(b.fecha)) }
  }
  return { error: 'No encuentro el cuadro: hace falta una fila con «Fecha», «Capital» (o «Amortización») e «Intereses».' }
}

/** Si el capital del cuadro suma lo aplazado: el contrato no se guarda si no (respuesta 1 de Julio, 30/10). */
export function cuadraConLoAplazado(cuadro: readonly FilaCuadro[], importeCent: number): { cuadra: boolean; sumaCent: number } {
  const sumaCent = cuadro.reduce((t, f) => t + f.capitalCent, 0)
  return { cuadra: sumaCent === importeCent, sumaCent }
}

/** Lo que queda por pagar después de cada fila (lo que guarda la base en `pendiente`). */
export function conPendiente(cuadro: readonly FilaCuadro[], importeCent: number): FilaCuadro[] {
  let queda = importeCent
  return cuadro.map((f) => { queda -= f.capitalCent; return { ...f, pendienteCent: queda } })
}

/** Lo que queda por pagar hoy: lo pendiente tras la última cuota ya vencida (todo, si no ha vencido ninguna). */
export function quedaPorPagar(c: Pick<ContratoVista, 'cuadro' | 'principalCent'>, hoy: string): number | null {
  if (!c.cuadro || c.cuadro.length === 0 || c.principalCent === null) return null
  const vencidas = c.cuadro.filter((f) => f.fecha < hoy)
  return vencidas.length ? conPendiente(c.cuadro, c.principalCent)[vencidas.length - 1].pendienteCent! : c.principalCent
}

/** La siguiente cuota desde hoy (incluido). */
export function proximaCuota(c: Pick<ContratoVista, 'cuadro'>, hoy: string): FilaCuadro | null {
  return c.cuadro?.find((f) => f.fecha >= hoy) ?? null
}

/** «Cómo se casa» (la última columna del tablero 3). */
export function comoSeCasa(c: Pick<ContratoVista, 'tipo' | 'cuadro' | 'documento'>): { texto: string; sola: boolean } {
  if (c.tipo === 'poliza') return { texto: 'Con la liquidación del banco', sola: false }
  if (!c.cuadro?.length) return { texto: 'Falta el cuadro', sola: false }
  if (c.tipo === 'aplazamiento') return { texto: /resoluci|tgss|seguridad/i.test(c.documento ?? '') ? 'Sola, con su resolución' : 'Sola, con su acuerdo', sola: true }
  return { texto: 'Sola, con su cuadro', sola: true }
}

export const TIPOS: Record<TipoContrato, string> = {
  prestamo: 'Préstamo', aplazamiento: 'Aplazamiento', poliza: 'Póliza de crédito', alquiler: 'Alquiler', otro: 'Otro',
}

/** La cabecera del tablero 3: las cuotas del mes, la próxima y lo que queda, de todos los contratos. */
export function resumen(cs: readonly ContratoVista[], hoy: string): {
  mes: { totalCent: number; cuotas: number }; proxima: { fila: FilaCuadro; nombre: string } | null; quedaCent: number; contratos: number
} {
  const mes = hoy.slice(0, 7)
  const delMes = cs.flatMap((c) => (c.cuadro ?? []).filter((f) => f.fecha.slice(0, 7) === mes))
  const proximas = cs.map((c) => ({ fila: proximaCuota(c, hoy), nombre: c.nombre })).filter((x): x is { fila: FilaCuadro; nombre: string } => x.fila !== null)
    .sort((a, b) => a.fila.fecha.localeCompare(b.fila.fecha))
  return {
    mes: { totalCent: delMes.reduce((t, f) => t + f.cuotaCent, 0), cuotas: delMes.length },
    proxima: proximas[0] ?? null,
    quedaCent: cs.reduce((t, c) => t + (quedaPorPagar(c, hoy) ?? 0), 0),
    contratos: cs.length,
  }
}
