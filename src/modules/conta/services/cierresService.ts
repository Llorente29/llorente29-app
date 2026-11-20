// src/modules/conta/services/cierresService.ts
//
// V01 · Entrega 2 · Ventas › Cierres del día: leer y escribir, solo por las
// funciones de la base (todas comprueban la cuenta de quien llama, regla 9):
//
//   · conta_cierres: la lista (los cierres de la empresa y los días que el
//     cierre del día no ha podido proponer, con su porqué).
//   · conta_cierre_pedidos: los pedidos de un cierre con lo cambiado.
//   · conta_cierre_guardar: «Guardar cambios» (quitar, pasar a otro día,
//     ajustar el importe, deshacer) y el cierre rehecho. No toca el pedido de
//     Folvy: solo cómo cuenta en la contabilidad.
//   · conta_cierre_espera: dejarlo en espera con su motivo, o quitarlo.
//   · validar: validarCierreConDocumento (conDiezService), que valida el
//     asiento con su PDF y su factura resumen en una transacción.
//   · R05 · conta_tpv_dias: los días del TPV, en la misma lista; y validarlos,
//     tpvDiaService (propone y valida a la vez, con su PDF).
//
// Nombres dentro de cadenas (regla 40): los crea la 20261024T1440 (conta_cierres,
// conta_cierre_pedidos, conta_cierre_guardar, conta_cierre_espera,
// conta_cierre_factura_prevista, conta_cierre_validar); journal_line y
// company_account (las del asiento) existen desde el C04.

import { rpc, tabla } from '@/modules/conta/services/bd'
import { validarCierreConDocumento } from '@/modules/conta/services/conDiezService'
import { validarDiaTpv } from '@/modules/conta/services/tpvDiaService'
import { cierreDeFila, cierreTpvDeFila, pedidoDeFila, type CambioPedido, type Cierre, type CobroDelDia, type PedidoCierre } from '@/modules/conta/lib/cierres'

type Fila = Record<string, unknown>

/**
 * Los cierres de la empresa: los de Folvy (conta_cierres) y, R05, los días del TPV
 * (conta_tpv_dias, de la 20261117T1602), en la misma lista, del día más nuevo al más viejo.
 */
export async function leerCierres(companyId: string): Promise<Cierre[]> {
  const [r, t] = await Promise.all([
    rpc<Fila[] | null>('conta_cierres', { p_company: companyId, p_desde: null, p_hasta: null }),
    rpc<Fila[] | null>('conta_tpv_dias', { p_company: companyId, p_desde: null, p_hasta: null }),
  ])
  const todos = [...(r ?? []).map(cierreDeFila), ...(t ?? []).map(cierreTpvDeFila)]
  const cobros = await leerCobrosDelDia(todos.map((x) => x.asientoId).filter((k): k is string => !!k))
  for (const x of todos) x.cobro = x.asientoId ? cobros.get(x.asientoId) ?? null : null
  return todos.map((x, i) => ({ x, i })).sort((a, b) => b.x.dia.localeCompare(a.x.dia) || a.i - b.i).map(({ x }) => x)
}

export async function leerPedidosCierre(cierreId: string): Promise<PedidoCierre[]> {
  const r = await rpc<Fila[] | null>('conta_cierre_pedidos', { p_summary: cierreId })
  return (r ?? []).map(pedidoDeFila)
}

export interface CierreGuardado {
  cambios: number
  antes: number
  total: number
  asiento: string | null
  dias: { dia: string; resultado: 'propuesto' | 'sin_propuesta' | 'vacio' | 'descartado'; porque: string | null; total: number | null }[]
}

export async function guardarCambiosCierre(cierreId: string, cambios: readonly CambioPedido[], quien: string | null): Promise<CierreGuardado> {
  const r = await rpc<Fila>('conta_cierre_guardar', { p_summary: cierreId, p_cambios: cambios, p_quien_nombre: quien })
  return {
    cambios: Number(r.cambios ?? 0), antes: Number(r.antes ?? 0), total: Number(r.total ?? 0), asiento: r.asiento ? String(r.asiento) : null,
    dias: ((r.dias ?? []) as Fila[]).map((d) => ({
      dia: String(d.dia), resultado: String(d.resultado) as CierreGuardado['dias'][number]['resultado'],
      porque: d.porque ? String(d.porque) : null, total: d.total == null ? null : Number(d.total),
    })),
  }
}

export async function ponerEnEspera(cierreId: string, motivo: string, quien: string | null): Promise<void> {
  await rpc('conta_cierre_espera', { p_summary: cierreId, p_motivo: motivo, p_quien_nombre: quien })
}

export async function quitarDeEspera(cierreId: string, quien: string | null): Promise<void> {
  await rpc('conta_cierre_espera', { p_summary: cierreId, p_motivo: '', p_quien_nombre: quien })
}

export async function facturaPrevista(entryId: string): Promise<string> {
  return String((await rpc<Fila>('conta_cierre_factura_prevista', { p_entry: entryId })).texto)
}

/** R05 · Validar un día del TPV: se propone y se valida a la vez, con su PDF y sin factura de Sumied. */
export async function validarCierreTpv(diaId: string, quien: string | null): Promise<{ numero: number; texto: string; cobroNumero: number | null }> {
  const v = await validarDiaTpv(diaId, quien)
  return { numero: v.numero, texto: v.texto, cobroNumero: v.cobroNumero }
}

/** Validar un cierre: el asiento, su PDF y su factura resumen. Dice qué ha hecho (regla 8). */
export async function validarCierre(entryId: string, quien: string | null): Promise<{ numero: number; factura: string | null }> {
  const v = await validarCierreConDocumento(entryId, quien)
  return { numero: v.numero, factura: v.factura ?? null }
}

/**
 * R07 · El cobro del día de cada factura del día (conta_dia_cobro, de la 20261120T0810, y su asiento en
 * journal_entry). Antes de la 0810 la tabla no está: sin cobros, la lista sale como siempre.
 */
export async function leerCobrosDelDia(facturas: string[]): Promise<Map<string, CobroDelDia>> {
  const out = new Map<string, CobroDelDia>()
  if (!facturas.length) return out
  for (let i = 0; i < facturas.length; i += 100) {
    const trozo = facturas.slice(i, i + 100)
    const u = await tabla('conta_dia_cobro').select('factura_entry_id, cobro_entry_id').in('factura_entry_id', trozo)
    if (u.error) return out
    const pares = (u.data ?? []) as { factura_entry_id: string; cobro_entry_id: string }[]
    if (!pares.length) continue
    const a = await tabla('journal_entry').select('id, number, status').in('id', pares.map((p) => p.cobro_entry_id))
    if (a.error) throw new Error(`No se han podido leer los cobros del día: ${a.error.message}`)
    const porId = new Map(((a.data ?? []) as { id: string; number: number | null; status: string }[]).map((e) => [e.id, e]))
    for (const p of pares) {
      const e = porId.get(p.cobro_entry_id)
      if (e) out.set(p.factura_entry_id, { id: e.id, numero: e.number == null ? null : Number(e.number), estado: e.status })
    }
  }
  return out
}
