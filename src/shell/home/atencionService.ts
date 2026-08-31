// src/shell/home/atencionService.ts
//
// LA FRANJA DE LO QUE PIDE ATENCIÓN — Inicio P1 · sub-lote 2 (31/08/2026).
//
// Del encargo, literal: «Franja de estado única arriba (v0: las fuentes que ya
// existen — conteos sin cerrar, tablets mudas, cuadrantes sin publicar; una
// franja, no cinco banners)».
//
// NO ES la otra franja. En el Inicio hay dos, y son cosas distintas:
//   · la de PROCEDENCIA (alcance, frescura, de dónde sale el mosaico) — siempre
//     visible, porque un mosaico sin decir de qué local y de cuándo es no vale.
//   · ÉSTA, la de ATENCIÓN — solo cuando hay algo que hacer.
//
// LAS TRES REGLAS, y por qué cada una:
//
//   1. SOLO APARECE CUANDO HAY ALGO. Si no hay nada, no ocupa sitio y NO dice
//      «todo bien»: el silencio es el estado normal. Un «todo correcto» diario
//      es ruido que enseña a no mirar la franja, y el día que diga algo tampoco
//      se mirará.
//
//   2. CADA AVISO LLEVA SU ENLACE al sitio donde se resuelve, y el texto nombra
//      la fila concreta (el código del conteo, la tablet, la semana). Un aviso
//      que dice «hay conteos sin cerrar» y te deja buscándolos es media ayuda.
//
//   3. REGLA 7: si hay cinco cosas, dice CINCO. Nunca «y 3 más». La franja
//      ordena y etiqueta; no decide la existencia de una fila.
//
// Nada aquí inventa una fuente: las tres tablas existen y están pobladas.

import { supabase, isSupabaseEnabled } from '../../lib/supabase'

export type TipoAviso = 'conteo' | 'tablet' | 'cuadrante'

export interface AvisoAtencion {
  id: string
  tipo: TipoAviso
  /** Lo que se lee en la franja. Nombra la fila concreta, no el montón. */
  texto: string
  /** Dónde se resuelve. Ruta absoluta del Shell. */
  ruta: string
}

type Row = Record<string, unknown>

// Un conteo está «sin cerrar» mientras no se apruebe ni se anule. Los estados
// vivos de la casa son `contando` y `en_revision`; `aprobado` y `anulado` son
// finales. No se listan por `closed_at` porque un conteo cerrado y sin aprobar
// sigue pidiendo atención — es justo el caso que se quiere ver.
const ESTADOS_CONTEO_VIVO = ['contando', 'en_revision']

// Una tablet lleva «muda» si no late desde hace más de un DÍA.
//
// El umbral no es fino a propósito. Con dos horas, la franja gritaría cada
// mañana: los locales cierran a la 01:00 y ninguna tablet late hasta que
// vuelven a abrir, así que todas serían «mudas» todos los días. Eso enseña a
// ignorar la franja, que es peor que no tenerla. Un día entero no lo cruza
// ningún cierre normal, y sí caza el caso que esto viene a evitar: la tablet
// que estuvo TRES DÍAS invisible en agosto con el heartbeat devolviendo 200.
const HORAS_SIN_LATIDO = 24

function haceCuanto(iso: string | null): string {
  if (!iso) return 'nunca'
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (dias >= 1) return `${dias} ${dias === 1 ? 'día' : 'días'}`
  const horas = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  return `${horas} h`
}

