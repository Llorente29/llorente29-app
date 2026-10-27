// src/modules/configuracion/services/facturasPedidosService.ts
//
// V04 · PR 1 · Lo que lee y escribe Ajustes › «Facturas de los pedidos». Todo
// por las funciones de la base (ticket_invoice_ajustes y
// ticket_invoice_code_set), que filtran por la cuenta: la pantalla no toca las
// tablas de la serie.

import { rpcSinTipar } from '@/lib/rpcSinTipar'
import { leerAjustes, type AjustesFacturas } from '../lib/facturasPedidos'

export async function cargarAjustesFacturas(accountId: string): Promise<AjustesFacturas> {
  return leerAjustes(await rpcSinTipar<Record<string, unknown>>('ticket_invoice_ajustes', { p_account: accountId }))
}

export function guardarCodigoLocal(locationId: string, codigo: string, quien: string | null) {
  return rpcSinTipar<{ codigo: string; cambiado: boolean; serie: string }>('ticket_invoice_code_set',
    { p_location: locationId, p_code: codigo.trim().toUpperCase(), p_quien_nombre: quien })
}
