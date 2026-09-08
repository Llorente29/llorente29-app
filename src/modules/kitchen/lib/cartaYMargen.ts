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

/**
 * Las etiquetas que van junto al nombre. Sólo cuando hay algo que mirar.
 *
 * ── «caro de hacer» se mide contra el OBJETIVO DE LA CUENTA (§3.21.2, 08/09) ──
 *
 * Antes salía con un 40 % fijo escrito aquí, y ese 40 no era de nadie: ni de
 * Julio, ni de la cuenta, ni de la carta. Una pantalla que llama «caro» a un
 * plato tiene que poder decir **caro comparado con qué**, y la respuesta es el
 * objetivo de comida sobre ventas de la cuenta, que es el número que Julio pone
 * en Ajustes y contra el que se mide el 24,1 % del Resumen.
 *
 * CONSECUENCIA, Y ES LA BUENA: hoy Foodint no tiene objetivo puesto
 * (`kitchen_settings.target_food_cost_pct` a NULL), así que **no sale ni una
 * pastilla** — y el Resumen dice, en su cuarta fila, «Sin objetivo de comida»
 * con su botón. Las dos pantallas cuentan la misma historia en vez de que una
 * juzgue con una vara que la otra dice que falta. El día que Julio lo ponga,
 * las pastillas aparecen solas.
 *
 * `objetivoPct` null = no hay vara, no se juzga. Nunca se cae a un número por
 * defecto: un umbral inventado es peor que ninguno, porque parece medido.
 *
 * NO se toca el 40 % de `frasePorCuadrante` (el «Cuesta el 44 % del precio» de
 * un lastre de Ingeniería): ahí no juzga, describe una proporción y ofrece dos
 * salidas. Si Julio quiere también esa frase atada al objetivo, es un cambio de
 * Ingeniería y va con su captura.
 */
