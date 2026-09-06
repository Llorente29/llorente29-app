// src/modules/kitchen/lib/cartaYMargen.ts
//
// B79 · lote 1 — LA REGLA. Qué deja cada plato, cuál es la media, y qué frase le
// corresponde. Sin pintar nada, para poder probarlo contra la carta de verdad.
//
// POR QUÉ VIVE AQUÍ Y NO EN LA PANTALLA. Tres pantallas —Resumen, Rentabilidad e
// Ingeniería de menús— responden tres preguntas distintas sobre los MISMOS
// números. Si cada una los calcula por su cuenta acaban discrepando, y ya sabemos
// cómo termina eso: dos definiciones de ingreso para la misma marca, sin que
// ninguna lleve su regla escrita. Aquí hay una sola vara y está declarada.
//
// LAS DOS MEDIAS SON DISTINTAS A PROPÓSITO, y por eso llevan nombres distintos:
//   · `margenPorUnidadVendida` (Rentabilidad) — PONDERADO por lo vendido, bebidas
//     incluidas. Responde «¿cuánto me deja de media cada cosa que sale por la
//     puerta?». Con la carta de Meraki: 8,04 €.
//   · `mediaSimpleDeMargen` (Ingeniería) — cada plato cuenta UNO, bebidas fuera.
//     Es el umbral clásico de la matriz: compara platos entre sí, no ventas.
//     Con la misma carta: 7,98 €.
// Mezclarlas da un número que no es de nadie. No se mezclan.
//
// EL COSTE YA TRAE EL ENVASE. `recipe_item.computed_cost` es ingredientes +
// envase; `food_cost` (en la RPC) es el mismo número menos el envase. Aquí se usa
// SIEMPRE el coste completo, que es lo que la carta dice y lo que Julio paga.
// Comprobado: Patatas Clásicas, coste 0,876 € con 0,224 € de envase dentro.

/** IVA en porcentaje (10 = 10 %). El precio de carta lo lleva con IVA. */
export function precioSinIva(precioConIva: number, ivaPct: number | null | undefined): number {
  return precioConIva / (1 + (ivaPct ?? 0) / 100)
}

/** Lo que la pantalla necesita saber de un producto para decidir qué contar. */
export interface ProductoDeCarta {
  id: string
  nombre: string
  /** `combo` = menú compuesto de otros platos; `item` = plato suelto. */
  tipo: string | null
  /** Categoría de la CARTA (`menu_category.name`), no de la ficha. */
  categoria: string | null
  precio: number | null
  ivaPct: number | null
  /** `recipe_item.computed_cost`: ingredientes + envase. null = no se sabe. */
  coste: number | null
  /** Unidades vendidas en el periodo. */
  uds: number
}

export interface FilaDeCarta extends ProductoDeCarta {
  precioNeto: number | null
  /** Precio sin IVA − coste. null si falta el coste o el precio. */
  margen: number | null
  /** Coste sobre el precio sin IVA, en %. */
  costeSobrePrecio: number | null
  /** Lo que ha dejado en el periodo: margen × unidades. */
  margenDelPeriodo: number | null
}

/**
 * Un plato sin coste no es un plato con coste cero. Se dice por qué no se sabe, y
 * el botón lleva a un sitio QUE EXISTE — si no hay destino, no hay botón
 * (regla de la casa, 06/09).
 */
export interface MotivoSinCoste {
  motivo: string
  boton: string
  /** Pestaña de la ficha a la que lleva el botón. */
  destino: 'escandallo' | 'en_carta'
}

export function motivoSinCoste(tipo: string | null): MotivoSinCoste {
  if (tipo === 'combo') {
    return {
      motivo: 'Es un menú: se compone de otros platos y no tiene receta propia.',
      boton: 'Componer',
      destino: 'escandallo',
    }
  }
  return {
    motivo: 'No tiene receta. Sin ella no sabemos su coste.',
    boton: 'Poner coste',
    destino: 'escandallo',
  }
}

/** Un plato cuyo coste se come 40 % o más del precio sin IVA. */
export const CARO_DE_HACER_PCT = 40

export function calculaFila(p: ProductoDeCarta): FilaDeCarta {
  const precioNeto = p.precio == null ? null : precioSinIva(p.precio, p.ivaPct)
  const margen = precioNeto == null || p.coste == null ? null : precioNeto - p.coste
  const costeSobrePrecio =
    precioNeto == null || p.coste == null || precioNeto <= 0
      ? null
      : (p.coste / precioNeto) * 100
  return {
    ...p,
    precioNeto,
    margen,
    costeSobrePrecio,
    margenDelPeriodo: margen == null ? null : margen * p.uds,
  }
}

