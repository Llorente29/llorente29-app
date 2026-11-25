// src/modules/conta/nucleo/piezas/logica.ts
//
// K12 · Lo que deciden las piezas comunes de ERP10 (concepto_erp10_en_todo_sumied.md), sin pantalla: se prueba sin
// navegador (tests/unit/modules/conta/k12/piezas.test.ts).
//
//   · la lupa («Localización de registros»): qué registros encajan con lo escrito y en qué orden;
//   · las líneas que se repiten: desde la quinta se desplazan dentro de su bloque, y su suma de control;
//   · el separador entre la pantalla y el documento: la parte del documento que cabe, y el plegado con «‹»;
//   · el teclado: Intro de casilla en casilla.

/** Un registro de la lupa: código, descripción y, si los tiene, nombre comercial y N.I.F. */
export interface Registro { id: string; codigo: string; descripcion: string; comercial?: string | null; nif?: string | null }

/** Sin acentos ni mayúsculas, para buscar como se escribe. */
export const llano = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * La lupa: los registros que encajan con lo escrito, ordenados por la descripción (como ERP10). Encaja si el código
 * empieza por lo escrito, o la descripción, el nombre comercial o el N.I.F. lo contienen (cada palabra escrita, en
 * cualquier orden). Sin nada escrito, todos.
 */
export function filtrarRegistros<T extends Registro>(lista: readonly T[], texto: string): T[] {
  const q = llano(texto)
  const palabras = q.split(/\s+/).filter(Boolean)
  const orden = (a: T, b: T) => llano(a.descripcion).localeCompare(llano(b.descripcion), 'es') || a.codigo.localeCompare(b.codigo)
  if (!palabras.length) return [...lista].sort(orden)
  const sinPunto = q.replace(/[.\s]/g, '')
  return lista.filter((r) => {
    if (sinPunto && llano(r.codigo).startsWith(sinPunto)) return true
    const todo = `${llano(r.descripcion)} ${llano(r.comercial ?? '')} ${llano(r.nif ?? '')} ${llano(r.codigo)}`
    return palabras.every((p) => todo.includes(p))
  }).sort(orden)
}

/** Intro en la casilla de una lupa: el registro, si lo escrito es su código exacto o solo encaja uno; si no, abrir la lista. */
export function elegirConIntro<T extends Registro>(lista: readonly T[], texto: string): { registro: T | null; abrir: boolean } {
  const t = texto.trim()
  if (!t) return { registro: null, abrir: false }
  const exacto = lista.find((r) => llano(r.codigo) === llano(t) || llano(r.descripcion) === llano(t))
  if (exacto) return { registro: exacto, abrir: false }
  const r = filtrarRegistros(lista, t)
  return r.length === 1 ? { registro: r[0], abrir: false } : { registro: null, abrir: true }
}

/** Las líneas que se repiten: desde la quinta, la lista se desplaza dentro de su bloque (la pantalla no crece). */
export const LINEAS_SIN_DESPLAZAR = 4
export const seDesplaza = (n: number): boolean => n > LINEAS_SIN_DESPLAZAR

/** La suma de control de unas líneas con debe y haber, en céntimos para no perder ninguno; cuadra si debe = haber y hay algo. */
export function sumaDeControl(lineas: readonly { debe: number; haber: number }[]): { debe: number; haber: number; descuadre: number; cuadra: boolean } {
  const c = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100)
  const debe = lineas.reduce((s, l) => s + c(l.debe), 0)
  const haber = lineas.reduce((s, l) => s + c(l.haber), 0)
  // X14 · 2 · También en negativo: cuadra si el debe es el haber y alguna línea lleva importe (antes, «debe > 0»).
  const conImporte = lineas.some((l) => c(l.debe) !== 0 || c(l.haber) !== 0)
  return { debe: debe / 100, haber: haber / 100, descuadre: (debe - haber) / 100, cuadra: debe === haber && conImporte }
}

/** «2 líneas», «1 línea». */
export const cuantasLineas = (n: number): string => `${n} ${n === 1 ? 'línea' : 'líneas'}`

// ── El separador ────────────────────────────────────────────────────────────────────────────────────────────────
/** Lo menos que ocupa el documento, en píxeles; y lo menos que ocupa la pantalla mientras no esté plegada. */
export const DOCUMENTO_MINIMO = 240
export const PLEGADO = 1

