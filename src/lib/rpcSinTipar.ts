// src/lib/rpcSinTipar.ts
//
// PUENTE TEMPORAL — FRENTE 2. Bórrame entero el día que se regenere
// `src/types/database.ts`.
//
// Hay 23 RPC que existen en la base y NO están en el fichero de tipos, así que
// `supabase.rpc('…')` no compila para ellas. La salida fácil sería añadirlas a
// mano a `database.ts`, y es justo la que no hay que tomar: cada parche manual
// es una divergencia más entre el fichero y la base, y el día que alguien lo
// regenere se los lleva por delante sin enterarse.
//
// Así que el desvío vive AQUÍ, en un solo sitio, con la lista de quién lo usa
// escrita debajo. Este fichero es a la vez el apaño y su propio inventario:
// cuando la lista se quede vacía, se borra el fichero.
//
// USADO HOY POR:
//   · employee_clock_status(p_employee_id)  — tarjeta «En cocina ahora»
//   · compras_camino_de(p_recepcion)        — la frase al confirmar una recepción (compras, N21)
//   · supplier_invoice_repetida(…)          — «¿ya está esta factura?» al escanear (supply, D01)
//   · fiscal_for_preview(p_sale_id)         — lo fiscal del tique en «Ver tiques» (pedidos, V04)
//   · ticket_invoice_ajustes / ticket_invoice_code_set — Ajustes › Facturas de los pedidos (V04)
//   · f01_marcas_last / f01_alta_marca / f01_ocultar_marca — las marcas nuevas de Last en Inicio y su alta en Marcas (F01)
//
// Cuando se regenere el fichero de tipos: quitar la llamada de arriba, borrar
// este fichero, y el compilador señalará solo lo que falte.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

/** Llama a una RPC que todavía no está en `database.ts`. Ver cabecera. */
export async function rpcSinTipar<T>(
  nombre: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  // El desvío de tipos, en la única línea del proyecto donde está permitido.
  const cliente = supabase as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }
  const { data, error } = await cliente.rpc(nombre, args)
  if (error) throw new Error(`${nombre}: ${error.message}`)
  return data as T
}
