#!/usr/bin/env node
// scripts/conta/produccion/analizar.mjs
//
// QUÉ CREA O ALTERA CADA FICHERO DE UNA TANDA, antes de aplicarla en
// producción (respuestas 6 y 7 del C00). Lo usa aplicar-produccion-conta.yml.
//
//   node scripts/conta/produccion/analizar.mjs objetivos  f1.sql f2.sql …
//       → JSON con los objetos que nombra cada fichero (para preguntar a la
//         base cuáles ya existen).
//   node scripts/conta/produccion/analizar.mjs decidir existentes.json f1.sql …
//       → informe en Markdown por la salida estándar, y sale con 1 si algún
//         fichero PARA.
//
// «Existente» = existía en producción ANTES de la tanda y no lo crea ningún
// fichero de la tanda. Todo lo existente se trata como de Cocina, albaranes o
// pedidos: es más estricto que mirar módulo a módulo, y no hay que mantener
// ninguna lista a mano.
//
// LA REGLA (respuesta 7):
//   PARA si un fichero, sobre algo existente:
//     · borra o renombra una tabla, columna, vista o función;
//     · cambia datos (update, delete, truncate);
//     · reemplaza una función que no sea vat_rate_for, o vat_rate_for
//       cambiando su firma;
//     · cambia el tipo de una columna o la hace obligatoria.
//   SIGUE, con informe, si solo añade: tabla, columna nula o con valor por
//   defecto, índice, vista nueva, restricción, política, comentario, permiso…,
//   o si reemplaza vat_rate_for con la misma firma (entonces el workflow mide
//   D1 antes y después).
//
// Lo que va dentro de un bloque DO se analiza igual que lo de fuera (se
// ejecuta). Lo que va dentro del cuerpo de una función NO (es una definición:
// no se ejecuta al aplicar). Un `execute` dinámico dentro de un DO no se puede
// leer: se lista como aviso para que lo mire una persona.

import { readFileSync } from 'node:fs'

const VAT_RATE_FOR = 'public.vat_rate_for(uuid,date)'

