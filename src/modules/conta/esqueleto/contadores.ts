// src/modules/conta/esqueleto/contadores.ts
//
// I01c (Julio, 20/10, punto 6) · El contador de una pestaña de la cabecera:
// un número junto a su nombre, en rojo lo que vence (pide atención) y en gris
// lo que solo cuenta. La cabecera es común a todos los módulos; cada producto
// dice, si quiere, qué cuenta cada pestaña (useContadores.ts).
//
// Regla 7: un contador puede contar solo lo prioritario, pero no dice «0»: si
// no hay nada que contar, no sale.

export type TonoContador = 'falta' | 'neutro'

export interface Contador {
  n: number
  tono: TonoContador
  /** En palabras, para el lector de pantalla y el título: «2 vencen en 7 días o menos». */
  texto: string
}

export type Contadores = Partial<Record<string, Contador>>

/** Solo los que cuentan algo (n > 0). */
export function soloConAlgo(c: Contadores): Contadores {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v && v.n > 0))
}
