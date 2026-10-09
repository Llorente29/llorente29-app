#!/usr/bin/env node
// scripts/conta/modelos-pgc.mjs
//
// C05 · Extrae del texto del BOE (docs/conta/fuentes/textos/rd-1514-2007.txt y
// rd-1515-2007.txt, bajados por fuentes.mjs) los modelos oficiales de cuentas
// anuales —balance, pérdidas y ganancias y estado de ingresos y gastos
// reconocidos— de los tres planes (normal, abreviado y pymes), con las cuentas
// que el propio PGC pone en la columna «N.º CUENTAS» de cada línea.
//
// Toma SIEMPRE la última versión de cada bloque (la vigente). Deja la huella
// sha256 del texto del que sale, para que la carga de serie la cite.
//
//   node scripts/conta/modelos-pgc.mjs > docs/conta/referencia/modelos-cuentas-anuales.json
//
// Cómo se lee el texto (es una tabla del BOE aplanada en párrafos): la celda de
// cuentas va ANTES del texto de su línea; una celda puede ocupar varios
// párrafos. Dos rarezas del BOE, tratadas a propósito:
//   · una celda que acaba en coma y se corta con el texto de su línea en medio
//     (PyG normal, 13.b: «(6612)…(6623),» / «b) Por deudas con terceros» /
//     «(6624)…(669)» / «(660)» / «c)»): si a la línea siguiente le llegan DOS o
//     más párrafos de cuentas, el primero es la cola de la anterior. Con uno
//     solo, es suyo (balance normal, B.V.2 y B.V.3, que también acaba en coma);
//   · cuentas DESPUÉS de su línea, justo antes de un encabezado de bloque
//     (balance de pymes, A-2): son de la línea anterior;
//   · el texto de una línea partido en dos párrafos («1. Clientes por ventas y»
//     / «prestaciones de servicios.»): se juntan.
// Notación del PGC: «(2801)» resta; «71 *» o «610*» puede ir con los dos signos
// (en la PyG y el estado de ingresos y gastos, «(6300)*» lleva las dos marcas).
// Códigos de línea: en el balance, lado y ruta («ACT.A.I.1»); en la PyG y el
// estado de ingresos y gastos, la numeración del PGC sin la letra de bloque,
// que allí es única («1.a», «12.a.a1», «VIII»); los resultados, con «=»
// delante («=A.1», «=A») porque no son partidas sino sumas.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const DIR = 'docs/conta/fuentes/textos'

/** El texto de la última versión de un bloque «## [id]». */
export function ultimaVersion(texto, id) {
  const ini = texto.indexOf(`\n## [${id}]\n`)
  if (ini < 0) throw new Error(`no está el bloque ${id}`)
  const fin = texto.indexOf('\n## [', ini + 5)
  const bloque = texto.slice(ini, fin < 0 ? undefined : fin)
  const partes = bloque.split(/\n### versión · /)
  const ultima = partes.at(-1)
  const cabecera = ultima.slice(0, ultima.indexOf('\n'))
  return { vigente: cabecera, lineas: ultima.split('\n').slice(1) }
}

const esCuentas = (l) => /\d/.test(l) && /^[\d\s(),*]+$/.test(l)
/** Numeración de una línea del modelo y su nivel. */
function numeracion(l) {
  let m
  if ((m = l.match(/^([A-Z])\.(\d)\)\s/))) return { n: `${m[1]}.${m[2]}`, nivel: 1, total: true }
  if ((m = l.match(/^([A-Z])-(\d)\)\s/))) return { n: `${m[1]}${m[2]}`, nivel: 2, sub: true }
  if ((m = l.match(/^([A-Z])\)\s/))) return { n: m[1], nivel: 1, total: /\(.*\+/.test(l) }
  if ((m = l.match(/^([IVX]+)\.\s/))) return { n: m[1], nivel: 2 }
  if ((m = l.match(/^(\d+)\.\s/))) return { n: m[1], nivel: 3 }
  if ((m = l.match(/^([a-z]\d)\)\s/))) return { n: m[1], nivel: 5 }
  if ((m = l.match(/^([a-z])\)\s/))) return { n: m[1], nivel: 4 }
  if (/^TOTAL\b/.test(l)) return { n: 'TOTAL', nivel: 1, total: true }
  return null
}

