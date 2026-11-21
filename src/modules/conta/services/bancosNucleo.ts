// src/modules/conta/services/bancosNucleo.ts
//
// B01 · Bancos en la app. El núcleo (importar, el motor sobre lo pendiente,
// confirmar y deshacer) vive en supabase/functions/_shared/bancos/nucleo.ts
// desde la B01·21, para que la lectura de cada noche proponga sola. Aquí se
// queda lo que solo hace la app: leer un fichero (Norma 43, Excel o CSV).

import { cuadrar, resumenLectura, type Cuadre, type ExtractoLeido } from '@/modules/conta/lib/extractoBanco'
import { leerFicheroBanco, type ContenidoFichero } from '@/modules/conta/lib/fuentesBanco'
import { partirCsv } from '@/modules/conta/lib/importarPlan'
import type { BancoCsv } from '@/modules/conta/lib/lectorCsvBanco'

export * from '../../../../supabase/functions/_shared/bancos/nucleo.ts'

export interface ExtractoAbierto { nombre: string; sha256: string; contenido: ContenidoFichero }

export function leerYCuadrar(a: ExtractoAbierto, banco?: BancoCsv): { extracto: ExtractoLeido; cuadre: Cuadre; resumen: string } {
  const extracto = leerFicheroBanco(a.contenido, partirCsv, banco)
  const cuadre = cuadrar(extracto)
  return { extracto, cuadre, resumen: resumenLectura(extracto, cuadre) }
}
