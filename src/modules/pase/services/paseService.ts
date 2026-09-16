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
  /**
   * EL REPARTIDOR, los tres campos del §4 de la enmienda.
   *
   * 🔴 El teléfono es el del REPARTIDOR, que es de casa. El del CLIENTE no
   * viaja aquí: `pase_board` se pregunta en bucle mientras la tablet está
   * encendida, y eso son datos de contacto viajando y cacheándose decenas de
   * veces por hora para pedidos que nadie ha abierto. Va en `pase_ficha`, a la
   * carta, cuando alguien abre la hoja.
   *
   * Y `quien_lo_lleva` NO viene de la base: es una frase derivada de canal +
   * `service_type` + `carrier_code`, y se arma en `quienLoLleva()`. Escribirla
   * también en SQL sería la misma regla en dos sitios.
   */
  repartidor_nombre: string | null
  repartidor_telefono: string | null
  repartidor_transporte: string | null
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

/**
 * QUÉ ES ESTA TABLET, y lo decide el TIPO DE SU ESTACIÓN, que ya existe:
 * `kitchen_station.kind`. Cero campos nuevos.
 *
 *     estación expo  → Pase, y NO tablero de cocina
 *     estación prep  → tablero de cocina, y NO Pase
 *     sin estación   → las dos (camichi4, en Carabanchel)
 *
 * Lo deriva la RPC y no la pantalla: una regla en dos sitios es una regla que
 * un día dice dos cosas.
 */
export type PapelDeLaTablet = 'cocina' | 'pase' | 'ambas'