/** Las etiquetas que van junto al nombre. Sólo cuando hay algo que mirar. */
export function etiquetasDeFila(f: FilaDeCarta): string[] {
  const e: string[] = []
  if (f.costeSobrePrecio != null && f.costeSobrePrecio >= CARO_DE_HACER_PCT) e.push('caro de hacer')
  if (f.uds === 0) e.push('sin ventas en el periodo')
  return e
}

// ── Rentabilidad: las cinco cifras ──────────────────────────────────────────

export interface CifrasDeRentabilidad {
  platosEnCarta: number
  conCoste: number
  sinCoste: number
  /** PONDERADO por unidades, bebidas incluidas. */
  margenPorUnidadVendida: number | null
  /** Σ (margen × uds) sin redondear hasta el final. */
  margenDelPeriodo: number
  /** El mismo, repartido entre los meses del periodo. */
  margenPorMes: number | null
  mejorPlato: { nombre: string; margen: number; costeSobrePrecio: number | null } | null
  /** Unidades vendidas de platos SIN coste, y el total vendido. */
  udsSinCoste: number
  udsTotales: number
}

/**
 * `diasDelPeriodo` sólo sirve para el «al mes». Si no se pasa, no se inventa.
 *
 * EL REDONDEO ES PARTE DE LA DEFINICIÓN, no un detalle: se suma con el coste
 * ENTERO y se redondea UNA VEZ al final. Redondear el coste antes de multiplicar
 * da 15.791,98 € y redondear por línea da 15.791,48 €, sobre los mismos datos.
 * Tres cifras para una carta; la buena es la que no redondea hasta el final:
 * 15.790,99 €.
 */
export function cifrasDeRentabilidad(
  filas: FilaDeCarta[],
  diasDelPeriodo?: number,
): CifrasDeRentabilidad {
  const conCoste = filas.filter((f) => f.margen != null)
  const sinCoste = filas.filter((f) => f.margen == null)

  let sumaMargen = 0
  let udsConCoste = 0
  for (const f of conCoste) {
    sumaMargen += (f.margen as number) * f.uds
    udsConCoste += f.uds
  }

  let mejor: CifrasDeRentabilidad['mejorPlato'] = null
  for (const f of conCoste) {
    if (mejor == null || (f.margen as number) > mejor.margen) {
      mejor = { nombre: f.nombre, margen: f.margen as number, costeSobrePrecio: f.costeSobrePrecio }
    }
  }

  return {
    platosEnCarta: filas.length,
    conCoste: conCoste.length,
    sinCoste: sinCoste.length,
    margenPorUnidadVendida: udsConCoste > 0 ? sumaMargen / udsConCoste : null,
    margenDelPeriodo: sumaMargen,
    margenPorMes: diasDelPeriodo && diasDelPeriodo > 0 ? sumaMargen / (diasDelPeriodo / 30) : null,
    mejorPlato: mejor,
    udsSinCoste: sinCoste.reduce((s, f) => s + f.uds, 0),
    udsTotales: filas.reduce((s, f) => s + f.uds, 0),
  }
}

// ── Ingeniería de menús: la matriz ──────────────────────────────────────────

/**
 * Las bebidas van aparte, y el criterio NO se inventa: es la categoría de la
 * CARTA. `recipe_item.category` está vacío en las 33 fichas de Meraki — por ahí
 * no se puede implementar, y comprobarlo evitó una heurística por nombre.
 *
 * Por qué van aparte: con las 6 latas dentro, la media baja de 7,98 € a 6,48 € y
 * una pita de 7,72 € pasa a contarse como lastre. Una lata no compite con una
 * pita por el sitio en la carta.
 */
export function esBebida(categoria: string | null): boolean {
  return (categoria ?? '').trim().toLowerCase() === 'bebidas'
}

export type Cuadrante = 'estrella' | 'caballo' | 'joya' | 'lastre'

export interface MatrizDeMenu {
  /** Los que entran: con coste Y con ventas, sin bebidas. */
  platos: FilaDeCarta[]
  /** Media SIMPLE: cada plato cuenta uno. */
  mediaSimpleDeMargen: number | null
  mediaSimpleDeUnidades: number | null
  cuadranteDe: Map<string, Cuadrante>
  conteo: Record<Cuadrante, number>
}

