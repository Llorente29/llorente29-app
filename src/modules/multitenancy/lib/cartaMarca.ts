// src/modules/multitenancy/lib/cartaMarca.ts
//
// F01 · PR 3 · Lo que pintan la pestaña Carta de una marca (tablero 3) y
// Marcas › Revisar (tablero 4), leído de f01_carta_marca y
// f01_marcas_por_revisar (20261028T0850_f01c_recetas_y_codigo.sql). Solo
// lectura y frases: lo que se decide vive en la base.

import { enumerar, fechaCorta, localCorto, nombreCanal, type LocalMarca } from './marcasLast'

type Fila = Record<string, unknown>
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const lista = (v: unknown): Fila[] => (Array.isArray(v) ? (v as Fila[]) : [])
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const locales = (v: unknown): LocalMarca[] => lista(v).map((l) => ({ id: String(l.id ?? ''), nombre: String(l.nombre ?? '') }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

/** Un nombre de plato para comparar: sin acentos, sin signos y en minúscula (como _f01_normalizar). */
export const normalizar = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ── Tablero 3 · La carta de una marca ───────────────────────────────────────

export type EstadoPlato = 'receta' | 'sin_receta' | 'almacen'

export interface PlatoCarta {
  id: string
  nombre: string
  estado: EstadoPlato
  recipeItemId: string | null
  /** El precio de cada plataforma de la marca (slug → euros). */
  precios: Record<string, number>
  ventasEsperando: number
  ventasAntesDelRecuento: number
}

export interface Colocada { plato: string; colocadas: number; fallidas: number; antesDelRecuento: number; colocadaAt: string | null }

export interface CartaMarca {
  marca: { id: string; nombre: string; propia: boolean; socio: string | null; locales: LocalMarca[]; canales: { slug: string; nombre: string }[] }
  platos: PlatoCarta[]
  resumen: { platos: number; conReceta: number; sinReceta: number; almacen: number }
  ventasEsperando: number
  ventasAntesDelRecuento: number
  corte: string | null
  porColocar: number
  colocadas: Colocada[]
}

const ORDEN_CANAL = ['uber', 'glovo', 'justeat', 'deliveroo', 'shop']

export function leerCarta(datos: unknown): CartaMarca {
  const r = (datos ?? {}) as Fila
  const m = (r.marca ?? {}) as Fila
  const res = (r.resumen ?? {}) as Fila
  return {
    marca: {
      id: String(m.id ?? ''),
      nombre: String(m.nombre ?? ''),
      propia: m.propia === true,
      socio: txt(m.socio),
      locales: locales(m.locales),
      canales: lista(m.canales).map((c) => ({ slug: String(c.slug ?? ''), nombre: nombreCanal(String(c.slug ?? '')) }))
        .sort((a, b) => (ORDEN_CANAL.indexOf(a.slug) + 1 || 99) - (ORDEN_CANAL.indexOf(b.slug) + 1 || 99)),
    },
    platos: lista(r.platos).map((p) => ({
      id: String(p.id ?? ''),
      nombre: String(p.nombre ?? '').trim(),
      estado: (['receta', 'sin_receta', 'almacen'].includes(String(p.estado)) ? p.estado : 'sin_receta') as EstadoPlato,
      recipeItemId: txt(p.recipe_item_id),
      precios: Object.fromEntries(Object.entries((p.precios ?? {}) as Fila).map(([k, v]) => [k, num(v)])),
      ventasEsperando: num(p.ventas_esperando),
      ventasAntesDelRecuento: num(p.ventas_antes_del_recuento),
    })),
    resumen: { platos: num(res.platos), conReceta: num(res.con_receta), sinReceta: num(res.sin_receta), almacen: num(res.almacen) },
    ventasEsperando: num(r.ventas_esperando),
    ventasAntesDelRecuento: num(r.ventas_antes_del_recuento),
    corte: txt(r.corte),
    porColocar: num(r.por_colocar),
    colocadas: lista(r.colocadas).map((c) => ({
      plato: String(c.plato ?? ''), colocadas: num(c.colocadas), fallidas: num(c.fallidas),
      antesDelRecuento: num(c.antes_del_recuento), colocadaAt: txt(c.colocada_at),
    })),
  }
}

/** «Cedida por Cloudtown Brands · Alcalá y Carabanchel · Uber Eats y Glovo». */
export function subtituloMarca(c: CartaMarca): string {
  const partes = [c.marca.propia ? 'Propia' : c.marca.socio ? `Cedida por ${c.marca.socio}` : 'Cedida']
  if (c.marca.locales.length) partes.push(enumerar(c.marca.locales.map((l) => localCorto(l.nombre))))
  if (c.marca.canales.length) partes.push(enumerar(c.marca.canales.map((x) => x.nombre)))
  return partes.join(' · ')
}

/** «0 de 12 platos con receta». */
export const progreso = (c: CartaMarca): string => `${c.resumen.conReceta} de ${c.resumen.platos} ${c.resumen.platos === 1 ? 'plato' : 'platos'} con receta`

/** La pista de debajo de la barra: lo del almacén, y lo vendido que espera. */
export function pistaProgreso(c: CartaMarca): string {
  const partes: string[] = []
  if (c.resumen.almacen > 0) {
    partes.push(c.resumen.almacen === 1 ? 'El artículo del almacén (bebida o postre) ya está enlazado con tu almacén.'
      : `Los ${c.resumen.almacen} artículos del almacén (bebidas y postres) ya están enlazados con tu almacén.`)
  }
  if (c.ventasEsperando > 0) {
    partes.push(`${plural(c.ventasEsperando, 'venta espera', 'ventas esperan')} a su receta: descontará${c.ventasEsperando === 1 ? '' : 'n'} almacén en cuanto la pongas.`)
  }
  if (c.ventasAntesDelRecuento > 0 && c.corte) {
    partes.push(`${plural(c.ventasAntesDelRecuento, 'venta es', 'ventas son')} de antes del último recuento (${fechaCorta(c.corte)}): se ${c.ventasAntesDelRecuento === 1 ? 'queda' : 'quedan'} como ${c.ventasAntesDelRecuento === 1 ? 'está' : 'están'}.`)
  }
  return partes.join(' ')
}

export const porcentaje = (c: CartaMarca): number => (c.resumen.platos ? Math.round((100 * c.resumen.conReceta) / c.resumen.platos) : 100)

/** El resultado de colocar lo vendido al poner una receta, en una frase (regla 8). */
export interface ResultadoColocar { colocadas: number; fallidas: number; antesDelRecuento: number; corte: string | null; quedan: number }

export function leerColocar(datos: unknown): ResultadoColocar {
  const r = (datos ?? {}) as Fila
  return { colocadas: num(r.colocadas), fallidas: num(r.fallidas), antesDelRecuento: num(r.antes_del_recuento), corte: txt(r.corte), quedan: num(r.quedan) }
}

/** Suma de varias tandas de colocar (la pantalla repite mientras «quedan»). */
export const sumarColocar = (a: ResultadoColocar, b: ResultadoColocar): ResultadoColocar => ({
  colocadas: a.colocadas + b.colocadas, fallidas: a.fallidas + b.fallidas, antesDelRecuento: a.antesDelRecuento + b.antesDelRecuento,
  corte: b.corte ?? a.corte, quedan: b.quedan,
})

export function fraseColocadas(r: ResultadoColocar): string {
  const partes: string[] = []
  if (r.colocadas > 0) partes.push(`${plural(r.colocadas, 'venta colocada y descontada', 'ventas colocadas y descontadas')} del almacén.`)
  else if (r.fallidas === 0 && r.antesDelRecuento === 0) partes.push('No había ventas esperando.')
  if (r.antesDelRecuento > 0) {
    partes.push(`${plural(r.antesDelRecuento, 'venta de antes', 'ventas de antes')} del último recuento${r.corte ? ` (${fechaCorta(r.corte)})` : ''} se ${r.antesDelRecuento === 1 ? 'queda' : 'quedan'} como ${r.antesDelRecuento === 1 ? 'estaba' : 'estaban'}.`)
  }
  if (r.fallidas > 0) partes.push(`${plural(r.fallidas, 'venta no se ha podido colocar', 'ventas no se han podido colocar')}: la pasada de cada hora lo vuelve a decir.`)
  return partes.join(' ')
}

/** «Receta de Alitas de Prueba guardada (1 ingrediente). 1 venta colocada y descontada del almacén.» */
export function fraseRecetaGuardada(plato: string, ingredientes: number, r: ResultadoColocar): string {
  return `Receta de ${plato} guardada (${plural(ingredientes, 'ingrediente', 'ingredientes')}). ${fraseColocadas(r)}`
}

/** La lectura de un fichero → el plato sin receta que más se le parece (o ninguno). */
export function platoParaLectura(nombreLeido: string, platos: PlatoCarta[]): PlatoCarta | null {
  const n = normalizar(nombreLeido)
  const candidatos = platos.filter((p) => p.estado === 'sin_receta')
  return candidatos.find((p) => normalizar(p.nombre) === n)
    ?? candidatos.find((p) => n !== '' && (normalizar(p.nombre).includes(n) || n.includes(normalizar(p.nombre))))
    ?? null
}

// ── Tablero 4 · Marcas › Revisar ────────────────────────────────────────────

export interface Comparacion {
  brandId: string
  marca: string
  platosLast: number
  platosFolvy: number
  conReceta: number
  coinciden: number
  identica: boolean
  localesFolvy: LocalMarca[]
  cartaLast: { nombre: string; coincide: boolean }[]
  cartaFolvy: { nombre: string; coincide: boolean }[]
}

export interface Pregunta {
  org: string
  nombre: string
  cuentaLast: string | null
  locales: LocalMarca[]
  comparacion: Comparacion
  ventas: { despues: number; antes: number; corte: string | null }
}

export interface Reconocida {
  id: string
  como: 'sola' | 'codigo_nuevo'
  nombreLast: string
  brandId: string
  marca: string
  locales: LocalMarca[]
  colocadas: number
  antesDelRecuento: number
  fallidas: number
}

export interface SinMarca { codigo: string | null; local: string | null; marcaLast: string | null; ventas: number; primera: string | null; ultima: string | null }

export interface PorRevisar { preguntas: Pregunta[]; reconocidas: Reconocida[]; sinMarca: SinMarca[] }

const leerComparacion = (c: Fila): Comparacion => {
  const cartas = (c.cartas ?? {}) as Fila
  const lado = (v: unknown) => lista(v).map((p) => ({ nombre: String(p.nombre ?? '').trim(), coincide: p.coincide === true }))
  return {
    brandId: String(c.brand_id ?? ''),
    marca: String(c.marca ?? ''),
    platosLast: num(c.platos_last),
    platosFolvy: num(c.platos_folvy),
    conReceta: num(c.con_receta),
    coinciden: num(c.coinciden),
    identica: c.identica === true,
    localesFolvy: locales(c.locales_folvy),
    cartaLast: lado(cartas.last),
    cartaFolvy: lado(cartas.folvy),
  }
}

export function leerPorRevisar(datos: unknown): PorRevisar {
  const r = (datos ?? {}) as Fila
  return {
    preguntas: lista(r.preguntas).map((q) => {
      const v = (q.ventas ?? {}) as Fila
      return {
        org: String(q.org ?? ''),
        nombre: String(q.nombre ?? '').trim(),
        cuentaLast: txt(q.cuenta_last),
        locales: locales(q.locales),
        comparacion: leerComparacion((q.comparacion ?? {}) as Fila),
        ventas: { despues: num(v.despues), antes: num(v.antes), corte: txt(v.corte) },
      }
    }),
    reconocidas: lista(r.reconocidas).map((x) => {
      const v = (x.ventas ?? {}) as Fila
      return {
        id: String(x.id ?? ''),
        como: x.como === 'codigo_nuevo' ? 'codigo_nuevo' : 'sola',
        nombreLast: String(x.nombre_last ?? '').trim(),
        brandId: String(x.brand_id ?? ''),
        marca: String(x.marca ?? ''),
        locales: locales(x.locales),
        colocadas: num(v.colocadas),
        antesDelRecuento: num(v.antes_del_recuento),
        fallidas: num(v.fallidas),
      }
    }),
    sinMarca: lista(r.sin_marca).map((s) => ({
      codigo: txt(s.codigo), local: txt(s.local), marcaLast: txt(s.marca_last), ventas: num(s.ventas), primera: txt(s.primera), ultima: txt(s.ultima),
    })),
  }
}

const dondeLocales = (l: LocalMarca[]): string => enumerar(l.map((x) => localCorto(x.nombre)))

/** «¿Es tu Dirty Burger?» */
export const tituloPregunta = (q: Pregunta): string => `¿Es tu ${q.comparacion.marca}?`

/** «Llegan pedidos de Alcalá con una marca «Dirty Burgers» que Folvy no conocía. Su carta se parece a la de tu Dirty Burger.» */
export function textoPregunta(q: Pregunta): string {
  const donde = q.locales.length ? ` de ${dondeLocales(q.locales)}` : ''
  const como = q.comparacion.identica ? 'Su carta es idéntica a' : 'Su carta se parece a'
  return `${q.ventas.despues + q.ventas.antes > 0 ? 'Llegan pedidos' : 'Aparece en Last'}${donde} con una marca «${q.nombre}» que Folvy no conocía. ${como} la de tu ${q.comparacion.marca}.`
}

/** «Patatas Clásicas, Dirty Burger Trufada…» (los primeros, con «…» si hay más). */
export function platosEnLinea(xs: { nombre: string }[], cuantos = 4): string {
  const nombres = xs.map((x) => x.nombre)
  return nombres.length > cuantos ? `${nombres.slice(0, cuantos).join(', ')}…` : nombres.join(', ')
}

/** «31 platos, 31 con receta. 29 de 31 coinciden.» */
export const resumenFolvy = (c: Comparacion): string =>
  `${plural(c.platosFolvy, 'plato', 'platos')}, ${c.conReceta} con receta. ${c.coinciden} de ${c.platosFolvy} ${c.coinciden === 1 ? 'coincide' : 'coinciden'}.`

/** El chip de la pregunta: «6 ventas esperando». */
export const chipPregunta = (q: Pregunta): string =>
  q.ventas.despues + q.ventas.antes > 0 ? `${plural(q.ventas.despues + q.ventas.antes, 'venta esperando', 'ventas esperando')}` : 'Sin ventas todavía'

/** «Al confirmar, las 6 ventas pasan a Dirty Burger y descuentan almacén con sus recetas.» */
export function pistaPregunta(q: Pregunta): string {
  const n = q.ventas.despues
  const base = n > 0
    ? `Al confirmar, ${n === 1 ? 'la venta pasa' : `las ${n} ventas pasan`} a ${q.comparacion.marca} y ${n === 1 ? 'descuenta' : 'descuentan'} almacén con sus recetas.`
    : `Al confirmar, lo que venda pasa a ${q.comparacion.marca} y descuenta almacén con sus recetas.`
  return q.ventas.antes > 0 && q.ventas.corte
    ? `${base} ${plural(q.ventas.antes, 'venta es', 'ventas son')} de antes del último recuento (${fechaCorta(q.ventas.corte)}): se ${q.ventas.antes === 1 ? 'queda' : 'quedan'} como ${q.ventas.antes === 1 ? 'está' : 'están'}.`
    : base
}

/** Lo que devuelve «Sí, es…»: la frase del aviso («Hecho: … 6 ventas colocadas y descontadas del almacén.»). */
export function fraseUnida(nombreLast: string, marca: string, l: LocalMarca[], r: ResultadoColocar, sinReceta: string[] = []): string {
  const donde = l.length ? ` de ${dondeLocales(l)}` : ''
  const ventas = r.colocadas > 0 ? ` ${plural(r.colocadas, 'venta colocada', 'ventas colocadas')}${sinReceta.length ? '' : ' y descontadas del almacén'}.` : ' No tenía ventas esperando.'
  const faltan = sinReceta.length ? ` Falta la receta de ${enumerar(sinReceta)}: ${sinReceta.length === 1 ? 'descontará' : 'descontarán'} en cuanto la pongas.` : ''
  const antes = r.antesDelRecuento > 0 ? ` ${plural(r.antesDelRecuento, 'venta de antes', 'ventas de antes')} del último recuento se ${r.antesDelRecuento === 1 ? 'queda' : 'quedan'} como ${r.antesDelRecuento === 1 ? 'estaba' : 'estaban'}.` : ''
  const fallos = r.fallidas > 0 ? ` ${plural(r.fallidas, 'venta no se ha podido colocar', 'ventas no se han podido colocar')}.` : ''
  return `Hecho: ${nombreLast}${donde} es tu ${marca}.${ventas}${faltan}${antes}${fallos}`
}

/** El aviso de lo que Folvy hizo solo: «Dirty Burgers en Alcalá: reconocida como tu Dirty Burger, 6 ventas colocadas». */
export function textoReconocida(r: Reconocida): { titulo: string; detalle: string } {
  const donde = r.locales.length ? ` en ${dondeLocales(r.locales)}` : ''
  const ventas = r.colocadas > 0 ? `${plural(r.colocadas, 'venta colocada', 'ventas colocadas')}` : 'sin ventas que colocar'
  const extra = [r.antesDelRecuento > 0 ? `${plural(r.antesDelRecuento, 'de antes', 'de antes')} del último recuento, como estaban` : '',
    r.fallidas > 0 ? `${plural(r.fallidas, 'no se ha podido colocar', 'no se han podido colocar')}` : ''].filter(Boolean)
  if (r.como === 'codigo_nuevo') {
    return {
      titulo: `${r.marca} llega${r.locales.length ? ` a ${dondeLocales(r.locales)}` : ''} con otro código de Last`,
      detalle: `Vinculada sola: es la misma marca. ${ventas[0].toUpperCase()}${ventas.slice(1)}.${extra.length ? ` ${extra.join('; ')}.` : ''}`,
    }
  }
  return {
    titulo: `${r.nombreLast}${donde}: reconocida, ${ventas}`,
    detalle: `Llegó de Last con otro código y la misma carta que tu ${r.marca}: Folvy la ha unido sola.${extra.length ? ` ${extra.join('; ')}.` : ''}`,
  }
}

/** Ventas de Last sin marca, de un código que Folvy no conoce: «1 venta sin marca en Alcalá (código 27d1…)». */
export function textoSinMarca(s: SinMarca): string {
  const donde = s.local ? ` en ${localCorto(s.local)}` : ''
  const de = s.marcaLast ? `de «${s.marcaLast}»` : `de un código que Last no tiene en su carta${s.codigo ? ` (${s.codigo.slice(0, 8)}…)` : ''}`
  const cuando = s.ultima ? `, la última del ${fechaCorta(s.ultima)}` : ''
  return `${plural(s.ventas, 'venta sin marca', 'ventas sin marca')}${donde}, ${de}${cuando}.`
}
