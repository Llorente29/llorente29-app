#!/usr/bin/env node
// scripts/conta/produccion/cuentas-comparar.mjs <antes.csv> <después.csv> [etiqueta-antes] [etiqueta-después]
// scripts/conta/produccion/cuentas-comparar.mjs <antes.csv>     (solo la tabla de antes, para el informe)
//
// R9 (Julio, 13/10) · Compara las cuentas que declara la tanda (cuentas.sh),
// tomadas con la misma vara a los dos lados. Imprime el trozo del informe
// (Markdown) y sale con 1 si alguna medida no coincide, diciendo cuánto falta
// (después − antes) en las que son números.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** «fichero,clave,valor» por línea → Map(«fichero · clave» → valor), en orden. */
export function leerCuentas(texto) {
  const m = new Map()
  for (const l of texto.split('\n')) {
    if (!l.trim()) continue
    const i = l.indexOf(',')
    const j = l.lastIndexOf(',')
    if (i < 0 || j <= i) continue
    const quita = (x) => x.replace(/^"(.*)"$/, '$1')
    m.set(`${l.slice(0, i)} · ${quita(l.slice(i + 1, j))}`, quita(l.slice(j + 1)))
  }
  return m
}

const numero = (x) => (x !== undefined && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : null)

export function compararCuentas(antes, despues, ea = 'Antes', ed = 'Después') {
  const filas = []
  const distintas = []
  for (const k of new Set([...antes.keys(), ...despues.keys()])) {
    const a = antes.get(k)
    const d = despues.get(k)
    let nota = 'igual'
    if (a !== d) {
      const na = numero(a)
      const nd = numero(d)
      if (na !== null && nd !== null) {
        const dif = Math.round((nd - na) * 100) / 100
        nota = `**${dif > 0 ? '+' : ''}${dif}** (${dif < 0 ? `faltan ${-dif}` : `sobran ${dif}`})`
      } else {
        nota = a === undefined ? '**no se midió antes**' : d === undefined ? '**no se midió después**' : '**distinta**'
      }
      distintas.push(`${k}: ${a ?? '—'} → ${d ?? '—'}`)
    }
    filas.push(`| ${k} | ${a ?? '—'} | ${d ?? '—'} | ${nota} |`)
  }
  const markdown = [`| Medida | ${ea} | ${ed} | |`, '|---|---|---|---|', ...filas, ''].join('\n')
  return { iguales: distintas.length === 0 && antes.size > 0, distintas, medidas: antes.size, markdown }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , fa, fd, ea, ed] = process.argv
  if (!fa) { console.error('Uso: cuentas-comparar.mjs <antes.csv> [<después.csv> [etiqueta-antes] [etiqueta-después]]'); process.exit(2) }
  const leer = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
  if (!fd) {
    console.log(['| Medida | Antes |', '|---|---|', ...[...leerCuentas(leer(fa))].map(([k, v]) => `| ${k} | ${v} |`), ''].join('\n'))
    process.exit(0)
  }
  const r = compararCuentas(leerCuentas(leer(fa)), leerCuentas(leer(fd)), ea, ed)
  console.log(r.markdown)
  if (r.iguales) console.log(`Las ${r.medidas} medidas, iguales.`)
  else if (r.medidas === 0) console.log('**No hay medidas de antes**: no se puede decir que esté como antes.')
  else console.log(`**${r.distintas.length} de ${r.medidas} medidas distintas:** ${r.distintas.join(' · ')}`)
  process.exitCode = r.iguales ? 0 : 1
}
