// src/modules/conta/bancos/leerFicheroCuadro.ts
//
// S01e · Leer el fichero de un cuadro (Excel del banco o PDF): lo comparten
// «Subir el cuadro» de la lista y «Subir un cuadro nuevo» de la ficha. Nada se
// guarda: devuelve lo leído para revisar.

import { leerCuadro, type FilaCuadro } from '@/modules/conta/lib/contratos'
import { leerCuadroPdf } from '@/modules/conta/services/contratosService'
import { abrirExtracto } from '@/modules/conta/services/bancosService'

export interface Leido {
  fichero: string; tipoDoc: 'excel' | 'pdf'; cuadro: FilaCuadro[]
  /** Del PDF: lo que dice el documento (lo aplazado, si es un aplazamiento y de quién). */
  importeCent?: number | null; tipo?: 'prestamo' | 'aplazamiento'; organismo?: string | null
  /** S01d-b · Del PDF: las cuotas que dice el texto y la deuda pendiente al final del cuadro (cuadro parcial). */
  cuotas?: number; pendienteCent?: number | null
  /** El fichero, para «Ver el PDF» sin volver a bajarlo. */
  url?: string
}

/** Lee el Excel (con el lector del extracto) o el PDF (ocr-albaran, modo cuadro). Lanza un error con la frase para la pantalla. */
export async function leerFicheroCuadro(accountId: string, f: File): Promise<Leido> {
  if (/\.pdf$/i.test(f.name)) {
    const c = await leerCuadroPdf(accountId, f)
    return { fichero: f.name, tipoDoc: 'pdf', cuadro: c.cuadro, importeCent: c.importeCent, tipo: c.tipo, organismo: c.organismo, cuotas: c.cuotas, pendienteCent: c.pendienteCent, url: URL.createObjectURL(f) }
  }
  const a = await abrirExtracto(f)
  if (!('filas' in a.contenido)) throw new Error('Esto no es un Excel: el cuadro va en .xlsx o .xls.')
  const r = leerCuadro(a.contenido.filas)
  if ('error' in r) throw new Error(r.error)
  return { fichero: f.name, tipoDoc: 'excel', cuadro: r.cuadro }
}
