// src/lib/direccionEntrega.ts
//
// LAS ETIQUETAS DE LA DIRECCIÓN DE ENTREGA, EN CASTELLANO — 31/08/2026.
//
// Glovo/HubRise mandan la dirección con las etiquetas en inglés («Floor: 1,
// Door: B»). El repartidor lee «Floor» en un móvil, a oscuras, con el motor en
// marcha. Traducirlas es de PRESENTACIÓN y solo de presentación.
//
// LAS TRES REGLAS DEL ENCARGO, Y CÓMO SE CUMPLEN AQUÍ
//
// 1. `raw_tab` y `delivery_address` NO SE TOCAN NUNCA. Son la prueba de lo que
//    mandó el proveedor. Este módulo no escribe en ningún sitio: recibe una
//    cadena y devuelve otra. Nada de lo que hay aquí llega a la base de datos.
//
// 2. UNA ETIQUETA DESCONOCIDA SE ENSEÑA TAL CUAL. Nunca se descarta ni se
//    adivina. El algoritmo es de lista blanca: lo que no reconoce, lo deja
//    intacto — no hay ninguna rama que borre texto.
//
// 3. EL MAPA VIVE EN UN SOLO SITIO (este) y la MISMA función la usan la
//    pantalla y el ticket. Si se separaran, el repartidor leería una cosa en el
//    móvil y otra en el papel de la bolsa.
//
// ── POR QUÉ NO ES UN REEMPLAZO DE PALABRAS ────────────────────────────────
// Contado en producción el 31/08 sobre las 1.043 ventas con dirección:
// «Door» aparece 2 veces, y UNA DE LAS DOS es esto:
//
//     «Calle del Corregidor Juan Francisco de Luján, 106, 4, 4B,
//      Press 4B and I will open the door, 28030»
//
// Es una nota del cliente, no una etiqueta. Un reemplazo por palabra la
// convertiría en «…open the Puerta»: destrozaría una instrucción de entrega
// para traducir una etiqueta que ahí no existe.
//
// Y al revés: ya llegan etiquetas EN ESPAÑOL de otros canales («Timbre: 07»,
// «Llamar: 81 + llave»). Tienen que pasar intactas.
//
// Por eso solo se traduce en POSICIÓN DE ETIQUETA:
//   · «Floor: 1»      → segmento entero con forma `Etiqueta: valor`.
//   · «Doorbell 435»  → etiqueta conocida + UN valor corto, sin dos puntos
//                       (aparece así en producción).
// Cualquier otra cosa se devuelve sin tocar.
//
// ── LO QUE NO SE TRADUCE, DECLARADO ───────────────────────────────────────
// «Spain» sale en 481 de las 1.043 direcciones — es, con diferencia, la
// palabra inglesa más frecuente del ticket. NO se traduce aquí: es un VALOR
// (el país que pone Google en la dirección formateada), no una etiqueta, y el
// encargo habla de etiquetas. Queda anotado para que lo decida Julio, no
// resuelto a escondidas.

/**
 * Etiqueta inglesa (en minúsculas) → castellano.
 *
 * SITIO ÚNICO: si aparece una etiqueta nueva, se añade AQUÍ y la arreglan a la
 * vez la pantalla y el ticket. Cada entrada está porque se sabe qué significa
 * en una dirección española; las dudosas se dejan fuera A PROPÓSITO, porque una
 * traducción inventada es peor que la etiqueta original: el repartidor puede
 * apañarse leyendo «Gate», pero no si le decimos «Puerta» y resulta que la
 * puerta era otra cosa. Sin entrada en el mapa = se enseña tal cual (regla 2).
 */
