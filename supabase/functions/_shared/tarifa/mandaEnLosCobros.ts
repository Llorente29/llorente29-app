// supabase/functions/_shared/tarifa/mandaEnLosCobros.ts
//
// G04 · Tarea 2 (08/11/2026). QUIÉN MANDA EN LOS COBROS, en un solo sitio
// (Julio, 08/11, pendiente de confirmar con QBO):
//   · Hasta el G05, manda GoCardless: «Cuotas al mes», «Este mes» de cada
//     cliente y «Próximo cobro» enseñan como cifra principal lo que cobra
//     GoCardless (suscripciones activas y su siguiente cobro). El cálculo de
//     Sumied sale al lado, como comparación («Sumied calcula X €»), y las
//     diferencias van a «Lo que tienes que hacer».
//   · Cuando llegue el G05 y Sumied facture, se invierte: manda Sumied. El
//     cambio es esta constante y nada más: ninguna pantalla decide por su
//     cuenta cuál va delante.
//
// Lo prueban tests/unit/modules/conta/gestoria/g04/mandaEnLosCobros.test.ts.

import { euros } from './precio.ts'

export type QuienManda = 'gocardless' | 'sumied'

/** Hasta el G05: GoCardless. Con el G05, «sumied». */
export const MANDA_EN_LOS_COBROS: QuienManda = 'gocardless'

const NOMBRE: Record<QuienManda, string> = { gocardless: 'GoCardless', sumied: 'Sumied' }

export interface CifraDeCobro {
  /** La cifra principal, la de quien manda. Null: quien manda no tiene dato (se dice, no se inventa). */
  principalCent: number | null
  de: QuienManda
  /** La del otro, al lado, como comparación. */
  comparacionCent: number | null
  deComparacion: QuienManda
  /** principal − comparación; null si falta alguna. */
  diferenciaCent: number | null
  /** «Sumied calcula 60,50 €» o «GoCardless cobra 60,50 €»; null si coinciden o falta la comparación. */
  alLado: string | null
}

/** Qué cifra va delante y cuál al lado, para una cuota, un mes o un próximo cobro. */
export function cifraDeCobro(v: { gocardlessCent: number | null; sumiedCent: number | null }, manda: QuienManda = MANDA_EN_LOS_COBROS): CifraDeCobro {
  const otro: QuienManda = manda === 'gocardless' ? 'sumied' : 'gocardless'
  const principalCent = manda === 'gocardless' ? v.gocardlessCent : v.sumiedCent
  const comparacionCent = manda === 'gocardless' ? v.sumiedCent : v.gocardlessCent
  const diferenciaCent = principalCent === null || comparacionCent === null ? null : principalCent - comparacionCent
  const alLado = comparacionCent === null || diferenciaCent === 0
    ? null
    : `${NOMBRE[otro]} ${otro === 'sumied' ? 'calcula' : 'cobra'} ${euros(comparacionCent)}`
  return { principalCent, de: manda, comparacionCent, deComparacion: otro, diferenciaCent, alLado }
}

export const nombreDeQuienManda = (q: QuienManda) => NOMBRE[q]
