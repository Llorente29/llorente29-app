// supabase/functions/_shared/puertaDePruebas.ts
//
// G05 · Tarea 3 (09/11/2026) · LA PUERTA DE LAS DEMOS HACIA LOS ENTORNOS DE
// PRUEBAS, en un solo sitio (Julio, nº 23: «una cuenta demo sale SOLO a
// entornos de pruebas —el sandbox de GoCardless, Hacienda de pruebas y un
// buzón de pruebas fijo— y nunca a uno real»). Completa la puerta del DM1
// (_shared/puerta.ts · cuentaPuedeSalir, que sigue diciendo si una cuenta es
// de demo): esta dice ADÓNDE puede salir cada una.
//
//   · Una cuenta de demo: solo al entorno de pruebas. Nunca al real.
//   · Una cuenta de verdad: a los dos, salvo donde se pide «solo demos en
//     pruebas» (Verifactu desde la base de producción: «jamás al de pruebas
//     desde una cuenta real», nº 23).
//   · El correo de una demo: solo al buzón de pruebas fijo (lo pone Julio en
//     CORREO_BUZON_PRUEBAS). Sin buzón, no sale, y se dice.
//
// Va en su fichero, y no dentro de puerta.ts, porque puerta.ts lo importan
// unas 50 funciones del servidor: cambiarlo obligaría a desplegarlas todas a
// mano sin que cambie nada en ellas. Puro: lo prueba
// tests/unit/demo/puertaDePruebas.test.ts.

export type EntornoDeSalida = 'pruebas' | 'real'

export type Salida = { sale: true } | { sale: false; porque: string }

export const DEMO_NUNCA_A_REAL = 'Una cuenta de demostración nunca sale a un entorno real: solo a los de pruebas.'
export const PRUEBAS_SOLO_DEMOS = 'Desde producción, al entorno de pruebas solo salen las cuentas de demostración.'
export const SIN_BUZON_DE_PRUEBAS = 'En la demo el correo solo va al buzón de pruebas, y no hay ninguno puesto: no se ha enviado.'

/**
 * ¿Puede salir esta cuenta a este entorno? `esDemo`: accounts.is_demo (lo dice
 * cuentaPuedeSalir). `soloDemosEnPruebas`: donde el entorno de pruebas es solo
 * para las demos (Verifactu desde producción).
 */
export function salirA(esDemo: boolean, entorno: EntornoDeSalida, soloDemosEnPruebas = false): Salida {
  if (esDemo) return entorno === 'pruebas' ? { sale: true } : { sale: false, porque: DEMO_NUNCA_A_REAL }
  if (entorno === 'pruebas' && soloDemosEnPruebas) return { sale: false, porque: PRUEBAS_SOLO_DEMOS }
  return { sale: true }
}

/** Adónde va un correo: el de verdad o, en una demo, el buzón de pruebas (si lo hay). */
export function correoDeSalida(esDemo: boolean, para: string, buzonDePruebas: string | null | undefined): { para: string } | { porque: string } {
  if (!esDemo) return { para }
  const b = (buzonDePruebas ?? '').trim()
  return b && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b) ? { para: b } : { porque: SIN_BUZON_DE_PRUEBAS }
}
