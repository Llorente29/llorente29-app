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

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

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
      const antes = r.length
      for (const trozo of x.split(/\b(?:begin|then|else|loop)\b/i)) r.push(...clasificar(trozo.trim(), true))
      // Y las escrituras de la sentencia ENTERA: un «case when … then … else»
      // dentro de una CTE la parte en trozos y el insert de detrás ya no
      // empieza por «with» (la 0110 del C01b, 04/10). Sin repetir lo ya visto.
      const visto = new Set(r.slice(antes).map((o) => `${o.accion}|${o.objeto}`))
      const plano = x.replace(/\s+/g, ' ')
      const escrituras = [
        [new RegExp(`\\binsert into ${ID}`, 'gi'), 'inserta', 'insert'],
        [new RegExp(`\\bupdate (?:only )?${ID}(?: (?:as )?[A-Za-z_][A-Za-z0-9_]*)? set\\b`, 'gi'), 'cambia_datos', 'update'],
        [new RegExp(`\\bdelete from (?:only )?${ID}`, 'gi'), 'cambia_datos', 'delete'],
      ]
      for (const [re, accion, que] of escrituras) {
        for (const m of plano.matchAll(re)) {
          const obj = nombre(m[1])
          if (visto.has(`${accion}|${obj}`)) continue
          visto.add(`${accion}|${obj}`)
          add(accion, 'tabla', obj, `${que} (dentro de una sentencia compuesta)`)
        }
      }
      if (/\bexecute\b/i.test(x)) add('dinamico', 'desconocido', '(execute dinámico)', x.replace(/\s+/g, ' ').slice(0, 160))
    }
    return r
  }

  let m
  if ((m = t.match(new RegExp(`^create (?:unlogged )?table (?:if not exists )?${ID}`, 'i')))) add('crea', 'tabla', nombre(m[1]))
  else if ((m = t.match(new RegExp(`^create (?:or replace )?(?:materialized )?view ${ID}`, 'i')))) add(/or replace/i.test(t) ? 'reemplaza' : 'crea', 'vista', nombre(m[1]))
  else if (/^create (?:or replace )?function/i.test(t)) add(/^create or replace/i.test(t) ? 'reemplaza' : 'crea', 'funcion', firma(t) ?? '(firma ilegible)')
  else if ((m = t.match(new RegExp(`^create (?:unique )?index (concurrently )?(?:if not exists )?(?:${ID} )?on (?:only )?${ID}`, 'i')))) add('crea', 'indice', nombre(m[3]), `${m[1] ? 'concurrently ' : ''}${m[2] ?? ''}`.trim())
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

// ── W01 · Desplegar con los negocios abiertos (08/10) ───────────────────────
//
// `decidir` (la respuesta 7) dice QUÉ toca algo que ya existe. Desde el W01 eso
// no basta para parar: se mira QUÉ HACE cada operación, contra lo que existe en
// producción, sin mirar el reloj ni cómo se llama lo nuevo.
//
//   añade    — crear, columna que admite vacío o con valor por defecto, índice
//              concurrently o en tabla pequeña, política, insert … do nothing,
//              permisos, comentarios. Pasa siempre.
//   cambia   — cambiar en caliente lo que existe: reemplazar una función con la
//              misma firma, quitar y volver a poner una restricción, disparador o
//              política, reemplazar una vista, alterar una tabla. Pasa si el
//              fichero lo declara en su cabecera
//                  -- cambia: <objeto> · prueba: supabase/staging/sql/<fichero>.sql
//              y esa prueba existe y nombra el objeto; si toca el camino del
//              pedido, además «autorizo».
//   destruye — borrar o renombrar, update/delete/truncate o upsert sobre lo que
//              existe, cambiar el tipo, hacer obligatoria una columna, índice sin
//              concurrently en tabla grande. Solo con «autorizo». Borrar o
//              renombrar exige además que nada lo use (base y front) y que la
//              misma tanda no expanda lo que contrae.
//
// Y cada fichero sale «bloquea» (no lo abre ni autorizo: se arregla el
// fichero), «autorizo» (lo abre el campo autorizo) o «sigue».

export const FILAS_TABLA_GRANDE = 100_000
const ORDEN = { sigue: 0, autorizo: 1, bloquea: 2 }

