// tests/conta/fixtures/importar/diez/pdfDiez.mjs
//
// C02c · Escribe un PDF con la FORMA de los listados de Cegid Diez (ver
// src/modules/conta/lib/lectorDiez.ts). Lo usa generar.mjs; los datos son los
// inventados de la fixture.
//
// Lo que copia de Diez, medido en los PDF reales (sin traer ningún dato):
//   · Plan de Cuentas: A4 vertical (595,5 × 842,25). Empresa arriba a la
//     derecha; título a 16 pt en (30,8; 745,3); cabecera «Subcuenta» (138,8) y
//     «Descripción» (205,5) a 728,9; grupo / subgrupo / cuenta / nivel 4 con su
//     código en x 29,3 / 45,0 / 61,5 / 78,0 y su título 41,3 más a la derecha;
//     la subcuenta y su descripción en 138,8 y 205,5.
//   · Listados: A4 apaisado (842,25 × 595,5). Título en (30,8; 498,6); cabecera a
//     7 pt en 483,1: Código 29,3 · N.I.F. 80,3 · Nombre 126,0 · Dirección 299,3 ·
//     C.Postal 482,3 · Población 514,5 · Provincia 624,8 · Observaciones 681,8;
//     filas cada 10,5 desde 471,1.
//   · «(N registros)» a 7 pt en x 32,3 debajo de la última fila, y en cada
//     página «Página:» y «X de Y» abajo a la derecha (y 32,1).
//   · Cada celda, su propio bloque de texto; las letras con un ajuste de
//     posición entre una y otra (el TJ del PDF), y un espacio de verdad entre
//     palabras. En algunos nombres un ajuste grande parte una palabra para quien
//     lea el texto «montado», como pasa en el real.
//
// PDF 1.4 a mano: una fuente (Helvetica, WinAnsi), un objeto por página.

import { writeFileSync } from 'node:fs'