export const ETIQUETAS_DIRECCION: Readonly<Record<string, string>> = Object.freeze({
  // Las dos que manda Glovo hoy, y el motivo del encargo.
  floor: 'Piso',
  door: 'Puerta',

  // Vista en producción sin dos puntos: «Doorbell 435».
  doorbell: 'Timbre',
  bell: 'Timbre',
  intercom: 'Portero automático',

  // `flat`/`apartment` NO son «Piso»: en una dirección española «Piso» ya es la
  // planta (floor). Llamar Piso a las dos cosas juntaría dos datos distintos en
  // la misma palabra, que es justo lo que hace ilegible una dirección.
  flat: 'Apartamento',
  apartment: 'Apartamento',

  stairs: 'Escalera',
  staircase: 'Escalera',
  building: 'Edificio',
  block: 'Bloque',
  entrance: 'Portal',
  lift: 'Ascensor',
  elevator: 'Ascensor',

  street: 'Calle',
  number: 'Número',
  city: 'Ciudad',
  postcode: 'Código postal',
  'postal code': 'Código postal',
  'zip code': 'Código postal',

  notes: 'Notas',
  note: 'Nota',
  instructions: 'Instrucciones',
  comment: 'Comentario',
  comments: 'Comentarios',
  company: 'Empresa',
  name: 'Nombre',
  phone: 'Teléfono',
})

// Un valor "corto" para la forma sin dos puntos: un solo trozo sin espacios.
// «Doorbell 435» sí; «Floor is broken, use the stairs» no — ahí `floor` no es
// una etiqueta, es la primera palabra de una frase.
const VALOR_CORTO = /^[\p{L}\p{N}ºª°.\-/#]{1,12}$/u

function traduceEtiqueta(bruta: string): string | null {
  const clave = bruta.trim().toLowerCase()
  return ETIQUETAS_DIRECCION[clave] ?? null
}

/**
 * Traduce las etiquetas de UN segmento (lo que hay entre comas). Devuelve el
 * segmento tal cual si no reconoce una etiqueta en posición de etiqueta.
 */
function traduceSegmento(seg: string): string {
  // Forma 1: «Etiqueta: valor». El separador y el valor se conservan LETRA POR
  // LETRA — solo se sustituye la etiqueta.
  const conDosPuntos = seg.match(/^(\s*)([\p{L} ]{2,20}?)(\s*:\s*)(.*)$/u)
  if (conDosPuntos) {
    const [, sangria, etiqueta, separador, resto] = conDosPuntos
    const es = traduceEtiqueta(etiqueta)
    return es ? `${sangria}${es}${separador}${resto}` : seg
  }

  // Forma 2: «Etiqueta valor», sin dos puntos y con UN valor corto.
  const sinDosPuntos = seg.match(/^(\s*)([\p{L}]{2,12})(\s+)(\S+)(\s*)$/u)
  if (sinDosPuntos) {
    const [, sangria, etiqueta, espacio, valor, cola] = sinDosPuntos
    if (!VALOR_CORTO.test(valor)) return seg
    const es = traduceEtiqueta(etiqueta)
    return es ? `${sangria}${es}${espacio}${valor}${cola}` : seg
  }

  return seg
}

/**
 * La dirección de entrega con sus etiquetas en castellano, PARA MOSTRAR Y PARA
 * IMPRIMIR. Es la única función que deben usar pantalla y ticket.
 *
 * No toca nada más: ni el orden, ni los números, ni las comas, ni las notas del
 * cliente. `null`/vacío entran y salen igual, para que quien llame no tenga que
 * envolverla en un condicional y acabe pintando "null".
 */
export function traduceDireccionEntrega<T extends string | null | undefined>(texto: T): T {
  if (typeof texto !== 'string' || texto === '') return texto
  return texto.split(',').map(traduceSegmento).join(',') as T
}

/**
 * Las etiquetas con forma de etiqueta (`Algo: valor`) que este mapa NO conoce.
 *
 * No se usa para decidir nada en pantalla — lo que no se conoce se enseña tal
 * cual, y punto. Existe para poder AUDITAR qué está llegando y hacer crecer el
 * mapa con datos en vez de por corazonada: la lista de las etiquetas «que
 * aparezcan» del encargo se saca de aquí, no de imaginarlas.
 */
export function etiquetasDesconocidas(texto: string | null | undefined): string[] {
  if (typeof texto !== 'string' || texto === '') return []
  const fuera: string[] = []
  for (const seg of texto.split(',')) {
    const m = seg.match(/^(\s*)([\p{L} ]{2,20}?)(\s*:\s*)(.*)$/u)
    if (!m) continue
    const etiqueta = m[2].trim()
    if (!traduceEtiqueta(etiqueta)) fuera.push(etiqueta)
  }
  return fuera
}
