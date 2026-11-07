// src/modules/conta/alta/sectorDelAlta.ts
//
// G03 · El sector que se propone en el alta, cuando se vuelve a entrar a
// medias: el que quedó guardado en la empresa (lo puso el alta al confirmar la
// actividad) y, si es gestoría, si iba con duda (por los códigos de sus
// actividades). Puro.

import { esSector, gestoriaPorCodigos, type Propuesta } from '@/modules/conta/sectores/sectores'

export function propuestaGuardada(sector: unknown, hosteleria: boolean | null, actividades: readonly { iaeCode: string | null; cnaeCode: string | null; endedOn: string | null }[]): Propuesta {
  const s = esSector(sector) ? sector : hosteleria ? 'hosteleria' : 'general'
  const vivas = actividades.filter((a) => a.endedOn === null).map((a) => gestoriaPorCodigos(a.iaeCode, a.cnaeCode))
  return { sector: s, duda: s === 'gestoria' && vivas.length > 0 && !vivas.includes('si') && vivas.includes('duda') }
}
