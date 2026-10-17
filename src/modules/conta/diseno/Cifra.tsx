// src/modules/conta/diseno/Cifra.tsx
//
// S01 · Un importe, siempre en cifras tabulares (las columnas cuadran a ojo) y
// escrito como en las maquetas: «1.240,50 €», con el menos de verdad («−121,00
// €»). `null` no es cero: sale «—» o lo que diga `vacio`. Con `lado` se
// escribe como en el nivel experto («438,99 D», «482,89 H»).

import { textoCifra } from './valores'

export function Cifra({ valor, exacta, lado, vacio, fuerte = false, grande = false }: {
  valor: number | null
  /** Con céntimos siempre (por defecto) o sin ellos si es redondo (la bandeja). */
  exacta?: boolean
  lado?: 'D' | 'H'
  vacio?: string
  fuerte?: boolean
  /** La cifra grande de una tarjeta de la bandeja. */
  grande?: boolean
}) {
  const clase = ['s-cifra', fuerte ? 's-cifra-fuerte' : '', grande ? 's-cifra-grande' : ''].filter(Boolean).join(' ')
  return <span className={clase}>{textoCifra(valor, { exacta, lado, vacio })}</span>
}
