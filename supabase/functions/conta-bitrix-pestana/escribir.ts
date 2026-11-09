// supabase/functions/conta-bitrix-pestana/escribir.ts
//
// GB · Segunda parte (nº 9) · Lo que se decide sin llamar a nadie al guardar un
// cambio desde la pestaña (lo prueban las unitarias: tests/unit/modules/conta/gb/escribir.test.ts).
//
//   · El recibo del mes que viene de un cliente con una empresa, con la MISMA
//     cuenta que la ficha del G04 (catalogoYAsignaciones y reciboDelMes de
//     _shared): es lo que se escribe en la «Cuota mensual» de Bitrix24.
//   · Qué hacer con ese campo de Bitrix24 sin pisar nada: si lo que hay allí es
//     lo que Sumied conocía (lo leído cada noche o lo último que escribió la
//     pestaña), se escribe; si alguien lo ha cambiado en Bitrix24, no se toca y
//     va a «Pendiente de revisar».

import { catalogoYAsignaciones } from '../_shared/cobro/datos.ts'
import { reciboDelMes } from '../_shared/tarifa/precio.ts'

type Fila = Record<string, unknown>
const filas = (x: unknown): Fila[] => (Array.isArray(x) ? (x as Fila[]) : [])

/** El mes que viene, «AAAA-MM». */
export function mesSiguiente(hoy: string): string {
  const a = Number(hoy.slice(0, 4)); const m = Number(hoy.slice(5, 7))
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

/** El total del recibo de un mes (céntimos), de lo que lee la pantalla de Clientes (conta_pantalla_clientes). */
export function totalDelRecibo(clientes: unknown, clienteId: string, empresaId: string, mes: string): number {
  const d = (clientes && typeof clientes === 'object' ? clientes : {}) as Fila
  const { catalogo, asignaciones } = catalogoYAsignaciones({
    servicios: filas(d.servicios), precios: filas(d.precios), asignaciones: filas(d.asignaciones), niveles: filas(d.niveles),
    paquetes: filas(d.paquetes), lineasDePaquete: filas(d.lineas_de_paquete), ajustes: filas(d.ajustes),
  })
  return reciboDelMes(catalogo, asignaciones, clienteId, empresaId, mes).totalCent
}

/** Un importe como lo guarda Bitrix24 en la cuota («250,00»). */
export const cuotaEnBitrix = (cent: number) => `${Math.floor(cent / 100)},${String(Math.abs(cent) % 100).padStart(2, '0')}`

/** De lo escrito en Bitrix24 («250,00», «250», «1.250,5 €», «250|EUR») a céntimos; null si está vacío o no es un importe. */
export function centDeTexto(x: unknown): number | null {
  if (x === null || x === undefined) return null
  let t = String(x).split('|')[0].replace(/[€\s]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export type QueHacer =
  | { hacer: 'escribir'; valor: string }
  | { hacer: 'nada'; porque: string }
  | { hacer: 'choque'; enBitrix: string; sumied: string }

/**
 * Qué hacer con el campo de la cuota. «actual» es lo que hay ahora en Bitrix24;
 * «conocida», lo que Sumied leyó; «escrita», lo último que escribió la pestaña.
 * Nunca se pisa un dato cambiado en Bitrix24.
 */
export function queHacerConLaCuota(o: { campo: string | null; actual: unknown; conocida: string | null; escrita: string | null; nuevoCent: number }): QueHacer {
  if (!o.campo) return { hacer: 'nada', porque: 'el mapa de Bitrix24 no tiene la «Cuota mensual»' }
  const valor = cuotaEnBitrix(o.nuevoCent)
  const actual = centDeTexto(o.actual)
  if (actual === o.nuevoCent) return { hacer: 'nada', porque: 'Bitrix24 ya tiene esa cuota' }
  const sabidas = [o.conocida, o.escrita].map(centDeTexto)
  const vacioYSabidoVacio = actual === null && sabidas.every((x) => x === null)
  if (vacioYSabidoVacio || (actual !== null && sabidas.includes(actual))) return { hacer: 'escribir', valor }
  return { hacer: 'choque', enBitrix: actual === null ? 'vacío' : cuotaEnBitrix(actual), sumied: valor }
}
