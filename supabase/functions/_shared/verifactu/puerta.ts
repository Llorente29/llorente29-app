// supabase/functions/_shared/verifactu/puerta.ts
//
// V03 · E1 · LA PUERTA DE conta-verifactu: qué entorno deja enviar, o por qué
// está cerrada. Cerrada si no se dice otra cosa. Pruebas, nunca desde la base
// de producción; real, solo desde ella (respuesta 1 de Julio: «producción solo
// lectura hasta que pase una empresa a real; las pruebas, desde staging»).

import type { Entorno } from './enviar.ts'

export const PRODUCCION_REF = 'xzmpnchlguibclvxyynt'

export function puerta(valor: string | undefined, supabaseUrl: string): { entorno: Entorno } | { cerrada: string } {
  const prod = supabaseUrl.includes(PRODUCCION_REF)
  if (valor === 'pruebas') return prod ? { cerrada: 'pruebas no se envía desde la base de producción' } : { entorno: 'pruebas' }
  if (valor === 'real') return prod ? { entorno: 'real' } : { cerrada: 'real solo se envía desde la base de producción' }
  return { cerrada: 'CONTA_VERIFACTU sin poner' }
}
