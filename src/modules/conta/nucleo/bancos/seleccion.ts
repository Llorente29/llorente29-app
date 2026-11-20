// src/modules/conta/nucleo/bancos/seleccion.ts
//
// R08 · Bancos: conciliar en un paso (maqueta nucleo_10_bancos_conciliar_en_un_paso), sin
// pantalla. Lo prueba tests/conta/r08-bancos.
//   · El estado, en una palabra: «Por conciliar», «Conciliado» o «Apartado».
//   · Marcar varios: Espacio marca uno, Mayús ↑ ↓ marca seguidos, la casilla de la cabecera todos.
//     Solo se marca lo que se puede conciliar.
//   · «Los N asientos que van al diario»: uno por movimiento, a la cuenta elegida y contra el banco.
//   · Lo que dice «Conciliar los N» al acabar (regla 8): «5 movimientos a la 46500000 · en el diario».
//   · Los mensajes de la base, en palabras: sin el nombre de la función y sin «casar» ni «ignorado».

import { eurosExactos } from '@/modules/conta/lib/formato'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'

export type Palabra = 'Por conciliar' | 'Conciliado' | 'Apartado'

export function palabraDe(m: Pick<MovimientoBanco, 'estado'>): Palabra {
  if (m.estado === 'casado') return 'Conciliado'
  if (m.estado === 'ignorado') return 'Apartado'
  return 'Por conciliar'
}

/** Se puede conciliar a una cuenta: no está conciliado, ni apartado, ni pendiente de decir si está repetido, ni es de antes del corte. */
export const conciliable = (m: Pick<MovimientoBanco, 'estado' | 'importeCent'>): boolean =>
  m.importeCent !== 0 && (m.estado === 'pendiente' || m.estado === 'propuesto' || m.estado === 'por_aclarar')

/** La cabecera: «5 por conciliar · 41 conciliados · 1 apartado». */
export function cuantos(movs: readonly Pick<MovimientoBanco, 'estado'>[]): { porConciliar: number; conciliados: number; apartados: number; texto: string } {
  let porConciliar = 0, conciliados = 0, apartados = 0
  for (const m of movs) { const p = palabraDe(m); if (p === 'Conciliado') conciliados++; else if (p === 'Apartado') apartados++; else porConciliar++ }
  const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
  return { porConciliar, conciliados, apartados, texto: `${porConciliar} por conciliar · ${pl(conciliados, 'conciliado', 'conciliados')} · ${pl(apartados, 'apartado', 'apartados')}` }
}

/** Espacio: marca o desmarca uno (solo si se puede conciliar). */
export function alternar(marcados: ReadonlySet<string>, m: Pick<MovimientoBanco, 'id' | 'estado' | 'importeCent'>): Set<string> {
  const s = new Set(marcados)
  if (s.has(m.id)) s.delete(m.id); else if (conciliable(m)) s.add(m.id)
  return s
}

/** Mayús ↑ ↓: marca todos los conciliables entre el ancla y la fila nueva (las dos incluidas). */
export function marcarSeguidos(marcados: ReadonlySet<string>, movs: readonly Pick<MovimientoBanco, 'id' | 'estado' | 'importeCent'>[], desde: number, hasta: number): Set<string> {
  const s = new Set(marcados)
  const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde]
  for (let i = Math.max(0, a); i <= Math.min(movs.length - 1, b); i++) if (conciliable(movs[i])) s.add(movs[i].id)
  return s
}

/** La casilla de la cabecera: todos los conciliables, o ninguno si ya están todos. */
export function marcarTodos(marcados: ReadonlySet<string>, movs: readonly Pick<MovimientoBanco, 'id' | 'estado' | 'importeCent'>[]): Set<string> {
  const todos = movs.filter(conciliable).map((m) => m.id)
  return todos.length > 0 && todos.every((id) => marcados.has(id)) ? new Set() : new Set(todos)
}

/** Lo marcado, en el orden de la rejilla y solo lo que aún se puede conciliar. */
export const losMarcados = <T extends Pick<MovimientoBanco, 'id' | 'estado' | 'importeCent'>>(movs: readonly T[], marcados: ReadonlySet<string>): T[] =>
  movs.filter((m) => marcados.has(m.id) && conciliable(m))

export interface AsientoQueVa { id: string; fecha: string; texto: string; cuenta: string; lado: 'al debe' | 'al haber'; importeCent: number }

/**
 * «Los N asientos que van al diario»: uno por movimiento. Un pago lleva la cuenta al debe y el banco
 * al haber; un ingreso, al revés. Cada uno cuadra por construcción (dos líneas del mismo importe).
 */
export function asientosQueVan(ms: readonly Pick<MovimientoBanco, 'id' | 'fecha' | 'importeCent' | 'conceptoLimpio' | 'conceptoBanco'>[], cuenta: string): AsientoQueVa[] {
  return ms.map((m) => ({ id: m.id, fecha: m.fecha, texto: (m.conceptoLimpio || m.conceptoBanco).trim(), cuenta, lado: m.importeCent < 0 ? 'al debe' : 'al haber', importeCent: Math.abs(m.importeCent) }))
}

