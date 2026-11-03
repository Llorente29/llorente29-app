// src/shell/version/novedades.ts
//
// NV1 (Julio, 03/11) · Qué cambia en cada versión, para el cartel de versión
// nueva y Ayuda › Novedades.
//
// De dónde sale: cada PR fusionado deja sus frases en novedades/pr-<n>.json;
// el build las publica en /novedades.json y sella en el bundle los ids de las
// que conoce (build/novedadesPlugin.ts). Así:
//   · las que trae la versión publicada y no la que se ejecuta = lo que el
//     cartel enseña (las 3 primeras, «y N más»);
//   · las de Sumied no salen en Folvy, ni al revés; las «comunes», en las dos.
//   · lo visto se recuerda por usuario (en sus datos de la sesión, así vale en
//     el ordenador y en el móvil); sin sesión, en este navegador.

import { supabase } from '@/lib/supabase'
import type { IdMarca } from '@/marca/marca'

declare const __NOVEDADES_IDS__: string[] | undefined

export type ProductoNovedad = 'sumied' | 'folvy' | 'comun'
export interface Novedad { id: string; pr: number; fecha: string; producto: ProductoNovedad; apartado: string; frase: string; ruta: string | null }

/** Los ids de las novedades que conoce la build que se está ejecutando. null en dev (sin plugin). */
export function novedadesConocidas(): string[] | null {
  try { return Array.isArray(__NOVEDADES_IDS__) ? __NOVEDADES_IDS__ : null } catch { return null }
}

/** De qué producto es una marca: Sumied (y la genérica de contabilidad) o Folvy. */
export const productoDeMarca = (id: IdMarca): 'sumied' | 'folvy' => (id === 'folvy' ? 'folvy' : 'sumied')

/** Las de este producto y las comunes, de lo más nuevo a lo más antiguo. */
export function deMiProducto(lista: readonly Novedad[], producto: 'sumied' | 'folvy'): Novedad[] {
  return lista.filter((n) => n.producto === producto || n.producto === 'comun')
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.pr - a.pr)
}

/** Lo que trae la versión publicada y no la que se ejecuta, de este producto. */
export function nuevasDeLaVersion(publicadas: readonly Novedad[], conocidas: readonly string[] | null, producto: 'sumied' | 'folvy'): Novedad[] {
  const ya = new Set(conocidas ?? [])
  return deMiProducto(publicadas, producto).filter((n) => !ya.has(n.id))
}

/** Las 3 primeras, y cuántas más. */
export function paraElCartel(nuevas: readonly Novedad[], cuantas = 3): { vistas: Novedad[]; mas: number } {
  return { vistas: nuevas.slice(0, cuantas), mas: Math.max(0, nuevas.length - cuantas) }
}

/** ¿Es nueva para quien la mira? Lo es si es posterior a lo último que vio (sin nada visto, todas). */
export const nuevaParaTi = (n: Novedad, vistasHasta: string | null): boolean => vistasHasta === null || n.fecha > vistasHasta

/** «3 nov 2026». */
export function fechaCorta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' }).replace('.', '')
}

/** Las novedades agrupadas por día (Madrid), de lo más nuevo a lo más antiguo. */
export function porDia(lista: readonly Novedad[]): { dia: string; fecha: string; novedades: Novedad[] }[] {
  const out: { dia: string; fecha: string; novedades: Novedad[] }[] = []
  for (const n of lista) {
    const dia = new Date(n.fecha).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })
    const g = out.find((x) => x.dia === dia)
    if (g) g.novedades.push(n)
    else out.push({ dia, fecha: n.fecha, novedades: [n] })
  }
  return out
}

/** Lo publicado. null si no se puede leer (sin red, o un build sin novedades). */
export async function leeNovedades(fetchImpl: typeof fetch = fetch): Promise<Novedad[] | null> {
  try {
    const r = await fetchImpl('/novedades.json', { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as unknown
    return Array.isArray(j) ? (j as Novedad[]).filter((n) => n && typeof n.id === 'string' && typeof n.frase === 'string') : null
  } catch {
    return null
  }
}

// ── Lo visto, por usuario ───────────────────────────────────────────────────

const CLAVE_LOCAL = 'novedades.vistas_hasta'
const CLAVE_USUARIO = 'novedades_vistas_hasta'

/** Hasta qué fecha ha visto las novedades quien está dentro (null: ninguna). */
export async function leeVistasHasta(): Promise<string | null> {
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
    const v = data.session?.user?.user_metadata?.[CLAVE_USUARIO]
    if (typeof v === 'string' && v) return v
  } catch { /* sin sesión: lo de este navegador */ }
  try { return window.localStorage.getItem(CLAVE_LOCAL) } catch { return null }
}

/** Ha visto hasta esta fecha (la de la más nueva que se le ha enseñado). Nunca hacia atrás. */
export async function marcaVistasHasta(fecha: string | null): Promise<void> {
  if (!fecha) return
  const antes = await leeVistasHasta()
  if (antes && antes >= fecha) return
  try { window.localStorage.setItem(CLAVE_LOCAL, fecha) } catch { /* sin almacenamiento */ }
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
    if (data.session) await supabase!.auth.updateUser({ data: { [CLAVE_USUARIO]: fecha } })
  } catch { /* sin red: queda en este navegador y se vuelve a intentar la próxima vez */ }
}

/** La más nueva de una lista (para marcar hasta ahí). */
export const masNueva = (lista: readonly Novedad[]): string | null => lista.reduce<string | null>((m, n) => (m === null || n.fecha > m ? n.fecha : m), null)
