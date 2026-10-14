#!/usr/bin/env node
// scripts/conta/workflows-salida.mjs
//
// D01 · R2 punto 1 · Paso 9 de antes-de-subir: un workflow NUEVO O TOCADO
// (contra origin/main) que lee producción o Diez no puede escribir en el
// registro ni en GITHUB_STEP_SUMMARY nada que no sea un número o una huella.
//
// Cómo se cumple: todo lo que corre un script, una consulta o un intérprete
// (tsx, node, psql, python, curl) o se manda a un fichero o pasa por la puerta
// de salida (scripts/conta/salida-segura.mjs), que solo deja pasar
// «@@ clave número|huella». Y lo que el workflow escribe él mismo (echo,
// printf, ::error::) va sin variables: un literal escrito en el fichero no es
// un dato. Lo único que puede llevar variables es ::add-mask:: (tapa, no
// enseña) y $GITHUB_*/$RUNNER_* (del propio run).
//
// Es una comprobación de TEXTO sobre el YAML, no un intérprete de bash: si un
// caso legítimo no cabe, se escribe de la forma que cabe (a un fichero, o por
// la puerta), no se afloja la regla.
//
//   node scripts/conta/workflows-salida.mjs            # los tocados contra origin/main
//   node scripts/conta/workflows-salida.mjs <fichero>… # esos

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

// Lee producción o Diez si usa sus secretos o su usuario de lectura. Nombrar la
// ref de producción para NEGARSE a conectar (las guardas de staging) no es leerla.
// La clave de gestión de Supabase y la de servicio abren producción: cuentan.
export const LEE_PROD_O_DIEZ = /secrets\.(?:DIEZ_|PROD_|SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE)|DIEZ_LECTURA|conta_lectura/

/** Los bloques run: de un workflow, con su línea de comienzo. */
export function bloquesRun(yaml) {
  const lineas = yaml.split('\n')
  const bloques = []
  for (let i = 0; i < lineas.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(\|[-+]?|>[-+]?)?\s*(.*)$/.exec(lineas[i])
    if (!m) continue
    if (!m[2]) { bloques.push({ linea: i + 1, texto: m[3] }); continue }
    const sangria = m[1].length
    const cuerpo = []
    let j = i + 1
    for (; j < lineas.length; j++) {
      const l = lineas[j]
      if (l.trim() !== '' && l.search(/\S/) <= sangria) break
      cuerpo.push(l)
    }
    bloques.push({ linea: i + 2, texto: cuerpo.join('\n') })
    i = j - 1
  }
  return bloques
}

