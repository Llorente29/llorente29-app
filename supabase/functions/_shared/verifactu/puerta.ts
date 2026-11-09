// supabase/functions/_shared/verifactu/puerta.ts
//
// V03 · E1 · LA PUERTA DE conta-verifactu: qué entorno deja enviar, o por qué
// está cerrada. Cerrada si no se dice otra cosa. Pruebas, nunca desde la base
// de producción; real, solo desde ella (respuesta 1 de Julio: «producción solo
// lectura hasta que pase una empresa a real; las pruebas, desde staging»).
//
// G05 · T3 (09/11): LA EXCEPCIÓN DE LAS DEMOS. La Gestoría Demo vive en
// producción (respuesta de Julio, nº 23): desde ella, las pruebas sí, pero
// SOLO para las cuentas de demostración. Se abre con las dos cosas: la
// llamada pide «pruebas» (la despierta verifactu_despertar_demos) y Julio ha
// puesto CONTA_VERIFACTU_DEMOS = pruebas. Entonces `soloDemos`: cada lote pasa
// por salirA (_shared/puertaDePruebas.ts) y el de una cuenta de verdad no sale.

import type { Entorno } from './enviar.ts'

export const PRODUCCION_REF = 'xzmpnchlguibclvxyynt'

export type Puerta = { entorno: Entorno; soloDemos?: true } | { cerrada: string }

/**
 * `valor`: CONTA_VERIFACTU. `pedido`: el entorno que pide la llamada (solo
 * cuenta «pruebas»). `demos`: CONTA_VERIFACTU_DEMOS.
 */
export function puerta(valor: string | undefined, supabaseUrl: string, pedido?: string, demos?: string): Puerta {
  const prod = supabaseUrl.includes(PRODUCCION_REF)
  if (prod && pedido === 'pruebas') {
    return demos === 'pruebas' ? { entorno: 'pruebas', soloDemos: true } : { cerrada: 'las pruebas de las demos desde producción están apagadas (CONTA_VERIFACTU_DEMOS sin poner)' }
  }
  if (valor === 'pruebas') return prod ? { cerrada: 'pruebas no se envía desde la base de producción' } : { entorno: 'pruebas' }
  if (valor === 'real') return prod ? { entorno: 'real' } : { cerrada: 'real solo se envía desde la base de producción' }
  return { cerrada: 'CONTA_VERIFACTU sin poner' }
}
