// src/modules/conta/nucleo/ficha/teclas.ts
//
// K04 · Lo que decide una ficha del núcleo con el teclado (decisiones 11 y 12),
// sin React: lo heredan la recibida (K04), la emitida (K05) y el asiento (K06).
//
//   · Intro dentro de una casilla pasa a la siguiente; en la última, o fuera de
//     una casilla, hace «Guardar y siguiente». Sobre un botón o un enlace,
//     Intro es de ese botón. En un desplegable abierto o en un área de texto,
//     no se toca.
//   · Tab es el del navegador: el orden de las casillas en la página es el de
//     la maqueta, y el de Intro es el mismo (una sola lista).
//   · La cuenta se escribe como en ERP10: «6001» da la 60000001 (los tres
//     primeros dígitos, ceros y lo que sigue), «600.1» también, y si no es un
//     número, parte del nombre.

export type QueHaceIntro = { que: 'siguiente'; a: number } | { que: 'guardar' } | null

/**
 * Intro, según dónde está el foco. `orden`: cuántas casillas hay; `actual`: el
 * índice de la casilla con el foco, o -1 si no está en una casilla. `sobre`: lo
 * que tiene el foco cuando no es una casilla.
 */
export function queHaceIntro(o: { orden: number; actual: number; sobre?: 'boton' | 'texto' | 'lista' | null }): QueHaceIntro {
  if (o.sobre === 'boton' || o.sobre === 'texto' || o.sobre === 'lista') return null
  if (o.actual < 0) return { que: 'guardar' }
  if (o.actual >= o.orden - 1) return { que: 'guardar' }
  return { que: 'siguiente', a: o.actual + 1 }
}

export interface CuentaDelPlan { codigo: string; nombre: string }

const sinAcentos = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * El código completo de lo escrito, si es un número: «6001» → 60000001 con 8
 * dígitos; «600.1» → 60000001; un código ya completo, tal cual. null si no es
 * un número o no cabe.
 */
export function codigoEscrito(texto: string, digitos: number): string | null {
  const t = texto.trim()
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  if (t.includes('.')) {
    const [a, b] = t.split('.')
    const relleno = digitos - a.length - b.length
    return relleno < 0 ? null : `${a}${'0'.repeat(relleno)}${b}`
  }
  if (t.length === digitos) return t
  if (t.length > digitos || t.length < 4) return null
  const a = t.slice(0, 3)
  const b = t.slice(3)
  return `${a}${'0'.repeat(digitos - a.length - b.length)}${b}`
}

/**
 * Las cuentas que encajan con lo escrito, la mejor primero: el código completo
 * de «6001» o «600.1»; si no, las que empiezan por esas cifras; si no es un
 * número, las que llevan esas palabras en el nombre.
 */
export function cuentasQueEncajan(texto: string, cuentas: readonly CuentaDelPlan[], digitos: number): CuentaDelPlan[] {
  const t = texto.trim()
  if (!t) return []
  const completo = codigoEscrito(t, digitos)
  if (completo) {
    const exacta = cuentas.find((c) => c.codigo === completo)
    if (exacta) return [exacta]
  }
  if (/^[\d.]+$/.test(t)) {
    const cifras = t.replace(/\./g, '')
    return cuentas.filter((c) => c.codigo.startsWith(cifras))
  }
  const palabras = sinAcentos(t).split(/\s+/).filter(Boolean)
  return cuentas.filter((c) => { const n = sinAcentos(c.nombre); return palabras.every((p) => n.includes(p)) })
}

/** dd/mm/aaaa de una fecha AAAA-MM-DD; '' si no hay. */
export const fechaVista = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

/**
 * Una fecha escrita como en ERP10, a AAAA-MM-DD: «01/07/2026», «1/7/26»,
 * «01072026», «1-7» (el año, el de `hoy`). null si no es una fecha que exista.
 */
export function fechaEscrita(texto: string, hoy: string): string | null {
  const t = texto.trim()
  let d: number, m: number, y: number
  const sep = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t)
  const junto = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(t)
  if (sep) { d = +sep[1]; m = +sep[2]; y = sep[3] ? +sep[3] : +hoy.slice(0, 4) }
  else if (junto) { d = +junto[1]; m = +junto[2]; y = +junto[3] }
  else return null
  if (y < 100) y += 2000
  const f = new Date(Date.UTC(y, m - 1, d))
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
