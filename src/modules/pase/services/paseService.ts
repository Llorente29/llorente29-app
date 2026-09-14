// src/modules/pase/services/paseService.ts
//
// EL PASE · LA PUERTA DE DATOS · 14/09/2026
//
// ── EL CONTRATO DE `pase_board`, QUE SE ESCRIBE ANTES QUE LA RPC ──────────
//
// La RPC no existe todavía: va en la tanda de las 23:45 junto con
// `pase_activo`, la condición de `kds_board` y la línea del sello. Se deja el
// contrato escrito aquí primero para que la pantalla se construya contra algo
// acordado y no contra lo que a la RPC le salga.
//
//     pase_board(p_device_token text) returns jsonb
//
// Del corte de `kds_board`: SECURITY DEFINER, el token resuelve dispositivo →
// local → CUENTA, y se devuelve sólo lo de esa cuenta.
//
// 🔴 DOS CONDICIONES, Y NO SON DE ESTILO:
//
//   1. ALCANCE POR CUENTA, no sólo por local. Hoy con un cliente no se nota;
//      con el cliente 2 es la diferencia entre un fallo y un incidente. El
//      ensayo lo prueba con un token de una cuenta pidiendo lo de otra, y tiene
//      que salir vacío o reventar, nunca devolver filas ajenas.
//   2. NO DEVUELVE LA LLAVE DE NADA. Estado de la bolsa sí; identificadores
//      internos los justos; y ningún dato de cliente que la pantalla no pinte.
//      Lo mismo que se corrigió por la mañana en la ficha de Instagram, donde
//      el `ig_user_id` viajaba al navegador para que el front lo tirase.
//
// Lo que NO hace: tocar el feed de pedidos. Ese está en el camino del pedido y
// lo usa todo; una lente nueva no se paga con un cambio ahí.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { PedidoDelPase } from '../lib/lasTresZonas'

/** El estado del ticket de bolsa, que sale de `print_job`. */
export interface LaBolsa {
  /** 'hecha' | 'esperando' | 'rota' | 'sin_pedir' */
  estado: 'hecha' | 'esperando' | 'rota' | 'sin_pedir'
  /** Cuándo se imprimió o cuándo se intentó por última vez. */
  cuando: string | null
  /** Intentos, para poder decir «intentado 3 veces» y no un icono. */
  intentos: number
}

/** Una tarjeta del Pase. Extiende lo que la lógica necesita con lo que se pinta. */
export interface TarjetaDelPase extends PedidoDelPase {
  /** El número corto que se lee en la esquina. */
  codigo: string | null
  marca: string | null
  /** El logo de la marca, el mismo de la pegatina de la bolsa. */
  marca_logo_url: string | null
  cliente: string | null
  rider_nombre: string | null
  rider_transporte: string | null
  /** Minutos desde el hito que toca en cada zona; los calcula la RPC. */
  minutos: number | null
  lineas: { nombre: string; cantidad: number }[]
  bolsa: LaBolsa
  /**
   * CÓMO AVANZÓ, no quién pulsó: 'persona' | 'foto' | 'flota' | null.
   *
   * La visión artificial del cierre NO existe todavía y no se construye aquí.
   * Pero la tarjeta se monta sobre el CÓMO y no sobre el botón, así que el día
   * que entre se añade un caso y no se rehace la pantalla. Y cuando avance por
   * foto tendrá que decirlo: el día que la visión se equivoque y salga una
   * bolsa incompleta, la única manera de saber quién lo dio por bueno es que
   * esté escrito.
   */
  avanzo_por: 'persona' | 'foto' | 'flota' | null
  avanzo_quien: string | null
}

export interface ElTablero {
  local: string | null
  /** El interruptor del local. Apagado = el Pase no se pinta en ningún sitio. */
  pase_activo: boolean
  ahora: string
  tarjetas: TarjetaDelPase[]
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

/** Puente para RPC que no están en los tipos autogenerados, como en el KDS. */
function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  requireSupabase()
  return (
    supabase!.rpc as unknown as (
      fn: string, args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args).then(({ data, error }) => {
    if (error) throw new Error(`Pase · ${fn}: ${error.message}`)
    return data as T
  })
}

/**
 * EL TABLERO VACÍO, que es lo que hay que devolver cuando la base todavía no
 * sabe de esto.
 *
 * 🔴 Entre que esto se fusiona y las 23:45, `pase_board` NO EXISTE en
 * producción. Sin este respaldo, la llamada reventaría y la tablet enseñaría
 * un error por una pantalla que además está apagada. Con él, el Pase
 * sencillamente no se pinta — que es exactamente lo que hace con el
 * interruptor en false.
 *
 * Y no se traga cualquier error: sólo el de «esa función no existe» (42883 /
 * PGRST202). Un fallo de red o de permisos SÍ tiene que verse, porque con el
 * Pase encendido eso es una pantalla que deja de funcionar.
 */
function noLoSabeTodavia(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e)
  return /42883|PGRST202|could not find the function|does not exist/i.test(m)
}

const TABLERO_APAGADO: ElTablero = {
  local: null, pase_activo: false, ahora: '', tarjetas: [],
}

export async function getTablero(token: string): Promise<ElTablero> {
  try {
    const t = await rpc<ElTablero>('pase_board', { p_device_token: token })
    return t ?? TABLERO_APAGADO
  } catch (e) {
    if (noLoSabeTodavia(e)) return TABLERO_APAGADO
    throw e
  }
}

/**
 * «LISTO». La única pulsación de toda la vida del pedido.
 *
 * Va por `set_order_status_by_token` con `awaiting_collection` PARA TODOS LOS
 * SERVICIOS — que es el camino vivo, el que usa hoy el botón de un toque de
 * `OrderCard.tsx:657` y por el que salen las 196 de 196 bolsas de Alcalá.
 *
 * No es una elección de estilo: `primaryAction` y `kds_bump` mandan el reparto
 * propio a `in_delivery`, que NO dispara el ticket de la bolsa. Tres escritores
 * y dos destinos; el Pase se queda con el que funciona y los otros dos
 * desaparecen con él.
 */
export function marcarListo(saleId: string, token: string): Promise<string> {
  // Devuelve el estado que quedó escrito. No se tira: un botón que hace algo
  // importante confirma con CONTENIDO, no con un visto (regla 8).
  return rpc<string>('set_order_status_by_token', {
    p_device_token: token,
    p_sale_id: saleId,
    p_new_status: 'awaiting_collection',
  })
}

/**
 * Volver a pedir la bolsa. Ya existe: `reprint_order_by_token`, y devuelve
 * CUÁNTOS trabajos ha encolado. Se enseña ese número --«Pedida otra vez»-- en
 * vez de un visto: si devuelve 0 es que no hay impresora de bolsa en el local,
 * y callarse eso es cómo se está una tarde entera sin papel sin enterarse.
 */
export function reimprimirBolsa(saleId: string, token: string): Promise<number> {
  return rpc<number>('reprint_order_by_token', {
    p_device_token: token,
    p_sale_id: saleId,
    p_doc_type: 'bag',
  })
}