const EMPRESA = ['TABERNA DE PRUEBA NORTE, S.L.', 'CALLE INVENTADA, 1', '28000 MADRID', 'MADRID', 'B99999990']

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`)

/**
 * El texto de una celda como TJ: letra a letra con un ajuste pequeño, y si
 * `partir` es un índice, uno grande (-150 milésimas) antes de esa letra.
 */
function tj(texto, partir = -1) {
  const partes = []
  for (let i = 0; i < texto.length; i++) {
    if (i > 0) partes.push(i === partir ? '-150' : i % 2 ? '11.25' : '-4.6')
    partes.push(`(${esc(texto[i])})`)
  }
  return `[${partes.join(' ')}] TJ`
}

/** Dónde se parte un nombre: dentro de su palabra más larga (de 6 letras o más), en la tercera letra. Una de cada tres. */
function dondePartir(texto, n) {
  if (n % 3 !== 0) return -1
  let mejor = -1, largo = 0, at = 0
  for (const w of texto.split(' ')) {
    if (/^[A-ZÁÉÍÓÚÑ]{6,}$/.test(w) && w.length > largo) { largo = w.length; mejor = at + 2 }
    at += w.length + 1
  }
  return mejor
}

class Paginas {
  constructor(ancho, alto) { this.ancho = ancho; this.alto = alto; this.paginas = []; this.actual = null }
  nueva() { this.actual = []; this.paginas.push(this.actual) }
  celda(x, y, texto, tam = 8, partir = -1) {
    if (texto === '' || texto == null) return
    this.actual.push(`BT /F1 ${tam} Tf ${x} ${y} Td ${tj(String(texto), partir)} ET`)
  }
  empresa(xNombre, yNombre, xDer) {
    // Nombre a 10 pt; debajo, dirección, CP y población, provincia y NIF, alineados a la derecha (aprox.).
    this.celda(xNombre, yNombre, EMPRESA[0], 10)
    EMPRESA.slice(1).forEach((t, i) => this.celda(xDer - t.length * 4.4, yNombre - 11.35 - i * 10.2, t))
  }
  pies() {
    const n = this.paginas.length
    this.paginas.forEach((p, i) => {
      const x = this.ancho > this.alto ? 713.3 : 470.3
      p.push(`BT /F1 8 Tf ${x} 32.1 Td ${tj('Página:')} ET`)
      p.push(`BT /F1 8 Tf ${x + 30.7} 32.1 Td ${tj(`${i + 1} de ${n}`)} ET`)
    })
  }
  escribir(ruta) {
    const objs = []
    const add = (o) => { objs.push(o); return objs.length }
    const catalogo = add(null)
    const paginas = add(null)
    const fuente = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    const kids = []
    for (const p of this.paginas) {
      const flujo = Buffer.from(p.join('\n'), 'latin1')
      const c = add(`<< /Length ${flujo.length} >>\nstream\n${flujo.toString('latin1')}\nendstream`)
      kids.push(add(`<< /Type /Page /Parent ${paginas} 0 R /MediaBox [0 0 ${this.ancho} ${this.alto}] /Resources << /Font << /F1 ${fuente} 0 R >> >> /Contents ${c} 0 R >>`))
    }
    objs[catalogo - 1] = `<< /Type /Catalog /Pages ${paginas} 0 R >>`
    objs[paginas - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
    let out = '%PDF-1.4\n'
    const offs = []
    objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const xref = Buffer.byteLength(out, 'latin1')
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    writeFileSync(ruta, Buffer.from(out, 'latin1'))
  }
}

/** El plan: filas [código, nombre] (las de menos de 8 dígitos son grupo, subgrupo, cuenta o nivel 4). */
function plan(filas) {
  const P = new Paginas(595.5, 842.25)
  const X = { 1: 29.3, 2: 45.0, 3: 61.5, 4: 78.0, 5: 78.0 }
  let y = 0
  const pagina = () => {
    P.nueva()
    P.empresa(359.3, 803.2, 563)
    P.celda(30.8, 745.3, 'Plan de Cuentas', 16)
    P.celda(138.8, 728.9, 'Subcuenta')
    P.celda(205.5, 728.9, 'Descripción')
    y = 716.1
  }
  pagina()
  let n = 0
  filas.forEach(([code, nombre], i) => {
    if (y < 60) pagina()
    if (code.length >= 6) {
      P.celda(138.8, y, code)
      P.celda(205.5, y, nombre, 8, dondePartir(nombre, i))
      n++
      y -= 12
    } else {
      P.celda(X[code.length], y, code)
      P.celda(X[code.length] + 41.3, y, nombre)
      y -= 15
    }
  })
  P.celda(32.3, y - 1.5, `(${n} registros)`, 7)
  P.pies()
  return P
}

/** Un listado de terceros: [{code, nif, nombre, direccion, cp, poblacion, provincia}]. */
function listado(titulo, terceros) {
  const P = new Paginas(842.25, 595.5)
  const COL = [['Código', 29.3], ['N.I.F.', 80.3], ['Nombre', 126.0], ['Dirección', 299.3], ['C.Postal', 482.3], ['Población', 514.5], ['Provincia', 624.8], ['Observaciones', 681.8]]
  let y = 0
  const pagina = () => {
    P.nueva()
    P.empresa(602.3, 556.5, 806)
    P.celda(30.8, 498.6, titulo, 16)
    for (const [t, x] of COL) P.celda(x, 483.1, t, 7)
    y = 471.1
  }
  pagina()
  terceros.forEach((t, i) => {
    if (y < 60) pagina()
    P.celda(29.3, y, t.code, 7)
    P.celda(80.3, y, t.nif, 7)
    P.celda(126.0, y, t.nombre, 7, dondePartir(t.nombre, i))
    P.celda(299.3, y, t.direccion, 7)
    P.celda(482.3, y, t.cp, 7)
    P.celda(514.5, y, t.poblacion, 7)
    P.celda(624.8, y, t.provincia, 7)
    y -= 10.5
  })
  P.celda(32.3, y - 3, `(${terceros.length} registros)`, 7)
  P.pies()
  return P
}

export function escribirPdfDiez(ruta, datos) {
  const P = datos.tipo === 'plan' ? plan(datos.filas)
    : listado(datos.tipo === 'proveedores' ? 'Listado de proveedores / acreedores' : 'Listado de clientes / deudores', datos.terceros)
  P.escribir(ruta)
}
