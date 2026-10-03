// src/modules/conta/services/codigoPostalService.ts
//
// Las poblaciones de un código postal, de la tabla de serie `postal_code_place`
// (respuesta 4 del C00, arreglo 3). Catálogo global, sin account_id: se lee
// por código a propósito (regla 9, excepción). Sale de GeoNames (CC BY 4.0),
// descargado por GitHub Actions; nada en vivo.
//
// Nombres de la base entre comillas (regla 40): postal_code_place y sus
// columnas postal_code, ord, place_name, municipality, province (migración
// 20261003T0210).

import { tabla, mensaje } from '@/modules/conta/services/bd'
import type { LugarCp } from '@/modules/conta/lib/codigoPostal'

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

export async function lugaresPorCp(cp: string): Promise<LugarCp[]> {
  if (!/^\d{5}$/.test(cp)) return []
  const { data, error } = await tabla('postal_code_place')
    .select('place_name, municipality, province').eq('postal_code', cp).order('ord')
  if (error) throw new Error(mensaje('No se han podido leer las poblaciones del código postal', error))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    poblacion: String(r.place_name), municipio: txt(r.municipality), provincia: txt(r.province),
  }))
}
