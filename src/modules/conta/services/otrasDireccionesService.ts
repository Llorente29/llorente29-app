// src/modules/conta/services/otrasDireccionesService.ts
//
// S01m · Las otras direcciones con las que las plataformas nombran a un local
// (location_address_alias, 0945). Se leen de la tabla (RLS: las de tus cuentas)
// y se guardan con conta_local_direcciones_guardar, que además vuelve a buscar
// la liquidación de las facturas de plataformas sin ligar y lo dice.
import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'

export async function leerOtrasDirecciones(locationIds: readonly string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>()
  const ids = locationIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x))
  if (!ids.length) return m
  const { data, error } = await tabla('location_address_alias').select('location_id, address').in('location_id', ids).order('created_at')
  if (error) throw new Error(mensaje('No se han podido leer las otras direcciones', error))
  for (const f of (data ?? []) as { location_id: string; address: string }[]) m.set(f.location_id, [...(m.get(f.location_id) ?? []), f.address])
  return m
}

export async function guardarOtrasDirecciones(locationId: string, direcciones: readonly string[], quien: string | null): Promise<string> {
  const r = await rpc<{ texto?: string }>('conta_local_direcciones_guardar', { p_location: locationId, p_direcciones: direcciones, p_quien_nombre: quien })
  return r?.texto ?? 'Guardadas.'
}

/** Las líneas que se escriben, sin vacías ni repetidas (sin mirar mayúsculas). */
export function direccionesDeTexto(texto: string): string[] {
  const vistas = new Set<string>()
  return texto.split('\n').map((x) => x.trim()).filter((x) => {
    const k = x.toLowerCase()
    if (!x || vistas.has(k)) return false
    vistas.add(k); return true
  })
}