/** La parte del documento (0–1) que cabe para un ancho pedido: entre su mínimo y lo que deja el mínimo de la pantalla. */
export function parteQueCabe(pedidoPx: number, anchoPx: number, minimoPantallaPx: number): number {
  if (!(anchoPx > 0)) return 0.5
  const max = Math.max(DOCUMENTO_MINIMO, anchoPx - minimoPantallaPx)
  return Math.min(max, Math.max(DOCUMENTO_MINIMO, pedidoPx)) / anchoPx
}

/** Lo guardado en la base, si vale: una parte entre 0 y 1 (1 = la pantalla plegada con «‹»); si no, null (la de siempre). */
export const repartoGuardado = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : x
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1 ? n : null
}

/** La parte del documento al abrir: la guardada; si no, la mitad desde 1600 px; si no, la de la maqueta (0,37 a 1366). */
export const ANCHO_MITAD = 1600
export const PARTE_MAQUETA = 0.37
export const parteDeSalida = (guardada: number | null, anchoVentana: number): number =>
  guardada ?? (anchoVentana >= ANCHO_MITAD ? 0.5 : PARTE_MAQUETA)

// ── El teclado ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Intro en una fila de casillas (la cabecera, la línea que se edita): a la siguiente que se puede escribir; al final,
 * lo que diga la pantalla (`fin`). Las grises (solo lectura) se saltan.
 */
export function siguienteEscribible(casillas: readonly { escribible: boolean }[], actual: number): number | 'fin' {
  for (let i = actual + 1; i < casillas.length; i++) if (casillas[i].escribible) return i
  return 'fin'
}

// ── El importe ──────────────────────────────────────────────────────────────────────────────────────────────────
// K12b (Julio, 22/11, al meter facturas): en la casilla de un importe, el punto y la coma valen como decimal (el punto
// del teclado numérico, como en ERP10), y al salir de la casilla se enseña siempre en formato español: 1.849,56.
//   · con coma: la coma es el decimal y los puntos, de miles («1.849,56», «1849,56»);
//   · sin coma y un solo punto: el punto es el decimal («1849.56», «63.6»), como el del teclado numérico;
//   · sin coma y varios puntos: son de miles («1.234.567»).
/** Un importe en formato español, con los miles siempre separados y dos decimales: 1.849,56 (Intl, en es-ES, no separa los de cuatro cifras). */
export function formatoImporte(n: number): string {
  const c = Math.round(Math.abs(n) * 100)
  const enteros = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 && c > 0 ? '-' : ''}${enteros},${String(c % 100).padStart(2, '0')}`
}

/** Lo que se dice al pasar el ratón por un importe dudoso. */
export const MOTIVO_IMPORTE_DUDOSO = '¿Miles o decimales? Escribe 1234 o 1,23'

/**
 * K12b (Julio, 22/11): más de dos cifras tras el decimal («1.234», «12.345», «1,234») es dudoso: ¿miles o decimales?
 * No se redondea ni se da por bueno; la casilla se queda en ámbar con lo escrito y no se guarda hasta corregirlo.
 * Varios puntos sin coma («1.234.567») son miles y no son dudosos.
 */
export function importeDudoso(texto: string): boolean {
  const t = texto.replace(/[\s€]/g, '')
  if (!t) return false
  const decimal = t.includes(',') ? t.slice(t.lastIndexOf(',') + 1) : (t.match(/\./g) ?? []).length === 1 ? t.slice(t.indexOf('.') + 1) : ''
  return /^\d{3,}$/.test(decimal)
}

/** El importe escrito, como número (0 si está vacío; NaN si no es un importe o es dudoso). */
export function leerImporte(texto: string): number {
  let t = texto.replace(/[\s€]/g, '')
  if (!t) return 0
  if (importeDudoso(t)) return NaN
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN
  return Number(t)
}

/** Lo escrito, en formato español con dos decimales («1849.56» → «1.849,56»); vacío o lo que no es un importe, tal cual. */
export function importeVisto(texto: string): string {
  if (!texto.trim()) return ''
  const n = leerImporte(texto)
  return Number.isFinite(n) ? formatoImporte(n) : texto
}