export function construyeMatriz(filas: FilaDeCarta[]): MatrizDeMenu {
  const platos = filas.filter((f) => !esBebida(f.categoria) && f.margen != null && f.uds > 0)
  const n = platos.length
  const mediaMargen = n > 0 ? platos.reduce((s, f) => s + (f.margen as number), 0) / n : null
  const mediaUds = n > 0 ? platos.reduce((s, f) => s + f.uds, 0) / n : null

  const cuadranteDe = new Map<string, Cuadrante>()
  const conteo: Record<Cuadrante, number> = { estrella: 0, caballo: 0, joya: 0, lastre: 0 }
  if (mediaMargen != null && mediaUds != null) {
    for (const f of platos) {
      const dejaMucho = (f.margen as number) >= mediaMargen
      const vendeMucho = f.uds >= mediaUds
      const c: Cuadrante = dejaMucho
        ? (vendeMucho ? 'estrella' : 'joya')
        : (vendeMucho ? 'caballo' : 'lastre')
      cuadranteDe.set(f.id, c)
      conteo[c] += 1
    }
  }
  return { platos, mediaSimpleDeMargen: mediaMargen, mediaSimpleDeUnidades: mediaUds, cuadranteDe, conteo }
}

/**
 * Lo que se ganaría subiendo el precio de carta. La subida es CON IVA (es lo que
 * ve el cliente) y lo que se gana es sin IVA — por eso 0,50 € sobre 149 unidades
 * son 68 €, no 74.
 */
export function ganariaSubiendo(uds: number, subidaConIva: number, ivaPct: number | null): number {
  return uds * precioSinIva(subidaConIva, ivaPct)
}

export const ROTULO_CUADRANTE: Record<Cuadrante, string> = {
  estrella: 'Estrellas',
  caballo: 'Caballos de batalla',
  joya: 'Joyas escondidas',
  lastre: 'Lastres',
}

export const EXPLICACION_CUADRANTE: Record<Cuadrante, string> = {
  estrella: 'se venden mucho y dejan mucho · no los toques',
  caballo: 'se venden mucho y dejan poco · candidatos a subir precio',
  joya: 'dejan mucho y se venden poco · dales sitio en la carta',
  lastre: 'ni se venden ni dejan · revísalos o quítalos',
}

// Sólo para componer las frases de abajo, y sobre un margen que en ese punto ya
// está comprobado no-null (`f.margen as number` tras filtrar). No usa
// `fmtMoney` porque esta capa no debe depender de la de presentación.
// eslint-disable-next-line no-restricted-syntax
const eur = (v: number) => v.toFixed(2).replace('.', ',') + ' €'

/**
 * La frase de cada fila: qué pasa, por qué, y qué gano si lo arreglo.
 *
 * `Mantener` NO existe como botón: no decidir es el estado por defecto, no una
 * acción. Y `Quitar de la carta` lleva a la pestaña «En carta» del plato, que ya
 * permite retirarlo — ningún botón sin destino que exista hoy.
 */
export function frasePorCuadrante(
  f: FilaDeCarta,
  c: Cuadrante,
  media: number,
): { frase: string; botones: { texto: string; destino: 'escandallo' | 'en_carta' | 'economia' }[] } {
  const m = f.margen as number
  if (c === 'caballo') {
    const gana = ganariaSubiendo(f.uds, 0.5, f.ivaPct)
    return {
      frase: `Se vende mucho (${f.uds}) pero deja ${eur(m)}. Con 0,50 € más de precio habrías ganado ${Math.round(gana)} € más en el periodo.`,
      botones: [{ texto: 'Subir precio', destino: 'economia' }, { texto: 'Ver receta', destino: 'escandallo' }],
    }
  }
  if (c === 'joya') {
    const deLoMejor = m >= media * 1.35
    return {
      frase: deLoMejor
        ? `Deja ${eur(m)}, de lo mejor de la carta, y sólo se ha vendido ${f.uds} veces. Súbelo en la carta o mételo en un menú.`
        : `Deja ${eur(m)}, por encima de la media, y se vende ${f.uds} veces. Que se vea más en la carta.`,
      botones: [{ texto: 'Darle sitio', destino: 'en_carta' }, { texto: 'Abrir', destino: 'escandallo' }],
    }
  }
  if (c === 'lastre') {
    if (f.costeSobrePrecio != null && f.costeSobrePrecio >= CARO_DE_HACER_PCT) {
      return {
        frase: `Cuesta el ${Math.round(f.costeSobrePrecio)} % del precio y deja ${eur(m)}. O sube el precio o cambia la receta.`,
        botones: [{ texto: 'Subir precio', destino: 'economia' }, { texto: 'Quitar de la carta', destino: 'en_carta' }],
      }
    }
    return {
      frase: `Deja ${eur(m)}, por debajo de la media, y se vende ${f.uds} veces. Decide si se queda.`,
      botones: [{ texto: 'Quitar de la carta', destino: 'en_carta' }],
    }
  }
  return {
    frase: 'Se vende y deja. Vigila que el coste no suba.',
    botones: [{ texto: 'Abrir', destino: 'escandallo' }],
  }
}