export interface ElTablero {
  local: string | null
  /** Qué es esta tablet. Lo deriva `pase_board` del `kind` de su estación. */
  papel: PapelDeLaTablet
  /** El interruptor del local. Apagado = el Pase no se pinta en ningún sitio. */
  pase_activo: boolean
  ahora: string
  tarjetas: TarjetaDelPase[]
  /**
   * 🔴 «LA BASE TODAVÍA NO SABE DE ESTO», y se dice con palabras.
   *
   * Antes de la tanda de las 23:45 `pase_board` no existe, y hace falta un
   * respaldo para que la tablet no enseñe un error por una pantalla apagada.
   * Pero DESPUÉS esa rama no debería dispararse nunca más: si se dispara es
   * porque alguien borró, renombró o revocó la función.
   *
   * Un respaldo que se traga el error y pinta un tablero vacío es la avería
   * muda de siempre, sólo que aplazada. Así que deja rastro y la pantalla lo
   * dice: «El Pase todavía no está instalado en este local». Si eso aparece
   * cuando ya debería estar instalado, alguien lo lee y avisa.
   *
   * Y sirve igual para el cliente 2 que todavía no tenga la función.
   */
  sin_instalar?: boolean
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

const TABLERO_SIN_INSTALAR: ElTablero = {
  local: null, papel: 'ambas', pase_activo: false, ahora: '', tarjetas: [],
  sin_instalar: true,
}

/**
 * LO QUE VE LA TABLET MIENTRAS NO SE SABE, que es una pregunta distinta de la
 * anterior y por eso tiene su propio tipo.
 *
 * `null` = todavía no se ha preguntado. NO es «ambas», NO es «apagado»: es que
 * no se sabe. Quien lo reciba tiene que enseñar lo de hoy y no adivinar —
 * misma familia que B74, donde un `0` significaba a la vez «no hay» y «no he
 * mirado».
 */
export interface LoQueEsLaTablet {
  papel: PapelDeLaTablet
  pase_activo: boolean
}

/**
 * QUÉ ES ESTA TABLET · se pregunta UNA VEZ al arrancar, no cada diez segundos.
 *
 * El reparto de pestañas no cambia durante un servicio; las tarjetas sí. Son
 * dos preguntas con dos ritmos, y mezclarlas haría que la pantalla entera se
 * repintara en cada sondeo.
 *
 * Devuelve `null` cuando no se sabe todavía, y el que llama enseña lo de hoy.
 */
export async function getLoQueEsLaTablet(token: string): Promise<LoQueEsLaTablet | null> {
  const t = await getTablero(token)
  if (t.sin_instalar) return null
  return { papel: t.papel, pase_activo: t.pase_activo }
}

export async function getTablero(token: string): Promise<ElTablero> {
  try {
    const t = await rpc<ElTablero>('pase_board', { p_device_token: token })
    return t ?? TABLERO_SIN_INSTALAR
  } catch (e) {
    if (noLoSabeTodavia(e)) {
      // Rastro, además de la pantalla: sin esto, el día que alguien revoque la
      // función no queda ni una línea de por qué el Pase se quedó en blanco.
      console.warn('[pase] `pase_board` no existe en esta base todavía')
      return TABLERO_SIN_INSTALAR
    }
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

// ── APAGAR EL PASE DESDE LA TABLET ────────────────────────────────────────
//
// El respaldo de verdad no es un segundo botón de «Listo»: es el interruptor a
// `false`, que devuelve la tablet a como estaba —con su botón en «Pedidos»— y
// no pierde ningún pedido. Hasta hoy eso sólo se podía hacer desde la oficina,
// y un respaldo que hay que pedir por teléfono a las 21:00 no es un respaldo.
//
// 🔴 `pase_apagar` SÓLO APAGA. No hay forma de encender desde aquí, y no es un
// olvido: encender cambia cómo trabaja el local entero y se decide con Julio
// delante; apagar es volver a donde ya se estaba.

export interface ElApagado {
  local: string | null
  /** Si de verdad estaba encendido. Apagar lo ya apagado no es un fallo, pero
   *  la pantalla no puede decir que ha hecho algo que no ha hecho (regla 8). */
  estaba: boolean
  activo: boolean
}

export function apagarElPase(token: string): Promise<ElApagado> {
  return rpc<ElApagado>('pase_apagar', { p_device_token: token })
}

// ── EL INTERRUPTOR, DESDE LA OFICINA ──────────────────────────────────────
//
// Apagar se puede desde la tablet; encender no se podía desde ningún sitio, y
// eso convertía la retirada en un viaje sin vuelta: el pase apaga un viernes a
// las 21:30 y para reintentarlo el sábado había que esperar a que estuviera
// alguien de fuera delante. Un interruptor que sólo el desarrollador puede
// rearmar no es del cliente.
//
// 🔴 LA LECTURA NO LLEVA RPC. `kitchen_time_config` y `locations` ya tienen
// RLS, y la política que gobierna esta tabla es la misma que gobierna los
// horarios del local. Preguntar directamente es dejar que decida esa política
// y no escribir una segunda. Comprobado con la sesión de Julio: ve TRES
// locales, los suyos.
//
// 🔴 Y POR QUÉ IMPORTA: la cuenta plantilla tiene tres locales con los MISMOS
// NOMBRES que producción --«Foodint Alcalá» existe dos veces en la base--. Por
// eso nada de esto se ancla NUNCA en el nombre: se ancla en `location_id`, y el
// nombre es sólo lo que se pinta (regla 9).

export interface ElLocalYSuPase {
  location_id: string
  local: string
  activo: boolean
  /** null = nadie lo ha tocado desde que hay traza. No es «nunca se tocó». */
  cuando: string | null
  /** 'pantalla' | 'tablet' | null */
  desde: string | null
  /** Usuario si fue desde la pantalla, aparato si fue desde la tablet. */
  por: string | null
  motivo: string | null
  /** Resuelto para pintar: el nombre de quien/lo que lo tocó. */
  quien: string | null
}

export async function getLocalesYSuPase(): Promise<ElLocalYSuPase[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('kitchen_time_config')
    .select('location_id, pase_activo, pase_activo_at, pase_activo_desde, pase_activo_por, pase_apagado_motivo, locations!inner(id, name)')
  if (error) throw error

  type Fila = {
    location_id: string; pase_activo: boolean; pase_activo_at: string | null
    pase_activo_desde: string | null; pase_activo_por: string | null
    pase_apagado_motivo: string | null; locations: { id: string; name: string } | { id: string; name: string }[]
  }
  const filas = (data ?? []) as unknown as Fila[]

  // Los nombres de quién: se piden en UNA tanda por tipo, no una por fila.
  const deTablet = filas.filter(f => f.pase_activo_desde === 'tablet' && f.pase_activo_por).map(f => f.pase_activo_por!)
  const dePantalla = filas.filter(f => f.pase_activo_desde === 'pantalla' && f.pase_activo_por).map(f => f.pase_activo_por!)

  const nombres = new Map<string, string>()
  if (deTablet.length > 0) {
    const { data: ap } = await supabase!.from('kds_device').select('id, label').in('id', deTablet)
    for (const d of (ap ?? []) as { id: string; label: string }[]) nombres.set(d.id, `la tablet «${d.label}»`)
  }
  if (dePantalla.length > 0) {
    const { data: us } = await supabase!.from('user_profiles').select('user_id, display_name').in('user_id', dePantalla)
    for (const u of (us ?? []) as { user_id: string; display_name: string | null }[]) {
      if (u.display_name) nombres.set(u.user_id, u.display_name)
    }
  }

  return filas.map(f => {
    const loc = Array.isArray(f.locations) ? f.locations[0] : f.locations
    return {
      location_id: f.location_id,
      local: loc?.name ?? 'Local sin nombre',
      activo: f.pase_activo,
      cuando: f.pase_activo_at,
      desde: f.pase_activo_desde,
      por: f.pase_activo_por,
      motivo: f.pase_apagado_motivo,
      // Si no se resuelve el nombre NO se inventa uno: se dice de dónde vino,
      // que es lo que de verdad se sabe (regla 32).
      quien: f.pase_activo_por ? (nombres.get(f.pase_activo_por) ?? null) : null,
    }
  }).sort((a, b) => a.local.localeCompare(b.local, 'es'))
}

export interface ElEncendido { local: string | null; activo: boolean; cuando: string; desde: string }

export function encenderElPase(locationId: string): Promise<ElEncendido> {
  return rpc<ElEncendido>('pase_encender', { p_location_id: locationId })
}

/**
 * «SE LO HA LLEVADO» · 16/09/2026.
 *
 * Apunta la recogida a mano. NO avanza el pedido --`order_status` no se toca,
 * así que esto no empuja nada a la plataforma--: sólo escribe el hito, y sólo
 * si estaba vacío. Devuelve la hora que quedó, que es lo que la pantalla
 * enseña; nunca un booleano, porque un botón que hace algo importante confirma
 * con contenido (regla 8).
 */
export function marcarRecogido(saleId: string, token: string): Promise<string> {
  return rpc<string>('marcar_recogido_by_token', {
    p_device_token: token,
    p_sale_id: saleId,
  })
}
