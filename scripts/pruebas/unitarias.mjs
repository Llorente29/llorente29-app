#!/usr/bin/env node
// scripts/pruebas/unitarias.mjs — qué unitarias corre la CI de un PR, según lo que toca.
//
// N1 (cola de noche del 23/10, paso 1 de la auditoría C09): «las de Sumied solo
// cuando cambia Sumied, las de Folvy solo cuando cambia Folvy, y lo común lanza
// las dos». Hasta hoy las unitarias solo corrían en local (antes-de-subir.sh,
// paso 3), y ahí siguen corriendo enteras: esto es la red de la CI, no la sustituye.
//
// LAS DOS SUITES (por la carpeta de cada prueba):
//   · Sumied: tests/conta/** y tests/unit/modules/conta/**.
//   · Folvy: el resto (tests/unit/**, tests/inventario/**), con las de las
//     herramientas (tests/unit/e2e, build, scripts…), que leen lo común.
//   · Y una prueba que nombra un fichero del OTRO producto (lo importa, lo lee o
//     lo cita) es de las dos. Medido el 23/10: 45 referencias cruzadas en 13
//     pruebas, entre ellas vigia.test (Folvy) importa scripts/conta/lib y cinco
//     de Sumied importan send-email/marca. Se detecta leyendo el texto de cada
//     prueba, sin lista a mano; si cita un camino solo como dato de ejemplo,
//     corre de más, que es el lado bueno del error.
//
// QUÉ LANZA CADA FICHERO CAMBIADO:
//   · de Sumied (RUTAS_SUMIED de area.mjs: src/modules/conta, conta-*,
//     scripts/conta, sus pruebas, docs/conta, sus tandas…) → Sumied;
//   · de Folvy (RUTAS_FOLVY: los demás módulos y páginas, sus funciones, sus
//     pruebas y sus tandas) → Folvy;
//   · cualquier otro → LAS DOS. Es lo común a propósito y por defecto: el
//     arranque de la app, src/lib, src/hooks, src/config, _shared, las
//     migraciones, los workflows, scripts/e2e, docs/… Medido el 23/10: las
//     unitarias de los DOS productos leen migraciones, workflows, scripts y
//     documentos de fuera de su carpeta (cableadoDeExtras lee
//     supabase/migrations y docs/pendiente; capturas.test lee docs/reparto).
//     Un fichero que no se sabe de quién es lanza las dos: equivocarse por ahí
//     cuesta unos segundos; por el otro, una unitaria en rojo que nadie vio.
//
//   node scripts/pruebas/unitarias.mjs <fichero con los cambiados> [<lista de salida>]
//     → todas=true|false, ninguna=true|false, sumied, folvy, n=…, porque=…
//       (para $GITHUB_OUTPUT) y, si no son todas, la lista de pruebas en
//       <lista de salida>, una por línea, para `npx vitest run $(cat …)`.

import { RUTAS_SUMIED, LO_COMUN_AMBOS } from '../e2e/area.mjs'
import path from 'node:path'

/** Las carpetas de las pruebas de Sumied. El resto de tests/**.test.ts* es de Folvy. */
export const PRUEBAS_SUMIED = ['tests/conta/', 'tests/unit/modules/conta/']

/** Lo que es solo de Folvy: sus pantallas, sus funciones, sus pruebas y sus tandas. */
export const RUTAS_FOLVY = [
  'src/pages/',
  'tests/unit/modules/', 'tests/inventario/', 'tests/e2e/',
  'scripts/inventario/',
  'supabase/produccion/tandas/folvy/', 'supabase/staging/tandas/folvy/',
  'android/',
]

const empieza = (f, lista) => lista.some((p) => f === p || f.startsWith(p))

/**
 * De quién es un fichero cambiado: 'sumied', 'folvy' o 'ambos'.
 * Lo común de la app (LO_COMUN_AMBOS) va primero: src/context, src/shell,
 * package.json… lanzan las dos aunque una regla de abajo los cogiera.
 */
