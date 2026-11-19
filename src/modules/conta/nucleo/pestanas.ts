// src/modules/conta/nucleo/pestanas.ts
//
// K03 · Las pestañas de trabajo del núcleo, como dato (encargo K03, 17/11).
// Cada pantalla que se abre es una pestaña, y conserva lo que tenía al ir a
// otra y volver (eso lo hace MarcoNucleo: la pantalla de una pestaña escondida
// sigue montada). Aquí, sin React, lo que se decide:
//
//   · De QUÉ pestaña es una dirección (claveDe): la de su botón de la cinta
//     (Recibidas, Bancos, Sumas y saldos…), con dos excepciones. La ficha de un
//     documento va en su propia pestaña, y no en la de su lista: la factura
//     recibida, la emitida, el asiento. Una sola por clase: ‹ › pasa de una a
//     otra dentro de la misma. Y el mayor de cada cuenta va en la suya, porque
//     F5 abre «el mayor de la cuenta en otra pestaña».
//   · Abrir y volver (alNavegar): si la pestaña de esa dirección ya está, se
//     activa con la dirección nueva; si no, se abre una. Así hacen lo que
//     dijo el inventario el botón de atrás (va a la dirección de antes: se
//     activa o se abre su pestaña), un enlace directo (abre la suya) y
//     recargar (pestanasGuardadas: siguen las abiertas, dormidas hasta que se
//     vuelvan a mirar, y la activa, despierta).
//   · Cerrar (cerrar): la pestaña se va y se vuelve a la última que se miró.
//     Inicio no se cierra. Si había algo sin guardar, MarcoNucleo pregunta
//     ANTES de llamar aquí.
//   · Cuántas caben en la fila (cuantasCaben): las que no, a «N más ▾».
//     Ninguna se cierra sola (regla 7).

import { CONTA } from '@/config/navegacion'
import { relativa } from '@/modules/conta/esqueleto/productos'
import { nombreDePestana, sitioDe } from './mapa'

export const INICIO = 'inicio'

export interface Pestana {
  /** La clave de la pestaña (claveDe). */
  id: string
  /** Su dirección: camino y consulta («/conta/documentos?ver=por-revisar»). */
  url: string
  /** Montada: su pantalla está viva. Las que vuelven de recargar duermen hasta que se miran. */
  montada: boolean
  /** Cuándo se miró por última vez (para volver a ella al cerrar otra). */
  uso: number
}

export interface EstadoPestanas {
  /** Inicio, la primera, siempre; las demás, en el orden en que se abrieron. */
  abiertas: Pestana[]
  activa: string
}

const R = CONTA.rutas
const urlDeInicio = `/${CONTA.modulo}/${R.inicio}`

/** Las fichas de un documento: su pestaña propia, una por clase. */
const FICHAS: { clave: string; casa: (rel: string) => boolean }[] = [
  { clave: 'ficha:recibida', casa: (r) => r.startsWith('documentos/recibidas/') || r === R.recibidaAMano },
  { clave: 'ficha:emitida', casa: (r) => r.startsWith(`${R.facturasVenta}/`) },
  {
    clave: 'ficha:asiento',
    casa: (r) => r.startsWith(`${R.libroDiario}/`) && ![R.diarioResumido, R.pendientesDiez].some((x) => r === x || r.startsWith(`${x}/`)),
  },
]

/** La clave de la pestaña de una dirección (camino con o sin consulta). */
export function claveDe(url: string): string {
  const [camino, consulta = ''] = url.split('?')
  const rel = relativa(camino)
  const mayor = /^plan\/([^/]+)$/.exec(rel)
  if (mayor) return `mayor:${decodeURIComponent(mayor[1])}`
  const ficha = FICHAS.find((f) => f.casa(rel))
  if (ficha) return ficha.clave
  const s = sitioDe(rel, consulta ? `?${consulta}` : '')
  if (!s) return `url:${rel}`
  if (s.tipo === 'inicio') return INICIO
  if (s.tipo === 'persona') return `persona:${s.entrada.id}`
  return `boton:${s.boton.id}`
}

/** El nombre de una pestaña cuando su pantalla no dice el suyo. */
export function nombrePorDefecto(p: Pick<Pestana, 'id' | 'url'>): string {
  if (p.id.startsWith('mayor:')) return `Mayor · ${p.id.slice('mayor:'.length)}`
  if (p.id === 'ficha:recibida') return relativa(p.url.split('?')[0]) === R.recibidaAMano ? 'Factura recibida · nueva' : 'Factura recibida'
  if (p.id === 'ficha:emitida') return 'Factura emitida'
  if (p.id === 'ficha:asiento') return 'Asiento'
  const [camino, consulta = ''] = p.url.split('?')
  return nombreDePestana(sitioDe(relativa(camino), consulta ? `?${consulta}` : ''))
}

