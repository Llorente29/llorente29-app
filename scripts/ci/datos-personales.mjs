#!/usr/bin/env node
// scripts/ci/datos-personales.mjs <base> <head>
//
// W12 · Regla T11 (29/10): ningún dato personal real en el repositorio. El
// repositorio es público: un DNI, un NIE, un NAF o un IBAN de verdad en una
// prueba, una semilla, un commit o la descripción de un PR queda a la vista
// de cualquiera. Lo pagó el #298: el NIE y el nombre de un rider de Foodint
// entraron en una prueba (tests/conta/diez/texto.test.ts) y en la descripción
// del PR.
//
// Mira lo que AÑADE el PR (las líneas nuevas del diff, sus commits y su
// descripción, en PR_CUERPO) y busca, con su dígito de control:
//   · DNI: 8 cifras y la letra que les toca;
//   · NIE: X, Y o Z, 7 cifras y su letra;
//   · IBAN español: ES, 2 de control y 20 cifras, que pasa el módulo 97;
//   · NAF (número de la Seguridad Social): 12 cifras que pasan su control, en
//     una línea que habla de afiliación o de la Seguridad Social (sin eso, 12
//     cifras son cualquier cosa).
// Deja pasar lo inventado A LA VISTA (todo ceros, cifras repetidas, 1234567…,
// el banco 9999) y lo de la lista `scripts/ci/datos-inventados.txt` (los
// inventados que no lo parecen, cada uno con su porqué).
//
// Lo que NO puede ver, y se queda escrito en CLAUDE.md: los nombres de
// personas y lo que sale dentro de una captura.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE'
export const LISTA = 'scripts/ci/datos-inventados.txt'

export const dniValido = (n, l) => LETRAS[Number(n) % 23] === l.toUpperCase()
export const nieValido = (p, n, l) => dniValido(`${'XYZ'.indexOf(p.toUpperCase())}${n}`, l)
function mod97(cifras) { let r = 0; for (const c of cifras) r = (r * 10 + Number(c)) % 97; return r }
export const ibanValido = (iban) => {
  const s = iban.slice(4) + iban.slice(0, 4)
  return mod97(s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))) === 1
}
/** NAF: provincia (2) + número (8) + control (2) = (provincia·10⁸ + número) mod 97; con número < 10⁷, provincia·10⁷ + número. */
export const nafValido = (d) => {
  const prov = Number(d.slice(0, 2)), num = Number(d.slice(2, 10)), ctl = Number(d.slice(10, 12))
  if (prov < 1 || prov > 53) return false
  const base = num < 10_000_000 ? prov * 10_000_000 + num : prov * 100_000_000 + num
  return base % 97 === ctl
}

/** ¿Se ve a simple vista que es inventado? Todo ceros, una cifra repetida, una escalera (1234567), el banco 9999. */
export function inventadoALaVista(tipo, valor) {
  const cifras = valor.replace(/\D/g, '')
  const escalera = (s) => { let n = 1; for (let i = 1; i < s.length; i++) { n = Number(s[i]) === Number(s[i - 1]) + 1 ? n + 1 : 1; if (n >= 7) return true } return false }
  const repetida = (s, k) => new RegExp(`(\\d)\\1{${k - 1}}`).test(s)
  if (tipo === 'IBAN') {
    const banco = cifras.slice(2, 6), cuenta = cifras.slice(-10)
    return banco === '9999' || repetida(cuenta, 6) || escalera(cifras)
  }
  return repetida(cifras, 6) || escalera(cifras) || /^0{4}/.test(cifras)
}

