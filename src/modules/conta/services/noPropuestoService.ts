// src/modules/conta/services/noPropuestoService.ts
//
// S01 · PR 3 · Lo que no se ha podido proponer solo, de un apartado
// (conta_propuesta_pendiente, de la 0753). Filtrado por empresa (regla 9).

import { tabla, mensaje } from '@/modules/conta/services/bd'
import type { Donde, NoPropuesto } from '@/modules/conta/lib/noPropuesto'

export async function leerNoPropuesto(companyId: string, donde: Donde): Promise<NoPropuesto[]> {
  const { data, error } = await tabla('conta_propuesta_pendiente').select('id, origen, que, porque, at')
    .eq('company_id', companyId).eq('donde', donde).order('at', { ascending: false })
  // El front antes que la base (la 0753 sin aplicar): no hay nada que enseñar, y no es un fallo.
  if (error && /does not exist|could not find|relation/i.test(error.message)) return []
  if (error) throw new Error(mensaje('No se ha podido leer lo que no se ha propuesto', error))
  return ((data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), origen: String(x.origen), que: String(x.que), porque: String(x.porque), at: String(x.at),
  }))
}
