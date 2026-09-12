// src/modules/kitchen/lib/rejillasDeCocina.ts
//
// LAS REJILLAS DE LAS TABLAS DE KITCHEN, EN UN SOLO SITIO.
//
// ── Por qué existen (regla 38, 08/09) ──────────────────────────────────────
//
// Las seis tablas del módulo terminaban en `auto`. En la cabecera esa celda está
// VACÍA y mide 0 px; en las filas lleva el botón y mide entre 56 y 230. Como la
// primera columna es elástica, cada píxel que ocupa el botón se lo quita al
// nombre — así que la cabecera y las filas tenían columnas de anchos distintos y
// **todos los títulos numéricos caían a la derecha de sus cifras**. Medido en el
// construido el 08/09:
//
//   Rentabilidad · carta      cabecera 0 px · filas 56 px   → 56 px de desfase
//   Resumen · por marca       cabecera 0 px · filas 85 px   → 85 px
//   Extras                    cabecera 0 px · filas 197 y 206 → 206 px
//   Ingeniería                filas 56 · 150 · 189 · 191 · 230 (no hay cabecera,
//                             pero las filas bailan ENTRE SÍ: la columna de la
//                             frase cambia de ancho en cada fila)
//   Resumen · las 5 cosas     filas 106 · 108 · 111 · 114 · 147
//
// El arreglo es que la columna de botones tenga ANCHO FIJO. Con eso la cabecera
// y la fila usan literalmente la misma cadena de pistas, y entonces las columnas
// coinciden por construcción, no por suerte.
//
// ── Por qué en un fichero y no en cada pantalla ────────────────────────────
//
// Porque cada una de las seis estaba escrita DOS veces —en la página y en su
// captura— y las dos copias tenían el mismo fallo. Una comparación «maqueta vs
// construido» no lo ve: la maqueta tenía el mismo `auto` y las dos salían
// igual de torcidas. **Regla 38: cuando maqueta y construido coinciden, sólo se
// ha probado que son iguales.** Aquí se corta por lo sano: una constante, la
// importan la pantalla y su foto, y `columnasCuadradas.test.ts` las vigila.
//
// ── De dónde salen los anchos ──────────────────────────────────────────────
//
// De los tableros del 08/09 (Julio) y, donde no los daba, del botón más ancho
// medido en el navegador con las fuentes de verdad. Nunca por debajo de lo
// medido: una celda más estrecha que su botón lo recorta o lo empuja.

/** El botón más ancho de cada tabla, con el ancho de su celda fijado. */
export const ANCHO_DE_BOTONES = {
  /** Rentabilidad: «Abrir» (56 px) y «Poner coste» (97 px). Tablero: 112. */
  rentabilidad: '112px',
  /** Resumen, por marca: «Ver platos» (85 px). Tablero: 100. */
  porMarca: '100px',
  /** Resumen, las 5 cosas: «Casar o crear la ficha» (147 px). */
  cosasQueArreglar: '150px',
  /** Ingeniería: «Subir precio» + «Quitar de la carta» (230 px medidos).
   *  El tablero dice 200 y no llega: ese par se saldría. Se usa lo medido. */
  ingenieria: '230px',
  /** Ingeniería · estrellas: sólo «Abrir» (56 px). Es OTRO panel, así que no
   *  comparte columna con nadie — darle los 230 de arriba le robaría 174 px a
   *  la frase para dejarlos en blanco. Una columna sólo tiene que cuadrar
   *  dentro de su propia tabla. */
  ingenieriaEstrellas: '70px',
  /** Extras: «Decir qué lleva» + «Ver dónde» (206 px). Tablero: 214. */
  extras: '214px',
  /** Modificadores · lista de preguntas: un solo botón por fila, y el más
   *  ancho de los tres es «Revisar» (71 px con las fuentes de verdad). El
   *  tablero da 96 y se respeta: sobra, pero la columna es fija y por eso la
   *  cabecera cuadra con las filas (regla 38). */
  preguntas: '96px',
} as const

/** Resumen · por marca: marca · vendido · comida · coste conocido · botón. */
export const REJILLA_MARCAS = `minmax(0,1fr) 120px 90px 160px ${ANCHO_DE_BOTONES.porMarca}`
/** Resumen · las 5 cosas: título · motivo · botón. */
export const REJILLA_COSAS = `230px minmax(0,1fr) ${ANCHO_DE_BOTONES.cosasQueArreglar}`

/** Rentabilidad: plato · precio · coste · margen · coste sobre precio · vendidos · botón. */
export const REJILLA_CARTA =
  `minmax(0,1fr) 105px 80px 95px 110px 75px ${ANCHO_DE_BOTONES.rentabilidad}`
/** Rentabilidad · sin coste: plato y motivo · precio · pastilla · vendidos · botón. */
export const REJILLA_SIN_COSTE =
  `minmax(0,1fr) 120px 110px 90px ${ANCHO_DE_BOTONES.rentabilidad}`

/** Ingeniería · los tres cuadrantes que piden decisión: plato · uds · margen · frase · botones. */
export const REJILLA_INGENIERIA =
  `250px 90px 90px minmax(0,1fr) ${ANCHO_DE_BOTONES.ingenieria}`
/** Ingeniería · estrellas: mismas columnas, y la de botones más estrecha porque
 *  ahí sólo hay «Abrir». Es un panel aparte: no se desalinea con nada. */
export const REJILLA_INGENIERIA_ESTRELLAS =
  `250px 90px 90px minmax(0,1fr) ${ANCHO_DE_BOTONES.ingenieriaEstrellas}`

/** Extras: extra · copias · cobra · vendido · qué lleva · botones. */
export const REJILLA_EXTRAS =
  `minmax(0,1fr) 120px 90px 110px 150px ${ANCHO_DE_BOTONES.extras}`

/**
 * Modificadores · la lista de preguntas (tablero 1 de la fase C).
 * Pregunta · qué puede hacer el cliente · opciones · en platos · qué le pasa ·
 * botón. Las cinco primeras son elásticas, tal cual el `.dc.html` de la
 * maqueta; la del botón es fija, que es lo que hace que la cabecera y la fila
 * usen las mismas pistas.
 */
export const REJILLA_PREGUNTAS =
  `minmax(0,2.3fr) minmax(0,1.25fr) minmax(0,0.8fr) minmax(0,0.75fr) minmax(0,1.7fr) ${ANCHO_DE_BOTONES.preguntas}`

/** Todas, para que la prueba las recorra sin que haya que acordarse de añadirla. */
export const TODAS_LAS_REJILLAS: Record<string, string> = {
  REJILLA_MARCAS, REJILLA_COSAS, REJILLA_CARTA,
  REJILLA_SIN_COSTE, REJILLA_INGENIERIA, REJILLA_INGENIERIA_ESTRELLAS, REJILLA_EXTRAS,
  REJILLA_PREGUNTAS,
}
