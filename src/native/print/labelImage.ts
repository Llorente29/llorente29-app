// src/native/print/labelImage.ts
// ---------------------------------------------------------------------------
// LA PEGATINA DE 80 mm, POR IMAGEN · 20/09/2026 · Lote 2 del encargo del 20/09
// ---------------------------------------------------------------------------
//
// Julio, el jueves 18: «con 15 pedidos se acumulaban muchísimas pegatinas, era
// excesivamente complicado saber para qué pedidos eran, los números se veían
// pequeños… comprobé personalmente la dificultad de enlazar pegatinas, ticket
// de cocina y botón Listo».
//
// Hasta hoy la pegatina salía por TEXTO (`ticketRenderer.ts` → `escpos.ts`), y
// por texto no se puede mandar en el tamaño: la ESC/POS sólo tiene cuatro
// escalones (×1, ×2, ×3, ×4 de una fuente de 12×24 puntos). Un número a ×4 son
// 48 puntos = 6 mm, y encima empuja todo lo demás. Por eso esto pasa a IMAGEN,
// con el MISMO motor que ya usan la bolsa y la cocina (`ticketImage.ts`).
//
// ── LA ESCALA, Y POR QUÉ LOS PÍXELES DE LA MAQUETA VALEN TAL CUAL ───────────
//
// La maqueta dibuja la pegatina a 640 × 360 px para 80 × 45 mm, o sea 8 px/mm.
// La térmica de 80 mm imprime 576 puntos a 203 dpi, que son exactamente
// 8 puntos/mm sobre los 72 mm imprimibles del rollo de 80. Así que
// **1 px de la maqueta = 1 punto de la impresora**, y los tamaños de letra se
// copian sin convertir: 132 px de número son 16,5 mm de número.
//
// Lo único que cambia es el ANCHO útil: la maqueta tiene 588 px de contenido y
// aquí hay 548. Un 7 % menos de sitio horizontal, cero diferencia de tamaño.
//
// ── EL ALTO, MEDIDO Y NO ELEGIDO ────────────────────────────────────────────
//
// 🔴 La maqueta dibuja el QR a 84 px (10,5 mm). El QR de verdad NO mide eso:
//    mide 29 módulos × 6 puntos = 174 puntos = 21,75 mm, y así se quedó el
//    04/09 después de la prueba física (ECC Q, URL en mayúsculas). El encargo
//    dice «se queda, al tamaño que tiene», y la regla del 04/09 dice que el QR
//    no crece a costa del texto — pero tampoco se encoge: encogerlo es
//    devolver el 3 de 6 de la foto de Alcalá.
//
//    Con el QR de verdad dentro, esta pegatina sale a **47 mm**, no a 45. Son
//    11,25 mm de QR que el dibujo no tenía. No se recorta nada para fingir los
//    45: el rollo es continuo y el alto lo elegimos nosotros.
//
// ── LOS CINCO PRINCIPIOS, aplicados aquí ────────────────────────────────────
//
//  1. UNA SOLA COSA GRANDE. En la pegatina, el número del día. El código del
//     repartidor va grande pero nunca tanto: manda en la entrega, no aquí.
//  2. ORDEN DE LECTURA = ORDEN DE TRABAJO. Número → cuántas cajas → qué lleva
//     → de qué marca. El QR queda en la esquina de abajo a la izquierda, que
//     es donde lo puso la maqueta y fuera del camino de lectura: es para una
//     cámara, no para una persona.
//  3. EL TAMAÑO DEL CÓDIGO ES UNA REGLA, NO UNA CONSTANTE. Se pinta al mayor
//     escalón que entre en UNA línea. Nunca se parte, nunca se recorta, y
//     nunca se encoge el resto para hacerle sitio.
//  4. SE LEE DESDE EL OTRO LADO DEL PASE.
//  5. NADA DE DISEÑO PARA INFORMÁTICOS.
//
// ---------------------------------------------------------------------------

import QRCode from 'qrcode'
import { allergenLabel, isAllergenCode } from '@/modules/kitchen/lib/allergens'
import { passCode } from '@/modules/orders/lib/passCode'
import { ensureFonts } from './ticketImage'
import { flattenItems, qrEtiqueta } from './ticketRenderer'

