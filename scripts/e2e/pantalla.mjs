// scripts/e2e/pantalla.mjs — cuando una e2e falla, lo que había en pantalla, al registro.
//
// Q03 (18/11). Las sesiones leen el registro del job, pero no pueden bajar los
// artefactos (el almacén de GitHub está fuera de su red): se quedaban a
// ciegas y adivinaban. El 18/11, la K03 falló tres veces en la misma prueba y
// las dos primeras hipótesis eran falsas; la causa estaba a la vista en la
// pantalla: el plan contable abría con un grupo que esa empresa no tiene y
// decía «Ninguna cuenta encaja con lo que buscas».
//
// Aquí está lo que lee, recorta, limpia y ordena. Lo usa el reporter
// (scripts/e2e/reporter-pantalla.mjs), que corre en cada fichero de
// por-fichero.sh. De cada prueba que falla:
//   · qué prueba (fichero, línea, tamaño) y qué esperaba (el error, corto);
//   · lo que había en pantalla: el árbol de la página con sus textos y el
//     estado de cada botón, del error-context.md que deja Playwright;
//   · lo que contestó la base con un 4xx o un 5xx (método, ruta y el principio
//     de la respuesta) y los errores de la página y de la consola, de la traza.
// Nunca las cabeceras de las peticiones, y sin tokens: se quitan antes de escribir.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

/** Los topes: por prueba y por run. Lo que se corta, se dice. */
export const TOPES = {
  lineasPantalla: 60, // del árbol de la pantalla, por prueba, en el registro
  lineasResumen: 25, // del árbol, por prueba, en el resumen del run
  red: 8, // respuestas 4xx/5xx por prueba
  errores: 8, // errores de la página y de la consola por prueba
  ancho: 220, // caracteres por línea
  pruebasPorRun: 15, // pruebas con su pantalla copiada en un run; las demás, solo la cabecera
}

// ── Lo que no puede salir ────────────────────────────────────────────────────

const PARAMS_SECRETOS = /([?&;](?:apikey|api_key|key|access_token|refresh_token|token|id_token|jwt|password|secret|signature|sig)=)[^&#\s"']*/gi
const JWT = /\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}\b/g
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi
const CAMPOS_SECRETOS = /("(?:password|contrase(?:ñ|n)a|access_token|refresh_token|token|apikey|api_key|secret|authorization)"\s*:\s*)"[^"]*"/gi

/** Quita tokens, claves y contraseñas de una línea (URL, respuesta o mensaje). */
export function limpiar(texto) {
  return String(texto ?? '')
    .replace(JWT, '‹token quitado›')
    .replace(BEARER, '$1 ‹quitado›')
    .replace(PARAMS_SECRETOS, '$1‹quitado›')
    .replace(CAMPOS_SECRETOS, '$1"‹quitado›"')
}

const corta = (s, n = TOPES.ancho) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// ── El error-context.md de Playwright ────────────────────────────────────────

/**
 * De error-context.md (Playwright 1.63): el bloque de «# Error details» y el
 * árbol de la página (el bloque ```yaml). «# Test source» no se copia: es
 * código del repositorio y ya está en el error.
 */
