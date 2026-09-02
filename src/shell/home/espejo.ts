// src/shell/home/espejo.ts
//
// GARANTÍA (b) DEL ENCARGO: TODO DELTA VA CONTRA SU ESPEJO.
//
// El espejo de un día es EL MISMO DÍA DE LA SEMANA ANTERIOR, y el de una semana
// es la semana anterior. Nunca «vs ayer».
//
// Por qué, y no es una preferencia de redacción: un restaurante no se parece a
// sí mismo de ayer, se parece a sí mismo del mismo día de la semana pasada. Un
// lunes contra un domingo da una caída del 60 % que no significa nada, y en el
// Inicio de Foodint decía «−100 % vs ayer» a las once de la mañana — que es lo
// que pasa cuando además comparas un día a medias con uno entero.
//
// LAS TRES REGLAS, y las tres viven aquí y en ningún otro sitio (Regla 10: el
// criterio que se escribe dos veces acaba discrepando, y este ya discrepaba —
// homeMetricsService lo calculaba y shellCardComponents lo redactaba):
//
//   1. SIN ESPEJO NO HAY TENDENCIA. Si la semana anterior no tiene datos, no se
//      pinta delta. Un «+100 %» porque antes no había nada no es un crecimiento,
//      es una división por casi cero con traje de buena noticia.
//
//   2. UN PERIODO EN CURSO NO SE COMPARA CON UNO CERRADO. Si el periodo actual
//      todavía no ha terminado, `calculaDelta` devuelve null y la tarjeta enseña
//      el número sin delta. No hay excepción por «es que se entiende».
//
//   3. EL ESPEJO SE NOMBRA. «vs sábado anterior», «vs semana anterior», y cuando
//      cabe, con su cifra dentro: «vs semana anterior (12.577 €)». Un delta sin
//      decir contra qué es un número que el lector tiene que adivinar.

/** Cómo se colorea el delta. Los mismos tonos que ya usa MetricCard. */
export type TonoDelta = 'positive' | 'attention' | 'neutral'

/** El periodo con el que se compara, ya resuelto y con su nombre en pantalla. */
export interface Espejo {
  /** Inicio del periodo espejo, inclusive. */
  desde: Date
  /** Fin del periodo espejo, exclusivo. */
  hasta: Date
  /** Como se lee: «sábado anterior», «semana anterior». */
  etiqueta: string
}

export interface Delta {
  /** Variación en %, con un decimal. Negativo = bajada. */
  pct: number
  tono: TonoDelta
  /** Ya redactado: «+1,7 % vs sábado anterior». */
  texto: string
}

const DIA_MS = 24 * 60 * 60 * 1000

/** Copia a medianoche local, para no arrastrar la hora del `new Date()`. */
function aMedianoche(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Lunes de la semana de `d`. En España la semana empieza en lunes. */
export function inicioDeSemana(d: Date): Date {
  const x = aMedianoche(d)
  // getDay(): 0 = domingo. El domingo pertenece a la semana que empezó el lunes
  // anterior, así que retrocede 6, no 0 — el error clásico de esta función.
  const desplazamiento = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - desplazamiento)
  return x
}

/** «sábado», «lunes»… en minúscula, como se lee dentro de una frase. */
export function nombreDeDia(d: Date): string {
  return d.toLocaleDateString('es-ES', { weekday: 'long' })
}

/**
 * El espejo de un día: el mismo día de la semana anterior.
 * `dia` es el día que se está enseñando (para «ventas de ayer», ayer).
 */
export function espejoDeDia(dia: Date): Espejo {
  const desde = aMedianoche(new Date(aMedianoche(dia).getTime() - 7 * DIA_MS))
  const hasta = new Date(desde.getTime() + DIA_MS)
  return { desde, hasta, etiqueta: `${nombreDeDia(desde)} anterior` }
}

/**
 * El espejo de una semana: la semana anterior completa.
 * `dentroDeLaSemana` es cualquier día de la semana que se está enseñando.
 */
export function espejoDeSemana(dentroDeLaSemana: Date): Espejo {
  const lunesActual = inicioDeSemana(dentroDeLaSemana)
  const desde = new Date(lunesActual.getTime() - 7 * DIA_MS)
  const hasta = new Date(lunesActual)
  return { desde, hasta, etiqueta: 'semana anterior' }
}

