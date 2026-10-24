// src/modules/conta/lib/numeroEnDiez.ts
//
// M01 · El número en Diez de cada asiento, para su columna del libro diario
// (encargo F01, tarea 4). Dos sitios de donde sale, y lo demás lo dice:
//   · lo que se mandó a Diez y llegó (external_send enviado o enlazado, con
//     su número): las ventas de una plataforma;
//   · lo que se trajo de Diez (journal_entry.external_program «diez»), con el
//     número que tenía allí.
// La serie solo se dice si no es la 1, como numerosFolvyDiez («2/45»; «1.803»
// a secas). Sin número, «—», y el porqué en el title: nunca un hueco mudo.

import type { ConDiez } from '@/modules/conta/lib/conDiez'
import { miles } from '@/modules/conta/ui/tabla/tablaDensa'

export interface NumeroDiez {
  /** Lo que va en la celda: «1.803», «2/45» o «—». */
  texto: string
  /** El porqué, entero (title y lector). */
  explicacion: string
  /** Para exportar y para buscar: el número tal cual, o null. */
  valor: string | null
}

const conSerie = (serie: string | null, numero: string): string => `${serie && serie !== '1' ? `${serie}/` : ''}${numero}`
const numeroBonito = (n: string): string => (/^\d+$/.test(n) ? miles(Number(n)) : n)

// C07: el envío de cualquier asiento (no solo el de una venta de plataforma).
export function numeroEnDiez(a: { estado: string; traido: { programa: string; serie: string | null; numero: string | null } | null }, d?: Pick<ConDiez, 'envio'> | { envio: { status: string; serie: string | null; numero: number | null } | null } | null): NumeroDiez {
  const e = d?.envio
  if (e && (e.status === 'enviado' || e.status === 'enlazado') && e.numero != null) {
    const n = String(e.numero)
    return { texto: conSerie(e.serie, numeroBonito(n)), explicacion: `En Diez: serie ${e.serie ?? '1'}, nº ${numeroBonito(n)}`, valor: conSerie(e.serie, n) }
  }
  if (a.traido && /diez/i.test(a.traido.programa)) {
    if (a.traido.numero) {
      return { texto: conSerie(a.traido.serie, numeroBonito(a.traido.numero)), explicacion: `Traído de Diez: ${a.traido.serie ? `serie ${a.traido.serie}, ` : ''}nº ${a.traido.numero}`, valor: conSerie(a.traido.serie, a.traido.numero) }
    }
    return { texto: '—', explicacion: 'Traído de Diez sin su número de allí', valor: null }
  }
  if (d) {
    if (a.estado === 'propuesto' || a.estado === 'borrador') return { texto: '—', explicacion: 'Aún sin validar: se manda a Diez al validarlo', valor: null }
    return { texto: '—', explicacion: 'Aún no está en Diez', valor: null }
  }
  return { texto: '—', explicacion: 'No tiene número en Diez', valor: null }
}
