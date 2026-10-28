#!/usr/bin/env node
// scripts/ci/limites-psql.mjs
//
// W09 (Julio, 28/10) · psql con límite. El #728 (S01) se quedó casi una hora
// esperando a la red, sin ninguna consulta en marcha: ni la conexión ni el paso
// tenían límite. En cada workflow que toca la base:
//   · PGCONNECT_TIMEOUT en su `env` de arriba: psql, pg_dump y todo lo que use
//     libpq dejan de esperar a conectar a los 15 s;
//   · `timeout-minutes` en cada paso que toca la base: si se queda colgado a
//     media consulta (la red cae sin cerrar), el paso cae a su límite y no al
//     del job.
// Un paso «toca la base» si su `run:` lanza psql o pg_dump, si su `env` lleva
// una URL de base (DB_URL…), o si llama a un guion del repositorio que lanza
// psql o pg_dump.
//
//   node scripts/ci/limites-psql.mjs listar     → los pasos que tocan la base, con su límite
//   node scripts/ci/limites-psql.mjs comprobar  → sale con 1 si falta alguno (lo usa la prueba)
//   node scripts/ci/limites-psql.mjs poner      → escribe lo que falta (PASO_MIN o LARGOS)

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DIR = '.github/workflows'
export const CONECTAR_S = '15'
/** El límite de un paso que toca la base, si no es de los largos (un real de producción entero tarda ~1 min). */
export const PASO_MIN = 15
/**
 * Los pasos que tardan más de verdad (nunca por encima del job): [fichero, nombre del paso, minutos].
 * Las e2e esperan carril y corren las pruebas; el aplicar de staging espera la barrera
 * y el cerrojo (15 + 15, su job lo dice); las importaciones de Diez escriben miles de filas.
 */
export const LARGOS = [
  ['e2e-staging-conta.yml', 'Pruebas (ordenador y móvil)', 120],
  ['e2e-staging-conta.yml', 'Carril · esperar su turno y coger uno', 60],
  ['carril-staging-conta.yml', 'Carril · esperar su turno y coger uno', 20],
  ['aplicar-staging-conta.yml', 'Cerrojo de migrar · esperar a que acaben los ficheros de prueba en marcha', 35],
  ['diez-importar.yml', 'Paso 2 · escribir, medir contra el testigo y decidir (una transacción)', 60],
  ['diez-importar.yml', 'Simulado · escribir, medir y deshacer (ensayo)', 25],
  ['diez-libros-iva-importar.yml', 'Paso 2 · escribir, medir contra el testigo y decidir (una transacción)', 45],
  ['diez-lectura.yml', 'Folvy · saldos de Foodint al corte y el mapeo de serie del abreviado (solo lectura)', 30],
]

/** El límite que le toca a un paso. */
export function limiteDe(fichero, paso, jobTimeout) {
  const largo = LARGOS.find(([f, n]) => f === fichero && n === paso)
  const min = largo ? largo[2] : PASO_MIN
  return jobTimeout ? Math.min(min, jobTimeout) : min
}

/** El workflow con lo que falta puesto: PGCONNECT_TIMEOUT arriba y timeout-minutes en los pasos que tocan la base. */
export function poner(fichero, texto, raiz = '.') {
  const r = faltas(texto, raiz)
  if (!r.tocaLaBase) return texto
  const lineas = texto.split('\n')
  const jobs = pasosDe(texto)
  const inserciones = []
  for (const j of jobs) for (const p of j.pasos) {
    if (p.timeout) continue
    if (!(tocaLaBase(p, raiz) || (p.run && jobConUrl(texto, j)))) continue
    const primera = p.lineas[0]
    if (!/^ {6}- name:/.test(primera)) continue
    inserciones.push({ despues: p.inicio, linea: `        timeout-minutes: ${limiteDe(fichero, p.nombre, j.timeout)}` })
  }
  for (const ins of inserciones.sort((a, b) => b.despues - a.despues)) lineas.splice(ins.despues + 1, 0, ins.linea)
  let out = lineas.join('\n')
  if (!new RegExp(`^ {2}PGCONNECT_TIMEOUT:`, 'm').test(out.match(/^env:\n((?: {2}.*\n)+)/m)?.[1] ?? '')) {
    const linea = `  # W09: psql y pg_dump dejan de esperar a conectar a los ${CONECTAR_S} s (el #728 esperó casi una hora).\n  PGCONNECT_TIMEOUT: '${CONECTAR_S}'\n`
    if (/^env:\n/m.test(out)) out = out.replace(/^env:\n/m, `env:\n${linea}`)
    else out = out.replace(/^jobs:\n/m, `env:\n${linea}\njobs:\n`)
  }
  return out
}
const LANZA_PSQL = /\b(psql|pg_dump)\b/

/** Si un guion del repositorio lanza psql o pg_dump (sin seguir lo que él llama). */
function guionLanzaPsql(ruta, cache = new Map()) {
  if (cache.has(ruta)) return cache.get(ruta)
  let si = false
  try { si = LANZA_PSQL.test(readFileSync(ruta, 'utf8')) } catch { si = false }
  cache.set(ruta, si)
  return si
}