/** Quita comentarios y separa sentencias, respetando cadenas y cuerpos $tag$…$tag$. */
export function sentencias(sql) {
  const out = []
  let cur = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const n2 = sql.slice(i, i + 2)
    if (n2 === '--') { const j = sql.indexOf('\n', i); i = j < 0 ? sql.length : j; continue }
    if (n2 === '/*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? sql.length : j + 2; cur += ' '; continue }
    if (c === "'") {
      let j = i + 1
      while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue } if (sql[j] === "'") break; j++ }
      cur += sql.slice(i, j + 1); i = j + 1; continue
    }
    if (c === '$') {
      const m = sql.slice(i).match(/^\$([A-Za-z_]*)\$/)
      if (m) {
        const tag = m[0]
        const j = sql.indexOf(tag, i + tag.length)
        const fin = j < 0 ? sql.length : j + tag.length
        cur += sql.slice(i, fin); i = fin; continue
      }
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue }
    cur += c; i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const nombre = (s) => {
  const t = s.replace(/"/g, '').toLowerCase()
  return t.includes('.') ? t : `public.${t}`
}
const ID = '((?:"?[A-Za-z_][A-Za-z0-9_]*"?\\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)'

/** El cuerpo de un DO (se ejecuta): sus sentencias, analizadas como las de fuera. */
function cuerpoDo(s) {
  const m = s.match(/^do\s+(\$[A-Za-z_]*\$)([\s\S]*)\1/i)
  return m ? m[2] : null
}

/** Firma normalizada de un create function: public.f(uuid,date). */
function firma(s) {
  const m = s.match(new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+${ID}\\s*\\(([^)]*)\\)`, 'i'))
  if (!m) return null
  const args = m[2].split(',').map((a) => a.trim()).filter(Boolean).map((a) => {
    const sinDefecto = a.replace(/\s+default\s+[\s\S]*$/i, '').replace(/\s*=\s*[\s\S]*$/, '')
    const partes = sinDefecto.split(/\s+/).filter((p) => !/^(in|out|inout|variadic)$/i.test(p))
    // «p_id uuid» → uuid; «uuid» → uuid
    const tipo = partes.length > 1 ? partes.slice(1).join(' ') : partes[0]
    return tipo.toLowerCase().replace(/\bcharacter varying\b/, 'varchar').replace(/\binteger\b/, 'integer')
  })
  return `${nombre(m[1])}(${args.join(',')})`
}

/** Clasifica UNA sentencia. Devuelve [{accion, objeto, tipo, detalle}]. */
export function clasificar(s, dentroDeDo = false) {
  const t = s.replace(/\s+/g, ' ').trim()
  const low = t.toLowerCase()
  const r = []
  const add = (accion, tipo, objeto, detalle = '') => r.push({ accion, tipo, objeto, detalle, dentroDeDo })

  // El cuerpo del DO se lee del texto ORIGINAL, con sus saltos de línea: con
  // todo en una línea, un comentario «--» dentro del bloque se comía el resto
  // y el bloque entero salía vacío (lo cazó la 0110 del C01b, 04/10).
  const cuerpo = cuerpoDo(s.trim())
  if (cuerpo !== null) {
    for (const x of sentencias(cuerpo)) {
      // Dentro de un DO hay bloques begin/end, if, loop…: se buscan las órdenes que importan en cada trozo.
      for (const trozo of x.split(/\b(?:begin|then|else|loop)\b/i)) r.push(...clasificar(trozo.trim(), true))
      if (/\bexecute\b/i.test(x)) add('dinamico', 'desconocido', '(execute dinámico)', x.replace(/\s+/g, ' ').slice(0, 160))
    }
    return r
  }

  let m
  if ((m = t.match(new RegExp(`^create (?:unlogged )?table (?:if not exists )?${ID}`, 'i')))) add('crea', 'tabla', nombre(m[1]))
  else if ((m = t.match(new RegExp(`^create (?:or replace )?(?:materialized )?view ${ID}`, 'i')))) add(/or replace/i.test(t) ? 'reemplaza' : 'crea', 'vista', nombre(m[1]))
  else if (/^create (?:or replace )?function/i.test(t)) add(/^create or replace/i.test(t) ? 'reemplaza' : 'crea', 'funcion', firma(t) ?? '(firma ilegible)')
  else if ((m = t.match(new RegExp(`^create (?:unique )?index (?:concurrently )?(?:if not exists )?(?:${ID} )?on (?:only )?${ID}`, 'i')))) add('crea', 'indice', nombre(m[2]), m[1] ?? '')
  else if ((m = t.match(new RegExp(`^create (?:or replace )?trigger ${ID} .*? on ${ID}`, 'i')))) add('crea', 'disparador', nombre(m[2]), m[1])
  else if ((m = t.match(new RegExp(`^create policy ${ID} on ${ID}`, 'i')))) add('crea', 'politica', nombre(m[2]), m[1])
  else if ((m = t.match(new RegExp(`^drop policy (?:if exists )?${ID} on ${ID}`, 'i')))) add('quita', 'politica', nombre(m[2]), m[1])
  else if ((m = t.match(new RegExp(`^drop trigger (?:if exists )?${ID} on ${ID}`, 'i')))) add('quita', 'disparador', nombre(m[2]), m[1])
  else if ((m = t.match(new RegExp(`^drop function (?:if exists )?${ID}\\s*(\\([^)]*\\))?`, 'i')))) {
    // Con firma, normalizada como la de create function; sin ella, todas las del nombre.
    const f = m[2] ? firma(`create function ${m[1]}${m[2]}`) : nombre(m[1])
    add('borra', 'funcion', f ?? nombre(m[1]))
  }
  else if ((m = t.match(new RegExp(`^drop (table|view|materialized view|index|type|sequence|schema) (?:if exists )?${ID}`, 'i')))) add('borra', m[1].toLowerCase().replace('table', 'tabla').replace(/^view$/, 'vista'), nombre(m[2]))
  else if ((m = t.match(new RegExp(`^alter (table|view|function) (?:if exists )?(?:only )?${ID}`, 'i')))) {
    const tipo = m[1].toLowerCase() === 'table' ? 'tabla' : m[1].toLowerCase() === 'view' ? 'vista' : 'funcion'
    const obj = nombre(m[2])
    const resto = t.slice(m[0].length)
    for (const parte of resto.split(/,(?![^(]*\))/)) {
      const tal = parte.trim()
      const p = tal.toLowerCase()
      if (!p) continue
      if (/^rename\b/.test(p)) add('renombra', tipo, obj, tal)
      else if (/^drop column\b/.test(p)) add('borra', 'columna', obj, tal)
      else if (/^add column\b/.test(p) || /^add (?!constraint)/.test(p)) {
        const obligatoria = /\bnot null\b/.test(p) && !/\bdefault\b/.test(p)
        add(obligatoria ? 'columna_obligatoria' : 'añade', 'columna', obj, tal.slice(0, 120))
      } else if (/^alter column\b.*\btype\b/.test(p)) add('cambia_tipo', 'columna', obj, tal)
      else if (/^alter column\b.*\bset not null\b/.test(p)) add('columna_obligatoria', 'columna', obj, tal)
      else if (/^add constraint\b/.test(p)) add('añade', 'restriccion', obj, tal.slice(0, 120))
      else if (/^drop constraint\b/.test(p)) add('quita', 'restriccion', obj, tal.slice(0, 120))
      else if (/^(enable|disable|force) row level security/.test(p)) add('altera', 'rls', obj, tal)
      else add('altera', tipo, obj, tal.slice(0, 120))
    }
  }
  else if ((m = t.match(new RegExp(`^update (?:only )?${ID}`, 'i')))) add('cambia_datos', 'tabla', nombre(m[1]), 'update')
  else if ((m = t.match(new RegExp(`^delete from (?:only )?${ID}`, 'i')))) add('cambia_datos', 'tabla', nombre(m[1]), 'delete')
  else if ((m = t.match(new RegExp(`^truncate (?:table )?(?:only )?${ID}`, 'i')))) add('cambia_datos', 'tabla', nombre(m[1]), 'truncate')
  else if ((m = t.match(new RegExp(`^insert into ${ID}`, 'i')))) add('inserta', 'tabla', nombre(m[1]), /on conflict[\s\S]*do update/i.test(t) ? 'insert … on conflict do update' : 'insert')
  else if ((m = t.match(new RegExp(`^comment on (?:column|table|function|view) ${ID}`, 'i')))) add('comenta', 'comentario', nombre(m[1]))
  else if (/^with\b/i.test(t)) {
    // Una CTE que escribe («with n as (insert into … returning …) select …»):
    // cada insert, update o delete de dentro cuenta como si fuera suelto.
    for (const x of t.matchAll(new RegExp(`\\binsert into ${ID}`, 'gi'))) add('inserta', 'tabla', nombre(x[1]), 'insert (dentro de un with)')
    for (const x of t.matchAll(new RegExp(`\\bupdate (?:only )?${ID}(?: (?:as )?[A-Za-z_][A-Za-z0-9_]*)? set\\b`, 'gi'))) add('cambia_datos', 'tabla', nombre(x[1]), 'update (dentro de un with)')
    for (const x of t.matchAll(new RegExp(`\\bdelete from (?:only )?${ID}`, 'gi'))) add('cambia_datos', 'tabla', nombre(x[1]), 'delete (dentro de un with)')
  }
  else if (/^(grant|revoke)\b/i.test(t)) add('permiso', 'permiso', low.slice(0, 120))
  else if (/^(begin|commit|rollback|end|start transaction)\b/i.test(low) && !dentroDeDo) add('transaccion', 'control', low)
  else if (!dentroDeDo && /^(select|set|reset|notify|analyze)\b/i.test(low)) add('otro', 'otro', low.slice(0, 80))
  return r
}

export function analizarFichero(f, texto = readFileSync(f, 'utf8')) {
  return sentencias(texto).flatMap((s) => clasificar(s))
}

/** Lo que la tanda crea ella misma: no cuenta como existente aunque ya esté. */
export function creadosPorLaTanda(porFichero) {
  const s = new Set()
  for (const ops of Object.values(porFichero)) for (const o of ops) if (o.accion === 'crea' && ['tabla', 'vista', 'funcion'].includes(o.tipo)) s.add(o.objeto)
  return s
}

const tablaDe = (o) => o.objeto.replace(/\(.*$/, '')

/** La regla de la respuesta 7, para un fichero. `existe(obj)` dice si existía antes. */
export function decidir(ops, existe) {
  const para = []
  const sigue = []
  const avisos = []
  for (const o of ops) {
    const ex = existe(o)
    const linea = `${o.accion} · ${o.tipo} · \`${o.objeto}\`${o.detalle ? ` · ${o.detalle}` : ''}`
    if (o.accion === 'dinamico') { avisos.push(linea); continue }
    if (o.accion === 'transaccion') { para.push(`${linea} — el fichero no puede llevar su propio control de transacción`); continue }
    if (!ex) continue
    if (['borra', 'renombra'].includes(o.accion) && ['tabla', 'vista', 'funcion', 'columna', 'materialized view'].includes(o.tipo)) para.push(linea)
    else if (o.accion === 'cambia_datos') para.push(linea)
    else if (o.accion === 'cambia_tipo' || o.accion === 'columna_obligatoria') para.push(linea)
    else if (o.accion === 'reemplaza' && o.tipo === 'funcion' && o.objeto !== VAT_RATE_FOR) para.push(`${linea} — solo vat_rate_for puede reemplazarse`)
    else if (o.accion === 'reemplaza' && o.tipo === 'vista') para.push(`${linea} — reemplaza una vista existente`)
    else sigue.push(linea)
  }
  const tocaVatRateFor = ops.some((o) => o.accion === 'reemplaza' && o.objeto === VAT_RATE_FOR)
  return { para, sigue, avisos, tocaVatRateFor }
}