/** «(2801)» → resta; «610*» → los dos signos. */
export function leerCuentas(s) {
  return s.split(',').map((x) => x.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^(\()?\s*(\d+)\s*(\))?\s*(\*)?$/)
    if (!m) throw new Error(`cuenta ilegible: «${t}» en «${s}»`)
    return { cuenta: m[2], signo: m[1] ? 'resta' : 'suma', dosSignos: !!m[4] }
  })
}

const FIN = /^(\* Su signo|Se modifica|Esta modificación|\(\*\)|Nota:|B\) ESTADO TOTAL)/

/**
 * Las líneas de un estado. `desde` es el título del estado; `hasta`, el del
 * siguiente (o nada). `nivelPyG`: en la PyG la numeración arábiga es nivel 2.
 */
export function leerEstado(lineas, desde, hasta, { pyg = false } = {}) {
  const i0 = lineas.findIndex((l) => l.startsWith(desde))
  if (i0 < 0) throw new Error(`no está «${desde}»`)
  let i1 = hasta ? lineas.findIndex((l, i) => i > i0 && l.startsWith(hasta)) : -1
  if (i1 < 0) i1 = lineas.length
  const filas = []
  let pendientes = [] // párrafos de cuentas a la espera de su línea
  let arrastre = null // la línea a la que va el siguiente párrafo de cuentas (rareza 1)
  let lado = null
  let enSub = false
  const ruta = []
  for (let i = i0 + 1; i < i1; i++) {
    const l = lineas[i].trim()
    if (!l) continue
    if (FIN.test(l)) break
    if (/^(ACTIVO|PATRIMONIO NETO Y PASIVO)$/.test(l)) { lado = l === 'ACTIVO' ? 'activo' : 'pn_pasivo'; ruta.length = 0; continue }
    if (esCuentas(l)) { pendientes.push(l); continue }
    const num = numeracion(l)
    if (!num) {
      // Cabeceras de la tabla, o el texto de la línea anterior partido en dos.
      const prev = filas.at(-1)
      if (prev && pendientes.length === 0 && !/\.\s*$|\)\s*$/.test(prev.texto) && !/^(N[°.º]|NOTAS|Notas|Nota|\(Debe\)|200X|2000X|MEMORIA)/i.test(l)) {
        prev.texto = `${prev.texto} ${l}`; continue
      }
      if (!/^(N[°.º]|NOTAS|Notas|Nota|\(Debe\)|200X|2000X|MEMORIA|Ingresos y gastos imputados|Transferencias a la cuenta)/i.test(l)) {
        filas.push({ codigo: null, nivel: 0, texto: l, cuentas: [], total: false, lado, rubrica: true })
      }
      continue
    }
    // Dentro de un subbloque del patrimonio neto (A-1, A-2, A-3) todo baja un nivel.
    if (num.nivel === 1) enSub = false
    if (num.sub) enSub = true
    const nivel = (pyg && num.nivel === 3 ? 2 : pyg && num.nivel === 4 ? 3 : pyg && num.nivel === 5 ? 4 : num.nivel) + (enSub && !num.sub && num.nivel > 1 ? 1 : 0)
    let codigo
    if (num.total) codigo = `=${lado === 'activo' ? 'ACT.' : lado === 'pn_pasivo' ? 'PNP.' : ''}${num.n}`
    else {
      ruta.length = nivel - 1
      ruta[nivel - 1] = num.n
      codigo = lado ? [lado === 'activo' ? 'ACT' : 'PNP', ...ruta].join('.') : (nivel === 1 ? num.n : ruta.slice(1).join('.'))
    }
    if (arrastre && pendientes.length >= 2) arrastre.cuentas.push(...leerCuentas(pendientes.shift()))
    // Un encabezado de bloque («B) PASIVO NO CORRIENTE») no lleva cuentas nunca:
    // si le llegan, son de la línea anterior, que el BOE puso al revés (pymes,
    // «A-2) Subvenciones…» / «130,131,132» / «B) PASIVO NO CORRIENTE»).
    if (num.nivel === 1 && !num.total && pendientes.length && filas.at(-1) && filas.at(-1).cuentas.length === 0) {
      filas.at(-1).cuentas.push(...leerCuentas(pendientes.join(',')))
      pendientes = []
    }
    const juntos = pendientes.join(',')
    const fila = {
      codigo,
      nivel, texto: l, cuentas: juntos ? leerCuentas(juntos) : [], total: !!num.total, lado,
    }
    arrastre = /,\s*$/.test(pendientes.at(-1) ?? '') ? fila : null
    pendientes = []
    filas.push(fila)
  }
  if (pendientes.length) throw new Error(`cuentas sin línea al final de «${desde}»: ${pendientes.join(' | ')}`)
  return filas.filter((f) => !f.rubrica)
}

