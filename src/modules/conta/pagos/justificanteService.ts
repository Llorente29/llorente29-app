// src/modules/conta/pagos/justificanteService.ts
//
// B01 · Cola 1e · Leer los justificantes de una factura (conta_factura_justificantes,
// con la sesión de quien mira) y «Mandar al proveedor» (conta-justificante).

import { supabase } from '@/lib/supabase'
import { rpc } from '@/modules/conta/services/bd'

export interface JustificantePago {
  id: string; clave: string; creado: string; caduca: string; importe: number; pagadoAt: string
  correoA: string | null; correoAt: string | null; correoTexto: string | null
  proveedor: string; supplierId: string; alPagar: boolean; telefono: string | null; correo: string | null
}

type Fila = Record<string, unknown>
const str = (x: unknown) => (typeof x === 'string' && x ? x : null)

export async function leerJustificantes(facturaId: string): Promise<JustificantePago[]> {
  let d: Fila[]
  try {
    d = await rpc<Fila[]>('conta_factura_justificantes', { p_factura: facturaId })
  } catch (e) {
    // Antes de que la base lo tenga (una rama antes de su tanda), la ficha sigue sin el bloque.
    if (/conta_factura_justificantes/.test(e instanceof Error ? e.message : String(e))) return []
    throw e
  }
  return (d ?? []).map((j) => ({
    id: String(j.id), clave: String(j.clave), creado: String(j.creado), caduca: String(j.caduca), importe: Number(j.importe), pagadoAt: String(j.pagado_at),
    correoA: str(j.correo_a), correoAt: str(j.correo_at), correoTexto: str(j.correo_texto),
    proveedor: String(j.proveedor ?? ''), supplierId: String(j.supplier_id), alPagar: j.al_pagar === true, telefono: str(j.telefono), correo: str(j.correo),
  }))
}

export async function mandarJustificanteAlProveedor(id: string, quien: string | null): Promise<{ enviado: boolean; texto: string }> {
  if (!supabase) throw new Error('No hay conexión con la base.')
  const { data, error } = await supabase.functions.invoke('conta-justificante', { body: { accion: 'correo', justificante: id, quien } })
  if (data && typeof (data as { texto?: unknown }).texto === 'string') return data as { enviado: boolean; texto: string }
  if (error) {
    const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null) as { texto?: string; error?: string } | null
    throw new Error(cuerpo?.texto ?? cuerpo?.error ?? error.message)
  }
  throw new Error('La función no ha contestado.')
}