export function leerContexto(md) {
  const t = String(md ?? '')
  const detalles = t.split(/^# Error details\s*$/m)[1]?.split(/^# Test source\s*$/m)[0] ?? ''
  const error = detalles.match(/```\s*\n([\s\S]*?)\n```/)?.[1] ?? null
  const yaml = t.match(/```yaml\s*\n([\s\S]*?)\n```/)?.[1] ?? null
  return {
    error: error ? error.trim() : null,
    pantalla: yaml ? yaml.split('\n').filter((l) => l.trim()) : null,
  }
}

/** Qué esperaba, en pocas líneas: la primera, el localizador y lo esperado y recibido. */
export function resumenError(error) {
  const ls = String(error ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (!ls.length) return ['(sin mensaje de error)']
  const clave = /^(Locator|Expected|Received|Timeout|- Expected|\+ Received|Expected substring|Expected pattern|Expected string|Received string|Error: element\(s\) not found|Error: strict mode)/
  const r = [ls[0]]
  for (const l of ls.slice(1)) {
    if (/^Call log:/.test(l)) break
    if (clave.test(l) && !r.includes(l)) r.push(l)
  }
  return r.slice(0, 7).map((l) => corta(limpiar(l)))
}

// ── La traza (trace.zip): lo que contestó la base y los errores de la página ──

/**
 * De las líneas de la traza: las respuestas 4xx y 5xx (y las que no llegaron),
 * los errores de la consola y los de la página. Solo método, ruta, estado y el
 * principio de la respuesta: nunca las cabeceras.
 *   red: líneas de N-trace.network · eventos: líneas de N-trace.trace ·
 *   cuerpo(fichero): el contenido de un resources/… de la traza, o null.
 */
export function deLaTraza({ red = [], eventos = [], cuerpo = () => null }) {
  const respuestas = []
  for (const l of red) {
    let e
    try { e = JSON.parse(l) } catch { continue }
    const s = e?.snapshot
    if (!s?.request) continue
    const estado = s.response?.status ?? -1
    const fallida = s._failureText || estado === -1 || estado === 0
    if (!fallida && estado < 400) continue
    let ruta = s.request.url
    try { const u = new URL(s.request.url); ruta = `${u.host}${u.pathname}${u.search}` } catch { /* se queda la URL */ }
    let contesto = fallida ? String(s._failureText ?? 'no llegó a contestar') : ''
    const fichero = s.response?.content?._file
    if (!fallida && fichero && (s.response?.content?.size ?? 0) <= 4000) {
      const c = cuerpo(fichero)
      if (c) contesto = c.replace(/\s+/g, ' ').trim().slice(0, 200)
    }
    respuestas.push({ estado: fallida ? 'sin respuesta' : estado, metodo: s.request.method, ruta: limpiar(ruta), contesto: limpiar(contesto) })
  }
  const errores = []
  for (const l of eventos) {
    let e
    try { e = JSON.parse(l) } catch { continue }
    if (e?.type === 'console' && e.messageType === 'error') errores.push(`[consola] ${limpiar(e.text)}`)
    else if (e?.type === 'event' && e.method === 'pageError') errores.push(`[error de la página] ${limpiar(e.params?.error?.error?.message ?? e.params?.error?.message ?? '')}`)
  }
  return { respuestas, errores }
}

/** Lee trace.zip con `unzip` (está en los runners de GitHub). Si no se puede, vacío. */
export function leerTraza(ruta) {
  if (!ruta || !existsSync(ruta)) return { respuestas: [], errores: [] }
  try {
    const nombres = execFileSync('unzip', ['-Z1', ruta], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\n')
    const leer = (n) => execFileSync('unzip', ['-p', ruta, n], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const red = nombres.filter((n) => /^\d+-trace\.network$/.test(n)).flatMap((n) => leer(n).split('\n'))
    const eventos = nombres.filter((n) => /^\d+-trace\.trace$/.test(n)).flatMap((n) => leer(n).split('\n'))
    return deLaTraza({ red, eventos, cuerpo: (f) => { try { return nombres.includes(f) ? leer(f) : null } catch { return null } } })
  } catch {
    return { respuestas: [], errores: [] }
  }
}

/** Lo que la prueba escribió de los errores de la página (si no hay traza). */
export function erroresDeLaSalida(lineas) {
  return (lineas ?? []).flatMap((x) => String(x).split('\n')).map((l) => l.trim())
    .filter((l) => /^\[(error de la página|consola|red sin parar)\]/.test(l)).map(limpiar)
}

const unicos = (xs) => [...new Set(xs)]

// ── Lo que se escribe ────────────────────────────────────────────────────────

/**
 * El bloque del registro de una prueba que falló. Lo primero que se lee: qué
 * prueba, qué esperaba y qué había. «copiar» falso: solo la cabecera y el
 * error (ya se ha llegado al tope del run).
 */
export function bloque(f, { copiar = true, topes = TOPES, tope = topes.pruebasPorRun } = {}) {
  const l = []
  const nombre = `${f.donde} · ${f.titulo}${f.tamano ? ` [${f.tamano}]` : ''}`
  l.push(`── Falló: ${corta(nombre, 200)} ──`)
  for (const [i, x] of resumenError(f.error).entries()) l.push(`${i ? '   ' : 'Esperaba: '}${x}`)
  if (!copiar) {
    l.push(`(Lo que había en pantalla no se copia: este run ya lleva ${tope} pruebas con su pantalla. Está en el artefacto «playwright-report».)`)
    l.push(`── fin de: ${corta(f.donde, 120)} ──`, '')
    return l
  }
  l.push('Lo que había en pantalla:')
  if (f.pantalla?.length) {
    for (const x of f.pantalla.slice(0, topes.lineasPantalla)) l.push(`  ${corta(limpiar(x))}`)
    if (f.pantalla.length > topes.lineasPantalla) l.push(`  … y ${f.pantalla.length - topes.lineasPantalla} líneas más; la pantalla entera está en el artefacto.`)
  } else {
    l.push('  (Playwright no la guardó: la prueba falló antes de abrir una página, o la página se cerró.)')
  }
  const red = f.respuestas ?? []
  if (red.length) {
    l.push('Lo que contestó la base (4xx y 5xx):')
    for (const r of red.slice(0, topes.red)) l.push(`  ${corta(`${r.estado} ${r.metodo} ${r.ruta}${r.contesto ? ` → ${r.contesto}` : ''}`)}`)
    if (red.length > topes.red) l.push(`  … y ${red.length - topes.red} más.`)
  }
  const err = unicos(f.errores ?? [])
  if (err.length) {
    l.push('Errores de la página:')
    for (const x of err.slice(0, topes.errores)) l.push(`  ${corta(x)}`)
    if (err.length > topes.errores) l.push(`  … y ${err.length - topes.errores} más.`)
  }
  l.push(`── fin de: ${corta(f.donde, 120)} ──`, '')
  return l
}

const md = (s) => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Lo mismo, para el resumen del run: plegado, con el error a la vista. */
export function resumenMd(f, { copiar = true, topes = TOPES } = {}) {
  const err = resumenError(f.error)
  const l = [`<details><summary>❌ <code>${md(f.donde)}</code> · ${md(corta(f.titulo, 140))}${f.tamano ? ` [${md(f.tamano)}]` : ''} — ${md(err[0])}</summary>`, '']
  l.push('```', ...err, '```')
  if (copiar) {
    if (f.pantalla?.length) {
      l.push('', '**Lo que había en pantalla**', '', '```yaml', ...f.pantalla.slice(0, topes.lineasResumen).map((x) => corta(limpiar(x))), '```')
      if (f.pantalla.length > topes.lineasResumen) l.push(`… y ${f.pantalla.length - topes.lineasResumen} líneas más (enteras, en el registro del job).`)
    }
    if (f.respuestas?.length) l.push('', '**Lo que contestó la base**', '', '```', ...f.respuestas.slice(0, topes.red).map((r) => corta(`${r.estado} ${r.metodo} ${r.ruta}${r.contesto ? ` → ${r.contesto}` : ''}`)), '```')
    const e = unicos(f.errores ?? [])
    if (e.length) l.push('', '**Errores de la página**', '', '```', ...e.slice(0, topes.errores).map((x) => corta(x)), '```')
  }
  l.push('', '</details>', '')
  return l
}

/** El contador del run (un fichero JSON compartido entre los ficheros de por-fichero.sh). */
export function leerEstado(ruta) {
  try { return { copiadas: 0, cortadas: 0, ...JSON.parse(readFileSync(ruta, 'utf8')) } } catch { return { copiadas: 0, cortadas: 0 } }
}