// El estado total de cambios en el patrimonio neto (y el ECPN de pymes, que no
// tiene estado de ingresos y gastos aparte) es una matriz de movimientos por
// columna de patrimonio, sin columna «N.º cuentas»: sale de los movimientos de
// las cuentas del grupo 1 y de la 129, no de un mapeo línea ↔ cuentas.
const SOLO_MATRIZ = { lineas: [], nota: 'Matriz sin columna de cuentas en el PGC: se calcula de los movimientos del grupo 1 y la 129.' }

export function extraer() {
  const t1514 = readFileSync(`${DIR}/rd-1514-2007.txt`, 'utf8')
  const t1515 = readFileSync(`${DIR}/rd-1515-2007.txt`, 'utf8')
  const huella = (s) => createHash('sha256').update(s).digest('hex')
  const n = (id) => ultimaVersion(t1514, id)
  const balN = n('balance'), pygN = n('cuenta'), ecpnN = n('estadodecambios')
  const balA = n('balanceabreviado-2'), pygA = n('cuentaabreviada'), ecpnA = n('estadoabreviado')
  const pym = ultimaVersion(t1515, 'iimodelosdecuentasanuales')
  return {
    fuente: {
      'rd-1514-2007': { sha256: huella(t1514), fichero: `${DIR}/rd-1514-2007.txt` },
      'rd-1515-2007': { sha256: huella(t1515), fichero: `${DIR}/rd-1515-2007.txt` },
    },
    modelos: {
      normal: {
        balance: { vigente: balN.vigente, lineas: leerEstado(balN.lineas, 'BALANCE AL CIERRE', null) },
        pyg: { vigente: pygN.vigente, lineas: leerEstado(pygN.lineas, 'CUENTA DE PÉRDIDAS', null, { pyg: true }) },
        igrpn: { vigente: ecpnN.vigente, lineas: leerEstado(ecpnN.lineas, 'A) ESTADO DE INGRESOS', null) },
        ecpn_total: SOLO_MATRIZ,
      },
      abreviado: {
        balance: { vigente: balA.vigente, lineas: leerEstado(balA.lineas, 'BALANCE ABREVIADO', null) },
        pyg: { vigente: pygA.vigente, lineas: leerEstado(pygA.lineas, 'CUENTA DE PÉRDIDAS', null, { pyg: true }) },
        igrpn: { vigente: ecpnA.vigente, lineas: leerEstado(ecpnA.lineas, 'A) ESTADO ABREVIADO DE INGRESOS', null) },
        ecpn_total: SOLO_MATRIZ,
      },
      pymes: {
        balance: { vigente: pym.vigente, lineas: leerEstado(pym.lineas, 'BALANCE DE PYMES', 'CUENTA DE PÉRDIDAS') },
        pyg: { vigente: pym.vigente, lineas: leerEstado(pym.lineas, 'CUENTA DE PÉRDIDAS', 'ESTADO DE CAMBIOS', { pyg: true }) },
        ecpn: SOLO_MATRIZ,
      },
    },
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').at(-1))) {
  process.stdout.write(JSON.stringify(extraer(), null, 1) + '\n')
}
