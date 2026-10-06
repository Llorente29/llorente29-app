// src/modules/conta/lib/lectorDiez.ts
//
// C02c · El lector de los tres PDF de Cegid Diez (respuesta 1.4). Determinista:
// no hay modelo ni adivinanza, solo la posición de cada celda en la página.
//
// La forma, vista en los tres PDF de un cliente real (que no están en el
// repositorio; la fixture inventada de tests/conta/fixtures/importar/diez/
// la copia):
//
//   · «Plan de Cuentas» (A4 vertical, 42 páginas): grupo › subgrupo › cuenta ›
//     subcuenta, cada nivel más a la derecha; la subcuenta de 8 dígitos y su
//     descripción, en las columnas «Subcuenta» y «Descripción».
//   · «Listado de proveedores / acreedores» y «Listado de clientes / deudores»
//     (A4 apaisado): Código · N.I.F. · Nombre · Dirección · C.Postal ·
//     Población · Provincia · Observaciones.
//   · Los tres: arriba a la derecha la empresa (nombre, dirección, NIF); el
//     título; la fila de cabecera en CADA página; al final «(N registros)», y
//     en cada página «Página: X de Y».
//
// Diez escribe cada celda en su propio bloque de texto, en la x de su columna.
// Este núcleo recibe esas celdas (las saca celdasPdf.ts con pdfjs-dist) y
// devuelve la misma Lectura que el CSV o el Excel (importarPlan.ts).
//
// Los nombres partidos («GL OVO», «PR OVEEDORES») NO se arreglan aquí con un
// diccionario: no llegan partidos. Diez coloca cada letra con un ajuste de
// posición, y el texto «montado» de pdfjs convierte los ajustes grandes en un
// espacio que no existe. celdasPdf.ts lee las letras de una en una y solo pone
// un espacio donde el PDF trae el carácter espacio (textoDeGlifos, abajo).

import { limpiar, nifDeListado, type CuentaLeida, type Lectura, type TerceroLeido } from '@/modules/conta/lib/importarPlan'

export interface Celda { x: number; y: number; texto: string }
export interface PaginaPdf { celdas: Celda[] }

export type ListadoDiez = 'plan' | 'proveedores' | 'clientes'

export interface LecturaPdf {
  listado: ListadoDiez
  lectura: Lectura
  /** El «(N registros)» del pie, o null si el PDF no lo trae. */
  registros: number | null
}

export class PdfNoReconocido extends Error {}

/**
 * El texto de un showText de pdfjs: las letras, una a una. Los números son
 * ajustes de posición (el TJ del PDF) y NO son espacios: el espacio de verdad
 * es un carácter. Así «NOR[-111.75]TE» es «NORTE» y «UBER[34.7] EATS»,
 * «UBER EATS».
 */
