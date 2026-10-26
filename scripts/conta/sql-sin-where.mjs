#!/usr/bin/env node
// scripts/conta/sql-sin-where.mjs
//
// PC01 · arreglo urgente (respuesta 6 de Julio, 26/10). Ninguna migración trae
// un DELETE ni un UPDATE sin WHERE.
//
// Por qué: la app llama por PostgREST, y el rol authenticator carga safeupdate
// (session_preload_libraries = supautils, safeupdate). safeupdate para TODO
// DELETE o UPDATE sin WHERE, también el que va dentro de una función security
// definer o de un disparador. Las pruebas de staging corren como postgres, sin
// safeupdate, y no lo ven: el 25/10, _conta_liquidacion_cobros vaciaba sus
// temporales con «delete from _pc01_pedidos;» y casar en Bancos el ingreso de
// una liquidación fallaba entero («DELETE requires a WHERE clause»). Había otras
// dos así desde antes (_compras_fin_de_mes y recost_sales_for_product).
//
// Qué mira: cada «delete from …» y cada «update <tabla> set …» de los ficheros,
// en el código y en el SQL dinámico que va dentro de una cadena («execute
// 'delete from …'», «format('update %I set …')»). La sentencia acaba en el «;»
// o en el «)» que la cierra (una CTE). Lleva WHERE si lo tiene fuera de sus
// paréntesis: el de una subconsulta no cuenta. «on conflict … do update set»
// y «for update» no son sentencias UPDATE y no se miran.
//
// Para vaciar una tabla entera, «where true» (lo que hace la 0642). Si de verdad
// tiene que ir sin WHERE (una migración que corre como postgres y no llama
// nadie desde la app), se dice en la misma línea o en la de encima:
//   -- sin where: <por qué>
//
// Uso:
//   node scripts/conta/sql-sin-where.mjs                 las añadidas o cambiadas contra origin/main, con lo no commiteado
//   node scripts/conta/sql-sin-where.mjs <base> [<head>] las de ese diff (pr-a-main.yml)
//   node scripts/conta/sql-sin-where.mjs revisar <f>…    esos ficheros
//   node scripts/conta/sql-sin-where.mjs todas           todas las de supabase/migrations (para medir; no para)
// Sale con 1 si alguna no cumple.

import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SENTENCIA = /\b(delete\s+from|update\s+(?:only\s+)?[\w."$%]+(?:\s+(?:as\s+)?[\w"]+)?\s+set)\b/gi
const EXENTA = /--\s*sin where:\s*\S/i

/**
 * El texto con los comentarios y el contenido de las cadenas cambiados por
 * espacios (los saltos de línea se quedan, para contar las líneas), y la lista
 * de cadenas con su posición.
 */
export function sinComentariosNiCadenas(texto) {
  const t = String(texto)
  let out = ''
  const cadenas = []
  let i = 0
  const blanco = (s) => s.replace(/[^\n]/g, ' ')
  while (i < t.length) {
    const c = t[i]
    const d = t[i + 1]
    if (c === '-' && d === '-') {
      const fin = t.indexOf('\n', i)
      const j = fin < 0 ? t.length : fin
      out += blanco(t.slice(i, j)); i = j
    } else if (c === '/' && d === '*') {
      const fin = t.indexOf('*/', i + 2)
      const j = fin < 0 ? t.length : fin + 2
      out += blanco(t.slice(i, j)); i = j
    } else if (c === "'") {
      const conBarra = /[eE]/.test(t[i - 1] ?? '') && !/[\w]/.test(t[i - 2] ?? '')
      let j = i + 1
      while (j < t.length) {
        if (conBarra && t[j] === '\\') { j += 2; continue }
        if (t[j] === "'") { if (t[j + 1] === "'") { j += 2; continue } break }
        j++
      }
      cadenas.push({ inicio: i, texto: t.slice(i + 1, j).replace(/''/g, "'") })
      out += "'" + blanco(t.slice(i + 1, j)) + (j < t.length ? "'" : '')
      i = j + 1
    } else {
      out += c; i++
    }
  }
  return { codigo: out, cadenas }
}