/** Las órdenes de un bloque: las líneas que siguen («\», comillas abiertas) se juntan. */
export function ordenes(texto) {
  const out = []
  let actual = null
  let enHeredoc = null
  texto.split('\n').forEach((l, k) => {
    if (enHeredoc) {
      actual.texto += '\n' + l
      if (l.trim() === enHeredoc) { enHeredoc = null; out.push(actual); actual = null }
      return
    }
    if (actual) actual.texto += '\n' + l
    else actual = { desde: k, texto: l }
    const h = /<<-?\s*['"]?(\w+)['"]?/.exec(l)
    if (h) { enHeredoc = h[1]; return }
    const comillas = (actual.texto.replace(/\\"/g, '').match(/"/g) ?? []).length
    if (/\\\s*$/.test(l) || comillas % 2 === 1) return
    out.push(actual); actual = null
  })
  if (actual) out.push(actual)
  return out
}

const PRODUCE = /\b(?:npx\s+(?:--yes\s+)?tsx(?:@[\d.]+)?|node\s+(?!scripts\/conta\/salida-segura\.mjs)\S+\.(?:m?js|ts)|psql|"\$PSQL"|python3?|curl|deno\s+run)\b/
const A_FICHERO = /(?:^|[^>&0-9])>{1,2}\s*(?:"?\$\{?RUNNER_TEMP|"?\/tmp\/|\/dev\/null|"?[\w./-]+\.(?:json|txt|sql|csv|md|pdf|bin)\b)/
const POR_LA_PUERTA = /\|\s*node\s+scripts\/conta\/salida-segura\.mjs\b/
/**
 * Las variables que el workflow declara de datos del REPOSITORIO (nombres de
 * fichero, md5, contadores del bucle), en un comentario:
 *   # salida-segura · variables del repositorio: f md5 i n
 * Quedan escritas en el YAML, para quien lo revise.
 */
export function variablesDelRepo(yaml) {
  const m = /#\s*salida-segura\s*·\s*variables del repositorio:\s*(.+)/.exec(yaml)
  return new Set((m?.[1] ?? '').trim().split(/\s+/).filter(Boolean))
}
const variablesEn = (t) => [...t.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*|\()/g)].map((x) => x[1])
const conVariables = (t, delRepo) => variablesEn(t).some((v) => v !== '(' ? !/^(GITHUB_|RUNNER_)/.test(v) && !delRepo.has(v) : true)
const ESCRIBE = /^\s*(?:echo|printf|cat)\b/

/** Los fallos de un workflow, o [] si cumple (o si no lee producción ni Diez). */
export function revisar(yaml, nombre = 'workflow') {
  if (!LEE_PROD_O_DIEZ.test(yaml)) return []
  const fallos = []
  const delRepo = variablesDelRepo(yaml)
  const VARIABLE = { test: (t) => conVariables(t, delRepo) }
  for (const b of bloquesRun(yaml)) {
    for (const o of ordenes(b.texto)) {
      const t = o.texto
      const donde = `${nombre}:${b.linea + o.desde}`
      const cabeza = t.split('\n')[0]
      const heredocPython = /python3?\s+-\s*<</.test(cabeza)
      if (heredocPython) {
        // Dentro del Python: solo print de ::add-mask:: o de literales sin f-string.
        for (const p of t.split('\n').filter((x) => /\bprint\(/.test(x))) {
          if (!/::add-mask::/.test(p) && /print\(\s*f["']/.test(p)) fallos.push(`${donde}: un print con variables dentro del Python: ${p.trim()}`)
        }
        continue
      }
      if (/GITHUB_STEP_SUMMARY/.test(t) && !POR_LA_PUERTA.test(t)) {
        // Al resumen solo llega lo que sale de la puerta; un literal sin variables, también.
        // (cat no es un literal: vuelca un fichero, que es como salió el run 60).
        if (!(/^\s*(?:echo|printf)\b/.test(cabeza) && !VARIABLE.test(t.replace(/"?\$GITHUB_STEP_SUMMARY"?/g, '')))) {
          fallos.push(`${donde}: escribe en GITHUB_STEP_SUMMARY sin pasar por scripts/conta/salida-segura.mjs`)
        }
        continue
      }
      if (PRODUCE.test(t) && !POR_LA_PUERTA.test(t) && !A_FICHERO.test(t) && !/^\s*(?:command\s+-v|.*--version)\b/.test(cabeza)) {
        fallos.push(`${donde}: corre ${PRODUCE.exec(t)[0]} y su salida va al registro sin pasar por la puerta ni a un fichero`)
        continue
      }
      if (ESCRIBE.test(cabeza) && !A_FICHERO.test(t) && !/::add-mask::/.test(t) && VARIABLE.test(t) && !/\$\(\s*wc\s+-[cl]\b/.test(t)) {
        fallos.push(`${donde}: ${cabeza.trim().split(/\s/)[0]} con variables al registro`)
      }
    }
  }
  return fallos
}

function tocados() {
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean)
  const base = git('merge-base', 'origin/main', 'HEAD')[0]
  const nombres = new Set([
    ...git('diff', '--name-only', `${base}...HEAD`, '--', '.github/workflows'),
    ...git('diff', '--name-only', '--', '.github/workflows'),
    ...git('ls-files', '--others', '--exclude-standard', '--', '.github/workflows'),
  ])
  return [...nombres].filter((f) => /\.ya?ml$/.test(f) && existsSync(f))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ficheros = process.argv.length > 2 ? process.argv.slice(2) : tocados()
  // La deuda escrita (workflows-salida-deuda.json): lo que ya salía antes de la
  // regla. Un workflow de la lista puede tocarse si su número no SUBE.
  const deuda = JSON.parse(readFileSync(new URL('./workflows-salida-deuda.json', import.meta.url), 'utf8')).deuda
  let mal = 0
  for (const f of ficheros) {
    const yaml = readFileSync(f, 'utf8')
    const fallos = revisar(yaml, f)
    const tope = deuda[f] ?? 0
    const lee = LEE_PROD_O_DIEZ.test(yaml)
    const estado = !lee ? 'no lee producción ni Diez' : !fallos.length ? 'cumple' : fallos.length <= tope ? `${fallos.length} de deuda escrita (tope ${tope}): no sube` : `${fallos.length} (tope ${tope}): SUBE`
    console.log(`${f}: ${estado}`)
    if (fallos.length > tope) { mal++; for (const x of fallos) console.log(`  · ${x}`) }
    else if (tope && fallos.length < tope) console.log(`  · baja de ${tope} a ${fallos.length}: bájalo también en workflows-salida-deuda.json`)
  }
  if (!ficheros.length) console.log('Ningún workflow tocado contra origin/main.')
  if (mal) { console.log(`\n${mal} workflow(s) sacan algo que no es un número o una huella: la lista falla.`); process.exit(1) }
}
