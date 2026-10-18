#!/usr/bin/env node
// scripts/conta/impuestos/casillas303.mjs
//
// I01b · Las etiquetas de las casillas del 303 para «Modelo oficial (casillas)»,
// sacadas del diseño de registro de la AEAT que ya está en el repositorio
// (docs/conta/referencia/dr303e26v101.json), no escritas a mano. Escribe
// src/modules/conta/impuestos/casillas303.ts; la prueba
// tests/unit/modules/conta/i01b/casillas303.test.ts vuelve a generarlo y lo compara.
//
//   node scripts/conta/impuestos/casillas303.mjs            escribe el fichero
//   node scripts/conta/impuestos/casillas303.mjs --salida   lo saca por pantalla

import { readFileSync, writeFileSync } from 'node:fs'

const FUENTE = 'docs/conta/referencia/dr303e26v101.json'
const DESTINO = 'src/modules/conta/impuestos/casillas303.ts'

/** Parte por « - », pero no dentro de paréntesis: las fórmulas («[69] - [70]») se quedan enteras. */
function partir(t) {
  const out = []
  let hondo = 0, actual = ''
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '(') hondo++
    if (ch === ')') hondo = Math.max(0, hondo - 1)
    if (hondo === 0 && t.startsWith(' - ', i)) { out.push(actual.trim()); actual = ''; i += 2; continue }
    actual += ch
  }
  out.push(actual.trim())
  return out.filter(Boolean)
}
const cadena = (x) => `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export function generar(json) {
  const d = JSON.parse(json)
  const vistas = new Map()
  for (const hoja of Object.values(d.hojas)) {
    for (const c of hoja.campos) {
      if (!c.casilla) continue
      const k = String(c.casilla).padStart(2, '0')
      if (vistas.has(k)) continue
      const partes = partir(String(c.descripcion).replace(/\s*\[[0-9A-Z]+\]\s*$/, ''))
      const grupo = partes[0].replace(/\s*\(\d+\)\s*$/, '')
      const texto = partes.slice(1).filter((x) => x !== 'Regimen General').join(' · ') || partes[0]
      vistas.set(k, { grupo, texto })
    }
  }
  const filas = [...vistas.entries()].sort(([a], [b]) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b))
  return `// src/modules/conta/impuestos/casillas303.ts
//
// GENERADO por scripts/conta/impuestos/casillas303.mjs desde ${FUENTE}
// (${d.fuente ?? 'diseño de registro del 303'}, versión ${d.version ?? '—'}, sha256 ${String(d.sha256 ?? '').slice(0, 16)}).
// No se toca a mano: se vuelve a generar. Lo comprueba
// tests/unit/modules/conta/i01b/casillas303.test.ts.

export interface Casilla303 { grupo: string; texto: string }

export const CASILLAS_303: Readonly<Record<string, Casilla303>> = {
${filas.map(([k, v]) => `  '${k}': { grupo: ${cadena(v.grupo)}, texto: ${cadena(v.texto)} },`).join('\n')}
}
`
}

if (process.argv[1] && process.argv[1].endsWith('casillas303.mjs')) {
  const salida = generar(readFileSync(FUENTE, 'utf8'))
  if (process.argv.includes('--salida')) process.stdout.write(salida)
  else writeFileSync(DESTINO, salida)
}