/** Parte un workflow en jobs y pasos, por su sangría (lo justo para esto, sin dependencias). */
export function pasosDe(texto) {
  const lineas = texto.split('\n')
  const jobs = []
  let enJobs = false, job = null, paso = null
  lineas.forEach((l, i) => {
    if (/^jobs:\s*$/.test(l)) { enJobs = true; return }
    if (enJobs && /^\S/.test(l) && !/^jobs:/.test(l)) enJobs = false
    if (!enJobs) return
    const mJob = l.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
    if (mJob) { job = { nombre: mJob[1], linea: i, timeout: null, pasos: [] }; jobs.push(job); paso = null; return }
    if (!job) return
    const mTimeout = l.match(/^ {4}timeout-minutes:\s*(\d+)/)
    if (mTimeout) job.timeout = Number(mTimeout[1])
    if (/^ {6}- /.test(l)) { paso = { inicio: i, lineas: [l] }; job.pasos.push(paso); return }
    if (paso && (/^ {8}/.test(l) || l.trim() === '')) { paso.lineas.push(l); return }
    if (paso && /^ {0,6}\S/.test(l)) paso = null
  })
  for (const j of jobs) for (const p of j.pasos) {
    const t = p.lineas.join('\n')
    p.nombre = (t.match(/- name:\s*(.+)/) ?? t.match(/name:\s*(.+)/) ?? [])[1]?.trim() ?? '(sin nombre)'
    p.run = /^ {8}run:/m.test(t) || /^ {6}- run:/m.test(t)
    p.timeout = Number((t.match(/^ {8}timeout-minutes:\s*(\d+)/m) ?? [])[1] ?? NaN) || null
    p.texto = t
  }
  return jobs
}

/** Si un paso toca la base. */
export function tocaLaBase(paso, raiz = '.') {
  if (!paso.run) return false
  if (LANZA_PSQL.test(paso.texto.replace(/^\s*#.*$/gm, ''))) return true
  if (/^\s+[A-Z_]*DB_URL[A-Z_]*:\s*\$\{\{\s*secrets\./m.test(paso.texto)) return true
  for (const m of paso.texto.matchAll(/\b(scripts\/[\w./-]+\.(?:sh|mjs|js))\b/g)) {
    const r = join(raiz, m[1])
    if (existsSync(r) && guionLanzaPsql(r)) return true
  }
  return false
}

/** Si el job toca la base por su env (DB_URL a nivel de job): entonces todos sus pasos con run. */
function jobConUrl(texto, job) {
  const desde = texto.split('\n').slice(job.linea, job.pasos[0]?.inicio ?? undefined).join('\n')
  return /^ {6}[A-Z_]*DB_URL[A-Z_]*:\s*\$\{\{\s*secrets\./m.test(desde)
}

/** Lo que falta en un workflow: [{ que, job?, paso? }]. */
export function faltas(texto, raiz = '.') {
  const fuera = []
  const jobs = pasosDe(texto)
  const pasosBase = jobs.flatMap((j) => j.pasos.filter((p) => tocaLaBase(p, raiz) || (p.run && jobConUrl(texto, j))).map((p) => ({ j, p })))
  if (!pasosBase.length) return { tocaLaBase: false, fuera }
  const env = texto.match(/^env:\n((?: {2}.*\n)+)/m)?.[1] ?? ''
  if (!new RegExp(`^ {2}PGCONNECT_TIMEOUT:\\s*'?${CONECTAR_S}'?\\s*$`, 'm').test(env)) fuera.push({ que: `falta PGCONNECT_TIMEOUT: '${CONECTAR_S}' en el env de arriba` })
  for (const { j, p } of pasosBase) {
    if (!p.timeout) fuera.push({ que: 'paso que toca la base sin timeout-minutes', job: j.nombre, paso: p.nombre })
    else if (j.timeout && p.timeout > j.timeout) fuera.push({ que: `timeout-minutes ${p.timeout} mayor que el del job (${j.timeout})`, job: j.nombre, paso: p.nombre })
  }
  return { tocaLaBase: true, fuera, pasos: pasosBase.map(({ j, p }) => ({ job: j.nombre, jobTimeout: j.timeout, paso: p.nombre, timeout: p.timeout })) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const orden = process.argv[2]
  if (orden === 'poner') {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith('.yml')).sort()) {
      const antes = readFileSync(join(DIR, f), 'utf8')
      const despues = poner(f, antes)
      if (despues !== antes) { writeFileSync(join(DIR, f), despues); console.log(`puesto: ${f}`) }
    }
    process.exit(0)
  }
  let mal = 0
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.yml')).sort()) {
    const r = faltas(readFileSync(join(DIR, f), 'utf8'))
    if (!r.tocaLaBase) continue
    if (orden === 'listar') for (const p of r.pasos) console.log(`${f}\t${p.job} (${p.jobTimeout ?? '—'})\t${p.timeout ?? '—'}\t${p.paso}`)
    for (const x of r.fuera) { mal++; if (orden === 'comprobar') console.error(`✗ ${f}${x.job ? ` · ${x.job}` : ''}${x.paso ? ` · «${x.paso}»` : ''}: ${x.que}`) }
  }
  if (orden === 'comprobar') { if (mal) { console.error(`✗ ${mal} faltas.`); process.exit(1) } console.log('Todos los pasos que tocan la base tienen su límite, y sus workflows PGCONNECT_TIMEOUT.') }
}