// ── Lienzo y escala ─────────────────────────────────────────────────────────

const W = 576              // 80 mm @ 203 dpi = 72 mm imprimibles = 8 puntos/mm
const PAD = 14             // 1,75 mm de margen
const INK = '#000000'
const MUT = '#3a3a3a'

const COL_IZQ = 200        // el tercio izquierdo (la maqueta: 216 de 640)
const HUECO = 18
const COL_DER = W - 2 * PAD - COL_IZQ - HUECO   // 330

/** Módulo del QR en puntos. Es el del 04/09 y no se toca (ver cabecera). */
const QR_MODULO = 6

function fnt(size: number, bold?: boolean) { return `${size}px ${bold ? 'FolvyBold' : 'Folvy'}` }
/** El código del repartidor va monoespaciado: 0 y O, 8 y B, con prisa. */
function mono(size: number) { return `${size}px "DejaVu Sans Mono", "Roboto Mono", monospace` }

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}

function loadImageSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('img load'))
    img.src = src
  })
}

/** El QR de la etiqueta, al MISMO tamaño y con la MISMA corrección que hoy:
 *  módulo 6 y ECC Q. `margin: 1` deja un módulo de zona tranquila dentro de la
 *  imagen; el resto lo pone el blanco de la propia pegatina. Si falla, se
 *  devuelve null y la pegatina sale SIN QR pero sale (regla B53). */
async function qrEtiquetaImg(data: string): Promise<HTMLImageElement | null> {
  try {
    const url = await QRCode.toDataURL(data, {
      margin: 1, scale: QR_MODULO, errorCorrectionLevel: 'Q',
    })
    return await loadImageSrc(url)
  } catch { return null }
}

// ── Ayudantes de texto ──────────────────────────────────────────────────────

/** El mayor tamaño (del escalón más grande hacia abajo) que entra en UNA línea.
 *  Si ninguno entra, calcula el exacto por proporción: se lee pequeño, pero
 *  ENTERO. Nunca devuelve un tamaño que obligue a partir o a recortar. */
function alMayorEscalonQueEntre(
  ctx: CanvasRenderingContext2D,
  texto: string,
  anchoMax: number,
  escalones: number[],
  fuente: (s: number) => string,
): number {
  for (const s of escalones) {
    ctx.font = fuente(s)
    if (ctx.measureText(texto).width <= anchoMax) return s
  }
  const menor = escalones[escalones.length - 1]
  ctx.font = fuente(menor)
  const ancho = ctx.measureText(texto).width
  if (ancho <= 0) return menor
  return Math.max(9, Math.floor(menor * anchoMax / ancho))
}

/** Parte en líneas por palabras. No parte palabras: si una sola palabra no
 *  cabe, se devuelve igual y quien llama encoge la fuente. */
function enLineas(ctx: CanvasRenderingContext2D, texto: string, anchoMax: number): string[] {
  const palabras = (texto || '').split(/\s+/).filter(Boolean)
  const out: string[] = []
  let linea = ''
  for (const p of palabras) {
    const prueba = linea ? linea + ' ' + p : p
    if (ctx.measureText(prueba).width <= anchoMax) linea = prueba
    else { if (linea) out.push(linea); linea = p }
  }
  if (linea) out.push(linea)
  return out.length ? out : ['']
}

/** Texto ENTERO en como mucho `maxLineas`, encogiendo la fuente hasta que quepa.
 *  G5 de la lista: la marca va entera. Hoy se corta en «Koreans do it be…». */
function enteroEnLineas(
  ctx: CanvasRenderingContext2D, texto: string, anchoMax: number,
  tamMax: number, maxLineas: number, bold: boolean,
): { size: number; lineas: string[] } {
  for (let s = tamMax; s >= 10; s -= 1) {
    ctx.font = fnt(s, bold)
    const l = enLineas(ctx, texto, anchoMax)
    const cabenTodas = l.length <= maxLineas && l.every(x => ctx.measureText(x).width <= anchoMax)
    if (cabenTodas) return { size: s, lineas: l }
  }
  ctx.font = fnt(10, bold)
  return { size: 10, lineas: enLineas(ctx, texto, anchoMax) }
}

