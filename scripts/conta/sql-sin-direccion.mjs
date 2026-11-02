#!/usr/bin/env node
// scripts/conta/sql-sin-direccion.mjs
//
// W10 · Staging no llama a producción (Julio, 28/10). Ninguna migración nueva
// o cambiada (ni su vuelta atrás) escribe la DIRECCIÓN de un proyecto de
// Supabase ni un SECRETO.
//
// Por qué: 23 funciones llevaban escrita la dirección de producción
// (https://<ref>.supabase.co/functions/v1/…). Como staging se construye con
// las mismas migraciones, staging las tenía igual: dos disparadores de sale
// llamaban a catcher-dispatch y order-advance de PRODUCCIÓN. Y
// trg_sale_push_status llevaba además el secreto de order-advance en el
// cuerpo, que quedó en el historial de git. Desde el W10 cada función lee la
// dirección de su propio proyecto del Vault (public._project_url()) y los
// secretos, también del Vault.
//
// Qué mira, en cada fichero:
//   · la dirección de un proyecto: «<20 letras o números>.supabase.co», en el
//     código y en las cadenas (con o sin https://). Los comentarios no cuentan:
//     no se ejecutan.
//   · un secreto: lo mismo que busca la estructura de staging antes de
//     publicarse (scripts/staging/esquema.mjs: un JWT que no sea anon, una
//     clave de Stripe, una URL con contraseña, un «fv_…» interno…), en TODO el
//     fichero, comentarios incluidos.
// No hay forma de saltarla: si una migración necesita una dirección o un
// secreto, los lee del Vault.
//
// Uso:
//   node scripts/conta/sql-sin-direccion.mjs                 las añadidas o cambiadas contra origin/main, con lo no commiteado
//   node scripts/conta/sql-sin-direccion.mjs <base> [<head>] las de ese diff (pr-a-main.yml)
//   node scripts/conta/sql-sin-direccion.mjs revisar <f>…    esos ficheros
//   node scripts/conta/sql-sin-direccion.mjs todas           todas (para medir; no para)
// Sale con 1 si alguna no cumple.

import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sinComentariosNiCadenas } from './sql-sin-where.mjs'
import { buscarSecretos } from '../staging/esquema.mjs'

const DIRECCION = /\b[a-z0-9]{20}\.supabase\.co\b/g
const CARPETAS = ['supabase/migrations', 'supabase/vuelta-atras']

const lineaDe = (texto, pos) => texto.slice(0, pos).split('\n').length

/** Lo que no puede llevar un fichero SQL: [{ linea, que }]. */
export function direccionesYSecretos(texto) {
  const t = String(texto)
  const mal = []
  // La dirección: en el código y en las cadenas, no en los comentarios.
  const { codigo, cadenas } = sinComentariosNiCadenas(t)
  for (const m of codigo.matchAll(DIRECCION)) mal.push({ linea: lineaDe(t, m.index), que: 'la dirección de un proyecto de Supabase' })
  for (const c of cadenas) {
    for (const m of c.texto.matchAll(DIRECCION)) {
      mal.push({ linea: lineaDe(t, c.inicio) + c.texto.slice(0, m.index).split('\n').length - 1, que: 'la dirección de un proyecto de Supabase' })
    }
  }
  // Un secreto: en todo el fichero.
  for (const s of buscarSecretos(t)) mal.push({ linea: s.linea, que: s.que })
  const vistos = new Set()
  return mal.filter((x) => { const k = `${x.linea}|${x.que}`; if (vistos.has(k)) return false; vistos.add(k); return true }).sort((a, b) => a.linea - b.linea)
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.sql'))

function ficherosDelDiff(base, head) {
  if (head) return git('diff', '--name-only', '--diff-filter=AM', `${base}...${head}`, '--', ...CARPETAS)
  const desde = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim()
  return [...new Set([
    ...git('diff', '--name-only', '--diff-filter=AM', desde, '--', ...CARPETAS),
    ...git('ls-files', '--others', '--exclude-standard', '--', ...CARPETAS),
  ])].sort()
}

function revisar(ficheros, { para = true } = {}) {
  let n = 0
  for (const f of ficheros) {
    for (const x of direccionesYSecretos(readFileSync(f, 'utf8'))) {
      n++
      console.log(`${para ? '::error ' : ''}${f}:${x.linea} · ${x.que}`)
    }
  }
  const que = `${ficheros.length} fichero${ficheros.length === 1 ? '' : 's'} de migración o vuelta atrás`
  if (n) {
    console.log(`\n${n} sitios con la dirección de un proyecto o un secreto escritos en ${que}. La dirección se lee con public._project_url() y los secretos, del Vault: en staging, una dirección escrita llama a producción (W10).`)
    return para ? 1 : 0
  }
  console.log(`Ninguna dirección de proyecto ni secreto escritos en ${que}.`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, ...resto] = process.argv.slice(2)
  if (a === 'revisar') process.exit(revisar(resto))
  if (a === 'todas') process.exit(revisar(CARPETAS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.sql')).sort().map((f) => `${d}/${f}`)), { para: false }))
  process.exit(revisar(ficherosDelDiff(a ?? 'origin/main', resto[0])))
}