/** La línea de debajo: «Cada uno, contra el banco (57200001) al haber.» */
export function contraElBanco(ms: readonly Pick<MovimientoBanco, 'importeCent'>[], cuenta572: string | null): string {
  const banco = cuenta572 ? `el banco (${cuenta572})` : 'el banco'
  const pagos = ms.filter((m) => m.importeCent < 0).length, ingresos = ms.length - pagos
  if (ingresos === 0) return `Cada uno, contra ${banco} al haber.`
  if (pagos === 0) return `Cada uno, contra ${banco} al debe.`
  return `Cada uno, contra ${banco}: los pagos, al haber; los ingresos, al debe.`
}

/** Lo que suman los marcados, sin signo si son todos del mismo lado; si se mezclan, lo que mueven en el banco. */
export function sumaMarcados(ms: readonly Pick<MovimientoBanco, 'importeCent'>[]): { cent: number; texto: string } {
  const pagos = ms.filter((m) => m.importeCent < 0), ingresos = ms.filter((m) => m.importeCent > 0)
  const total = ms.reduce((t, m) => t + Math.abs(m.importeCent), 0)
  const que = pagos.length && ingresos.length ? `${ms.length} movimientos marcados` : pagos.length ? `${pagos.length === 1 ? '1 pago marcado' : `${pagos.length} pagos marcados`}` : `${ingresos.length === 1 ? '1 ingreso marcado' : `${ingresos.length} ingresos marcados`}`
  return { cent: total, texto: que }
}

/**
 * Pagos e ingresos mezclados: cada uno con su signo. A una cuenta de proveedor o de acreedor (40, 41)
 * un ingreso es una devolución, y a una de cliente (43) un pago también: se dice antes de guardar.
 */
export function avisoMezcla(ms: readonly Pick<MovimientoBanco, 'importeCent'>[], cuenta: string | null): string | null {
  if (!cuenta) return null
  const pagos = ms.filter((m) => m.importeCent < 0).length, ingresos = ms.filter((m) => m.importeCent > 0).length
  if (!pagos || !ingresos) return null
  if (/^4[01]/.test(cuenta)) return `Hay ${ingresos === 1 ? 'un ingreso' : `${ingresos} ingresos`} entre los marcados y la ${cuenta} es de un proveedor: a un proveedor, un ingreso es una devolución. Si no lo es, quítale la marca.`
  if (/^43/.test(cuenta)) return `Hay ${pagos === 1 ? 'un pago' : `${pagos} pagos`} entre los marcados y la ${cuenta} es de un cliente: a un cliente, un pago es una devolución. Si no lo es, quítale la marca.`
  return `Hay pagos e ingresos entre los marcados: cada uno va a la ${cuenta} con su signo.`
}

/** Lo que dice «Conciliar los N» al acabar: «5 movimientos a la 46500000 · en el diario» (sin cuenta, «cada uno a su cuenta»), y lo que no, uno a uno. */
export function textoConciliados(r: { bien: number; cuenta: string; importeCent: number; mal: string[] }): string {
  const a = r.cuenta ? ` a la ${r.cuenta}` : r.bien === 1 ? ' a su cuenta' : ', cada uno a su cuenta'
  const hecho = r.bien === 0 ? 'Ninguno conciliado' : `${r.bien === 1 ? '1 movimiento' : `${r.bien} movimientos`}${a} · ${eurosExactos(r.importeCent / 100)} · en el diario`
  if (r.mal.length === 0) return `${hecho}.`
  return `${hecho}. ${r.mal.length === 1 ? 'Uno no' : `${r.mal.length} no`}: ${r.mal.join(' · ')}`
}

/**
 * Los mensajes de la base, en palabras (encargo R08, 3.5): fuera el nombre de la función que los
 * dio («bank_casar: …») y las palabras de dentro («casado», «casar», «ignorado», «propuesto»).
 */
export function enPalabras(texto: string): string {
  const t = texto.replace(/^\s*[a-z_][a-z0-9_]*:\s+/, '')
  const cambios: [RegExp, string][] = [
    [/\bEse casado\b/g, 'Ese movimiento conciliado'], [/\bese casado\b/g, 'ese movimiento conciliado'],
    [/\bcasados\b/g, 'conciliados'], [/\bcasado\b/g, 'conciliado'], [/\bCasado\b/g, 'Conciliado'], [/\bcasadas\b/g, 'conciliadas'], [/\bcasada\b/g, 'conciliada'],
    [/\bcasarla\b/g, 'conciliarla'], [/\bcasarlo\b/g, 'conciliarlo'], [/\bcasar\b/g, 'conciliar'], [/\bse casa\b/g, 'se concilia'],
    [/\bignorados\b/g, 'apartados'], [/\bignorado\b/g, 'apartado'], [/\bignorar\b/g, 'apartar'],
    [/\basiento propuesto\b/g, 'asiento sin validar'], [/\bpropuesta descartada\b/g, 'propuesta quitada'],
  ]
  return cambios.reduce((s, [re, por]) => s.replace(re, por), t)
}
