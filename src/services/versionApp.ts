// src/services/versionApp.ts
//
// EL AVISO DE VERSIÓN NUEVA.
//
// El problema que resuelve (RECON del 01/09): Folvy es una SPA. El documento se
// pide UNA vez, al abrir la pestaña; a partir de ahí se navega por rutas
// internas, que no son navegaciones del navegador. Nada vuelve a pedir
// index.html, así que nada lee los hashes nuevos de los assets. El JS viejo
// sigue vivo mientras la pestaña siga abierta.
//
// No era «la tablet no se actualiza»: era que NADA se actualiza hasta que
// alguien cierra la pestaña. La tablet de Cocina solo era el caso extremo,
// cinco días sin cerrarse.
//
// Cómo se sabe que hay algo nuevo: el build escribe `/version.json` con su
// buildId (ver build/folvyVersionPlugin.ts) y estampa ese mismo id como
// constante `__BUILD_ID__` dentro del bundle. Comparar las dos responde
// exactamente a la pregunta «¿lo que estoy ejecutando es lo que está
// publicado?», sin depender del service worker ni de ningún caché.

/** Id de la build que se está EJECUTANDO. Lo inyecta el plugin en `vite build`. */
declare const __BUILD_ID__: string | undefined

export interface VersionPublicada {
  buildId: string
  builtAt?: string
}

/** Lo que esta build sabe de sí misma. `null` en dev (no hay plugin). */
export function buildEnEjecucion(): string | null {
  try {
    return typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : null
  } catch {
    return null
  }
}

/**
 * ¿Hay versión nueva publicada?
 *
 * Falla CERRADO hacia el silencio, no hacia el aviso: si no se sabe qué build
 * se está ejecutando, o lo publicado no se pudo leer, la respuesta es `false`.
 * Un aviso de «hay versión nueva» que sale sin estar seguro enseña a ignorarlo,
 * y entonces no sirve el día que sea verdad.
 */
export function hayVersionNueva(
  enEjecucion: string | null,
  publicada: VersionPublicada | null,
): boolean {
  if (!enEjecucion) return false
  if (!publicada || !publicada.buildId) return false
  return publicada.buildId !== enEjecucion
}

/**
 * Lee /version.json saltándose el caché.
 *
 * `cache: 'no-store'` es lo que hace útil esto: sin él, el navegador podría
 * devolver la copia con la que se cargó la pestaña y el vigía nunca vería un
 * cambio — el mismo fallo que viene a detectar, un piso más abajo.
 */
export async function leeVersionPublicada(
  fetchImpl: typeof fetch = fetch,
): Promise<VersionPublicada | null> {
  try {
    const r = await fetchImpl('/version.json', { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as unknown
    if (!j || typeof j !== 'object') return null
    const buildId = (j as Record<string, unknown>).buildId
    if (typeof buildId !== 'string' || !buildId) return null
    const builtAt = (j as Record<string, unknown>).builtAt
    return { buildId, builtAt: typeof builtAt === 'string' ? builtAt : undefined }
  } catch {
    // Sin red, o /version.json todavía no desplegado (primer build con esto).
    // Silencio: ver el "falla cerrado" de arriba.
    return null
  }
}

/** Cada cuánto se pregunta. 5 min: barato y de sobra para un turno. */
export const INTERVALO_MS = 5 * 60 * 1000
