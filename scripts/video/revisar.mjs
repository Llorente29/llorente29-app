#!/usr/bin/env node
// scripts/video/revisar.mjs — V01 · que en el vídeo no salga nada real (T11).
//
//   node scripts/video/revisar.mjs <salida>
//
// Lee el texto de cada pantalla grabada (capturas/*.txt, lo deja el guion en
// cada paso) y busca lo que no puede salir: un IBAN que no sea del banco 9999,
// un DNI o NIE, un NIF que no sea de ceros, un correo, y los nombres que se
// sabe que son reales o de personas (Foodint, los del sandbox de Revolut…).
// Escribe revision.txt y sale en rojo si encuentra algo.
//
// Lo que sale DENTRO de una imagen (el PDF de la factura) no lo ve: ese PDF lo
// hace el propio guion con datos de datos.mjs. Aun así, los fotogramas se
// miran a ojo (fotogramas/, uno cada 2 s) antes de dar el vídeo por bueno.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const salida = process.argv[2]
const dir = join(salida, 'capturas')
const NOMBRES = ['foodint', 'llorente', 'julio', 'rory', 'pearson', 'coheldi', 'florencio', 'carabanchel', 'alcalá', 'alcala']
const hallazgos = []
let leidas = 0
for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
  const t = readFileSync(join(dir, f), 'utf8')
  leidas++
  const poner = (que, m) => hallazgos.push(`${f}: ${que} «${m}»`)
  for (const m of t.matchAll(/\bES\d{2}[ ]?(\d{4})[ ]?\d{4}[ ]?\d{2}[ ]?\d{2}[ ]?\d{4}[ ]?\d{4}\b/g)) if (m[1] !== '9999') poner('IBAN que no es del banco 9999', m[0])
  for (const m of t.matchAll(/\b\d{8}[ -]?[A-HJ-NP-TV-Z]\b/g)) poner('DNI', m[0])
  for (const m of t.matchAll(/\b[XYZ][ -]?\d{7}[ -]?[A-Z]\b/g)) poner('NIE', m[0])
  for (const m of t.matchAll(/\b[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]\b/g)) if (!/^[A-Z]0{5}/.test(m[0])) poner('NIF que no es de ceros', m[0])
  for (const m of t.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) poner('correo', m[0])
  const bajo = t.toLowerCase()
  for (const n of NOMBRES) if (bajo.includes(n)) poner('nombre', n)
}
const texto = `Pantallas leídas: ${leidas}\n${hallazgos.length ? `ENCONTRADO (${hallazgos.length}):\n${hallazgos.join('\n')}` : 'Nada real: ni IBAN fuera del 9999, ni DNI/NIE, ni NIF que no sea de ceros, ni correos, ni nombres de la lista.'}\n`
writeFileSync(join(salida, 'revision.txt'), texto)
console.log(texto)
if (hallazgos.length || leidas === 0) process.exitCode = 1