export function textoDeGlifos(glifos: readonly unknown[]): string {
  let s = ''
  for (const g of glifos) {
    if (g && typeof g === 'object' && 'unicode' in g && typeof (g as { unicode: unknown }).unicode === 'string') s += (g as { unicode: string }).unicode
  }
  return s
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const TITULOS: { listado: ListadoDiez; empieza: string; nombre: string }[] = [
  { listado: 'plan', empieza: 'plan de cuentas', nombre: '«Plan de Cuentas»' },
  { listado: 'proveedores', empieza: 'listado de proveedores', nombre: '«Listado de proveedores / acreedores»' },
  { listado: 'clientes', empieza: 'listado de clientes', nombre: '«Listado de clientes / deudores»' },
]

// Las cabeceras de columna, por su texto (sin acentos ni puntos).
const CLAVE = (s: string) => sinAcentos(limpiar(s)).replace(/[.\s]/g, '')
const COLUMNAS_PLAN = { subcuenta: 'subcuenta', descripcion: 'descripcion' } as const
const COLUMNAS_LISTADO = {
  codigo: 'codigo', nif: 'nif', nombre: 'nombre', direccion: 'direccion', cp: 'cpostal', poblacion: 'poblacion', provincia: 'provincia', observaciones: 'observaciones',
} as const

const PIE_PAGINA = /^pagina:?$/
const PIE_NUMERO = /^(\d+)\s+de\s+(\d+)$/
const PIE_REGISTROS = /^\((\d+)\s+registros?\)$/

/** Las celdas de una página, en filas (de arriba abajo) y cada fila de izquierda a derecha. */
function filasDe(celdas: readonly Celda[]): Celda[][] {
  const porY = new Map<string, Celda[]>()
  for (const c of celdas) {
    if (!c.texto.trim()) continue
    const k = String(Math.round(c.y * 10) / 10)
    porY.set(k, [...(porY.get(k) ?? []), c])
  }
  return [...porY.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([, cs]) => cs.sort((a, b) => a.x - b.x))
}

/** A qué columna va una celda: la de la cabecera más a la derecha que empieza en su x o antes (con medio punto de holgura). */
function columnaDe<K extends string>(x: number, cols: ReadonlyMap<K, number>): K | null {
  let mejor: K | null = null
  let mx = -Infinity
  for (const [k, cx] of cols) if (cx <= x + 0.5 && cx > mx) { mejor = k; mx = cx }
  return mejor
}

/** Qué listado es, por su título. */
export function queListado(paginas: readonly PaginaPdf[]): ListadoDiez | null {
  for (const c of paginas[0]?.celdas ?? []) {
    const t = sinAcentos(limpiar(c.texto))
    const hit = TITULOS.find((x) => t.startsWith(x.empieza))
    if (hit) return hit.listado
  }
  return null
}

/**
 * Lee un PDF de Diez (sus celdas, página a página). `nombre` es el del fichero,
 * para los mensajes. Para y lo dice si:
 *   · no es ninguno de los tres listados;
 *   · falta una página («Página: X de Y» no cuadra con las que hay);
 *   · el pie dice N registros y se han leído otros tantos distintos.
 */
export function leerPdfDiez(paginas: readonly PaginaPdf[], nombre: string): LecturaPdf {
  const listado = queListado(paginas)
  if (!listado) {
    throw new PdfNoReconocido(`«${nombre}» no parece un listado de Diez: espero el ${TITULOS.map((t) => t.nombre).join(', el ')}. Si es otro, expórtalo a Excel.`)
  }
  const esperadas = new Set<string>(Object.values(listado === 'plan' ? COLUMNAS_PLAN : COLUMNAS_LISTADO))
  const cuentas: CuentaLeida[] = []
  const terceros: TerceroLeido[] = []
  const avisos: string[] = []
  let registros: number | null = null
  let totalPaginas: number | null = null
  let cols: Map<string, number> | null = null

  paginas.forEach((pg, ip) => {
    const filas = filasDe(pg.celdas)
    // La cabecera de columnas: la fila que trae todas las esperadas. Lo de encima (empresa, título) no se lee.
    const icab = filas.findIndex((f) => { const ks = new Set(f.map((c) => CLAVE(c.texto))); return [...esperadas].every((k) => ks.has(k)) })
    if (icab >= 0) cols = new Map(filas[icab].map((c) => [CLAVE(c.texto), c.x]))
    if (!cols) throw new PdfNoReconocido(`«${nombre}», página ${ip + 1}: no encuentro la fila de cabecera (${[...esperadas].join(', ')}).`)
    const colsPagina: Map<string, number> = cols
    for (const f of filas.slice(icab + 1)) {
      const texto = limpiar(f.map((c) => c.texto).join(' '))
      // Pies: «Página: X de Y» y «(N registros)».
      const sinPagina = sinAcentos(texto).replace(/^pagina:?\s*/, '')
      const nPag = PIE_NUMERO.exec(sinPagina)
      if (nPag && PIE_PAGINA.test(sinAcentos(f[0].texto.trim()))) { totalPaginas = Number(nPag[2]); continue }
      const nReg = PIE_REGISTROS.exec(texto)
      if (nReg) { registros = Number(nReg[1]); continue }

      const celda = (k: string) => {
        const c = f.find((x) => columnaDe(x.x, colsPagina) === k)
        return c ? c.texto : null
      }
      if (listado === 'plan') {
        // Grupo, subgrupo y cuenta van a la izquierda de «Subcuenta»: son títulos, no cuentas.
        if (f.every((c) => c.x < (colsPagina.get(COLUMNAS_PLAN.subcuenta) ?? 0) - 0.5)) continue
        const code = limpiar(celda(COLUMNAS_PLAN.subcuenta) ?? '').replace(/[.\s]/g, '')
        if (!/^\d{6,12}$/.test(code)) { avisos.push(`«${nombre}», página ${ip + 1}: «${texto}» no lleva un código de subcuenta; no se usa.`); continue }
        const nombreOrigen = (celda(COLUMNAS_PLAN.descripcion) ?? '').trim()
        cuentas.push({ code, nombreOrigen, nombre: limpiar(nombreOrigen) })
        continue
      }
      const code = limpiar(celda(COLUMNAS_LISTADO.codigo) ?? '').replace(/[.\s]/g, '')
      if (!/^\d{6,12}$/.test(code)) { avisos.push(`«${nombre}», página ${ip + 1}: «${texto}» no lleva un código de cuenta; no se usa.`); continue }
      const nombreOrigen = (celda(COLUMNAS_LISTADO.nombre) ?? '').trim()
      cuentas.push({ code, nombreOrigen, nombre: limpiar(nombreOrigen) })
      const nifTexto = celda(COLUMNAS_LISTADO.nif)
      const { nif, aviso } = nifDeListado(nifTexto)
      if (aviso) avisos.push(`${code}: ${aviso}`)
      if (nif) {
        const v = (k: string) => { const t = limpiar(celda(k) ?? ''); return t || null }
        terceros.push({
          code, nombreOrigen, nombre: limpiar(nombreOrigen), nif, nifOrigen: limpiar(nifTexto ?? ''),
          direccion: v(COLUMNAS_LISTADO.direccion), cp: codigoPostal(v(COLUMNAS_LISTADO.cp)),
          poblacion: v(COLUMNAS_LISTADO.poblacion), provincia: v(COLUMNAS_LISTADO.provincia),
        })
      }
    }
  })

  if (totalPaginas !== null && totalPaginas !== paginas.length) {
    throw new PdfNoReconocido(`«${nombre}» dice que tiene ${totalPaginas} páginas y llegan ${paginas.length}: falta alguna. Vuelve a sacarlo de Diez entero.`)
  }
  if (registros !== null && registros !== cuentas.length) {
    throw new PdfNoReconocido(`«${nombre}» dice «${registros} registros» y Folvy ha leído ${cuentas.length}: no sigo, porque faltaría o sobraría algo. Vuelve a sacarlo de Diez o mándalo en Excel.`)
  }
  return { listado, lectura: { programa: 'diez', cuentas, terceros, avisos }, registros }
}

/** Diez se come el cero de delante de los códigos postales de Álava a Baleares, Barcelona… («8018» es 08018). */
export function codigoPostal(cp: string | null): string | null {
  if (!cp) return null
  const d = cp.replace(/\s/g, '')
  if (/^\d{4}$/.test(d)) return `0${d}`
  return d
}
