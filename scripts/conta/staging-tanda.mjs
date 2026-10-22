#!/usr/bin/env node
// scripts/conta/staging-tanda.mjs — qué pasa por staging en cada run (W04, Julio, 22/10).
//
// «Staging recibe de verdad solo lo que está en producción.»
//   · Desde una RAMA: solo las líneas que la rama añade a supabase/staging/aplicar.txt
//     contra main, y en ROLLBACK (staging no cambia).
//   · Desde MAIN: las líneas que el push añade (contra el commit de antes), de verdad.
// Así no se vuelve a pasar el manifiesto entero —lo que dejaba funciones viejas
// detrás de otras nuevas (la 0110 detrás de la 0180) y pedía W03— ni entra en
// staging nada que producción no tiene (el C07, el 22/10).
//
//   node scripts/conta/staging-tanda.mjs nuevas <ref-de-antes> [manifiesto]
//     → las líneas nuevas, en su orden (una por línea)
//   node scripts/conta/staging-tanda.mjs rollback <ficheros…>
//     → para (sale con 1) si alguno haría algo de verdad dentro del ROLLBACK
//   node scripts/conta/staging-tanda.mjs sesiones <ficheros…>
//     → el SQL de cada sesión de ensayo, separadas por una línea «--@@ sesión»

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export const MANIFIESTO = 'supabase/staging/aplicar.txt'

/** Las rutas de un manifiesto: sin comentarios ni blancos, en su orden. */
export function lineas(texto) {
  return String(texto ?? '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() && !/^\s*#/.test(l))
}

/** Las líneas de «ahora» que no estaban en «antes», en el orden de «ahora». */
export function nuevas(antes, ahora) {
  const ya = new Set(lineas(antes))
  return lineas(ahora).filter((l) => !ya.has(l))
}

/** El SQL sin comentarios ni cadenas, para buscar sentencias de transacción. */
function sinRuido(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')   // cuerpos $$…$$ (su «end;» no es de la transacción)
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
}

/**
 * Lo que impide ensayar un fichero en ROLLBACK, en palabras (o null si vale):
 *   · un COMMIT (o END) dejaría de verdad lo de antes;
 *   · un ROLLBACK que no es la última sentencia deja en autocommit, de verdad, lo de después.
 */
export function porQueNoSeEnsaya(sql) {
  const s = sinRuido(sql)
  if (/(^|;)\s*(commit|end)\s*(transaction|work)?\s*;/im.test(s)) return 'tiene un COMMIT: dejaría cosas de verdad en staging'
  const sentencias = s.split(';').map((x) => x.trim()).filter(Boolean)
  const i = sentencias.findIndex((x) => /^rollback\b/i.test(x))
  if (i >= 0 && i !== sentencias.length - 1) return 'tiene un ROLLBACK que no es su última sentencia: lo de después iría de verdad'
  return null
}

/** ¿Lleva el fichero su propia transacción (BEGIN … ROLLBACK)? */
export function llevaSuTransaccion(sql) {
  return /(^|;)\s*rollback\s*;/im.test(sinRuido(sql))
}

/**
 * Las sesiones del ensayo: una por fichero, que empieza con BEGIN, pasa antes
 * los ficheros nuevos anteriores que no llevan su propia transacción (las
 * migraciones de la rama, para que su prueba las encuentre) y acaba en ROLLBACK.
 */
export function sesiones(ficheros, leer = (f) => readFileSync(f, 'utf8')) {
  const previas = []
  return ficheros.map((f) => {
    const sql = ['begin;', ...previas.map((p) => `\\i ${p}`), `\\i ${f}`, 'rollback;'].join('\n')
    if (!llevaSuTransaccion(leer(f))) previas.push(f)
    return { fichero: f, sql }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [modo, ...args] = process.argv.slice(2)
  if (modo === 'nuevas') {
    const [ref, manifiesto = MANIFIESTO] = args
    let antes = ''
    try { antes = execFileSync('git', ['show', `${ref}:${manifiesto}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { antes = '' }
    for (const l of nuevas(antes, readFileSync(manifiesto, 'utf8'))) console.log(l)
  } else if (modo === 'rollback') {
    let mal = 0
    for (const f of args) {
      const p = porQueNoSeEnsaya(readFileSync(f, 'utf8'))
      if (p) { console.log(`::error::${f} ${p}. No se ensaya nada.`); mal = 1 }
    }
    process.exit(mal)
  } else if (modo === 'sesiones') {
    for (const s of sesiones(args)) console.log(`--@@ sesión ${s.fichero}\n${s.sql}`)
  } else {
    console.error('uso: staging-tanda.mjs nuevas <ref> [manifiesto] | rollback <ficheros…> | sesiones <ficheros…>')
    process.exit(2)
  }
}