export const estadoInicial = (ahora: number): EstadoPestanas => ({ abiertas: [{ id: INICIO, url: urlDeInicio, montada: true, uso: ahora }], activa: INICIO })

/** La dirección ha cambiado (un botón, un enlace, atrás, un enlace directo): se activa o se abre su pestaña. */
export function alNavegar(e: EstadoPestanas, url: string, ahora: number): EstadoPestanas {
  const id = claveDe(url)
  const ya = e.abiertas.find((p) => p.id === id)
  if (ya) {
    if (e.activa === id && ya.url === url && ya.montada) return e
    return { activa: id, abiertas: e.abiertas.map((p) => (p.id === id ? { ...p, url, montada: true, uso: ahora } : p)) }
  }
  return { activa: id, abiertas: [...e.abiertas, { id, url, montada: true, uso: ahora }] }
}

/**
 * Cierra una pestaña (no Inicio). Si era la activa, se vuelve a la última que
 * se miró (o a Inicio): `ir` es su dirección, para navegar a ella.
 */
export function cerrar(e: EstadoPestanas, id: string): { estado: EstadoPestanas; ir: string | null } {
  if (id === INICIO || !e.abiertas.some((p) => p.id === id)) return { estado: e, ir: null }
  const abiertas = e.abiertas.filter((p) => p.id !== id)
  if (e.activa !== id) return { estado: { ...e, abiertas }, ir: null }
  const siguiente = [...abiertas].sort((a, b) => b.uso - a.uso)[0] ?? abiertas[0]
  return { estado: { abiertas, activa: siguiente.id }, ir: siguiente.url }
}

/** La de al lado (Alt Av Pág / Alt Re Pág), dando la vuelta. */
export function deAlLado(e: EstadoPestanas, paso: 1 | -1): Pestana {
  const i = e.abiertas.findIndex((p) => p.id === e.activa)
  const n = e.abiertas.length
  return e.abiertas[((i < 0 ? 0 : i) + paso + n) % n]
}

// ── Recargar: lo que se guarda en la sesión del navegador ─────────────────

export interface Guardadas { abiertas: { id: string; url: string }[]; activa: string }

export const aGuardar = (e: EstadoPestanas): Guardadas => ({ abiertas: e.abiertas.map((p) => ({ id: p.id, url: p.url })), activa: e.activa })

/**
 * Las pestañas de antes de recargar, con la dirección de ahora delante: siguen
 * todas, dormidas; la de la dirección, activa y despierta. Lo guardado que no
 * se entiende se ignora: lo de hoy no se rompe por un almacén raro.
 */
export function pestanasGuardadas(g: unknown, urlAhora: string, ahora: number): EstadoPestanas {
  let e = estadoInicial(ahora)
  const lista = (g && typeof g === 'object' && Array.isArray((g as Guardadas).abiertas)) ? (g as Guardadas).abiertas : []
  for (const x of lista) {
    if (!x || typeof x.url !== 'string' || !x.url.startsWith(`/${CONTA.modulo}/`)) continue
    const id = claveDe(x.url)
    if (id === INICIO || e.abiertas.some((p) => p.id === id)) continue
    e = { ...e, abiertas: [...e.abiertas, { id, url: x.url, montada: false, uso: 0 }] }
  }
  const conActiva = alNavegar(e, urlAhora, ahora)
  // Inicio solo está montada si es la que se mira (o se miró): al recargar en otra, duerme.
  return { ...conActiva, abiertas: conActiva.abiertas.map((p) => (p.id === INICIO && conActiva.activa !== INICIO ? { ...p, montada: false } : p)) }
}

// ── Cuántas caben en la fila ──────────────────────────────────────────────

/**
 * De las pestañas, en su orden, cuántas caben en `disponible` px dejando sitio
 * para «N más ▾» si hace falta. La activa siempre se ve: si no cabe en su
 * sitio, ocupa el último hueco (y la que estaba ahí va al menú).
 */
export function cuantasCaben(anchos: readonly number[], disponible: number, sitioDelMas: number, activa: number): { enFila: number[]; enMenu: number[] } {
  const total = anchos.reduce((s, a) => s + a, 0)
  const todas = anchos.map((_, i) => i)
  if (total <= disponible) return { enFila: todas, enMenu: [] }
  const enFila: number[] = []
  let usado = 0
  for (const i of todas) {
    if (usado + anchos[i] > disponible - sitioDelMas) break
    enFila.push(i)
    usado += anchos[i]
  }
  if (activa >= 0 && !enFila.includes(activa)) {
    while (enFila.length > 1 && usado + anchos[activa] > disponible - sitioDelMas) usado -= anchos[enFila.pop()!]
    enFila.push(activa)
  }
  return { enFila, enMenu: todas.filter((i) => !enFila.includes(i)) }
}

