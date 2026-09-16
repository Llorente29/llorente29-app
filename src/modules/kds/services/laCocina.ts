// src/modules/kds/services/laCocina.ts
//
// LO QUE NECESITA «LA COCINA DE <LOCAL>» · 15/09/2026
//
// La página junta lo que hoy son tres pestañas —Estaciones, Ruteo familias y
// Dispositivos—, que son la misma cosa mirada tres veces: la estación.
//
// 🔴 NO HAY NI UNA RPC NUEVA. Todo lo que ESCRIBE ya existe en `kdsService`
// (`updateStation`, `createStation`, `setDefaultStation`, `setFamilyRoute`,
// `updateDevice`…) y se reusa tal cual. Aquí sólo vive la LECTURA conjunta, que
// es lo único que no existía: hasta ahora cada pestaña leía lo suyo.
//
// ✅ `kitchen_station.pase_activo` y sus cuatro columnas de traza EXISTEN desde
// la migración `20260915225209` (16/09, 00:52). Los 25 nombres que pide este
// fichero se comprobaron uno a uno contra `information_schema` ese mismo día:
// existen los 25 (regla 40 — lo que viaja dentro de una cadena no lo mira ni
// `tsc` ni el lint).
//
// Mientras la migración no estuvo, aquí había un aviso de que este fichero no
// podía fusionarse. Lo escribí en el código y no sólo en un parte, porque el
// parte no se lee al hacer merge.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { listDeviceBundleStatus } from './kdsService'
import { loQueLeeLaOficina } from '../lib/palabrasDeLaActualizacion'

export type PapelDeEstacion = 'expo' | 'prep'

export interface LaTabletQueMira {
  id: string
  label: string
  /** Minutos desde la última señal. null = nunca ha dado una. */
  vistoHaceMin: number | null
  activa: boolean
  /** Qué estaciones mira. Vacío = las mira todas (y eso es un aviso). */
  estacionIds: string[]
  /**
   * 🔴 QUÉ PAQUETE CORRE Y POR QUÉ ESPERA, si espera.
   *
   * Esto casi se pierde en la retirada. «Dispositivos» era la ÚNICA pantalla
   * que enseñaba `kds_device_bundle_status`, y el vigía de bundle desfasado
   * (migración `20260902T0800`) justifica su umbral APOYÁNDOSE en que esa
   * pantalla existe y no filtra: «el umbral de 24 h vive SOLO en el vigía que
   * interrumpe» (regla 7). Retirarla sin traer esto dejaba al vigía sin su
   * mitad que no esconde.
   *
   * Lo cazó el barrido de la regla 18 --mirar quién enlaza antes de borrar--,
   * y no el front: lo dice un comentario de una migración.
   *
   * El castellano NO se reescribe aquí: sale de `loQueLeeLaOficina`, que es
   * donde vive y está probado contra los estados reales.
   */
  paquete: { texto: string; rojo: boolean } | null
}

export interface LaEstacion {
  id: string
  name: string
  kind: PapelDeEstacion
  isDefault: boolean
  isActive: boolean
  displayOrder: number
  /** Familias ruteadas AQUÍ. Hoy cero en toda la base: ver `hayQuePintarQuePrepara`. */
  familias: { id: string; nombre: string }[]
  laMiran: LaTabletQueMira[]
  // ── El Pase, sólo en las de salida ──────────────────────────────────────
  paseActivo: boolean
  paseCuando: string | null
  paseDesde: string | null
  paseQuien: string | null
  paseMotivo: string | null
}

export interface LaCocina {
  locationId: string
  local: string
  estaciones: LaEstacion[]
  /**
   * 🔴 TABLETS DE ESTE LOCAL SIN ESTACIÓN, y sólo las ACTIVAS.
   *
   * Regla 39: un aviso sale donde se puede arreglar, o no sale. Una tablet de
   * Carabanchel no se arregla desde la página de Alcalá, así que el aviso vive
   * en la página de SU local y en ninguna otra — si no, saldría en los tres por
   * igual y enseñaría a ignorar los avisos.
   *
   * Y sólo activas: medido hoy, «Tablet J» de Plaza Castilla lleva 57 días
   * desactivada y sin señal. Una tablet apagada sin estación no es un problema
   * de configuración: es una tablet apagada. Avisarlo es ruido que además no se
   * puede quitar.
   */
  tabletsSinEstacion: LaTabletQueMira[]
  /**
   * TODAS las tablets activas del local, con las estaciones que miran.
   *
   * 🔴 Hace falta porque la página sustituye también a «Dispositivos», y esa
   * pestaña no sólo listaba: daba de alta una tablet con su token, enseñaba el
   * QR para vincularla, copiaba la URL y la revocaba. Retirarla sin esto dejaba
   * la cuenta SIN NINGUNA FORMA de dar de alta una tablet --el 13/08 otra vez:
   * una retirada que se lleva por delante algo que se usa--.
   */
  tablets: LaTabletQueMira[]
}