export function deQuien(f) {
  if (empieza(f, LO_COMUN_AMBOS)) return 'ambos'
  if (empieza(f, RUTAS_SUMIED)) return 'sumied'
  // Un módulo de src/modules que no es la contabilidad es de Folvy.
  if (/^src\/modules\/(?!conta\/)[^/]+\//.test(f)) return 'folvy'
  // Una función que no es de la contabilidad ni compartida es de Folvy.
  if (/^supabase\/functions\/(?!conta-|_shared\/)[^/]+\//.test(f)) return 'folvy'
  if (empieza(f, RUTAS_FOLVY)) return 'folvy'
  return 'ambos'
}

/** Qué suites corre la CI para unos ficheros cambiados. */
export function queUnitarias(cambiados) {
  const muestra = (xs) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` y ${xs.length - 3} más` : '')
  const por = { sumied: [], folvy: [], ambos: [] }
  for (const f of cambiados) por[deQuien(f)].push(f)
  if (por.ambos.length) return { sumied: true, folvy: true, porque: `toca lo común: ${muestra(por.ambos)}` }
  const sumied = por.sumied.length > 0
  const folvy = por.folvy.length > 0
  const porque = [sumied && `Sumied: ${muestra(por.sumied)}`, folvy && `Folvy: ${muestra(por.folvy)}`].filter(Boolean).join('; ')
  return { sumied, folvy, porque: porque || 'no cambia ningún fichero' }
}

/** De qué suite es un fichero de prueba, por su carpeta. */
export function suiteDe(prueba) {
  return empieza(prueba, PRUEBAS_SUMIED) ? 'sumied' : 'folvy'
}

/** Los caminos del repositorio que nombra el texto de una prueba (imports y cadenas). */
export function caminosQueNombra(prueba, texto) {
  const refs = new Set()
  const re = /from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]|['"`]((?:src|scripts|supabase|docs|tests|build|android)\/[^'"`$\s]+)/g
  for (const m of texto.matchAll(re)) {
    let r = m[1] || m[2] || m[3]
    if (r.startsWith('.')) r = path.posix.normalize(path.posix.join(path.posix.dirname(prueba), r))
    else if (r.startsWith('@/')) r = 'src/' + r.slice(2)
    else if (!m[3]) continue   // un paquete (vitest, node:fs…)
    refs.add(r)
  }
  return [...refs]
}

/** Las suites de una prueba: la de su carpeta y la de cada producto que nombra. */
export function suitesDe(prueba, texto) {
  const s = new Set([suiteDe(prueba)])
  for (const r of caminosQueNombra(prueba, texto)) {
    const q = deQuien(r)
    if (q !== 'ambos') s.add(q)
  }
  return s
}

/**
 * Las pruebas que corren: todas si toca lo común; si no, las de cada producto
 * tocado (con las que nombran ese producto). `pruebas` es [{ fichero, texto }].
 */
export function pruebasQueCorren(cambiados, pruebas) {
  const q = queUnitarias(cambiados)
  if (q.sumied && q.folvy) return { ...q, todas: true, lista: pruebas.map((p) => p.fichero) }
  const lista = pruebas.filter((p) => {
    const s = suitesDe(p.fichero, p.texto)
    return (q.sumied && s.has('sumied')) || (q.folvy && s.has('folvy'))
  }).map((p) => p.fichero)
  return { ...q, todas: false, lista }
}

/** Las pruebas unitarias del repositorio, con su texto (lo que vitest.config incluye). */
export async function pruebasDelRepositorio() {
  const { execSync } = await import('node:child_process')
  const { readFileSync } = await import('node:fs')
  const ficheros = execSync("git ls-files 'tests/**/*.test.ts' 'tests/**/*.test.tsx'").toString().split('\n').filter(Boolean)
  return ficheros.map((fichero) => ({ fichero, texto: readFileSync(fichero, 'utf8') }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const [fichero, salida] = process.argv.slice(2)
  if (!fichero) { console.error('uso: unitarias.mjs <fichero con los cambiados> [<lista de salida>]'); process.exit(2) }
  const cambiados = readFileSync(fichero, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)
  const pruebas = await pruebasDelRepositorio()
  const r = pruebasQueCorren(cambiados, pruebas)
  if (salida) writeFileSync(salida, r.lista.join('\n') + (r.lista.length ? '\n' : ''))
  console.log(`todas=${r.todas}`)
  console.log(`ninguna=${r.lista.length === 0}`)
  console.log(`sumied=${r.sumied}`)
  console.log(`folvy=${r.folvy}`)
  console.log(`n=${r.lista.length} de ${pruebas.length}`)
  console.log(`porque=${r.porque}`)
}