// ── La caja de alérgenos ────────────────────────────────────────────────────

/**
 * 🔴 UNA CAJA VACÍA SE LEE COMO «ESTE PLATO NO TIENE ALÉRGENOS», y eso es una
 * afirmación falsa sobre comida, impresa y pegada a la caja. Así que la caja
 * NUNCA se queda vacía y NUNCA se omite.
 *
 * Tres respuestas, porque medido en la base son tres cosas y no dos (Foodint,
 * marcas propias activas, platos activos con ficha: 204; con alérgenos
 * declarados: 143; SIN ninguno: 61 — el mismo 61 del encargo). Esos 61 son:
 *
 *   47 platos → las 14 casillas puestas en «libre», ninguna sin decidir. La
 *               ficha está ENTERA y dice que no lleva ninguno de los 14.
 *   11 platos → ficha en blanco, cero filas. Nadie la ha tocado.
 *    3 platos → sólo una traza declarada y 13 sin decidir.
 *
 * Imprimir «sin datos» en los 47 sería mentir en el otro sentido —y tirar a la
 * basura trabajo YA HECHO, que es la regla 30—. Por eso la base manda
 * `allergens_state` y aquí sólo se pinta lo que diga.
 */
function laCajaDeAlergenos(it: { allergens?: string[]; allergensState?: string | null }): string {
  const lista = (it.allergens || []).filter(Boolean)
  const estado = it.allergensState ?? (lista.length ? 'listed' : 'unknown')
  if (estado === 'listed' && lista.length) {
    // La BBDD guarda el código estable en inglés («gluten», «milk»). Hasta hoy
    // la pegatina imprimía ESE código. La etiqueta en castellano sale de
    // allergens.ts, que es la fuente única — aquí no se traduce nada a mano.
    return lista.map(c => (isAllergenCode(c) ? allergenLabel(c, 'es') : c)).join(' · ')
  }
  if (estado === 'none') return 'Ninguno de los 14'
  return 'Sin datos'
}

// ── La pegatina ─────────────────────────────────────────────────────────────

/**
 * Lo que la pegatina necesita de un artículo ya aplanado por `flattenItems`.
 * Se escribe aquí, y no se hereda el `any` del porte del agente: un fichero
 * nuevo no tiene por qué traerse la deuda del viejo, y el comprobador de tipos
 * es la única red que hay sobre estos nombres (regla 40).
 */
interface ArticuloAplanado {
  name: string
  qty: number
  isDrink: boolean
  allergens?: string[]
  allergensState?: string | null
  modifiers?: { name?: string | null }[]
  unitTokens?: (string | null)[] | null
  unitNo?: number | null
}

/** Lo que la pegatina necesita del pedido (`order_for_print`). */
interface PedidoParaPegatina {
  brand?: string | null
  brand_shop_url?: string | null
  bag_token?: string | null
  customer_name?: string | null
  entro_at?: string | null
  pase_numero?: number | null
  channel?: string | null
  pos_short_code?: string | null
  platform_order_code?: string | null
  platform_order_ref?: string | null
  external_tab_ref?: string | null
  external_ref?: string | null
  lineas?: unknown[]
}

interface Pieza {
  titulo: string
  /** Lo que se lee en grande a la izquierda: el número del día. */
  numero: string
  /** «1 de 3». */
  deCuantas: string
  marca: string
  plato: string
  detalle: string[]
  alergenos: string
  codigo: string
  pie: string
  qr: string | null
}

/** El número GRANDE. Si el pedido todavía no tiene número del día —una venta
 *  anterior a la migración, o un fallo del contador— NO se deja un hueco: se
 *  pone lo que el pase canta, que es el código. Regla de la hoja del pase:
 *  donde no hay dato, se pone lo que sí hay, nunca un blanco. */
function elNumeroGrande(order: PedidoParaPegatina, pc: { emph: string }): string {
  const n = order.pase_numero
  return (n === null || n === undefined) ? (pc.emph || '—') : String(n)
}

