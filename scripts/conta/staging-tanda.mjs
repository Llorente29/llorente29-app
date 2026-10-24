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
//   node scripts/conta/staging-tanda.mjs anaden <contexto.json> <ficheros…>
//     → de las migraciones, las que SOLO AÑADEN contra ese contexto (W05),
//       una por línea; en el error, las demás y por qué
//
// W05 (Julio, 22/10): «lo que solo añade (columna que admite nulos, tabla o
// función nuevas) se aplica de verdad en staging desde la rama, y tiene que
// poder pasarse otra vez; todo lo demás, solo en ROLLBACK». Solo añadir no
// cambia nada de lo que leen las demás ramas: el problema del 22/10 fue un
// «cambia en caliente» (la 0450 cambió conta_resumen_ventas). La clase la da el
// analizador de la tanda (analizar.mjs categoria), contra el contexto medido en
// STAGING; y un CHECK que solo mira una columna que añade el mismo fichero
// también cuenta como añadir (nace vacía: no cambia ninguna fila).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { analizarFichero, categoria, creadosPorLaTanda } from './produccion/analizar.mjs'

// C10 (Julio, 23/10): «ningún fichero compartido se edita en dos PR». El
// manifiesto de staging de siempre (aplicar.txt) queda CERRADO: no se le añade
// nada. Cada rama pone lo suyo en supabase/staging/tandas/<producto>/<rama>.txt
// (<producto>: sumied o folvy; <rama>, como en produccion/tanda.mjs). El
// manifiesto que se lee es el cerrado y, detrás, cada tanda por orden de nombre:
// así «lo que añade la rama contra main» sigue siendo lo mismo, y dos ramas no
// editan nunca el mismo fichero.
export const MANIFIESTO = 'supabase/staging/aplicar.txt'
export const TANDAS = 'supabase/staging/tandas'

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/** Los ficheros de tanda de staging (las rutas), en orden: en el árbol de trabajo o en un ref. */
export function ficherosDeTandas(ref = null) {
  if (ref) {
    try { return git('ls-tree', '-r', '--name-only', ref, '--', TANDAS).split('\n').filter((f) => /\.txt$/.test(f)).sort() } catch { return [] }
  }
  const out = []
  const andar = (d) => { if (!existsSync(d)) return; for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) andar(p); else if (/\.txt$/.test(n)) out.push(p) } }
  andar(TANDAS)
  return out.sort()
}

/** El texto del manifiesto entero de staging: el cerrado y las tandas detrás (de un ref, o del árbol de trabajo). */
export function textoDelManifiesto(ref = null) {
  const leer = (f) => { try { return ref ? git('show', `${ref}:${f}`) : readFileSync(f, 'utf8') } catch { return '' } }
  return [MANIFIESTO, ...ficherosDeTandas(ref)].map(leer).join('\n')
}

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

const sinFirma = (obj) => obj.replace(/\(.*$/, '')
const PALABRAS_SQL = new Set(['is', 'not', 'null', 'or', 'and', 'in', 'like', 'ilike', 'similar', 'to', 'between', 'true', 'false', 'any', 'all', 'array', 'case', 'when', 'then', 'else', 'end', 'distinct', 'from'])
/** Las columnas que el fichero añade a una tabla (para el CHECK que solo las mira). */
function columnasNuevas(ops, tabla) {
  return ops.filter((o) => o.tipo === 'columna' && o.accion === 'añade' && sinFirma(o.objeto) === tabla)
    .map((o) => o.detalle.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/i)?.[1]?.toLowerCase())
    .filter(Boolean)
}

/**
 * ¿Solo añade este fichero, contra el contexto (tablas y funciones que existen,
 * medido en staging)? null si sí; si no, el porqué de la primera operación que no.
 * Solo migraciones: una prueba de staging nunca va de verdad.
 */