export function etiquetasDeFila(f: FilaDeCarta, objetivoPct: number | null): string[] {
  const e: string[] = []
  if (objetivoPct != null && f.costeSobrePrecio != null && f.costeSobrePrecio > objetivoPct) {
    e.push('caro de hacer')
  }
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

  // B83: el mejor plato se elige SOLO entre los que se han vendido en el periodo.
  // Antes salía el de mayor margen aunque tuviera 0 ventas — en Bendito Burrito
  // salía «Burrito Colosal · sin ventas en el periodo», que como respuesta a «¿qué
  // plato te deja más margen?» no vale: un plato que no se vende no te ha dejado
  // nada. Si no se ha vendido ninguno con coste, no hay mejor plato y se dice «—».
  let mejor: CifrasDeRentabilidad['mejorPlato'] = null
  for (const f of conCoste) {
    if (f.uds <= 0) continue
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

/** Los tres órdenes de Rentabilidad. La pregunta de la pantalla es el ranking. */
export type OrdenDeCarta = 'margen' | 'vendido' | 'coste'

/**
 * Las filas CON coste, ordenadas.
 *
 * VIVE AQUÍ Y NO EN LA PÁGINA porque la captura tiene que ordenar con la misma
 * función que la pantalla. Julio, 08/09: con «Por margen» marcado, la foto
 * enseñaba 4,02 · 4,02 · 3,67 · 4,03 · 4,79 · 4,12 — no estaba ordenada, porque
 * la foto no pasaba por la ordenación de nadie. Es la regla 37 una fila más
 * abajo: la foto no puede enseñar un orden que la pantalla no hace.
 *
 * `margenPropio = false` (marca de terceros): no hay margen que ordenar, pero
 * los platos existen. Se listan por lo vendido para que no se quede vacía.
 */
export function ordenaLaCarta(
  filas: FilaDeCarta[],
  orden: OrdenDeCarta,
  margenPropio = true,
): FilaDeCarta[] {
  const conCoste = margenPropio
    ? filas.filter((f) => f.margen != null)
    : filas.filter((f) => f.coste != null)
  const porLoVendido = (a: FilaDeCarta, b: FilaDeCarta) => b.uds - a.uds
  const comparador = margenPropio
    ? {
        margen: (a: FilaDeCarta, b: FilaDeCarta) => (b.margen as number) - (a.margen as number),
        vendido: porLoVendido,
        coste: (a: FilaDeCarta, b: FilaDeCarta) => (b.costeSobrePrecio ?? 0) - (a.costeSobrePrecio ?? 0),
      }[orden]
    : porLoVendido
  return [...conCoste].sort(comparador)
}

/** Los que no tienen coste, por lo vendido: primero el que más se cobra a ciegas. */
export function losSinCoste(filas: FilaDeCarta[]): FilaDeCarta[] {
  return [...filas.filter((f) => f.coste == null)].sort((a, b) => b.uds - a.uds)
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
) : {
  frase: string
  /** El trozo de `frase` que va en negrita. Ver `parteLaFrase`. */
  destacado?: string
  botones: { texto: string; destino: 'escandallo' | 'en_carta' | 'economia' }[]
} {
  const m = f.margen as number
  if (c === 'caballo') {
    const gana = ganariaSubiendo(f.uds, 0.5, f.ivaPct)
    return {
      frase: `Se vende mucho (${f.uds}) pero deja ${eur(m)}. Con 0,50 € más de precio habrías ganado ${Math.round(gana)} € más en el periodo.`,
      destacado: `${Math.round(gana)} € más`,
      botones: [{ texto: 'Subir precio', destino: 'economia' }, { texto: 'Ver receta', destino: 'escandallo' }],
    }
  }
  if (c === 'joya') {
    const deLoMejor = m >= media * 1.35
    return {
      frase: deLoMejor
        ? `Deja ${eur(m)}, de lo mejor de la carta, y sólo se ha vendido ${f.uds} veces. Súbelo en la carta o mételo en un menú.`
        : `Deja ${eur(m)}, por encima de la media, y se vende ${f.uds} veces. Que se vea más en la carta.`,
      // Sólo se destaca cuando hay algo que destacar: si todas las frases
      // llevaran una negrita, la negrita dejaría de decir nada.
      destacado: deLoMejor ? eur(m) : undefined,
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
    // «Decide si se queda» daba la orden y se iba. La maqueta aprobada dice lo
    // que hay que decidir CON qué: «Si se queda, que sea por algo que no sea el
    // margen» — porque un lastre puede quedarse por ser el plato vegano de la
    // carta o el que pide la mitad de las mesas, y eso esta pantalla no lo sabe.
    // Y lleva «Abrir» detrás: para mirar eso hay que entrar en la ficha.
    return {
      frase: `Deja ${eur(m)}, por debajo de la media, y se vende ${f.uds} veces. Si se queda, que sea por algo que no sea el margen.`,
      botones: [
        { texto: 'Quitar de la carta', destino: 'en_carta' },
        { texto: 'Abrir', destino: 'escandallo' },
      ],
    }
  }
  return {
    frase: 'Se vende y deja. Vigila que el coste no suba.',
    botones: [{ texto: 'Abrir', destino: 'escandallo' }],
  }
}

/**
 * Parte la frase en tres para que la pantalla pinte el trozo del medio en
 * negrita: lo de antes, lo destacado y lo de después.
 *
 * POR QUÉ ASÍ Y NO CON HTML EN LA FRASE. Esta capa no sabe pintar y no debe:
 * si devolviera `<b>…</b>`, la frase dejaría de poderse comparar con una
 * cadena en una prueba, y el día que alguien la use en un correo o en un push
 * saldría con las etiquetas dentro. Devolviendo el trozo, cada sitio decide si
 * lo destaca y cómo — y el que no lo destaque sigue enseñando la frase entera.
 */
export function parteLaFrase(frase: string, destacado?: string): [string, string, string] {
  if (!destacado) return [frase, '', '']
  const i = frase.indexOf(destacado)
  if (i < 0) return [frase, '', '']
  return [frase.slice(0, i), destacado, frase.slice(i + destacado.length)]
}

// ── Marcas de terceros: el margen NO es de la casa ──────────────────────────

/**
 * ¿El margen de esta marca es de Foodint?
 *
 * En una marca PROPIA sí: Foodint pone la comida y cobra el precio de carta, así
 * que «precio sin IVA − coste» es lo que se queda.
 *
 * En una marca CEDIDA (`licensed`) **no**, y calcularlo igual sería inventar una
 * cifra con cara de medida. Foodint no cobra el PVP: cobra un porcentaje de la
 * venta (`brand_licensing_agreement.revenue_share_pct`) y, según el acuerdo, se le
 * reembolsa el consumo. La propia `menu_item_economics` lo sabe y deja
 * `food_cost_pct` y `contribution_margin` en NULL para `licensed` — este código no
 * puede ser más optimista que el motor.
 *
 * Cuál de las dos varas es la buena para una cedida —el PVP de carta o lo que
 * Foodint cobra por ella— es CONCEPTO y lo decide Julio con la cifra delante. Es
 * de la fase C. Hasta entonces la pantalla lo dice con todas las letras en su
 * línea de regla, que es distinto de decir «no hay platos».
 */
export function elMargenEsDeLaCasa(ownershipType: string | null | undefined): boolean {
  return ownershipType !== 'licensed'
}

export const MARGEN_DE_MARCA_CEDIDA =
  'Ésta es una marca de terceros: Foodint no cobra el precio de carta, sino un porcentaje de la venta. ' +
  'Su margen real llega cuando se calcule con esa regla; el coste y lo vendido sí son de verdad.'
