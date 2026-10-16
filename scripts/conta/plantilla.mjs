#!/usr/bin/env node
// scripts/conta/plantilla.mjs — la regla de la plantilla (W02, aprobada el 16/10).
//
// La plantilla de prueba son las cuentas A, B, C, Diez y las solas, con sus
// siete usuarios: lo que copia cada carril (scripts/e2e/carril/comun.sql) y lo
// que leen las pruebas de TODOS los frentes. El 16/10, 9 de 15 enteras rojas
// fueron datos de la plantilla que cambió otro frente.
//
// La regla:
//   1. La plantilla solo se cambia con un fichero de la rama (una semilla de
//      supabase/seeds/conta o un supabase/staging/sql), aplicado por
//      aplicar-staging-conta, que lo registra con su huella. Nunca a mano.
//   2. Ese fichero lo dice en su cabecera:
//        -- plantilla: <qué cambia> · lo leen: <pruebas de tests/e2e, o «ninguna»>
//   3. Quien cambia la plantilla arregla, en su rama y antes de aplicarlo, las
//      pruebas de los demás que rompe.
//   4. Las pruebas no fijan lo que la plantilla puede cambiar: lo leen de la semilla.
//   5. Cada noche, la huella de la plantilla (comparar-staging-produccion.yml):
//      si cambia sin un fichero registrado, sale en rojo.
//
// Esto comprueba la 2, en antes-de-subir: todo fichero NUEVO O TOCADO (contra
// origin/main) que nombra una cuenta o un usuario de la plantilla lleva la
// cabecera, y en «lo leen» están por lo menos las pruebas de tests/e2e que
// nombran alguno de sus mismos ids.
//
//   node scripts/conta/plantilla.mjs            # los tocados contra origin/main
//   node scripts/conta/plantilla.mjs <fichero>… # esos

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Las cuentas y los usuarios de la plantilla: los de scripts/e2e/carril/comun.sql. */
export const CUENTAS = [
  'c01a0000-0000-4000-8000-00000000000a', // A · Taberna de Prueba Norte
  'c01b0000-0000-4000-8000-00000000000b', // B · Cocina de Prueba Sur
  'c01c0000-0000-4000-8000-00000000000c', // C · Obrador de Prueba Este
  'c0600000-0000-4000-8000-0000000000d0', // Comercio de Prueba Diez
]
export const USUARIOS = [
  'c01a0000-0000-4000-8000-0000000000a1', 'c01a0000-0000-4000-8000-0000000000a6',
  'c01b0000-0000-4000-8000-0000000000b1', 'c01c0000-0000-4000-8000-0000000000c1',
  'c0600000-0000-4000-8000-0000000000a1', 'c0600000-0000-4000-8000-0000000000b1',
  'c0600000-0000-4000-8000-0000000000f0',
]
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
export const CARPETAS = /^supabase\/(seeds\/conta|staging\/sql)\/[^/]+\.sql$/

/** ¿Nombra el fichero alguna cuenta o usuario de la plantilla? */
export function tocaPlantilla(sql) {
  const ids = new Set((sql.match(UUID) ?? []).map((x) => x.toLowerCase()))
  return [...CUENTAS, ...USUARIOS].some((id) => ids.has(id))
}

/** La cabecera «-- plantilla: … · lo leen: …» en las primeras 40 líneas, o null. */
export function cabecera(sql) {
  for (const l of sql.split('\n').slice(0, 40)) {
    const m = /^--\s*plantilla:\s*(.+?)\s*·\s*lo leen:\s*(.+?)\s*$/i.exec(l)
    if (m) {
      const leen = /^ningun[ao]s?$/i.test(m[2]) ? [] : m[2].split(',').map((x) => x.trim()).filter(Boolean)
      return { que: m[1], leen }
    }
  }
  return null
}

/**
 * Las pruebas de tests/e2e (rutas relativas) que nombran alguno de los ids
 * PROPIOS del fichero: los de lo que crea o cambia (un proveedor, una empresa,
 * un asiento). Las cuentas y los usuarios base no cuentan aquí: salen en casi
 * todas las pruebas y dirían «lo lee media suite» de cualquier semilla.
 */
export function quienLee(sql, pruebas) {
  const base = new Set([...CUENTAS, ...USUARIOS])
  const ids = new Set((sql.match(UUID) ?? []).map((x) => x.toLowerCase()).filter((x) => !base.has(x)))
  return pruebas.filter(({ texto }) => (texto.match(UUID) ?? []).some((x) => ids.has(x.toLowerCase()))).map((p) => p.ruta).sort()
}

/** Lo que falla de un fichero: [] si cumple. */
export function revisar(sql, pruebas) {
  if (!tocaPlantilla(sql)) return []
  const c = cabecera(sql)
  if (!c) return ['toca la plantilla y no lleva «-- plantilla: <qué cambia> · lo leen: <pruebas o ninguna>»']
  const mal = []
  const rutas = new Set(pruebas.map((p) => p.ruta))
  for (const r of c.leen) if (!rutas.has(r)) mal.push(`«lo leen» nombra ${r}, que no está en tests/e2e`)
  for (const r of quienLee(sql, pruebas)) if (!c.leen.includes(r)) mal.push(`falta en «lo leen»: ${r} (usa ids de este fichero)`)
  return mal
}

/** Las pruebas de tests/e2e, con su texto. */
export function pruebasE2e(dir = 'tests/e2e') {
  const rutas = execFileSync('git', ['ls-files', dir], { encoding: 'utf8' }).split('\n').filter((r) => /\.(ts|mjs|js)$/.test(r))
  return rutas.map((r) => ({ ruta: r.slice(dir.length + 1), texto: readFileSync(r, 'utf8') }))
}

/** Los ficheros de las dos carpetas, nuevos o tocados contra origin/main (y sin commitear). */
export function tocados() {
  const out = new Set()
  for (const args of [['diff', '--name-only', '--diff-filter=AM', 'origin/main...HEAD'], ['diff', '--name-only', '--diff-filter=AM', 'HEAD'], ['ls-files', '--others', '--exclude-standard']]) {
    try { for (const f of execFileSync('git', args, { encoding: 'utf8' }).split('\n')) if (CARPETAS.test(f)) out.add(f) } catch { /* sin origin/main: solo lo local */ }
  }
  return [...out].filter((f) => existsSync(f)).sort()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ficheros = process.argv.length > 2 ? process.argv.slice(2) : tocados()
  const pruebas = pruebasE2e()
  let mal = 0
  for (const f of ficheros) {
    const fallos = revisar(readFileSync(join(process.cwd(), f), 'utf8'), pruebas)
    if (!fallos.length) { console.log(`${f}: ${tocaPlantilla(readFileSync(f, 'utf8')) ? 'cumple' : 'no toca la plantilla'}`); continue }
    mal++
    console.log(`${f}:`)
    for (const x of fallos) console.log(`  · ${x}`)
  }
  if (!ficheros.length) console.log('Ningún fichero de semillas ni de staging/sql nuevo o tocado.')
  if (mal) {
    console.log(`\n${mal} fichero(s) cambian la plantilla sin decir quién la lee. La regla: docs/conta/staging.md («La plantilla solo se cambia con un fichero»).`)
    process.exit(1)
  }
}