async function pintarPieza(p: Pieza): Promise<HTMLCanvasElement> {
  const medir = newCanvas(10, 10).getContext('2d')!

  // ── Columna derecha: se mide antes de pintar, porque el alto sale de aquí ──
  const marca = enteroEnLineas(medir, p.marca || 'Sin marca', COL_DER, 20, 2, true)
  const plato = enteroEnLineas(medir, p.plato, COL_DER, 27, 3, true)

  medir.font = fnt(17, false)
  const detalle = p.detalle.flatMap(d => enLineas(medir, d, COL_DER)).slice(0, 2)

  const ALERG_PAD = 8
  medir.font = fnt(20, true)
  const alergLineas = enLineas(medir, p.alergenos, COL_DER - 2 * ALERG_PAD - 6)
  const alergH = 3 + ALERG_PAD + 15 + 4 + alergLineas.length * 24 + ALERG_PAD + 3

  // Principio 3: el mayor escalón que entre EN UNA LÍNEA. Medido en Alcalá
  // (30 días): Glovo 4 caracteres, Uber 5 —los 680, todos—, Just Eat hasta 10.
  const codSize = alMayorEscalonQueEntre(medir, p.codigo, COL_DER, [44, 40, 36, 32, 28, 24, 20, 17], mono)

  const altoDerecha =
    marca.lineas.length * (marca.size + 6) + 10 +      // marca
    3 + 12 +                                           // la regla negra
    plato.lineas.length * (plato.size + 5) +
    (detalle.length ? detalle.length * 22 + 4 : 0) +
    12 + alergH + 12 +
    codSize + 4 + 20                                   // código + pie

  // ── Columna izquierda ──
  const numSize = alMayorEscalonQueEntre(medir, p.numero, COL_IZQ, [132, 120, 108, 96, 86, 76, 66], s => fnt(s, true))
  const numAlto = Math.round(numSize * 0.80)
  const qrImg = p.qr ? await qrEtiquetaImg(p.qr) : null
  const qrAlto = qrImg ? qrImg.height : 0
  const altoIzquierda = numAlto + 10 + 38 + (qrImg ? 14 + qrAlto : 0)

  // 🔴 TODAS LAS PEGATINAS DEL MISMO ALTO, y esto se vio dibujándolas, no
  //    leyéndolas. Con el alto libre salían a 47,8 · 43,1 · 36,5 y 33,5 mm
  //    según el pedido: el número de tres cifras encoge un escalón, y una marca
  //    sin tienda no lleva QR. Quince pegatinas de cuatro altos distintos en la
  //    mesa es justo lo que el encargo pide evitar — se emparejan peor, se
  //    apilan peor y se despegan peor.
  //
  //    El mínimo es el alto natural de la pegatina COMPLETA (número de dos
  //    cifras + QR). Lo que necesite más, crece; nada se recorta nunca.
  const ALTO_MIN = 382      // 47,8 mm: 14 + 106 de número + 10 + 38 + 14 + 186 de QR + 14
  const H = Math.max(ALTO_MIN, PAD + Math.max(altoIzquierda, altoDerecha) + PAD)

  const canvas = newCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = INK

  // ── Izquierda: EL NÚMERO, y debajo cuántas cajas son ──
  let yi = PAD
  ctx.font = fnt(numSize, true); ctx.fillStyle = INK
  ctx.fillText(p.numero, PAD, yi - Math.round(numSize * 0.14))
  yi += numAlto + 10
  ctx.font = fnt(38, true)
  ctx.fillText(p.deCuantas, PAD, yi)
  yi += 38 + 14
  if (qrImg) ctx.drawImage(qrImg, PAD, yi)

  // ── Derecha: de qué marca, qué lleva, qué alérgenos y el código ──
  const x = PAD + COL_IZQ + HUECO
  let yd = PAD
  ctx.fillStyle = INK
  for (const l of marca.lineas) { ctx.font = fnt(marca.size, true); ctx.fillText(l, x, yd); yd += marca.size + 6 }
  yd += 10
  ctx.fillRect(x, yd, COL_DER, 3); yd += 3 + 12
  for (const l of plato.lineas) { ctx.font = fnt(plato.size, true); ctx.fillText(l, x, yd); yd += plato.size + 5 }
  if (detalle.length) {
    yd += 4
    ctx.font = fnt(17, false); ctx.fillStyle = MUT
    for (const l of detalle) { ctx.fillText(l, x, yd); yd += 22 }
    ctx.fillStyle = INK
  }

  // La caja se ancla ABAJO, para que el código quede siempre en el mismo sitio
  // aunque el nombre del plato ocupe una línea más o una menos.
  const yCaja = Math.max(yd + 12, H - PAD - 20 - 4 - codSize - 12 - alergH)
  ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.setLineDash([])
  ctx.strokeRect(x + 1.5, yCaja + 1.5, COL_DER - 3, alergH - 3)
  let ya = yCaja + 3 + ALERG_PAD
  ctx.font = fnt(15, true)
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '2px' } catch { /* WebView viejo */ }
  ctx.fillText('ALÉRGENOS', x + ALERG_PAD + 3, ya)
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px' } catch { /* */ }
  ya += 15 + 4
  ctx.font = fnt(20, true)
  for (const l of alergLineas) { ctx.fillText(l, x + ALERG_PAD + 3, ya); ya += 24 }

  // El código del repartidor, abajo del todo y entero.
  const yCod = H - PAD - 20 - 4 - codSize
  ctx.font = mono(codSize); ctx.fillStyle = INK
  ctx.fillText(p.codigo, x, yCod)
  ctx.font = fnt(17, true); ctx.fillStyle = MUT
  ctx.fillText(p.pie, x, yCod + codSize + 4)

  return canvas
}

