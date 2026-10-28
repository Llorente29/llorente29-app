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
//       («otra vez: <ruta>» pasa la ruta aunque ya estuviera: ver OTRA_VEZ)
//   node scripts/conta/staging-tanda.mjs rutas <ficheros…>
//     → para (sale con 1) si alguna ruta no la admite el workflow o no existe
//       (la misma regla en aplicar-staging-conta.yml y en pr-a-main.yml)
//   node scripts/conta/staging-tanda.mjs semilla <ficheros…>
//     → W07: las semillas que se puede intentar que vayan de verdad; en el
//       error, las demás y por qué
//   node scripts/conta/staging-tanda.mjs ya-de-verdad <registro>
//     → W07b: de «fichero md5» (lo que la rama ya pasó de verdad), los que
//       siguen iguales: cuentan como que van de verdad
//   node scripts/conta/staging-tanda.mjs semilla-dos-veces <semilla> [previas…]
//     → W07: el psql que la aplica dos veces en ROLLBACK y compara las medidas
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
import { createHash } from 'node:crypto'
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

// F01, respuesta 4 (27/10) · «OTRA VEZ». Lo que ya está en el manifiesto de
// main no vuelve a pasar: «lo nuevo» se mide por la línea. Si un fichero entró
// en el manifiesto y su run falló (el #677 cayó entero por la ruta de una
// semilla de Folvy), staging se queda sin él y repetir la línea no sirve: no es
// nueva. «otra vez: <ruta>» es una línea distinta —así cuenta como nueva una
// vez, en el push que la añade— y pasa la ruta de detrás.
const OTRA_VEZ = /^otra vez:\s*/

/** La ruta de una línea del manifiesto (sin «otra vez:»). */
export function ruta(linea) {
  return String(linea).trim().replace(OTRA_VEZ, '')
}

/** Las rutas de «ahora» cuya línea no estaba en «antes», en el orden de «ahora» y sin repetir. */
export function nuevas(antes, ahora) {
  const ya = new Set(lineas(antes))
  return [...new Set(lineas(ahora).filter((l) => !ya.has(l)).map(ruta))]
}

// Qué rutas admite el manifiesto de staging: el SQL de las migraciones, de las
// pruebas de staging y de las semillas de cada producto (contabilidad, reparto
// y, desde el F01, Folvy). Una sola regla para el workflow que aplica
// (aplicar-staging-conta.yml) y para el que revisa el PR (pr-a-main.yml): el
// #358 se fusionó con una semilla de seeds/folvy que el workflow no admitía, y
// el run de main tras la fusión (#677) cayó entero sin aplicar nada.
export const RUTA_STAGING = /^supabase\/(migrations|staging\/sql|seeds\/conta|seeds\/reparto|seeds\/folvy)\/[A-Za-z0-9_./-]+\.sql$/