const base = (obj) => obj.replace(/\(.*$/, '')
const corto = (obj) => base(obj).replace(/^[a-z_]+\./, '')
const linea = (o) => `${o.accion} · ${o.tipo} · \`${o.objeto}\`${o.detalle ? ` · ${o.detalle}` : ''}`
const nombreRestriccion = (d) => (d.match(/^(?:add|drop) constraint (?:if exists )?"?([A-Za-z_][A-Za-z0-9_]*)"?/i)?.[1] ?? '').toLowerCase()
const leerSiExiste = (r) => (existsSync(r) ? readFileSync(r, 'utf8') : null)

/** Lo que el fichero declara que cambia en caliente: «-- cambia: objeto · prueba: ruta». */
export function cabecera(texto) {
  const out = []
  for (const l of texto.split('\n')) {
    const m = l.match(/^\s*--\s*cambia:\s*(\S+)\s*·\s*prueba:\s*(\S+)\s*$/i)
    if (m) out.push({ objeto: nombre(m[1]), prueba: m[2] })
  }
  return out
}

/** La prueba de staging existe, está en su carpeta y nombra el objeto. */
export function pruebaCubre(ruta, objeto, leer = leerSiExiste) {
  if (!/^supabase\/staging\/sql\/[A-Za-z0-9_./-]+\.sql$/.test(ruta) || ruta.includes('..')) return false
  const t = leer(ruta)
  return t !== null && new RegExp(`\\b${corto(objeto)}\\b`, 'i').test(t)
}

/** Lo que una operación de borrar o renombrar quita: la clave para buscar quién lo usa. */
export function destruido(o) {
  if (!['borra', 'renombra'].includes(o.accion)) return null
  if (o.tipo === 'funcion') return { tipo: 'funcion', funcion: base(o.objeto), clave: base(o.objeto) }
  if (o.tipo === 'columna') {
    const c = o.detalle.match(/^drop column (?:if exists )?"?([A-Za-z_][A-Za-z0-9_]*)"?/i)?.[1]
    return c ? { tipo: 'columna', tabla: o.objeto, columna: c.toLowerCase(), clave: `${o.objeto}.${c.toLowerCase()}` } : null
  }
  if (o.accion === 'renombra') {
    const c = o.detalle.match(/^rename column "?([A-Za-z_][A-Za-z0-9_]*)"?/i)?.[1]
    if (c) return { tipo: 'columna', tabla: o.objeto, columna: c.toLowerCase(), clave: `${o.objeto}.${c.toLowerCase()}` }
  }
  if (['tabla', 'vista'].includes(o.tipo)) return { tipo: 'tabla', tabla: o.objeto, clave: o.objeto }
  return null
}

/**
 * La categoría de UNA operación. ctx.existe(o) = existía antes y la tanda no lo
 * crea; ctx.filas(o) = filas estimadas de su tabla; ctx.otrasFirmas(o) = otras
 * firmas que ya existen con el mismo nombre; ctx.opsDelFichero = las demás.
 */
export function categoria(o, ctx) {
  const mismo = ctx.opsDelFichero ?? []
  if (o.accion === 'transaccion') return { cat: 'bloquea', motivo: 'el fichero no puede llevar su propio control de transacción' }
  if (o.accion === 'dinamico') return { cat: 'aviso', motivo: 'execute dinámico: que lo mire una persona' }
  const ex = ctx.existe(o)
  if (o.tipo === 'funcion' && ['crea', 'reemplaza'].includes(o.accion) && !ex) {
    const otras = ctx.otrasFirmas?.(o) ?? []
    if (otras.length) {
      const seBorra = mismo.some((x) => x.accion === 'borra' && x.tipo === 'funcion' && base(x.objeto) === base(o.objeto))
      return seBorra
        ? { cat: 'cambia', motivo: `cambia la firma con drop + create (antes: ${otras.join(', ')})` }
        : { cat: 'bloquea', motivo: `crearía una sobrecarga de ${otras.join(', ')}: se hace drop + create (regla 2 de CLAUDE.md)` }
    }
  }
  if (!ex) return { cat: 'añade' }
  const vuelve = (tipo, igual) => mismo.some((x) => ['crea', 'añade'].includes(x.accion) && x.tipo === tipo && x.objeto === o.objeto && igual(x))
  const quitado = (tipo, igual) => mismo.some((x) => x.accion === 'quita' && x.tipo === tipo && x.objeto === o.objeto && igual(x))
  switch (o.accion) {
    case 'crea':
      if (o.tipo === 'indice') {
        const filas = ctx.filas?.(o) ?? 0
        // Sin concurrently frena las escrituras mientras se construye: en una
        // tabla grande, o en una del camino del pedido aunque sea pequeña.
        const camino = ctx.enCamino?.(o) ?? false
        if (!/^concurrently\b/.test(o.detalle) && (filas > FILAS_TABLA_GRANDE || camino)) return { cat: 'destruye', motivo: `índice sin concurrently sobre ${filas} filas${camino ? ' del camino del pedido' : ''}`, bloqueo: 'SHARE: frena las escrituras mientras se construye' }
        return { cat: 'añade' }
      }
      if (o.tipo === 'disparador') {
        const re = quitado('disparador', (x) => x.detalle.toLowerCase() === o.detalle.toLowerCase())
        return { cat: 'cambia', motivo: re ? 'vuelve a poner un disparador' : 'disparador nuevo en una tabla que existe: cambia cómo se escribe en ella', bloqueo: 'SHARE ROW EXCLUSIVE' }
      }
      if (o.tipo === 'politica') {
        const re = quitado('politica', (x) => x.detalle.toLowerCase() === o.detalle.toLowerCase())
        return re ? { cat: 'cambia', motivo: 'quita y vuelve a poner la política' } : { cat: 'añade' }
      }
      return { cat: 'añade' }
    case 'quita': {
      const igual = o.tipo === 'restriccion' ? (x) => nombreRestriccion(x.detalle) === nombreRestriccion(o.detalle) : (x) => x.detalle.toLowerCase() === o.detalle.toLowerCase()
      return vuelve(o.tipo, igual)
        ? { cat: 'cambia', motivo: `quita y vuelve a poner ${o.tipo}`, bloqueo: o.tipo === 'restriccion' ? 'ACCESS EXCLUSIVE: revisa todas las filas' : 'SHARE ROW EXCLUSIVE' }
        : { cat: 'destruye', motivo: `quita ${o.tipo} sin volver a ponerla`, bloqueo: 'ACCESS EXCLUSIVE' }
    }
    case 'añade':
      if (o.tipo === 'restriccion') return { cat: 'cambia', motivo: 'restricción en una tabla que existe', bloqueo: 'ACCESS EXCLUSIVE: revisa todas las filas' }
      return { cat: 'añade' }
    case 'reemplaza':
      return { cat: 'cambia', motivo: o.tipo === 'funcion' ? 'reemplaza la función (misma firma)' : `reemplaza ${o.tipo}` }
    case 'altera':
      return { cat: 'cambia', motivo: `altera ${o.tipo}`, bloqueo: 'ACCESS EXCLUSIVE' }
    case 'borra':
    case 'renombra':
      if (o.tipo === 'funcion' && mismo.some((x) => ['crea', 'reemplaza'].includes(x.accion) && x.tipo === 'funcion' && base(x.objeto) === base(o.objeto))) {
        return { cat: 'cambia', motivo: 'drop + create de la función: cambia la firma' }
      }
      return { cat: 'destruye', motivo: `${o.accion} ${o.tipo}`, bloqueo: 'ACCESS EXCLUSIVE', contrae: true }
    case 'cambia_datos':
      return { cat: 'destruye', motivo: o.detalle || 'cambia datos', bloqueo: 'ROW EXCLUSIVE: las filas que toca' }
    case 'inserta':
      return /do update/.test(o.detalle) ? { cat: 'destruye', motivo: 'insert … on conflict do update: reescribe filas que existen', bloqueo: 'ROW EXCLUSIVE' } : { cat: 'añade' }
    case 'cambia_tipo':
      return { cat: 'destruye', motivo: 'cambia el tipo de la columna', bloqueo: 'ACCESS EXCLUSIVE: puede reescribir la tabla' }
    case 'columna_obligatoria':
      return { cat: 'destruye', motivo: 'hace obligatoria una columna', bloqueo: 'ACCESS EXCLUSIVE: revisa todas las filas' }
    default:
      return { cat: 'añade' }
  }
}

/**
 * El veredicto de UN fichero. ctx, además de lo de `categoria`:
 *   cabecera            lo declarado con «-- cambia:»
 *   pruebaCubre(r, obj) la prueba de staging existe y nombra el objeto
 *   enCamino(o)         toca una tabla o función del camino del pedido que existe
 *   usos(o)             quién usa todavía lo que se borra o renombra (base y front)
 *   expandeEnLaTanda(o) la tanda añade o cambia la misma tabla que esto contrae
 *   pareceAplicado      todo lo que crea ya existía y no está en el historial
 */
export function veredicto(ops, ctx) {
  let estado = 'sigue'
  const sube = (e) => { if (ORDEN[e] > ORDEN[estado]) estado = e }
  const lineas = []
  const avisos = []
  for (const o of ops) {
    const c = categoria(o, { ...ctx, opsDelFichero: ops })
    if (c.cat === 'añade') continue
    if (c.cat === 'aviso') { avisos.push(`${linea(o)} — ${c.motivo}`); continue }
    const enCamino = c.cat !== 'bloquea' && (ctx.enCamino?.(o) ?? false)
    const filas = ctx.filas?.(o)
    const necesita = []
    if (c.cat === 'bloquea') { sube('bloquea'); necesita.push('no se abre con autorizo: se arregla el fichero') }
    if (c.cat === 'cambia') {
      const decl = (ctx.cabecera ?? []).find((h) => base(h.objeto) === base(o.objeto) || corto(h.objeto) === corto(o.objeto))
      if (!decl) { sube('bloquea'); necesita.push('falta la cabecera «-- cambia: <objeto> · prueba: supabase/staging/sql/<fichero>.sql»') }
      else if (!(ctx.pruebaCubre ?? pruebaCubre)(decl.prueba, o.objeto)) { sube('bloquea'); necesita.push(`la prueba \`${decl.prueba}\` no existe o no nombra ${corto(o.objeto)}`) }
      else if (enCamino) { sube('autorizo'); necesita.push('camino del pedido: autorizo') }
      else necesita.push(`declarado, prueba \`${decl.prueba}\``)
    }
    if (c.cat === 'destruye') {
      sube('autorizo'); necesita.push('autorizo')
      if (c.contrae) {
        const usos = ctx.usos?.(o) ?? []
        if (usos.length) { sube('bloquea'); necesita.push(`se usa todavía: ${usos.join('; ')}`) }
        else necesita.push('nada lo usa (base y front)')
        if (ctx.expandeEnLaTanda?.(o)) { sube('bloquea'); necesita.push('la misma tanda expande lo que esto contrae: van en dos tandas') }
      }
    }
    lineas.push({ cat: c.cat, texto: linea(o), motivo: c.motivo, bloqueo: c.bloqueo ?? null, filas: filas ?? null, enCamino, necesita })
  }
  if (ctx.pareceAplicado) {
    sube('bloquea')
    lineas.push({ cat: 'bloquea', texto: 'todo lo que crea ya existe en producción, y no está en el historial', motivo: 'parece aplicado antes de que hubiera historial', bloqueo: null, filas: null, enCamino: false, necesita: ['quitarlo de la tanda, o darlo de alta en el historial'] })
  }
  return { estado, lineas, avisos }
}

// ── El historial: lo ya aplicado no se reaplica ─────────────────────────────
// Cada fichero que aplica el workflow queda en supabase_migrations.schema_migrations
// con version = su nombre sin «.sql» (los prefijos de fecha se repiten en los
// antiguos) y, en statements, una sola línea con su huella.
export const versionDe = (f) => f.replace(/^.*\//, '').replace(/(\.down)?\.sql$/, '')
export const marcaHuella = (md5) => `-- huella md5:${md5}`

export function filtrarHistorial(ficheros, registro, md5De) {
  const porVersion = new Map((registro ?? []).map((r) => [r.version, r]))
  const pendientes = []
  const yaAplicados = []
  const distintos = []
  for (const f of ficheros) {
    const r = porVersion.get(versionDe(f))
    if (!r) { pendientes.push(f); continue }
    const actual = md5De(f)
    const reg = (r.huella ?? '').match(/huella md5:([0-9a-f]{32})/)?.[1] ?? null
    if (reg === actual) yaAplicados.push(f)
    else distintos.push({ f, registrada: reg, actual })
  }
  return { pendientes, yaAplicados, distintos }
}

/** El registro de un fichero aplicado (o su baja), para la misma transacción. */
export function sqlRegistro(f, md5, quien) {
  const v = versionDe(f)
  if (!/^[A-Za-z0-9_]+$/.test(v) || !/^[0-9a-f]{32}$/.test(md5)) throw new Error(`registro: nombre o huella no válidos (${f})`)
  const q = quien.replace(/[^A-Za-z0-9 ._·:-]/g, '')
  return `insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ('${v}', '${v.replace(/^[^_]*_/, '')}', array['${marcaHuella(md5)}'], '${q}');\n`
}
export function sqlBaja(f) {
  const v = versionDe(f)
  if (!/^[A-Za-z0-9_]+$/.test(v)) throw new Error(`baja: nombre no válido (${f})`)
  return `delete from supabase_migrations.schema_migrations where version = '${v}';\n`
}

// ── Quién usa lo que se borra: el front, por búsqueda en el repositorio ─────
/** archivos: [{ruta, texto}] de src/. Devuelve {clave: [rutas]}. */
export function usosEnFront(destruidos, archivos) {
  const out = {}
  const q = (n) => new RegExp(`['"\`]${n}['"\`]|\\b${n}\\s*\\(`)
  for (const d of destruidos) {
    const hay = archivos.filter(({ texto }) => {
      if (d.tipo === 'funcion') return new RegExp(`['"\`]${corto(d.funcion)}['"\`]`).test(texto)
      if (d.tipo === 'tabla') return q(corto(d.tabla)).test(texto)
      return q(corto(d.tabla)).test(texto) && new RegExp(`\\b${d.columna}\\b`).test(texto)
    }).map((a) => a.ruta)
    if (hay.length) out[d.clave] = hay
  }
  return out
}

/** El front de un commit (o del árbol de trabajo): los .ts/.tsx/.js de src/. */
export function archivosFront(ref) {
  const args = ref === 'WORKTREE' ? ['ls-files', 'src'] : ['ls-tree', '-r', '--name-only', ref, 'src']
  // Sin src/types/database.ts: son los tipos generados de TODA la base (cada
  // tabla y cada columna), no una lectura; con él, cualquier borrado saldría
  // «usado por el front» para siempre.
  const rutas = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')
    .filter((r) => /\.(tsx?|jsx?|mjs)$/.test(r) && r !== 'src/types/database.ts')
  if (ref === 'WORKTREE') return rutas.map((ruta) => ({ ruta, texto: readFileSync(ruta, 'utf8') }))
  // Un solo proceso para todo el front del commit: «<sha> blob <bytes>\n<contenido>\n» por fichero.
  const buf = execFileSync('git', ['cat-file', '--batch'], { input: rutas.map((r) => `${ref}:${r}`).join('\n') + '\n', maxBuffer: 256 << 20 })
  const out = []
  let i = 0
  for (const ruta of rutas) {
    const fin = buf.indexOf(10, i)
    const n = Number(buf.subarray(i, fin).toString().split(' ')[2])
    out.push({ ruta, texto: buf.subarray(fin + 1, fin + 1 + n).toString('utf8') })
    i = fin + 1 + n + 1
  }
  return out
}

// ── La consulta a producción (solo lee) ─────────────────────────────────────
const lit = (x) => `'${String(x).replace(/'/g, "''")}'`
const valores = (xs) => (xs.length ? xs.map((x) => `(${lit(x)})`).join(',') : '(null)')

/**
 * Una sola consulta que devuelve, en JSON, lo que necesita el veredicto:
 * qué existe, filas estimadas, otras firmas, el camino del pedido, quién usa lo
 * que se borra y el historial de los ficheros de la tanda.
 */
export function sqlContexto({ tablas, funciones }, destruidos, ficheros, caminoTablas, caminoFunciones) {
  const fn = (n) => `case when ${n} like '%(%' then to_regprocedure(${n}) end`
  const usos = destruidos.map((d) => {
    const c = lit(d.clave)
    if (d.tipo === 'funcion') {
      const nom = lit(corto(d.funcion))
      return `select ${c} k, 'función ' || p.oid::regprocedure::text u from pg_proc p where p.prosrc ~* ('\\m' || ${nom} || '\\M') and p.proname <> ${nom} and p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  union select ${c}, 'disparador ' || t.tgname || ' en ' || t.tgrelid::regclass::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and p.proname = ${nom}
  union select ${c}, 'cron ' || j.jobname from cron.job j where j.command ~* ('\\m' || ${nom} || '\\M')`
    }
    if (d.tipo === 'tabla') {
      const nom = lit(corto(d.tabla)); const t = lit(d.tabla)
      return `select ${c} k, 'vista ' || v.oid::regclass::text u from pg_depend dp join pg_rewrite r on r.oid = dp.objid join pg_class v on v.oid = r.ev_class where dp.refobjid = to_regclass(${t}) and v.oid <> to_regclass(${t})
  union select ${c}, 'función ' || p.oid::regprocedure::text from pg_proc p where p.prosrc ~* ('\\m' || ${nom} || '\\M') and p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  union select ${c}, 'clave ajena desde ' || k.conrelid::regclass::text from pg_constraint k where k.contype = 'f' and k.confrelid = to_regclass(${t}) and k.conrelid <> k.confrelid`
    }
    const nom = lit(corto(d.tabla)); const t = lit(d.tabla); const col = lit(d.columna)
    return `select ${c} k, 'vista ' || v.oid::regclass::text u from pg_depend dp join pg_rewrite r on r.oid = dp.objid join pg_class v on v.oid = r.ev_class join pg_attribute a on a.attrelid = dp.refobjid and a.attnum = dp.refobjsubid where dp.refobjid = to_regclass(${t}) and a.attname = ${col} and v.oid <> to_regclass(${t})
  union select ${c}, 'función ' || p.oid::regprocedure::text from pg_proc p where p.prosrc ~* ('\\m' || ${col} || '\\M') and p.prosrc ~* ('\\m' || ${nom} || '\\M') and p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  union select ${c}, 'disparador ' || tg.tgname || ' (' || p.oid::regprocedure::text || ')' from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid where not tg.tgisinternal and tg.tgrelid = to_regclass(${t}) and p.prosrc ~* ('\\m' || ${col} || '\\M')`
  })
  const versiones = ficheros.map(versionDe)
  return `with t(n) as (values ${valores(tablas)}), f(n) as (values ${valores(funciones)})${usos.length ? `, u(k, x) as (${usos.join('\n  union ')})` : ''}
select json_build_object(
  'tablas', (select coalesce(json_agg(n order by n), '[]') from t where n is not null and to_regclass(n) is not null),
  'funciones', (select coalesce(json_agg(n order by n), '[]') from f where n is not null and ${fn('n')} is not null),
  'filas', (select coalesce(json_object_agg(n, greatest(c.reltuples, 0)::bigint), '{}') from t join pg_class c on c.oid = to_regclass(n) where n is not null),
  'otras', (select coalesce(json_object_agg(n, o), '{}') from (
      select f.n, json_agg('public.' || p.oid::regprocedure::text order by p.oid) o
        from f join pg_proc p on p.pronamespace = 'public'::regnamespace and 'public.' || p.proname = split_part(f.n, '(', 1)
       where f.n is not null and p.oid is distinct from ${fn('f.n')}
       group by f.n) x),
  'camino', json_build_object(
    'tablas', (select coalesce(json_agg(n order by n), '[]') from t where n is not null and to_regclass(n) is not null and n ~ ${lit(caminoTablas)}),
    'funciones', (select coalesce(json_agg(n order by n), '[]') from f where n is not null and ${fn('n')} is not null and (
        n ~ ${lit(caminoFunciones)}
        or exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace s on s.oid = c.relnamespace
                    where not tg.tgisinternal and tg.tgfoid = ${fn('n')} and (s.nspname || '.' || c.relname) ~ ${lit(caminoTablas)})
        or exists (select 1 from cron.job j where j.command ~* ('\\m' || split_part(split_part(n, '(', 1), '.', 2) || '\\M'))))),
  'usos', ${usos.length ? `(select coalesce(json_object_agg(k, xs), '{}') from (select k, json_agg(distinct x) xs from u group by k) y)` : `'{}'::json`},
  'registro', (select coalesce(json_agg(json_build_object('version', version, 'huella', statements[1]) order by version), '[]')
                 from supabase_migrations.schema_migrations where version in (${versiones.length ? versiones.map(lit).join(',') : 'null'})))`
}

// ── El informe de la tanda, con el veredicto de cada fichero ────────────────
export function informe(ficheros, contexto, usosFront = {}, leer = leerSiExiste) {
  const exTablas = new Set(contexto.tablas ?? [])
  const exFunciones = new Set(contexto.funciones ?? [])
  const caminoT = new Set(contexto.camino?.tablas ?? [])
  const caminoF = new Set(contexto.camino?.funciones ?? [])
  const porFichero = Object.fromEntries(ficheros.map((f) => [f, analizarFichero(f, leer(f) ?? '')]))
  const deLaTanda = creadosPorLaTanda(porFichero)
  const todas = Object.values(porFichero).flat()
  const borraLaTanda = new Set(todas.filter((o) => o.tipo === 'funcion' && o.accion === 'borra').map((o) => base(o.objeto)))
  // El cuerpo NUEVO de cada función que la tanda crea o reemplaza: si ya no
  // nombra lo que se borra, deja de ser un uso; si lo sigue nombrando, lo es.
  const cuerpoNuevo = new Map()
  for (const f of ficheros) for (const s of sentencias(leer(f) ?? '')) {
    const fi = /^create\s+(?:or\s+replace\s+)?function/i.test(s) ? firma(s.replace(/\s+/g, ' ')) : null
    if (fi) cuerpoNuevo.set(base(fi), `${cuerpoNuevo.get(base(fi)) ?? ''}\n${s}`)
  }
  const existiaAntes = (o) => (o.tipo === 'funcion'
    ? (o.objeto.includes('(') ? exFunciones.has(o.objeto) : [...exFunciones].some((x) => x.startsWith(`${o.objeto}(`)))
    : exTablas.has(tablaDe(o)))
  const existe = (o) => existiaAntes(o) && !deLaTanda.has(o.tipo === 'funcion' ? o.objeto : tablaDe(o))
  const ctxBase = {
    existe,
    filas: (o) => contexto.filas?.[tablaDe(o)],
    // Otras firmas del mismo nombre: las que da la base y las que ya están en la lista de existentes.
    otrasFirmas: (o) => [...new Set([...(contexto.otras?.[o.objeto] ?? []), ...[...exFunciones].filter((x) => base(x) === base(o.objeto) && x !== o.objeto)])],
    enCamino: (o) => (o.tipo === 'funcion' ? caminoF.has(o.objeto) : caminoT.has(tablaDe(o))) && existe(o),
    usos: (o) => {
      const d = destruido(o)
      if (!d) return []
      const nombrado = new RegExp(`\\b${d.tipo === 'columna' ? d.columna : corto(d.clave)}\\b`, 'i')
      const enBase = (contexto.usos?.[d.clave] ?? []).filter((u) => {
        // Una función que la propia tanda borra, o reemplaza por una que ya no
        // lo nombra, no cuenta como uso.
        const m = u.match(/^función (?:public\.)?([a-z_][a-z0-9_]*)\(/)
        if (!m) return true
        const k = `public.${m[1]}`
        if (borraLaTanda.has(k) && !cuerpoNuevo.has(k)) return false
        return !(cuerpoNuevo.has(k) && !nombrado.test(cuerpoNuevo.get(k)))
      })
      return [...enBase, ...(usosFront[d.clave] ?? []).map((r) => `front ${r}`)]
    },
    expandeEnLaTanda: (o) => {
      const d = destruido(o)
      if (!d || d.tipo === 'funcion') return false
      return Object.entries(porFichero).some(([, ops]) => ops.some((x) => x !== o && tablaDe(x) === d.tabla && x.tipo !== 'funcion'
        && ['añade', 'cambia'].includes(categoria(x, { existe, filas: ctxBase.filas, otrasFirmas: ctxBase.otrasFirmas, opsDelFichero: ops }).cat)
        && !destruido(x)))
    },
  }
  const salida = { ficheros: {}, vatRateFor: [] }
  const l = ['## Qué hace cada fichero', '',
    'Contra lo que existe en producción. **añade** pasa siempre; **cambia** (en caliente) pasa declarado en la cabecera y con prueba de staging, y en el camino del pedido además con `autorizo`; **destruye** solo con `autorizo`, y borrar o renombrar además sin usos y en su propia tanda.', '']
  for (const f of ficheros) {
    const ops = porFichero[f]
    const creaciones = ops.filter((o) => o.accion === 'crea' && ['tabla', 'vista', 'funcion'].includes(o.tipo))
    const pareceAplicado = creaciones.length > 0 && creaciones.every((o) => existiaAntes(o))
    const v = veredicto(ops, { ...ctxBase, cabecera: cabecera(leer(f) ?? ''), pruebaCubre: (r, obj) => pruebaCubre(r, obj, leer), pareceAplicado })
    salida.ficheros[f] = v.estado
    if (decidir(ops, existe).tocaVatRateFor) salida.vatRateFor.push(f)
    const nuevos = [...new Set(ops.filter((o) => o.accion === 'crea' && !existe(o)).map((o) => `${o.tipo} \`${o.objeto}\``))]
    l.push(`### \`${f}\` — ${v.estado === 'bloquea' ? '**BLOQUEA**' : v.estado === 'autorizo' ? '**AUTORIZO**' : 'sigue'}`)
    l.push(`- Crea (nuevo): ${nuevos.length ? nuevos.join(', ') : 'nada'}`)
    for (const x of v.lineas) {
      const extra = [x.motivo, x.filas != null ? `${x.filas} filas` : null, x.bloqueo ? `bloqueo ${x.bloqueo}` : null, x.enCamino ? 'camino del pedido' : null].filter(Boolean).join(' · ')
      l.push(`- **${x.cat}** · ${x.texto}${extra ? ` — ${extra}` : ''}`)
      for (const n of x.necesita) l.push(`  - ${n}`)
    }
    if (v.avisos.length) { l.push('- Aviso, para que lo mire una persona:'); for (const a of v.avisos) l.push(`  - ${a}`) }
    l.push('')
  }
  return { markdown: l.join('\n') + '\n', ...salida }
}

// ── Línea de órdenes ────────────────────────────────────────────────────────
const leerJson = (f) => JSON.parse(readFileSync(f, 'utf8'))
const md5De = (f) => createHash('md5').update(readFileSync(f)).digest('hex')
const [modo, ...resto] = process.argv.slice(2)
if (modo === 'objetivos') {
  const porFichero = Object.fromEntries(resto.map((f) => [f, analizarFichero(f)]))
  const tablas = new Set(); const funciones = new Set()
  for (const ops of Object.values(porFichero)) for (const o of ops) {
    if (o.tipo === 'funcion') funciones.add(o.objeto)
    else if (o.objeto.startsWith('public.') || /^[a-z_]+\.[a-z_]+$/.test(o.objeto)) tablas.add(tablaDe(o))
  }
  process.stdout.write(JSON.stringify({ tablas: [...tablas].sort(), funciones: [...funciones].sort() }, null, 1) + '\n')
} else if (modo === 'destruidos') {
  const vistos = new Map()
  for (const f of resto) for (const o of analizarFichero(f)) { const d = destruido(o); if (d) vistos.set(d.clave, d) }
  process.stdout.write(JSON.stringify([...vistos.values()], null, 1) + '\n')
} else if (modo === 'front') {
  // front <ref|WORKTREE> destruidos.json → {clave: [rutas]}
  const [ref, fDestruidos] = resto
  process.stdout.write(JSON.stringify(usosEnFront(leerJson(fDestruidos), archivosFront(ref)), null, 1) + '\n')
} else if (modo === 'sql-contexto') {
  // sql-contexto objetivos.json destruidos.json f… (CAMINO_TABLAS y CAMINO_FUNCIONES del entorno)
  const [fObj, fDes, ...ficheros] = resto
  process.stdout.write(sqlContexto(leerJson(fObj), leerJson(fDes), ficheros, process.env.CAMINO_TABLAS ?? '^$', process.env.CAMINO_FUNCIONES ?? '^$') + '\n')
} else if (modo === 'historial') {
  // historial contexto.json f… → {pendientes, yaAplicados, distintos}
  const [fCtx, ...ficheros] = resto
  process.stdout.write(JSON.stringify(filtrarHistorial(ficheros, leerJson(fCtx).registro, md5De), null, 1) + '\n')
} else if (modo === 'informe') {
  // informe contexto.json usos-front.json f… → Markdown; sale con 1 si alguno no «sigue»
  const [fCtx, fFront, ...ficheros] = resto
  const r = informe(ficheros, leerJson(fCtx), leerJson(fFront))
  process.stdout.write(r.markdown + `VAT_RATE_FOR_EN: ${r.vatRateFor.join(' ') || '(ninguno)'}\n`)
  process.exitCode = Object.values(r.ficheros).some((e) => e !== 'sigue') ? 1 : 0
} else if (modo === 'registro') {
  // registro f quien → el insert del historial (va en la misma transacción que el fichero)
  const [f, quien] = resto
  process.stdout.write(sqlRegistro(f, md5De(f), quien ?? 'aplicar-produccion-conta'))
} else if (modo === 'baja') {
  process.stdout.write(sqlBaja(resto[0]))
} else if (modo === 'front-compatible') {
  // front-compatible [manifiesto]: lo que la tanda borra o renombra, ¿lo lee
  // todavía el front publicado (origin/main) o el del commit que se sube? Sale
  // con 1 si alguno lo lee: primero se quita del front, después de la base.
  const manifiesto = resto[0] ?? 'supabase/produccion/aplicar.txt'
  const ficheros = readFileSync(manifiesto, 'utf8').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))
  const vistos = new Map()
  for (const f of ficheros) for (const o of analizarFichero(f)) { const d = destruido(o); if (d) vistos.set(d.clave, d) }
  const destruidos = [...vistos.values()]
  if (!destruidos.length) {
    process.stdout.write(`Front compatible: la tanda de ${manifiesto} no borra ni renombra nada.\n`)
  } else {
    let mal = false
    for (const ref of ['origin/main', 'WORKTREE']) {
      const usos = usosEnFront(destruidos, archivosFront(ref))
      for (const [clave, rutas] of Object.entries(usos)) {
        mal = true
        process.stdout.write(`✗ ${clave} lo lee todavía el front de ${ref === 'WORKTREE' ? 'este commit' : 'origin/main (publicado)'}: ${rutas.join(', ')}\n`)
      }
    }
    if (mal) process.stdout.write('Primero se deja de leer en el front (y se publica), después se borra de la base: dos pasos.\n')
    else process.stdout.write(`Front compatible: nadie lee ${destruidos.map((d) => d.clave).join(', ')} (origin/main ni este commit).\n`)
    process.exitCode = mal ? 1 : 0
  }
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