/** Lunes de la semana de `d`, en ISO corto. */
export function lunesDe(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7          // 0 = lunes
  x.setDate(x.getDate() - dow)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/**
 * Lo que pide atención ahora mismo. Lista COMPLETA, sin recortar.
 *
 * `locationId` null = todos los locales: entonces cada aviso dice de qué local
 * es, porque si no la franja sería un montón de avisos sin dueño.
 *
 * Si una fuente falla, se devuelven las otras y se anota en consola: media
 * franja es mejor que ninguna, y desde luego mejor que una franja vacía que
 * parezca «no hay nada».
 */
export async function getAvisosAtencion(
  accountId: string | null,
  locationId: string | null,
): Promise<AvisoAtencion[]> {
  if (!isSupabaseEnabled || !supabase || !accountId) return []
  const sb = supabase
  const avisos: AvisoAtencion[] = []

  const semanaActual = lunesDe(new Date())
  const semanaSiguiente = lunesDe(new Date(Date.now() + 7 * 86_400_000))
  const corteLatido = new Date(Date.now() - HORAS_SIN_LATIDO * 3_600_000).toISOString()

  // Los locales primero: dan el nombre para los avisos Y acotan `schedules`,
  // cuyo `account_id` existe en la tabla pero no en los tipos generados. Acotar
  // por los locales de la cuenta es además más preciso: es el mismo alcance,
  // expresado por donde el dato ya está relacionado.
  const locales = await sb.from('locations').select('id, name').eq('account_id', accountId)
  if (locales.error) { console.error('[atencion] locales', locales.error); return [] }
  const nombreLocal = new Map<string, string>(
    (((locales.data as Row[] | null) ?? [])).map(l => [l.id as string, l.name as string]),
  )
  const idsLocales = [...nombreLocal.keys()]
  if (idsLocales.length === 0) return []

  const [conteos, tablets, cuadrantes] = await Promise.all([
    sb.from('inventory_count').select('id, code, status, location_id, started_at')
      .eq('account_id', accountId).in('status', ESTADOS_CONTEO_VIVO),
    // Solo dispositivos ACTIVOS: uno dado de baja a propósito no es una tablet
    // muda, es una tablet retirada. Alarmar por él sería ruido permanente.
    sb.from('kds_device').select('id, label, location_id, last_seen_at, is_active')
      .eq('account_id', accountId).eq('is_active', true),
    sb.from('schedules').select('id, week_start, status, location_id')
      .eq('status', 'draft')
      .in('location_id', idsLocales)
      .in('week_start', [semanaActual, semanaSiguiente]),
  ])
  const enAlcance = (loc: unknown) => locationId == null || loc === locationId
  const deQuien = (loc: unknown) =>
    locationId != null ? '' : ` · ${nombreLocal.get(loc as string) ?? 'sin local'}`

  if (conteos.error) console.error('[atencion] conteos', conteos.error)
  else for (const c of ((conteos.data as Row[] | null) ?? [])) {
    if (!enAlcance(c.location_id)) continue
    avisos.push({
      id: `conteo:${c.id}`,
      tipo: 'conteo',
      texto: `Conteo ${(c.code as string) ?? ''} sin cerrar${deQuien(c.location_id)}`,
      ruta: '/supply/inventario',
    })
  }

  if (tablets.error) console.error('[atencion] tablets', tablets.error)
  else for (const d of ((tablets.data as Row[] | null) ?? [])) {
    if (!enAlcance(d.location_id)) continue
    const visto = (d.last_seen_at as string | null) ?? null
    if (visto !== null && visto > corteLatido) continue
    avisos.push({
      id: `tablet:${d.id}`,
      tipo: 'tablet',
      texto: `La tablet «${(d.label as string) ?? 'sin nombre'}» lleva ${haceCuanto(visto)} sin dar señal${deQuien(d.location_id)}`,
      ruta: '/orders/ajustes',
    })
  }

  if (cuadrantes.error) console.error('[atencion] cuadrantes', cuadrantes.error)
  else for (const s of ((cuadrantes.data as Row[] | null) ?? [])) {
    if (!enAlcance(s.location_id)) continue
    const esta = s.week_start === semanaActual
    avisos.push({
      id: `cuadrante:${s.id}`,
      tipo: 'cuadrante',
      texto: `Cuadrante de ${esta ? 'esta semana' : 'la semana que viene'} sin publicar${deQuien(s.location_id)}`,
      // El enlace va YA FILTRADO a la semana del aviso.
      ruta: `/personal/calendario?semana=${s.week_start as string}`,
    })
  }

  return avisos
}
