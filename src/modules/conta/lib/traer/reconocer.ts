// src/modules/conta/lib/traer/reconocer.ts
//
// N04 · Qué es cada fichero, POR LO QUE LLEVA DENTRO (los títulos de sus columnas y,
// de apoyo, su título), nunca por el nombre del fichero. Los títulos se comparan
// limpios: sin acentos, sin mayúsculas, sin puntos y sin espacios («N.I.F.» = «nif»,
// «Subcuenta » = «subcuenta»), y se buscan en su fila, no en una columna fija.
//
// Los libros de facturas recibidas y expedidas son el formato oficial de la AEAT
// (los sacan igual ERP10, Diez y otros programas): dos filas de títulos, la segunda
// completa a la primera («NIF Expedidor» › «Identificación»).

import { texto, type Celda, type FicheroExcel, type Hoja } from './excel'

export type TipoFichero = 'plan_cuentas' | 'proveedores' | 'clientes' | 'inmovilizado' | 'diario' | 'sumas_saldos' | 'recibidas' | 'expedidas'

/** En el orden en que se enseñan, con el nombre que ve quien lo sube. */
export const TIPOS: readonly { tipo: TipoFichero; nombre: string }[] = [
  { tipo: 'proveedores', nombre: 'Proveedores' },
  { tipo: 'clientes', nombre: 'Clientes' },
  { tipo: 'inmovilizado', nombre: 'Inmovilizado' },
  { tipo: 'plan_cuentas', nombre: 'Plan de cuentas' },
  { tipo: 'diario', nombre: 'Diario' },
  { tipo: 'expedidas', nombre: 'Facturas emitidas' },
  { tipo: 'recibidas', nombre: 'Facturas recibidas' },
  { tipo: 'sumas_saldos', nombre: 'Sumas y saldos' },
]
export const nombreDe = (t: TipoFichero): string => TIPOS.find((x) => x.tipo === t)!.nombre

/** Un título, limpio para comparar. */
export const clave = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Las claves de una fila, con su columna (la primera, si se repite). */
export function clavesDeFila(fila: readonly Celda[] | undefined): Map<string, number> {
  const m = new Map<string, number>()
  ;(fila ?? []).forEach((c, i) => { const k = clave(texto(c)); if (k && !m.has(k)) m.set(k, i) })
  return m
}

/** La primera fila (de las 20 primeras) que trae todos esos títulos. */
export function filaDeTitulos(h: Hoja, requeridos: readonly string[]): { fila: number; col: Map<string, number> } | null {
  for (let i = 0; i < Math.min(h.filas.length, 20); i++) {
    const col = clavesDeFila(h.filas[i])
    if (requeridos.every((r) => col.has(r))) return { fila: i, col }
  }
  return null
}

/**
 * Los títulos de dos filas (libros AEAT): cada columna, «grupo|subtítulo». El grupo
 * se arrastra a la derecha mientras la primera fila está vacía («NIF Expedidor»
 * cubre «Tipo», «Código País» e «Identificación»). Sin subtítulo: «grupo|».
 */
export function titulosDobles(h: Hoja, fila: number): Map<string, number> {
  const a = h.filas[fila] ?? [], b = h.filas[fila + 1] ?? []
  const m = new Map<string, number>()
  let grupo = ''
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const g = clave(texto(a[i])), s = clave(texto(b[i]))
    if (g) grupo = g
    else if (!s) continue
    const k = `${g || grupo}|${s}`
    if (!m.has(k)) m.set(k, i)
  }
  return m
}

/** El texto de las filas de encima de los títulos (el título del listado). */
function encima(h: Hoja, fila: number): string {
  return h.filas.slice(0, fila).flatMap((f) => f.map((c) => texto(c))).filter(Boolean).join(' ')
}

export interface Reconocido { tipo: TipoFichero; hoja: Hoja; fila: number }

const LIBRO_RECIBIDAS = ['identificacionfacturadelexpedidor', 'nifexpedidor', 'totalfactura', 'cuotaivasoportado']
const LIBRO_EXPEDIDAS = ['identificaciondelafactura', 'nifdestinatario', 'totalfactura', 'cuotaivarepercutida']
const DIARIO = ['serie', 'fecha', 'asiento', 'subcuenta', 'debe', 'haber']
const SUMAS = ['subcuenta', 'debe', 'haber', 'deudor', 'acreedor']
const PLAN = ['grupo', 'subgrupo', 'subcuenta', 'descripcion']
const TERCEROS = ['codigo', 'nombrefiscal', 'nif']
const INMOVILIZADO = ['codigo', 'subcuenta', 'descripcion', 'fcompra', 'precio', 'amortizado']

/** Qué es un fichero. Null si no es ninguno de los que se saben leer. */
export function reconocer(f: FicheroExcel): Reconocido | null {
  for (const h of f.hojas) {
    let t = filaDeTitulos(h, LIBRO_RECIBIDAS)
    if (t) return { tipo: 'recibidas', hoja: h, fila: t.fila }
    if ((t = filaDeTitulos(h, LIBRO_EXPEDIDAS))) return { tipo: 'expedidas', hoja: h, fila: t.fila }
    if ((t = filaDeTitulos(h, DIARIO))) return { tipo: 'diario', hoja: h, fila: t.fila }
    if ((t = filaDeTitulos(h, SUMAS))) return { tipo: 'sumas_saldos', hoja: h, fila: t.fila }
    if ((t = filaDeTitulos(h, PLAN))) return { tipo: 'plan_cuentas', hoja: h, fila: t.fila }
    if ((t = filaDeTitulos(h, INMOVILIZADO))) return { tipo: 'inmovilizado', hoja: h, fila: t.fila }
    if ((t = filaDeTitulos(h, TERCEROS))) {
      const titulo = clave(encima(h, t.fila))
      if (/proveedor|acreedor/.test(titulo)) return { tipo: 'proveedores', hoja: h, fila: t.fila }
      if (/cliente|deudor/.test(titulo)) return { tipo: 'clientes', hoja: h, fila: t.fila }
      // Sin título: por sus cuentas (40 y 41, proveedores y acreedores; 43 y 44, clientes y deudores).
      const c = t.col.get('codigo')!
      const codigos = h.filas.slice(t.fila + 1).map((r) => texto(r[c])).filter((x) => /^\d{3,}$/.test(x))
      if (codigos.length && codigos.every((x) => /^4[01]/.test(x))) return { tipo: 'proveedores', hoja: h, fila: t.fila }
      if (codigos.length && codigos.every((x) => /^4[34]/.test(x))) return { tipo: 'clientes', hoja: h, fila: t.fila }
    }
  }
  return null
}