// ── Línea de órdenes ────────────────────────────────────────────────────────
const [modo, ...resto] = process.argv.slice(2)
if (modo === 'objetivos') {
  const porFichero = Object.fromEntries(resto.map((f) => [f, analizarFichero(f)]))
  const tablas = new Set(); const funciones = new Set()
  for (const ops of Object.values(porFichero)) for (const o of ops) {
    if (o.tipo === 'funcion') funciones.add(o.objeto)
    else if (o.objeto.startsWith('public.') || /^[a-z_]+\.[a-z_]+$/.test(o.objeto)) tablas.add(tablaDe(o))
  }
  process.stdout.write(JSON.stringify({ tablas: [...tablas].sort(), funciones: [...funciones].sort() }, null, 1) + '\n')
} else if (modo === 'decidir') {
  const [fExistentes, ...ficheros] = resto
  const existentes = JSON.parse(readFileSync(fExistentes, 'utf8'))
  const exTablas = new Set(existentes.tablas ?? [])
  const exFunciones = new Set(existentes.funciones ?? [])
  const porFichero = Object.fromEntries(ficheros.map((f) => [f, analizarFichero(f)]))
  const deLaTanda = creadosPorLaTanda(porFichero)
  const existe = (o) => {
    if (o.tipo === 'funcion' && !o.objeto.includes('(')) return [...exFunciones].some((f) => f.startsWith(`${o.objeto}(`))
    if (o.tipo === 'funcion') return exFunciones.has(o.objeto) && !deLaTanda.has(o.objeto)
    const t = tablaDe(o)
    return exTablas.has(t) && !deLaTanda.has(t)
  }
  let alguno = false
  const l = ['## Qué crea o altera cada fichero', '',
    'Existente = estaba en producción antes de la tanda y ningún fichero de la tanda lo crea. Todo lo existente se trata como de Cocina, albaranes o pedidos.', '']
  for (const f of ficheros) {
    const ops = porFichero[f]
    const d = decidir(ops, existe)
    const nuevos = [...new Set(ops.filter((o) => o.accion === 'crea' && !existe(o)).map((o) => `${o.tipo} \`${o.objeto}\``))]
    l.push(`### \`${f}\` — ${d.para.length ? '**PARA**' : d.tocaVatRateFor ? 'sigue · reemplaza vat_rate_for (D1 antes y después)' : 'sigue'}`)
    l.push(`- Crea (nuevo): ${nuevos.length ? nuevos.join(', ') : 'nada'}`)
    if (d.sigue.length) { l.push('- Altera algo existente (solo añade):'); for (const x of d.sigue) l.push(`  - ${x}`) }
    if (d.para.length) { alguno = true; l.push('- **Para por:**'); for (const x of d.para) l.push(`  - ${x}`) }
    if (d.avisos.length) { l.push('- Aviso, para que lo mire una persona:'); for (const x of d.avisos) l.push(`  - ${x}`) }
    l.push('')
  }
  const tocan = ficheros.filter((f) => decidir(porFichero[f], existe).tocaVatRateFor)
  l.push(`VAT_RATE_FOR_EN: ${tocan.join(' ') || '(ninguno)'}`)
  process.stdout.write(l.join('\n') + '\n')
  process.exitCode = alguno ? 1 : 0
}