/** «12.577 €», con el signo de menos tipográfico que usa la maqueta. */
export function eurCorto(n: number): string {
  return n.toLocaleString('es-ES', {
    style: 'currency', currency: 'EUR',
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  })
}

export interface OpcionesDelta {
  /**
   * true si el periodo actual TODAVÍA NO HA TERMINADO (hoy, esta semana en
   * curso). Con esto puesto no se devuelve delta: regla 2.
   */
  periodoEnCurso?: boolean
  /** Mete la cifra del espejo en el texto: «vs semana anterior (12.577 €)». */
  conCifraDelEspejo?: boolean
}

/**
 * El delta, o null si no se puede afirmar honestamente.
 *
 * Devuelve null —y la tarjeta entonces enseña el número a secas— cuando:
 *   · el espejo no tiene datos (null, NaN o 0),
 *   · el periodo actual está en curso,
 *   · el valor actual no se pudo calcular.
 */
export function calculaDelta(
  actual: number | null | undefined,
  valorEspejo: number | null | undefined,
  espejo: Espejo,
  opciones: OpcionesDelta = {},
): Delta | null {
  if (opciones.periodoEnCurso) return null
  if (actual == null || Number.isNaN(actual)) return null
  if (valorEspejo == null || Number.isNaN(valorEspejo) || valorEspejo <= 0) return null

  const bruto = ((actual - valorEspejo) / valorEspejo) * 100
  // Un decimal, como la maqueta: «+1,7 %», «−21,0 %».
  const pct = Math.round(bruto * 10) / 10

  const signo = pct > 0 ? '+' : pct < 0 ? '−' : ''
  const magnitud = Math.abs(pct).toLocaleString('es-ES', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  })
  const cifra = opciones.conCifraDelEspejo ? ` (${eurCorto(valorEspejo)})` : ''

  return {
    pct,
    // Una bajada NO es una alarma por sí sola: es «atención», no rojo de error.
    tono: pct > 0 ? 'positive' : pct < 0 ? 'attention' : 'neutral',
    texto: `${signo}${magnitud} % vs ${espejo.etiqueta}${cifra}`,
  }
}

/**
 * EL DELTA DE UN PORCENTAJE, que no es el mismo animal que el de un euro.
 *
 * Dos diferencias, y las dos han dado disgustos en paneles de otra gente:
 *
 *   1. UN PORCENTAJE SE MUEVE EN PUNTOS, no en porcentaje del porcentaje. Un
 *      food cost que pasa de 27,4 % a 28,9 % ha subido **1,5 puntos**. Decir
 *      «+5,5 %» es verdad aritmética y mentira operativa: nadie compra comida
 *      en porcentajes de porcentajes, y la cifra suena cinco veces más pequeña
 *      de lo que se siente en la cuenta.
 *
 *   2. SUBIR NO SIEMPRE ES BUENO. En ventas, más es mejor y `calculaDelta` lo
 *      da por hecho. En food cost o en % de personal, más es peor. Por eso el
 *      sentido se DECLARA en la llamada en vez de heredarse.
 *
 * Las tres reglas de la cabecera siguen mandando: sin espejo no hay tendencia,
 * un periodo en curso no se compara con uno cerrado, y el espejo se nombra.
 */
export function deltaEnPuntos(
  actual: number | null | undefined,
  valorEspejo: number | null | undefined,
  espejo: Espejo,
  opciones: OpcionesDelta & { subirEsMalo?: boolean } = {},
): Delta | null {
  if (opciones.periodoEnCurso) return null
  if (actual == null || Number.isNaN(actual)) return null
  // A diferencia del delta en euros, aquí un espejo de 0 SÍ vale: un food cost
  // del 0 % es un dato (nadie tenía coste), no una división imposible.
  if (valorEspejo == null || Number.isNaN(valorEspejo)) return null

  const puntos = Math.round((actual - valorEspejo) * 10) / 10
  const signo = puntos > 0 ? '+' : puntos < 0 ? '−' : ''
  const magnitud = Math.abs(puntos).toLocaleString('es-ES', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  })
  const malo = opciones.subirEsMalo ?? false
  const cifra = opciones.conCifraDelEspejo
    ? ` (${valorEspejo.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %)`
    : ''

  return {
    pct: puntos,
    tono: puntos === 0 ? 'neutral'
      : (puntos > 0) === malo ? 'attention' : 'positive',
    texto: `${signo}${magnitud} pp vs ${espejo.etiqueta}${cifra}`,
  }
}
