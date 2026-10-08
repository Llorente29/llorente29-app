#!/usr/bin/env node
// scripts/conta/produccion/agentes-comparar.mjs <agentes-antes.txt> <agentes-despues.txt>
//
// W01 · Qué se pone en rojo con la tanda, según los agentes de agentes.sh.
// Imprime el trozo del informe (Markdown) y sale con 1 si la comprobación falla.
//
// La regla (C04 R4, 08/10):
//   · el «antes» es la foto de partida, no una guarda: un agente «no-medible»
//     antes (la tanda le da el permiso que le faltaba) NO para nada;
//   · el «después» es obligatorio: un agente «no-medible» después FALLA;
//   · la comparación solo cuenta los agentes medibles en los dos lados: falla
//     si uno estaba en verde antes y está en rojo después. Un rojo después sin
//     foto de antes se dice en el informe, pero no cuenta.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MEDIBLE = new Set(['verde', 'rojo'])

/** «agente\testado\tmotivo» por línea → Map(agente → { estado, motivo }). */
export function leerAgentes(texto) {
  const m = new Map()
  for (const l of texto.split('\n')) {
    if (!l.trim()) continue
    const [agente, estado = '', motivo = ''] = l.split('\t')
    m.set(agente, { estado, motivo })
  }
  return m
}

export function compararAgentes(antes, despues) {
  const lineas = []
  const fallos = []
  for (const agente of new Set([...antes.keys(), ...despues.keys()])) {
    const a = antes.get(agente) ?? { estado: 'no-medible', motivo: 'no se midió antes' }
    const d = despues.get(agente) ?? { estado: 'no-medible', motivo: 'no se midió después' }
    const ver = (x) => (x.motivo ? `${x.estado} (${x.motivo})` : x.estado)
    let nota
    if (!MEDIBLE.has(d.estado) && d.estado !== 'no-aplica') {
      fallos.push(`agente-${agente}-no-corre`)
      nota = '**no se ha podido medir después: falla**'
    } else if (!MEDIBLE.has(a.estado) || !MEDIBLE.has(d.estado)) {
      nota = d.estado === 'rojo' ? 'rojo después sin foto de antes: se dice, no cuenta' : 'no cuenta (no medible en los dos lados)'
    } else if (a.estado === 'verde' && d.estado === 'rojo') {
      fallos.push(`agente-${agente}`)
      nota = '**se pone en rojo con la tanda: falla**'
    } else {
      nota = a.estado === d.estado ? 'igual' : 'mejora'
    }
    lineas.push(`| ${agente} | ${ver(a)} | ${ver(d)} | ${nota} |`)
  }
  const markdown = ['**Agentes (antes ↔ después):**', '', '| Agente | Antes | Después | |', '|---|---|---|---|', ...lineas, ''].join('\n')
  return { fallos, markdown }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , fa, fd] = process.argv
  if (!fa || !fd) { console.error('Uso: agentes-comparar.mjs <agentes-antes.txt> <agentes-despues.txt>'); process.exit(2) }
  const leer = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
  const r = compararAgentes(leerAgentes(leer(fa)), leerAgentes(leer(fd)))
  console.log(r.markdown)
  process.exitCode = r.fallos.length ? 1 : 0
}
