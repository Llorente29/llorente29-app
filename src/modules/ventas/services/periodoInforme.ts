// src/modules/ventas/services/periodoInforme.ts
//
// EL PERIODO Y SU ESPEJO. La pieza del §2 del encargo, sola y sin pintar nada.
//
// ── LA REGLA, Y POR QUÉ NO ES OBVIA ────────────────────────────────────────
// «Lo que va de semana» es un periodo PARCIAL. Su espejo NO es la semana pasada
// entera: es el MISMO TROZO de la semana pasada — de su lunes 00:00 a su mismo
// día y su misma hora. Comparar un trozo contra un entero inventa una caída
// todos los días, y el lunes por la mañana diría −90 % sin que pasara nada.
//
// Un periodo COMPLETO (ayer, la semana pasada, el mes pasado) sí se compara
// contra el anterior entero, y ahí el espejo se construye por CALENDARIO, no
// restando una duración: la semana del cambio de hora dura 169 h y restar
// 7×24 h la desplaza una hora.
//
// ── LAS DOS POLÍTICAS DE ESPEJO DEL PROYECTO, QUE NO SON LA MISMA ──────────
// El Inicio (`ventasSemana.ts`) compara DÍAS CERRADOS: excluye el día en curso
// de los dos lados y rotula «vs los mismos días». El generador compara EL MISMO
// TROZO, hasta la misma hora. Las dos son correctas y responden a preguntas
// distintas — «¿cómo va la semana comparada con la anterior a estas alturas?»
// no es «¿cómo van los días que ya han cerrado?». NO SE UNIFICAN: el día que
// alguien las iguale, una de las dos pantallas empezará a mentir en su rótulo.
//
// La frontera SQL (`report_sales`) vuelve a comprobar que las dos ventanas
// duran lo mismo y aborta si no. Esto de aquí no es la única defensa.

import {
  diaDelNegocio, diaAnterior, semanaDelNegocio, semanaAnteriorDelNegocio,
  mesDelNegocio, mesAnteriorDelNegocio,
} from '@/lib/fechas'

export type ClaveDePeriodo =
  | 'hoy' | 'ayer' | 'esta_semana' | 'semana_pasada'
  | 'este_mes' | 'mes_pasado' | 'personalizado'

export interface Ventana { desde: Date; hasta: Date }

export interface PeriodoResuelto {
  clave: ClaveDePeriodo
  actual: Ventana
  espejo: Ventana
  /** true = el periodo está EN CURSO y su espejo va recortado a la misma hora. */
  parcial: boolean
  /**
   * true = las dos ventanas son periodos de calendario y pueden durar distinto
   * (febrero contra enero). La frontera SQL lo necesita para no abortar.
   */
  calendario: boolean
}

/** Etiqueta corta para el rótulo. Dice lo que se ha comparado, no una promesa. */
export function etiquetaDelEspejo(p: PeriodoResuelto): string {
  if (p.parcial) return 'vs el mismo tramo del periodo anterior'
  return 'vs el periodo anterior completo'
}

/**
 * Resuelve un periodo y su espejo. `ahora` se pasa a propósito para que las
 * pruebas no dependan del reloj (regla: una verificación con ventana relativa
 * no se reproduce).
 */
export function resuelvePeriodo(
  clave: Exclude<ClaveDePeriodo, 'personalizado'>,
  ahora: Date,
): PeriodoResuelto {
  switch (clave) {
    case 'ayer': {
      const a = diaAnterior(ahora)
      const previo = diaAnterior(new Date(a.desde.getTime() + 12 * 3600_000))
      return { clave, actual: rango(a), espejo: rango(previo), parcial: false, calendario: false }
    }
    case 'semana_pasada': {
      const s = semanaAnteriorDelNegocio(ahora)
      const previa = semanaAnteriorDelNegocio(new Date(s.desde.getTime() + 12 * 3600_000))
      return { clave, actual: rango(s), espejo: rango(previa), parcial: false, calendario: false }
    }
    case 'mes_pasado': {
      const m = mesAnteriorDelNegocio(ahora)
      const previo = mesAnteriorDelNegocio(new Date(m.desde.getTime() + 12 * 3600_000))
      // Meses: 31 días contra 30. Es legítimo y hay que declararlo.
      return { clave, actual: rango(m), espejo: rango(previo), parcial: false, calendario: true }
    }
    case 'hoy':
      return parcialDesde(clave, diaDelNegocio(ahora).desde, ahora,
        diaAnterior(ahora).desde, false)
    case 'esta_semana':
      return parcialDesde(clave, semanaDelNegocio(ahora).desde, ahora,
        semanaAnteriorDelNegocio(ahora).desde, false)
    case 'este_mes':
      return parcialDesde(clave, mesDelNegocio(ahora).desde, ahora,
        mesAnteriorDelNegocio(ahora).desde, false)
  }
}

/**
 * Un periodo a medias: el espejo arranca donde arrancó el anterior y dura
 * EXACTAMENTE lo mismo que lleva corrido el actual.
 *
 * Se suma la duración transcurrida, no se reconstruye la hora de pared. En la
 * semana del cambio de hora eso deja el corte una hora movida respecto al reloj
 * —y es justo el margen de ±1 h que la frontera SQL admite—. Reconstruir la
 * hora de pared sería más fino y menos predecible: dos veces al año el espejo
 * duraría una hora más o menos que el actual, que es lo que la frontera prohíbe.
 */
function parcialDesde(
  clave: ClaveDePeriodo, desde: Date, ahora: Date, espejoDesde: Date, calendario: boolean,
): PeriodoResuelto {
  const corrido = ahora.getTime() - desde.getTime()
  return {
    clave,
    actual: { desde, hasta: ahora },
    espejo: { desde: espejoDesde, hasta: new Date(espejoDesde.getTime() + corrido) },
    parcial: true,
    calendario,
  }
}

/** Un periodo escrito a mano: su espejo es el trozo inmediatamente anterior. */
export function periodoPersonalizado(desde: Date, hasta: Date): PeriodoResuelto {
  const dura = hasta.getTime() - desde.getTime()
  return {
    clave: 'personalizado',
    actual: { desde, hasta },
    espejo: { desde: new Date(desde.getTime() - dura), hasta: desde },
    parcial: false,
    calendario: false,
  }
}

function rango(r: { desde: Date; hasta: Date }): Ventana {
  return { desde: r.desde, hasta: r.hasta }
}
