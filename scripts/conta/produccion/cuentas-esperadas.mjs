#!/usr/bin/env node
// scripts/conta/produccion/cuentas-esperadas.mjs <antes.csv> <después.csv> <esperado.txt>
//
// W02 (Julio, 17/10) · En una tanda SIN VUELTA ATRÁS declarada
// (manifiesto.sh, «sin-vuelta-atras:»), el ensayo no puede comprobar que
// deshacerla deja todo como antes: no hay con qué deshacerla. Comprueba, en su
// lugar, que la tanda hace EXACTAMENTE lo que declara: cada medida de las
// cuentas, después de la tanda, tiene que ser la esperada.
//
//   esperado.txt: «<cuenta> · <clave> = <valor>» por línea (manifiesto.sh),
//   donde <valor> es un literal o «como antes» (el mismo valor que antes).
//
// Para (sale con 1) si una medida no sale como se espera, si una medida no
// tiene esperado (lo que no se ha dicho que cambia, se comprueba), si un
// esperado no corresponde a ninguna medida, o si no hay medidas. Imprime el
// trozo del informe en Markdown.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { leerCuentas } from './cuentas-comparar.mjs'

export const COMO_ANTES = 'como antes'

/** «<cuenta> · <clave> = <valor>» → Map(«<cuenta> · <clave>» → valor). */
export function leerEsperado(texto) {
  const m = new Map()
  for (const bruta of String(texto ?? '').split('\n')) {
    const l = bruta.trim()
    if (!l) continue
    const i = l.lastIndexOf(' = ')
    if (i < 0) throw new Error(`esperado sin «=»: ${l}`)
    m.set(l.slice(0, i).trim(), l.slice(i + 3).trim())
  }
  return m
}

export function compararEsperado(antes, despues, esperado) {
  const filas = []
  const mal = []
  const claves = [...new Set([...antes.keys(), ...despues.keys()])]
  for (const k of claves) {
    const a = antes.get(k)
    const d = despues.get(k)
    const e = esperado.get(k)
    let espera, nota
    if (e === undefined) { espera = '—'; nota = '**sin esperado declarado**'; mal.push(`${k}: no tiene esperado`) }
    else {
      espera = e === COMO_ANTES ? (a ?? '—') : e
      if (d === undefined) { nota = '**no se midió después**'; mal.push(`${k}: no se midió después`) }
      else if (d === espera) nota = e === COMO_ANTES ? 'como antes ✓' : 'la esperada ✓'
      else { nota = '**NO es la esperada**'; mal.push(`${k}: se esperaba ${espera} y sale ${d}`) }
    }
    filas.push(`| ${k} | ${a ?? '—'} | ${e === COMO_ANTES ? `${COMO_ANTES} (${espera})` : espera} | ${d ?? '—'} | ${nota} |`)
  }
  for (const k of esperado.keys()) if (!claves.includes(k)) mal.push(`${k}: está en lo esperado y no es ninguna medida`)
  if (!claves.length) mal.push('no hay medidas')
  const markdown = ['| Medida | Antes de la tanda | Esperado | Después de la tanda | |', '|---|---|---|---|---|', ...filas, ''].join('\n')
  return { ok: mal.length === 0, mal, medidas: claves.length, markdown }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , fa, fd, fe] = process.argv
  if (!fa || !fd || !fe) { console.error('Uso: cuentas-esperadas.mjs <antes.csv> <después.csv> <esperado.txt>'); process.exit(2) }
  const leer = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
  const r = compararEsperado(leerCuentas(leer(fa)), leerCuentas(leer(fd)), leerEsperado(leer(fe)))
  console.log(r.markdown)
  if (r.ok) console.log(`Las ${r.medidas} medidas, como se esperaba.`)
  else console.log(`**No hace lo que declara:** ${r.mal.join(' · ')}`)
  process.exitCode = r.ok ? 0 : 1
}
