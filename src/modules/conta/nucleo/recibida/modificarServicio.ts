// src/modules/conta/nucleo/recibida/modificarServicio.ts
//
// X26 · «Modificar» una recibida contabilizada: si se puede (y por qué no) y modificarla. Las dos las decide la base
// (conta_recibida_se_puede_modificar y conta_recibida_modificar, 1900): el IVA presentado, el ejercicio y el mes, Diez
// o ERP10, la cadena de huellas y el permiso; y el mismo asiento, con el mismo número.

import { rpc } from '@/modules/conta/services/bd'

export interface SePuedeModificar { puede: boolean; porque: string | null; numero: number | null }

export async function sePuedeModificar(invoiceId: string): Promise<SePuedeModificar> {
  const r = await rpc<{ puede: boolean; porque: string | null; numero: number | null }>('conta_recibida_se_puede_modificar', { p_invoice: invoiceId })
  return { puede: !!r?.puede, porque: r?.porque ?? null, numero: r?.numero ?? null }
}

/** Las cuentas nuevas de sus líneas de gasto, por su posición. Devuelve la frase de la base (regla 8). */
export async function modificarRecibida(invoiceId: string, lineas: { posicion: number; cuenta: string }[], quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_recibida_modificar', { p_invoice: invoiceId, p_lineas: lineas, p_quien_nombre: quien })
  return r.texto
}