/** Por qué el workflow no admitiría esta ruta, o null si la admite. */
export function rutaNoAdmitida(f) {
  if (!RUTA_STAGING.test(f) || f.includes('..')) return 'Ruta no permitida en el manifiesto'
  return null
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
 * «ROLLBACK [WORK|TRANSACTION] TO [SAVEPOINT] x» no cuenta: vuelve al savepoint y
 * la transacción sigue abierta (S01, 28/10: la prueba de la guarda de la 2238).
 */
export function porQueNoSeEnsaya(sql) {
  const s = sinRuido(sql)
  if (/(^|;)\s*(commit|end)\s*(transaction|work)?\s*;/im.test(s)) return 'tiene un COMMIT: dejaría cosas de verdad en staging'
  const sentencias = s.split(';').map((x) => x.trim()).filter(Boolean)
  const i = sentencias.findIndex((x) => /^rollback\b/i.test(x) && !/^rollback(\s+(work|transaction))?\s+to\b/i.test(x))
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
 * Las funciones de public que el fichero LLAMA al aplicarse (fuera del cuerpo de
 * las funciones que define) y que no crea él mismo. El analizador no sigue lo
 * que escriben: la 2238 del S01 crea su copia (añade) y hace los asientos con
 * public._s01_asiento_cobro(), así que «solo añade» decía que podía ir de verdad
 * desde la rama, y no puede (S01, Respuesta 3, el ensayo #691).
 */
export function llamadasAlAplicar(sql) {
  const limpio = sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''")
  // Lo que se ejecuta al aplicar: el cuerpo de cada DO y las sentencias select/perform de fuera
  // (no el cuerpo de las funciones que define, ni las expresiones de una política o un default).
  const dos = [...limpio.matchAll(/\bdo\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/gi)].map((m) => m[2])
  const fuera = sinRuido(sql).split(';').map((x) => x.trim()).filter((x) => /^(select|perform)\b/i.test(x))
  const propias = new Set([...limpio.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()))
  const llamadas = [...dos, ...fuera].flatMap((t) => [...t.matchAll(/(?<!\b(?:into|references|table|from|join|update|on)\s+)\bpublic\.([a-z_][a-z0-9_]*)\s*\(/gi)].map((m) => m[1].toLowerCase()))
  return [...new Set(llamadas.filter((f) => !propias.has(f)))].map((f) => `public.${f}()`)
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
  const llama = llamadasAlAplicar(sql)
  if (llama.length) return `al aplicarse llama a ${llama.join(', ')}, que puede escribir lo que el analizador no ve`
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

// ─────────────────────────────────────────────────────────────────────────────
// W07 (Julio, 28/10) · LAS SEMILLAS DE UNA RAMA LLEGAN A STAGING.
// Una semilla nueva solo se ensayaba en ROLLBACK hasta fusionar, y la e2e de la
// rama que la necesitaba no la encontraba: el #358 (arreglado a mano con el
// #365) y el #361. Ahora una semilla va de verdad desde la rama, como lo que
// solo añade (W05), si se puede aplicar dos veces. No basta con que lo diga su
// cabecera: lo demuestra el ensayo. En ROLLBACK se aplica, se mide, se aplica
// otra vez y se vuelve a medir; si las dos medidas coinciden (las mismas filas y
// las mismas huellas en las tablas que escribe y en las funciones que crea), va
// de verdad. Si no, se queda solo en ROLLBACK, y el ensayo dice por qué.
//
// Antes de medir, lo que ni se intenta (porQueNoVaLaSemilla):
//   · un COMMIT o un ROLLBACK a mitad (no se puede ensayar);
//   · llamar al aplicarse a una función que no crea ella (la regla del S01 en el
//     #363: puede escribir donde la medida no mira);
//   · un insert a secas, sin «on conflict» ni «not exists»: la segunda vez duplica;
//   · update, delete o truncate al aplicarse: cambian filas que ya existen y que
//     leen las demás ramas (lo que va de verdad desde una rama solo añade).
// ─────────────────────────────────────────────────────────────────────────────

export const esSemilla = (f) => /^supabase\/seeds\//.test(f)

/** Los trozos de SQL que se ejecutan al aplicar: cada sentencia de fuera y cada sentencia del cuerpo de un DO (no el de las funciones que define). */
export function trozosAlAplicar(sql) {
  const limpio = sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''")
  const dos = [...limpio.matchAll(/\bdo\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/gi)].flatMap((m) => m[2].split(';'))
  const fuera = sinRuido(sql).split(';')
  return [...dos, ...fuera].map((x) => x.trim()).filter(Boolean)
}

const tablaPublica = (t) => (t.includes('.') ? t : `public.${t}`).toLowerCase()

/** Las tablas en las que escribe la semilla al aplicarse (insert, update, delete, truncate). */
export function tablasQueEscribe(sql) {
  const t = trozosAlAplicar(sql).flatMap((x) => [...x.matchAll(/\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi)].map((m) => tablaPublica(m[1])))
  return [...new Set(t)].sort()
}

/** Las funciones de public que crea la semilla (por nombre). */
export function funcionesQueCrea(sql) {
  const limpio = sql.replace(/--.*$/gm, ' ')
  return [...new Set([...limpio.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)].map((m) => m[1].toLowerCase()))].sort()
}

/** ¿Puede intentarse que esta semilla vaya de verdad desde la rama? null si sí; si no, por qué. */
export function porQueNoVaLaSemilla(fichero, sql) {
  if (!esSemilla(fichero)) return 'no es una semilla'
  const e = porQueNoSeEnsaya(sql)
  if (e) return e
  const llama = llamadasAlAplicar(sql)
  if (llama.length) return `al aplicarse llama a ${llama.join(', ')}, que puede escribir donde la medida no mira`
  const trozos = trozosAlAplicar(sql)
  const cambia = trozos.map((x) => x.match(/^(?:[\s\S]*?\b(?:then|else|loop|begin)\s+)?(update|delete\s+from|truncate)\s+(?:table\s+)?(?:only\s+)?([a-z_][a-z0-9_.]*)/i)).find(Boolean)
  if (cambia) return `${cambia[1].toLowerCase()} ${tablaPublica(cambia[2])} al aplicarse: cambia filas que ya existen y que leen las demás ramas`
  const aSecas = trozos.find((x) => /\binsert\s+into\b/i.test(x) && !/\bon\s+conflict\b/i.test(x) && !/\bnot\s+exists\b/i.test(x))
  if (aSecas) return `inserta en ${tablaPublica(aSecas.match(/\binsert\s+into\s+([a-z_][a-z0-9_.]*)/i)[1])} sin «on conflict» ni «not exists»: la segunda vez duplica`
  if (!tablasQueEscribe(sql).length && !funcionesQueCrea(sql).length) return 'no escribe en ninguna tabla ni crea funciones: no hay nada que medir'
  return null
}

/**
 * W07b (28/10) · Lo que la rama ya pasó de verdad en un run anterior (W05 o
 * W07), con el mismo contenido, cuenta como «va de verdad» para lo que va
 * detrás. Sin esto, en el segundo push de una rama su migración ya no «solo
 * añade» contra staging (ya está puesta) y su semilla se quedaba en ROLLBACK
 * «por ir detrás de algo que no va de verdad» (el #361, ensayo 40642383617).
 * registro: «fichero md5» por línea (w06_staging.de_verdad de la rama);
 * md5De(f): el md5 del fichero de ahora, o null si ya no existe.
 */
export function yaDeVerdad(registro, md5De) {
  return String(registro ?? '').split('\n').map((l) => l.trim().split(/\s+/)).filter((x) => x.length === 2)
    .filter(([f, m]) => md5De(f) === m).map(([f]) => f)
}

/** La medida de una semilla: filas y huella de cada tabla que escribe, y huella de cada función que crea. */
export function sqlMedida(sql) {
  const tablas = tablasQueEscribe(sql).map((t) =>
    `select 'tabla ${t}'::text as obj, (select count(*) from ${t})::text as n, (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from ${t} x) as huella`)
  const fns = funcionesQueCrea(sql)
  const funciones = fns.length
    ? [`select 'función ' || p.oid::regprocedure::text, '', md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${fns.map((f) => `'${f}'`).join(', ')})`]
    : []
  return [...tablas, ...funciones].join('\nunion all\n')
}

/**
 * El script de psql que aplica la semilla dos veces en ROLLBACK y dice si las
 * dos medidas coinciden: la última línea es «W07|igual» o «W07|distinto|…».
 * Antes, lo de la tanda que va delante (previas), para que la semilla encuentre
 * lo que necesita.
 */
export function sqlDosVeces(semilla, previas = [], leer = (f) => readFileSync(f, 'utf8')) {
  const medida = sqlMedida(leer(semilla))
  return [
    '\\set ON_ERROR_STOP 1',
    'begin;',
    ...previas.map((p) => `\\i ${p}`),
    `\\i ${semilla}`,
    `create temp table _w07_1 on commit drop as ${medida};`,
    `\\i ${semilla}`,
    `create temp table _w07_2 on commit drop as ${medida};`,
    `select 'W07|' || coalesce('distinto|' || (select string_agg(coalesce(a.obj, b.obj) || ': ' || case
         when a.obj is null then 'aparece la segunda vez' when b.obj is null then 'desaparece la segunda vez'
         when a.obj like 'función %' then 'otra definición'
         when a.n is distinct from b.n then a.n || ' filas → ' || b.n || ' filas (otra huella)'
         else 'las mismas ' || a.n || ' filas, con otra huella' end, '; ' order by coalesce(a.obj, b.obj))
       from _w07_1 a full join _w07_2 b on a.obj = b.obj where (a.n, a.huella) is distinct from (b.n, b.huella)), 'igual');`,
    'rollback;',
  ].join('\n')
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
    for (const l of new Set(lineas(textoDelManifiesto()).map(ruta))) console.log(l)
  } else if (modo === 'rutas') {
    let mal = 0
    for (const f of args) {
      const p = rutaNoAdmitida(f)
      if (p) { console.log(`::error::${p}: ${f} (admite ${RUTA_STAGING.source})`); mal = 1; continue }
      if (!existsSync(f)) { console.log(`::error::No existe: ${f}`); mal = 1 }
    }
    process.exit(mal)
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
  } else if (modo === 'semilla') {
    // W07: las que se puede intentar que vayan de verdad (una por línea); las demás, al error con su porqué.
    for (const f of args) {
      const p = porQueNoVaLaSemilla(f, readFileSync(f, 'utf8'))
      if (p) console.error(`\`${f}\`: solo en ROLLBACK (${p})`)
      else console.log(f)
    }
  } else if (modo === 'ya-de-verdad') {
    // W07b: de «fichero md5» (stdin o un fichero), los que siguen iguales en el árbol de ahora.
    const md5De = (f) => { try { return createHash('md5').update(readFileSync(f)).digest('hex') } catch { return null } }
    for (const f of yaDeVerdad(readFileSync(args[0] ?? 0, 'utf8'), md5De)) console.log(f)
  } else if (modo === 'semilla-dos-veces') {
    const [semilla, ...previas] = args
    console.log(sqlDosVeces(semilla, previas))
  } else if (modo === 'sesiones') {
    for (const s of sesiones(args)) console.log(`--@@ sesión ${s.fichero}\n${s.sql}`)
  } else {
    console.error('uso: staging-tanda.mjs nuevas <ref> [manifiesto] | entero | rutas <ficheros…> | semilla <ficheros…> | semilla-dos-veces <semilla> [previas…] | rollback <ficheros…> | sesiones <ficheros…>')
    process.exit(2)
  }
}
