// src/modules/reparto/lib/resolucion.ts
//
// R02 · Quién reparte, por marca × plataforma. La MISMA resolución que
// `public.resolve_delivery_by` (supabase/migrations/20261005T0100), escrita en
// TypeScript para pintar la pantalla sin una llamada por celda. El orden es el
// de la base y no se toca aquí sin tocarlo allí:
//   1. celda de la marca en ese local
//   2. celda de la marca para todos los locales (UUID cero)
//   3. herencia por tipo de marca en ese local
//   4. herencia por tipo de marca de la cuenta
//   5. «Plataforma» (nadie ha dicho nada)
//
// Funciones puras: sin Supabase, sin React. Las prueba
// tests/unit/modules/reparto/resolucion.test.ts.

export type QuienReparte = 'platform' | 'own'
/** Lo que se GUARDA en una celda (respuesta 1 de Julio, punto 7). */
export type OrigenGuardado = 'manual' | 'migrated' | 'ai_accepted'
/** Lo que DEVUELVE la resolución: lo guardado, o de dónde se dedujo. */
export type Origen = OrigenGuardado | 'inherited' | 'default'
export type TipoDeMarca = 'own' | 'licensed'

export const TODOS_LOS_LOCALES = '00000000-0000-0000-0000-000000000000'

export interface Celda {
  brandId: string
  channelSlug: string
  /** TODOS_LOS_LOCALES para la fila de la marca. */
  locationId: string
  deliveryBy: QuienReparte
  source: OrigenGuardado
  decidedAt: string | null
  decidedByName: string | null
}

export interface Herencia {
  channelSlug: string
  ownershipType: TipoDeMarca
  /** null = toda la cuenta. */
  locationId: string | null
  deliveryBy: QuienReparte
}

export type Nivel = 'local' | 'marca' | 'herencia_local' | 'herencia_cuenta' | 'defecto'

export interface Resolucion {
  deliveryBy: QuienReparte
  source: Origen
  nivel: Nivel
  /** La celda guardada que manda, si la hay. */
  celda: Celda | null
}

export function serviceTypeDe(deliveryBy: QuienReparte): 'own_delivery' | 'platform_delivery' {
  return deliveryBy === 'own' ? 'own_delivery' : 'platform_delivery'
}

export function quienDeServiceType(st: string | null | undefined): QuienReparte | null {
  if (st === 'own_delivery') return 'own'
  if (st === 'platform_delivery') return 'platform'
  return null
}

/** La herencia («Si no dices nada») que aplica a un tipo de marca en un canal y local. */
export function resolverHerencia(
  herencias: Herencia[], tipo: TipoDeMarca, channelSlug: string, locationId: string | null,
): { deliveryBy: QuienReparte; nivel: Nivel; source: Origen } {
  if (locationId) {
    const delLocal = herencias.find(h =>
      h.channelSlug === channelSlug && h.ownershipType === tipo && h.locationId === locationId)
    if (delLocal) return { deliveryBy: delLocal.deliveryBy, nivel: 'herencia_local', source: 'inherited' }
  }
  const deCuenta = herencias.find(h =>
    h.channelSlug === channelSlug && h.ownershipType === tipo && h.locationId === null)
  if (deCuenta) return { deliveryBy: deCuenta.deliveryBy, nivel: 'herencia_cuenta', source: 'inherited' }
  return { deliveryBy: 'platform', nivel: 'defecto', source: 'default' }
}

export function resolver(
  celdas: Celda[],
  herencias: Herencia[],
  marca: { id: string; ownershipType: TipoDeMarca | null },
  channelSlug: string,
  locationId: string | null,
): Resolucion {
  const deEsta = celdas.filter(c => c.brandId === marca.id && c.channelSlug === channelSlug)
  if (locationId && locationId !== TODOS_LOS_LOCALES) {
    const delLocal = deEsta.find(c => c.locationId === locationId)
    if (delLocal) return { deliveryBy: delLocal.deliveryBy, source: delLocal.source, nivel: 'local', celda: delLocal }
  }
  const deMarca = deEsta.find(c => c.locationId === TODOS_LOS_LOCALES)
  if (deMarca) return { deliveryBy: deMarca.deliveryBy, source: deMarca.source, nivel: 'marca', celda: deMarca }
  // Una marca sin tipo no hereda nada (en la base, el JOIN con la marca no
  // encuentra tipo): va a «Plataforma».
  if (!marca.ownershipType) return { deliveryBy: 'platform', source: 'default', nivel: 'defecto', celda: null }
  const h = resolverHerencia(herencias, marca.ownershipType, channelSlug,
    locationId && locationId !== TODOS_LOS_LOCALES ? locationId : null)
  return { ...h, celda: null }
}

/** ¿La decidió una persona (o la migración)? Para pintar «azul relleno» o «hereda». */
export function esDecidida(r: Resolucion): boolean {
  return r.nivel === 'local' || r.nivel === 'marca'
}

/**
 * Locales donde una marca × plataforma se separa de lo que dice la fila de la
 * marca. La pantalla despliega «por local» solo si hay alguno (o si la persona
 * lo abre).
 */
export function localesQueSeSeparan(
  celdas: Celda[], brandId: string, channelSlug: string,
): string[] {
  return celdas
    .filter(c => c.brandId === brandId && c.channelSlug === channelSlug && c.locationId !== TODOS_LOS_LOCALES)
    .map(c => c.locationId)
}
