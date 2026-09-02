// src/shell/home/sello.ts
//
// GARANTÍA (a) DEL ENCARGO: CADA TARJETA LLEVA SU SELLO DE FRESCURA.
//
// Hasta hoy había UN sello para todo el panel, en la franja: «datos de las
// 08:18». Y no es lo mismo. Cada tarjeta consulta su propia fuente, en su
// propio momento y con su propio resultado: un sello global dice que TODO se
// midió a esa hora, y basta con que una consulta falle o tarde para que la
// franja esté firmando un número que no midió.
//
// El sello tiene DOS partes, y la segunda es la que pedía el encargo:
//
//   1. CUÁNDO se leyó. «datos de las 08:18».
//   2. SI ESE DATO YA NO SE PUEDE PRESENTAR COMO ACTUAL. Una pantalla abierta
//      desde ayer sigue enseñando el número de ayer con toda naturalidad. Pasado
//      el umbral, la tarjeta deja de afirmar y lo dice: «pueden haber
//      cambiado». No se borra el número —esconderlo sería peor— pero deja de
//      presentarse como el de ahora.
//
// El umbral es por tarjeta a propósito: el 86 de un producto cambia en mitad de
// un servicio y las ventas de ayer no cambian nunca. Poner un umbral único
// obligaría a elegir entre gritar de más en una y callar de menos en la otra.

/** Cuánto aguanta un dato antes de dejar de poder llamarse «de ahora». */
export const UMBRAL_POR_DEFECTO_MIN = 10

export interface Sello {
  /** Cuándo se leyó. null = todavía no se ha leído nada. */
  leidoA: Date | null
  /** true = pasado el umbral: el dato sigue en pantalla, pero no como actual. */
  caducado: boolean
  /** Lo que se pinta al pie: «datos de las 08:18 · pueden haber cambiado». */
  texto: string
}

/** «08:18», hora local. */
export function hora(d: Date): string {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

/**
 * El sello de un dato leído en `leidoA`, visto en el instante `ahora`.
 *
 * `umbralMin <= 0` desactiva la caducidad: para una tarjeta cuyo dato es un
 * periodo CERRADO (las ventas de ayer no van a cambiar), avisar de que «puede
 * haber cambiado» sería ruido — y el ruido es lo que hace que después nadie lea
 * el aviso que sí importa.
 */
export function selloDe(
  leidoA: Date | null,
  ahora: Date = new Date(),
  umbralMin: number = UMBRAL_POR_DEFECTO_MIN,
): Sello {
  if (leidoA == null) {
    return { leidoA: null, caducado: false, texto: 'sin leer todavía' }
  }
  const minutos = (ahora.getTime() - leidoA.getTime()) / 60000
  const caducado = umbralMin > 0 && minutos > umbralMin
  return {
    leidoA,
    caducado,
    texto: caducado
      ? `datos de las ${hora(leidoA)} · pueden haber cambiado`
      : `datos de las ${hora(leidoA)}`,
  }
}
