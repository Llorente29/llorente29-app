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
//
// Nombres dentro de cadenas (regla 40): los crea la 20261024T1440 (conta_cierres,
// conta_cierre_pedidos, conta_cierre_guardar, conta_cierre_espera,
// conta_cierre_factura_prevista, conta_cierre_validar); journal_line y
// company_account (las del asiento) existen desde el C04.

import { rpc } from '@/modules/conta/services/bd'
import { validarCierreConDocumento } from '@/modules/conta/services/conDiezService'
import { cierreDeFila, pedidoDeFila, type CambioPedido, type Cierre, type PedidoCierre } from '@/modules/conta/lib/cierres'

type Fila = Record<string, unknown>

export async function leerCierres(companyId: string): Promise<Cierre[]> {
  const r = await rpc<Fila[] | null>('conta_cierres', { p_company: companyId, p_desde: null, p_hasta: null })
  return (r ?? []).map(cierreDeFila)
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

/** Validar un cierre: el asiento, su PDF y su factura resumen. Dice qué ha hecho (regla 8). */
export async function validarCierre(entryId: string, quien: string | null): Promise<{ numero: number; factura: string | null }> {
  const v = await validarCierreConDocumento(entryId, quien)
  return { numero: v.numero, factura: v.factura ?? null }
}