/** La lista de inventados que no lo parecen: un valor por línea, «# porqué» al lado; lo demás se ignora. */
export function leerLista(texto) {
  return new Set(texto.split('\n').map((l) => l.replace(/#.*/, '').trim().toUpperCase().replace(/[\s-]/g, '')).filter(Boolean))
}

/** Los datos que parecen reales en un texto: [{ tipo, valor, linea }]. */
export function buscar(texto, lista = new Set()) {
  const out = []
  texto.split('\n').forEach((l, i) => {
    const poner = (tipo, valor) => {
      const v = valor.toUpperCase().replace(/[\s-]/g, '')
      if (!lista.has(v) && !inventadoALaVista(tipo, v)) out.push({ tipo, valor: v, linea: i + 1 })
    }
    // Con espacio delante de la letra, solo en mayúscula: «70000000 y» es una cuenta y una «y».
    for (const m of l.matchAll(/(?<![A-Za-z0-9])(\d{8})(?:-?([A-Za-z])| ([A-Z]))(?![A-Za-z0-9])/g)) {
      const letra = m[2] ?? m[3]
      if (dniValido(m[1], letra)) poner('DNI', `${m[1]}${letra}`)
    }
    for (const m of l.matchAll(/(?<![A-Za-z0-9])([XYZxyz])[- ]?(\d{7})[- ]?([A-Za-z])(?![A-Za-z0-9])/g)) {
      if (nieValido(m[1], m[2], m[3])) poner('NIE', `${m[1]}${m[2]}${m[3]}`)
    }
    for (const m of l.matchAll(/(?<![A-Za-z0-9])ES\d{2}(?:[ ]?\d{4}){5}(?!\d)/g)) {
      const v = m[0].replace(/\s/g, '')
      if (ibanValido(v)) poner('IBAN', v)
    }
    if (/\bNAF\b|afiliaci[oó]n|seguridad social|\bNUSS\b/i.test(l)) {
      for (const m of l.matchAll(/(?<!\d)(\d{2})[/ ]?(\d{8})[/ ]?(\d{2})(?!\d)/g)) {
        const d = m[1] + m[2] + m[3]
        if (nafValido(d)) poner('NAF', d)
      }
    }
  })
  return out
}

const NOMBRE = { DNI: 'un DNI', NIE: 'un NIE', IBAN: 'un IBAN', NAF: 'un número de la Seguridad Social (NAF)' }

/** El mensaje, en tres partes: qué ha pasado, dónde y qué hacer. */
export function mensaje(h, donde) {
  return `Hay ${NOMBRE[h.tipo]} que parece real (${h.valor}) en ${donde}. `
    + `El repositorio es público: un dato de una persona de verdad no puede estar aquí. `
    + `Qué hacer: cámbialo por uno inventado que se vea que lo es (todo ceros, 12345678…; para un IBAN, el banco 9999), `
    + `o, si ya es inventado, añádelo a ${LISTA} con su porqué.`
}

/** Las líneas que añade el diff, por fichero: [{ fichero, linea, texto }]. */
export function lineasAnadidas(diff) {
  const out = []
  let fichero = null, n = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { fichero = l.slice(4).replace(/^b\//, ''); continue }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l)
    if (h) { n = Number(h[1]); continue }
    if (!fichero || l.startsWith('---')) continue
    if (l.startsWith('+')) { out.push({ fichero, linea: n, texto: l.slice(1) }); n++ }
    else if (!l.startsWith('-')) n++
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, head] = process.argv.slice(2)
  const lista = leerLista(readFileSync(LISTA, 'utf8'))
  const fallos = []
  const diff = execFileSync('git', ['diff', '-U0', '--no-color', '--diff-filter=AM', `${base}...${head}`, '--', '.', `:(exclude)${LISTA}`,
    ':(exclude)**/*.png', ':(exclude)**/*.jpg', ':(exclude)**/*.pdf', ':(exclude)**/*.xlsx'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  for (const a of lineasAnadidas(diff)) for (const h of buscar(a.texto, lista)) fallos.push(mensaje(h, `\`${a.fichero}\`, línea ${a.linea}`))
  const commits = execFileSync('git', ['log', '--format=%h%x00%B%x01', `${base}..${head}`], { encoding: 'utf8' }).split('\x01')
  for (const c of commits) {
    const [h, cuerpo] = c.trim().split('\x00')
    if (!cuerpo) continue
    for (const x of buscar(cuerpo, lista)) fallos.push(mensaje(x, `el mensaje del commit ${h}, línea ${x.linea}`))
  }
  for (const x of buscar(process.env.PR_CUERPO ?? '', lista)) fallos.push(mensaje(x, `la descripción del PR, línea ${x.linea}`))
  if (fallos.length) {
    for (const f of fallos) console.log(`::error::${f}`)
    process.exit(1)
  }
  console.log(`Ningún DNI, NIE, NAF ni IBAN que parezca real en lo que añade el PR (lista de inventados: ${lista.size}).`)
}
