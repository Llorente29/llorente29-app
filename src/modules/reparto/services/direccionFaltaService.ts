// src/modules/reparto/services/direccionFaltaService.ts
//
// R03 · Las tres llamadas del aviso «Falta la dirección». Doble puerta, como la
// alarma de reparto: con token (tablet, sin sesión; la base solo deja ver y
// tocar los pedidos del local de ese dispositivo) o con sesión (ordenador).
import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type { PedidoSinDireccion, ResultadoFijar } from '../lib/direccionFalta'

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

function rpc(): Rpc {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  // Atado al cliente: `supabase.rpc` suelto pierde su `this` y revienta antes
  // de mandar nada (la e2e del 16/10 lo cazó: el aviso no llegaba a pedir).
  return (supabase.rpc as unknown as Rpc).bind(supabase)
}

export async function pedidosSinDireccion(locationId: string | null, token: string | null): Promise<PedidoSinDireccion[]> {
  const { data, error } = await rpc()('pedidos_sin_direccion', { p_location_id: locationId, p_token: token })
  if (error) throw new Error(error.message)
  return ((data as { pedidos?: PedidoSinDireccion[] } | null)?.pedidos ?? [])
}

export async function fijarDireccion(saleId: string, direccion: string, token: string | null): Promise<ResultadoFijar> {
  const { data, error } = await rpc()('fijar_direccion_entrega', { p_sale_id: saleId, p_direccion: direccion, p_token: token })
  if (error) throw new Error(error.message)
  return data as ResultadoFijar
}

/** Una persona decide quién reparte un Uber con señales mezcladas. */
export async function decidirQuienReparte(saleId: string, quien: 'nosotros' | 'uber', token: string | null): Promise<ResultadoFijar> {
  const { data, error } = await rpc()('decidir_quien_reparte', { p_sale_id: saleId, p_quien: quien, p_token: token })
  if (error) throw new Error(error.message)
  return data as ResultadoFijar
}

/** Manda el pedido a Catcher (catcher-dispatch, idempotente). Lanza con el motivo si no. */
export async function mandarACatcher(saleId: string): Promise<void> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  const { data, error } = await supabase.functions.invoke('catcher-dispatch', { body: { sale_id: saleId } })
  if (error) throw new Error(`Catcher no lo ha cogido: ${error.message}`)
  const d = data as { ok?: boolean; error?: string } | null
  if (d && d.ok === false) throw new Error(`Catcher no lo ha cogido: ${d.error ?? 'sin motivo'}`)
}