export function porQueNoSoloAnade(fichero, sql, contexto) {
  if (!/^supabase\/migrations\//.test(fichero)) return 'no es una migración: solo en ROLLBACK'
  const ops = analizarFichero(fichero, sql)
  if (!ops.length) return 'no hace nada que se pueda medir'
  const tablas = new Set(contexto.tablas ?? [])
  const funciones = new Set(contexto.funciones ?? [])
  const deLaTanda = creadosPorLaTanda({ [fichero]: ops })
  const existe = (o) => {
    const antes = o.tipo === 'funcion'
      ? (o.objeto.includes('(') ? funciones.has(o.objeto) : [...funciones].some((x) => x.startsWith(`${o.objeto}(`)))
      : tablas.has(sinFirma(o.objeto))
    return antes && !deLaTanda.has(o.tipo === 'funcion' ? o.objeto : sinFirma(o.objeto))
  }
  const ctx = {
    existe,
    filas: (o) => contexto.filas?.[sinFirma(o.objeto)],
    otrasFirmas: (o) => [...funciones].filter((x) => sinFirma(x) === sinFirma(o.objeto) && x !== o.objeto),
    enCamino: () => false,
    opsDelFichero: ops,
  }
  for (const o of ops) {
    const c = categoria(o, ctx)
    if (c.cat === 'añade') continue
    if (o.tipo === 'restriccion' && o.accion === 'añade' && /\bcheck\b/i.test(o.detalle)) {
      const nuevas = columnasNuevas(ops, sinFirma(o.objeto))
      // Todo lo que nombra el CHECK tiene que ser columna nueva (sin cadenas, palabras de SQL ni funciones).
      const expr = o.detalle.slice(o.detalle.search(/\bcheck\b/i) + 5).replace(/'(?:[^']|'')*'/g, ' ').replace(/::\s*[a-z_][a-z0-9_]*/gi, ' ')
      const nombres = [...expr.matchAll(/\b([a-z_][a-z0-9_]*)\b(?!\s*\()/gi)].map((m) => m[1].toLowerCase()).filter((w) => !PALABRAS_SQL.has(w))
      if (nuevas.length && nombres.length && nombres.every((w) => nuevas.includes(w))) continue
    }
    return `${o.accion} ${o.tipo} ${o.objeto}: ${c.motivo ?? c.cat}`
  }
  return null
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [modo, ...args] = process.argv.slice(2)
  if (modo === 'nuevas') {
    // Un manifiesto nombrado (pruebas), tal cual; sin él, el entero (el cerrado y las tandas, C10).
    const [ref, manifiesto] = args
    if (manifiesto) {
      let antes = ''
      try { antes = git('show', `${ref}:${manifiesto}`) } catch { antes = '' }
      for (const l of nuevas(antes, readFileSync(manifiesto, 'utf8'))) console.log(l)
    } else {
      for (const l of nuevas(textoDelManifiesto(ref), textoDelManifiesto())) console.log(l)
    }
  } else if (modo === 'entero') {
    for (const l of lineas(textoDelManifiesto())) console.log(l)
  } else if (modo === 'rollback') {
    let mal = 0
    for (const f of args) {
      const p = porQueNoSeEnsaya(readFileSync(f, 'utf8'))
      if (p) { console.log(`::error::${f} ${p}. No se ensaya nada.`); mal = 1 }
    }
    process.exit(mal)
  } else if (modo === 'anaden') {
    const [fCtx, ...fs] = args
    const raw = JSON.parse(readFileSync(fCtx, 'utf8'))
    const contexto = raw.contexto ?? raw
    for (const f of fs) {
      const p = porQueNoSoloAnade(f, readFileSync(f, 'utf8'), contexto)
      if (p) console.error(`${f}: solo en ROLLBACK (${p})`)
      else console.log(f)
    }
  } else if (modo === 'sesiones') {
    for (const s of sesiones(args)) console.log(`--@@ sesión ${s.fichero}\n${s.sql}`)
  } else {
    console.error('uso: staging-tanda.mjs nuevas <ref> [manifiesto] | entero | rollback <ficheros…> | sesiones <ficheros…>')
    process.exit(2)
  }
}