// ── K05 · 0b · Las pestañas son de su empresa (Julio, 19/11) ──────────────
//
// Cada pestaña es de la empresa con la que se abrió. Al cambiar de empresa
// arriba, solo se ven las de la nueva; las de la otra se APARCAN tal cual
// (siguen montadas, con lo escrito y sin guardar) y vuelven al volver a ella.
// Si la nueva no tiene ninguna, sale su Inicio. Lo que lee y guarda cada
// pestaña con su empresa lo pone el marco (PestanaViva, con la empresa de la
// pestaña en el contexto); aquí, sin React, qué se ve y a dónde se va.

export interface PestanasDeEmpresas {
  /** La empresa de las pestañas que se ven (null mientras no se sabe cuál es la activa). */
  empresa: string | null
  /** Las pestañas que se ven: las de `empresa`. */
  estado: EstadoPestanas
  /** Las de las demás empresas, aparcadas tal cual. */
  aparcadas: Record<string, EstadoPestanas>
}

/** La llave de una pestaña entre todas las empresas: su empresa y su clave. */
export const llaveDe = (empresa: string | null, id: string): string => `${empresa ?? ''}|${id}`

/**
 * La empresa de arriba es `nueva`. Si es la de las pestañas que se ven, nada.
 * La primera vez que se sabe (al cargar), las que se ven pasan a ser suyas. Si
 * no, las de ahora se aparcan con su empresa y se ven las de la nueva (o su
 * Inicio): `ir` es la dirección de la que queda activa, para navegar a ella.
 */
export function cambiarDeEmpresa(t: PestanasDeEmpresas, nueva: string, ahora: number): { t: PestanasDeEmpresas; ir: string | null } {
  if (t.empresa === nueva) return { t, ir: null }
  if (t.empresa === null) {
    const aparcadas = { ...t.aparcadas }
    delete aparcadas[nueva]
    return { t: { empresa: nueva, estado: t.estado, aparcadas }, ir: null }
  }
  const aparcadas = { ...t.aparcadas, [t.empresa]: t.estado }
  const suyas = aparcadas[nueva] ?? estadoInicial(ahora)
  delete aparcadas[nueva]
  const estado: EstadoPestanas = { ...suyas, abiertas: suyas.abiertas.map((p) => (p.id === suyas.activa ? { ...p, montada: true, uso: ahora } : p)) }
  const activa = estado.abiertas.find((p) => p.id === estado.activa) ?? estado.abiertas[0]
  return { t: { empresa: nueva, estado, aparcadas }, ir: activa.url }
}

/** Las otras empresas con algo abierto (además de su Inicio): cuántas pestañas tiene cada una, para la línea de abajo. */
export function abiertasEnOtras(t: PestanasDeEmpresas): { empresa: string; n: number }[] {
  return Object.entries(t.aparcadas)
    .map(([empresa, e]) => ({ empresa, n: e.abiertas.filter((p) => p.id !== INICIO).length }))
    .filter((x) => x.n > 0)
}

/** «1 pestaña abierta en X», «3 pestañas abiertas en X». */
export const fraseAbiertasEn = (n: number, empresa: string): string => `${n} pestaña${n === 1 ? '' : 's'} abierta${n === 1 ? '' : 's'} en ${empresa}`

// Recargar: lo que se guarda, con la empresa y las aparcadas.
export interface GuardadasPorEmpresa extends Guardadas { empresa: string | null; aparcadas: Record<string, Guardadas> }

export const aGuardarPorEmpresa = (t: PestanasDeEmpresas): GuardadasPorEmpresa => ({
  ...aGuardar(t.estado), empresa: t.empresa,
  aparcadas: Object.fromEntries(Object.entries(t.aparcadas).map(([k, e]) => [k, aGuardar(e)])),
})

/** Lo guardado antes de recargar: las que se veían, con la dirección de ahora, y las aparcadas, dormidas. */
export function pestanasDeEmpresasGuardadas(g: unknown, urlAhora: string, ahora: number): PestanasDeEmpresas {
  const estado = pestanasGuardadas(g, urlAhora, ahora)
  const x = (g && typeof g === 'object' ? g : {}) as Partial<GuardadasPorEmpresa>
  const empresa = typeof x.empresa === 'string' && x.empresa ? x.empresa : null
  const aparcadas: Record<string, EstadoPestanas> = {}
  if (x.aparcadas && typeof x.aparcadas === 'object') {
    for (const [k, v] of Object.entries(x.aparcadas)) {
      if (!k || k === empresa || !v || !Array.isArray((v as Guardadas).abiertas)) continue
      const activa = (v as Guardadas).abiertas.find((p) => p && p.id === (v as Guardadas).activa)
      const e = pestanasGuardadas(v, typeof activa?.url === 'string' ? activa.url : urlDeInicio, 0)
      aparcadas[k] = { ...e, abiertas: e.abiertas.map((p) => ({ ...p, montada: false })) }
    }
  }
  return { empresa, estado, aparcadas }
}