/** Desde la posición de una sentencia, hasta su «;» o el «)» que la cierra; con lo de dentro de paréntesis en blanco. */
function trozoDeLaSentencia(codigo, desde) {
  let prof = 0
  let plano = ''
  let i = desde
  for (; i < codigo.length; i++) {
    const c = codigo[i]
    if (c === '(') { prof++; plano += ' '; continue }
    if (c === ')') { if (prof === 0) break; prof--; plano += ' '; continue }
    if (c === ';' && prof === 0) break
    plano += prof === 0 ? c : ' '
  }
  return { plano, fin: i }
}

const lineaDe = (texto, pos) => texto.slice(0, pos).split('\n').length

/** Las sentencias DELETE y UPDATE sin WHERE de un texto SQL: [{ linea, sentencia }]. */
export function sentenciasSinWhere(texto) {
  const t = String(texto)
  const lineas = t.split('\n')
  const exenta = (linea) => EXENTA.test(lineas[linea - 1] ?? '') || EXENTA.test(lineas[linea - 2] ?? '')
  const { codigo, cadenas } = sinComentariosNiCadenas(t)
  const mal = []
  const mirar = (cod, base, posEnTexto) => {
    for (const m of cod.matchAll(SENTENCIA)) {
      const { plano, fin } = trozoDeLaSentencia(cod, m.index)
      if (/\bwhere\b/i.test(plano)) continue
      const linea = lineaDe(t, posEnTexto(m.index))
      if (exenta(linea)) continue
      mal.push({ linea, sentencia: base(m.index, fin).replace(/\s+/g, ' ').trim().slice(0, 160) })
    }
  }
  // En el código.
  mirar(codigo, (a, b) => t.slice(a, b), (p) => p)
  // Dentro de cada cadena que es SQL (execute, format…).
  for (const c of cadenas) {
    if (!/^\s*(delete\s+from|update)\b/i.test(c.texto)) continue
    const dentro = sinComentariosNiCadenas(c.texto).codigo
    mirar(dentro, (a, b) => c.texto.slice(a, b), () => c.inicio)
  }
  return mal.sort((a, b) => a.linea - b.linea)
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.sql'))

// En el PR, el diff entre sus dos commits. En local (sin head), también lo que
// aún no está commiteado: lo cambiado y lo nuevo.
function ficherosDelDiff(base, head) {
  if (head) return git('diff', '--name-only', '--diff-filter=AM', `${base}...${head}`, '--', 'supabase/migrations')
  const desde = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim()
  return [...new Set([
    ...git('diff', '--name-only', '--diff-filter=AM', desde, '--', 'supabase/migrations'),
    ...git('ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations'),
  ])].sort()
}

function revisar(ficheros, { para = true } = {}) {
  let n = 0
  for (const f of ficheros) {
    for (const x of sentenciasSinWhere(readFileSync(f, 'utf8'))) {
      n++
      console.log(`${para ? '::error ' : ''}${f}:${x.linea} · sin WHERE: ${x.sentencia}`)
    }
  }
  const que = `${ficheros.length} migraci${ficheros.length === 1 ? 'ón' : 'ones'}`
  if (n) {
    console.log(`\n${n} DELETE o UPDATE sin WHERE en ${que}. La app pasa por safeupdate y los para: usa «where true» para vaciar una tabla, o di por qué no con «-- sin where: <por qué>» en la misma línea o en la de encima.`)
    return para ? 1 : 0
  }
  console.log(`Ningún DELETE ni UPDATE sin WHERE en ${que}.`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, ...resto] = process.argv.slice(2)
  if (a === 'revisar') process.exit(revisar(resto))
  if (a === 'todas') process.exit(revisar(readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => `supabase/migrations/${f}`), { para: false }))
  process.exit(revisar(ficherosDelDiff(a ?? 'origin/main', resto[0])))
}
