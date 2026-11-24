// src/modules/conta/nucleo/bancos/seleccion.ts
//
// R08 · Bancos: conciliar en un paso (maqueta nucleo_10_bancos_conciliar_en_un_paso), sin
// pantalla. Lo prueba tests/conta/r08-bancos.
//   · El estado, en una palabra: «Por conciliar», «Conciliado» o «Apartado».
//   · X28 · «Marcar varios» y «Conciliar los N» se quitan (respuesta X28 · 1, decisión 3): en Tesorería,
//     Intro contabiliza fila a fila.
//   · Los mensajes de la base, en palabras: sin el nombre de la función y sin «casar» ni «ignorado».

import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'

export type Palabra = 'Por conciliar' | 'Conciliado' | 'Apartado'

export function palabraDe(m: Pick<MovimientoBanco, 'estado'>): Palabra {
  if (m.estado === 'casado') return 'Conciliado'
  if (m.estado === 'ignorado') return 'Apartado'
  return 'Por conciliar'
}

/** Se puede conciliar a una cuenta: no está conciliado, ni apartado, ni pendiente de decir si está repetido, ni es de antes del corte. */
export const conciliable = (m: Pick<MovimientoBanco, 'estado' | 'importeCent'>): boolean =>
  m.importeCent !== 0 && (m.estado === 'pendiente' || m.estado === 'propuesto' || m.estado === 'por_aclarar')

/** La cabecera: «5 por conciliar · 41 conciliados · 1 apartado». */
export function cuantos(movs: readonly Pick<MovimientoBanco, 'estado'>[]): { porConciliar: number; conciliados: number; apartados: number; texto: string } {
  let porConciliar = 0, conciliados = 0, apartados = 0
  for (const m of movs) { const p = palabraDe(m); if (p === 'Conciliado') conciliados++; else if (p === 'Apartado') apartados++; else porConciliar++ }
  const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
  return { porConciliar, conciliados, apartados, texto: `${porConciliar} por conciliar · ${pl(conciliados, 'conciliado', 'conciliados')} · ${pl(apartados, 'apartado', 'apartados')}` }
}

/**
 * Los mensajes de la base, en palabras (encargo R08, 3.5): fuera el nombre de la función que los
 * dio («bank_casar: …») y las palabras de dentro («casado», «casar», «ignorado», «propuesto»).
 */
export function enPalabras(texto: string): string {
  const t = texto.replace(/^\s*[a-z_][a-z0-9_]*:\s+/, '')
  const cambios: [RegExp, string][] = [
    [/\bEse casado\b/g, 'Ese movimiento conciliado'], [/\bese casado\b/g, 'ese movimiento conciliado'],
    [/\bcasados\b/g, 'conciliados'], [/\bcasado\b/g, 'conciliado'], [/\bCasado\b/g, 'Conciliado'], [/\bcasadas\b/g, 'conciliadas'], [/\bcasada\b/g, 'conciliada'],
    [/\bcasarla\b/g, 'conciliarla'], [/\bcasarlo\b/g, 'conciliarlo'], [/\bcasar\b/g, 'conciliar'], [/\bse casa\b/g, 'se concilia'],
    [/\bignorados\b/g, 'apartados'], [/\bignorado\b/g, 'apartado'], [/\bignorar\b/g, 'apartar'],
    [/\basiento propuesto\b/g, 'asiento sin validar'], [/\bpropuesta descartada\b/g, 'propuesta quitada'],
  ]
  return cambios.reduce((s, [re, por]) => s.replace(re, por), t)
}