/**
 * Una imagen por pegatina, en el MISMO orden que el renderizador de texto al
 * que sustituye: una por artículo de comida y una agrupada para bebidas y
 * postres. El reparto de unidades y los tokens de cada una NO se deciden aquí
 * —salen de `flattenItems`, que es donde vive esa regla desde el 04/09—.
 */
export async function renderLabelImages(order: PedidoParaPegatina): Promise<HTMLCanvasElement[]> {
  await ensureFonts()
  const pc = passCode(order)
  const items = flattenItems(order) as ArticuloAplanado[]
  const comida = items.filter(it => !it.isDrink)
  const bebidas = items.filter(it => it.isDrink)
  const total = comida.length + (bebidas.length > 0 ? 1 : 0)
  const numero = elNumeroGrande(order, pc)
  const quien = (order.customer_name || '').split(' ')[0] || ''
  const hora = order.entro_at
    ? new Date(order.entro_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
    : ''
  const pie = [quien, hora].filter(Boolean).join(' · ')

  const out: HTMLCanvasElement[] = []
  let i = 0
  for (const it of comida) {
    i++
    out.push(await pintarPieza({
      titulo: `Pegatina ${i}/${total}`,
      numero,
      deCuantas: `${i} de ${total}`,
      marca: order.brand ?? '',
      plato: it.name,
      detalle: (it.modifiers || []).map(m => m.name ?? '').filter(Boolean),
      alergenos: laCajaDeAlergenos({ allergens: it.allergens, allergensState: it.allergensState }),
      codigo: pc.full,
      pie,
      qr: qrEtiqueta(order, it.unitTokens?.[(it.unitNo ?? 1) - 1]),
    }))
  }
  if (bebidas.length > 0) {
    i++
    out.push(await pintarPieza({
      titulo: 'Pegatina bebidas',
      numero,
      deCuantas: `${i} de ${total}`,
      marca: order.brand ?? '',
      plato: 'Bebidas y postres',
      detalle: bebidas.map(b => `${b.qty}x ${b.name}`),
      // La bolsa de bebidas agrupa varios artículos: no hay UN plato del que
      // declarar alérgenos, y decir «ninguno» sería inventárselo.
      alergenos: 'Ver cada envase',
      codigo: pc.full,
      pie: [pie, 'bolsa aparte'].filter(Boolean).join(' · '),
      qr: qrEtiqueta(order, order.bag_token),
    }))
  }
  return out
}