/**
 * ¿SE PINTA EL BLOQUE «QUÉ PREPARA»? Sólo con DOS O MÁS estaciones de
 * preparación.
 *
 * 🔴 Medido el 15/09: `kitchen_family_route` tiene CERO filas en toda la base y
 * cero inserts en toda su vida, y cada uno de los 7 locales tiene EXACTAMENTE
 * UNA estación de preparación, que además es la de por defecto.
 *
 * O sea que el ruteo no está sin configurar: no hay nada que rutear. Rutear
 * familias es decidir si las hamburguesas van a Plancha o a Fríos, y aquí no
 * hay Plancha ni Fríos — hay una cocina. Con una sola estación, todo va ahí por
 * definición.
 *
 * Enseñar entonces una lista vacía con un «+ familia» invita a configurar algo
 * que no puede hacer nada, y hace creer que falta trabajo por hacer. Peor que
 * no enseñarlo.
 */
export function hayQuePintarQuePrepara(estaciones: LaEstacion[]): boolean {
  return estaciones.filter(e => e.isActive && e.kind === 'prep').length >= 2
}

/** Lo que dice la fila cuando no hay bloque de familias que enseñar. */
export function porQueNoHayFamilias(e: LaEstacion, unaSolaPrep: boolean): string | null {
  if (e.kind === 'expo') return 'Nada. Es la estación de salida: recibe lo que ya está hecho.'
  if (unaSolaPrep) return 'Se cocina todo aquí: es la única estación de preparación.'
  return null
}

function minutosDesde(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((Date.now() - t) / 60_000))
}

interface FilaEstacion {
  id: string; name: string; kind: string; is_default: boolean; is_active: boolean
  display_order: number | null
  pase_activo?: boolean; pase_activo_at?: string | null
  pase_activo_desde?: string | null; pase_activo_por?: string | null
  pase_apagado_motivo?: string | null
}
interface FilaTablet {
  id: string; label: string; is_active: boolean
  last_seen_at: string | null; station_ids: string[] | null
}

export async function getLaCocina(accountId: string, locationId: string): Promise<LaCocina> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')

  const [est, dev, loc, rutas, paquetes] = await Promise.all([
    supabase.from('kitchen_station').select('*')
      .eq('account_id', accountId).eq('location_id', locationId)
      .order('display_order', { ascending: true }).order('name', { ascending: true }),
    supabase.from('kds_device').select('id, label, is_active, last_seen_at, station_ids')
      .eq('account_id', accountId).eq('location_id', locationId),
    supabase.from('locations').select('name').eq('id', locationId).single(),
    // 🔴 La familia vive en `recipe_family`, no en una tabla «dish_family»:
    // comprobado contra la clave ajena `kitchen_family_route_family_id_fkey`.
    // Escribí el nombre de memoria y `tsc` no lo habría cazado --es una cadena--;
    // lo habría cazado la pantalla en blanco el día que alguien rutee algo.
    supabase.from('kitchen_family_route').select('station_id, family_id, recipe_family(id, name)')
      .eq('account_id', accountId),
    // Best-effort, como en la pantalla que sustituye: si la RPC no contesta,
    // la página sigue entera y sólo falta esta línea. Un fallo aquí no puede
    // tumbar la configuración de la cocina.
    listDeviceBundleStatus(locationId).catch(() => []),
  ])
  if (est.error) throw new Error(`La cocina · estaciones: ${est.error.message}`)
  if (dev.error) throw new Error(`La cocina · tablets: ${dev.error.message}`)

  const filas = (est.data ?? []) as unknown as FilaEstacion[]
  const tablets = (dev.data ?? []) as unknown as FilaTablet[]
  type FilaRuta = { station_id: string; family_id: string; recipe_family: { id: string; name: string } | null }
  const porEstacion = new Map<string, { id: string; nombre: string }[]>()
  for (const r of ((rutas.data ?? []) as unknown as FilaRuta[])) {
    const lista = porEstacion.get(r.station_id) ?? []
    lista.push({ id: r.family_id, nombre: r.recipe_family?.name ?? 'Familia sin nombre' })
    porEstacion.set(r.station_id, lista)
  }

  const porAparato = new Map((paquetes ?? []).map(b => [b.deviceId, b]))

  const comoTablet = (d: FilaTablet): LaTabletQueMira => {
    const b = porAparato.get(d.id)
    return {
      id: d.id, label: d.label, activa: d.is_active, vistoHaceMin: minutosDesde(d.last_seen_at),
      estacionIds: d.station_ids ?? [],
      paquete: b ? loQueLeeLaOficina(b) : null,
    }
  }

  const estaciones: LaEstacion[] = filas.map(f => ({
    id: f.id,
    name: f.name,
    kind: (f.kind === 'expo' ? 'expo' : 'prep'),
    isDefault: Boolean(f.is_default),
    isActive: Boolean(f.is_active),
    displayOrder: f.display_order ?? 0,
    familias: porEstacion.get(f.id) ?? [],
    laMiran: tablets.filter(d => (d.station_ids ?? []).includes(f.id)).map(comoTablet),
    paseActivo: Boolean(f.pase_activo),
    paseCuando: f.pase_activo_at ?? null,
    paseDesde: f.pase_activo_desde ?? null,
    paseQuien: f.pase_activo_por ?? null,
    paseMotivo: f.pase_apagado_motivo ?? null,
  }))

  return {
    locationId,
    local: (loc.data as { name: string } | null)?.name ?? 'este local',
    estaciones,
    tabletsSinEstacion: tablets
      .filter(d => d.is_active && (d.station_ids ?? []).length === 0)
      .map(comoTablet),
    tablets: tablets.filter(d => d.is_active).map(comoTablet),
  }
}
