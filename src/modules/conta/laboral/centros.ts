// src/modules/conta/laboral/centros.ts
//
// LS1 (28/10/2026) · Las cuentas de la pantalla de Centros, aparte para
// probarlas sin pintar nada.

import type { Location } from '@/types'

export const RADIO_POR_DEFECTO = 200

export interface Borrador {
  id: string | null
  nombre: string
  direccion: string
  lat: string
  lng: string
  radio: string
}

export const VACIO: Borrador = { id: null, nombre: '', direccion: '', lat: '', lng: '', radio: String(RADIO_POR_DEFECTO) }

export function deCentro(c: Location): Borrador {
  return {
    id: c.id, nombre: c.name, direccion: c.address ?? '',
    lat: c.lat != null ? String(c.lat) : '', lng: c.lng != null ? String(c.lng) : '',
    radio: String(c.clockRadiusM ?? RADIO_POR_DEFECTO),
  }
}

/** Un número con coma o punto; vacío es «sin dato». */
export function numero(t: string): number | null {
  const s = t.trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/** Lo que falla del borrador, en palabras; null si se puede guardar. */
export function errorDeCentro(b: Borrador): string | null {
  if (!b.nombre.trim()) return 'Ponle un nombre al centro.'
  const lat = numero(b.lat), lng = numero(b.lng), radio = numero(b.radio)
  if ((lat == null) !== (lng == null)) return 'La ubicación necesita las dos coordenadas, o ninguna.'
  if (lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) return 'La latitud va de −90 a 90.'
  if (lng != null && (Number.isNaN(lng) || lng < -180 || lng > 180)) return 'La longitud va de −180 a 180.'
  if (radio == null || Number.isNaN(radio) || radio < 20 || radio > 5000) return 'El radio va de 20 a 5.000 metros.'
  return null
}
