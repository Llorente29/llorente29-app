#!/usr/bin/env node
// scripts/conta/produccion/analisis-tanda-viva.mjs [contexto.json] [--informe] [--manifiesto=<f>]
//
// Paso 8 de antes-de-subir.sh (R11, Julio, 13/10): «antes de dar datos de
// lanzamiento a Julio, pasar el analizador de producción con el contexto real
// y pegar su salida en el informe».
//
// El contexto real es la respuesta de la consulta de contexto del workflow
// (analizar.mjs sql-contexto) lanzada en producción en solo lectura, guardada
// en tests/conta/produccion/contexto-produccion-tanda-viva.json con la hora de
// la medida y el md5 de cada fichero de la tanda. Esto:
//   1. PARA si la tanda de supabase/produccion/aplicar.txt no es la medida
//      (otro fichero, otro orden o un md5 distinto): el contexto de un fichero
//      que ha cambiado no vale. Se vuelve a medir. (R9 y R10 cambiaron la 0130
//      y los datos de Julio salieron con el análisis de la R7: el ensayo #57 lo
//      paró el analizador en 1 s.)
//   2. Saca el informe del analizador, el mismo que el workflow, para pegarlo
//      debajo de los datos de Julio, con la lista de «autorizo».
//   3. PARA si algún fichero sale BLOQUEA.
// Lo que no mide: que producción no haya cambiado desde la hora de la medida.
// Por eso la hora va en el informe.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// --manifiesto=<f>: una tanda preparada que aún no está en aplicar.txt (B01, 14/10: «el orden
// de las tres tandas lo digo yo»), con su contexto medido. Sin él, la tanda viva de siempre.
const MANIFIESTO = process.argv.find((x) => x.startsWith('--manifiesto='))?.slice('--manifiesto='.length) ?? 'supabase/produccion/aplicar.txt'
const FIXTURE = process.argv.slice(2).find((x) => !x.startsWith('--')) ?? 'tests/conta/produccion/contexto-produccion-tanda-viva.json'
const A = 'scripts/conta/produccion/analizar.mjs'
const tanda = readFileSync(MANIFIESTO, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('cuenta:'))
const medida = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex')

const mal = []
const medidos = Object.keys(medida.tanda)
if (medidos.join('\n') !== tanda.join('\n')) mal.push(`la tanda no es la medida: medida ${medidos.length} (${medidos.map((f) => f.replace(/^.*\//, '')).join(', ')}), ahora ${tanda.length}`)
for (const f of tanda) if (medida.tanda[f] && medida.tanda[f] !== md5(f)) mal.push(`${f} ha cambiado desde la medida (${medida.tanda[f]} → ${md5(f)})`)
if (mal.length) {
  console.error(mal.map((m) => `✗ ${m}`).join('\n'))
  console.error(`Vuelve a medir el contexto en producción (solo lectura) y guárdalo en ${FIXTURE}: node ${A} sql-contexto …, con CAMINO_TABLAS y CAMINO_FUNCIONES del workflow.`)
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'tanda-viva-'))
const ctx = join(dir, 'contexto.json'); writeFileSync(ctx, JSON.stringify(medida.contexto))
const des = join(dir, 'destruidos.json'); writeFileSync(des, execFileSync('node', [A, 'destruidos', ...tanda]))
const usos = join(dir, 'usos.json'); writeFileSync(usos, execFileSync('node', [A, 'front', 'WORKTREE', des]))
let informe
try { informe = execFileSync('node', [A, 'informe', ctx, usos, ...tanda], { encoding: 'utf8' }) } catch (e) { informe = e.stdout }
informe = informe.split('\n').filter((l) => !l.startsWith('VAT_RATE_FOR_EN:')).join('\n')
const estado = (f) => (informe.match(new RegExp('^### `' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '` — (.*)$', 'm')) ?? [])[1] ?? '¿?'
const resumen = tanda.map((f) => `${f.replace(/^.*\//, '')}: ${estado(f).replace(/\*/g, '')}`)
const autorizo = tanda.filter((f) => /AUTORIZO/.test(estado(f))).map((f) => f.replace(/^.*\//, ''))
console.log(`Análisis de la tanda viva contra el contexto de producción medido ${medida.medido} (md5 de los ${tanda.length} ficheros: los medidos).`)
for (const r of resumen) console.log(`  ${r}`)
console.log(`  autorizo: ${autorizo.join(' ') || '(ninguno)'}`)
if (process.argv.includes('--informe')) console.log('\n' + informe)
if (resumen.some((r) => /BLOQUEA/.test(r))) { console.error('✗ Algún fichero BLOQUEA: no se dan datos de lanzamiento.'); process.exit(1) }
