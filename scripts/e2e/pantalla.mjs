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
  // X09 (19/11): era 60, y se cortaba justo antes de lo importante (Q no vio qué se quedaba
  // cargando; N, en qué casilla se paró). Ahora se cuenta sobre lo que importa (los avisos y
  // la pestaña activa, entera, con las filas compactadas) y el resto va después, si cabe.
  lineasPantalla: 400, // del árbol de la pantalla, por prueba, en el registro
  lineasResumen: 25, // del árbol, por prueba, en el resumen del run
  red: 8, // respuestas 4xx/5xx por prueba
  errores: 8, // errores de la página y de la consola por prueba
  ancho: 220, // caracteres por línea
  pruebasPorRun: 15, // pruebas con su pantalla copiada en un run; las demás, solo la cabecera
}

const unicos = (xs) => [...new Set(xs)]

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
    pantalla: yaml ? ordenarPantalla(compactarFilas(yaml.split('\n').filter((l) => l.trim()))) : null,
  }
}

const sangria = (l) => l.length - l.trimStart().length

/**
 * X09 · Las filas de una tabla, en una línea. Playwright nombra cada fila con el texto de
 * todas sus celdas («row "41000012 Suministros… 246,30"»), y después repite cada celda debajo:
 * en una tabla de 219 cuentas eran más de mil líneas que no decían nada nuevo. Se quitan las
 * celdas que SOLO tienen su texto; una celda con algo dentro (una casilla, un botón, un
 * enlace) se queda entera: es donde se para una prueba.
 */
export function compactarFilas(lineas) {
  const ls = (lineas ?? []).filter((l) => !/^\s*- \/url: /.test(l))
  const out = []
  for (let i = 0; i < ls.length;) {
    const l = ls[i]
    if (!/^\s*- row\b.*:$/.test(l)) { out.push(l); i++; continue }
    const d = sangria(l)
    let j = i + 1
    const hijos = []
    while (j < ls.length && sangria(ls[j]) > d) hijos.push(ls[j++])
    const quedan = []
    for (let k = 0; k < hijos.length;) {
      const h = hijos[k], hd = sangria(h)
      let kk = k + 1
      while (kk < hijos.length && sangria(hijos[kk]) > hd) kk++
      const sub = hijos.slice(k + 1, kk)
      const soloTexto = hd === d + 2 && !sub.length && /^\s*- (cell|gridcell|columnheader|rowheader)\b/.test(h)
      if (!soloTexto) quedan.push(h, ...sub)
      k = kk
    }
    out.push(quedan.length ? l : l.replace(/:$/, ''), ...quedan)
    i = j
  }
  return out
}

/** De qué parte de la página es un bloque de arriba del árbol (para decir qué se ha quitado). */
function parteDe(cabeza) {
  if (/^- (dialog|alertdialog|alert)\b/.test(cabeza)) return 'aviso'
  if (/^- main\b/.test(cabeza)) return 'zona'
  if (/^- banner\b/.test(cabeza)) return 'la cabecera'
  if (/^- navigation\b/.test(cabeza)) return 'el menú'
  if (/^- tablist "Lo que tienes abierto"/.test(cabeza)) return 'las pestañas abiertas'
  if (/^- (tablist|tabpanel|toolbar|button "Plegar)/.test(cabeza)) return 'la cinta'
  if (/^- contentinfo\b/.test(cabeza)) return 'el pie'
  if (/^- status\b/.test(cabeza)) return 'la franja de arriba'
  return 'lo demás'
}

/**
 * X09 · Lo que se copia, por orden: los avisos y diálogos; la pestaña activa (el «main» del
 * marco: las pestañas que no se ven llevan «hidden» y no salen en el árbol; si hubiera más de
 * uno, el de nombre `zona`), entera; y el resto. Devuelve las líneas y, de las que no caben en
 * `tope`, cuántas son de cada parte.
 */
export function repartirPantalla(lineas, { zona = null, tope = TOPES.lineasPantalla } = {}) {
  const bloques = []
  for (const l of lineas ?? []) {
    if (/^- /.test(l) || !bloques.length) bloques.push({ lineas: [l], parte: parteDe(l) })
    else bloques.at(-1).lineas.push(l)
  }
  const mains = bloques.filter((b) => b.parte === 'zona')
  const activa = (zona && mains.find((b) => b.lineas[0].startsWith(`- main "${zona}"`))) || mains[0]
  for (const b of mains) if (b !== activa) b.parte = 'otra pestaña'
  const orden = [...bloques.filter((b) => b.parte === 'aviso'), ...(activa ? [activa] : []), ...bloques.filter((b) => b.parte !== 'aviso' && b !== activa)]
  const lineasFuera = new Map()
  const dentro = []
  for (const b of orden) {
    const caben = Math.max(0, tope - dentro.length)
    dentro.push(...b.lineas.slice(0, caben))
    const fuera = b.lineas.length - Math.min(caben, b.lineas.length)
    if (fuera) {
      const nombre = b === activa ? `la pestaña${activa.lineas[0].match(/^- main "([^"]*)"/) ? ` «${activa.lineas[0].match(/^- main "([^"]*)"/)[1]}»` : ''}` : b.parte
      lineasFuera.set(nombre, (lineasFuera.get(nombre) ?? 0) + fuera)
    }
  }
  return { lineas: dentro, fuera: lineasFuera }
}

/** «… y 40 líneas de la cinta y el menú.» */
export function fraseFuera(fuera) {
  const total = [...fuera.values()].reduce((t, n) => t + n, 0)
  if (!total) return null
  const partes = [...fuera.keys()]
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
  return `… y ${total} ${total === 1 ? 'línea' : 'líneas'} de ${lista}, que no caben: la pantalla entera está en el artefacto.`
}

/**
 * Lo que importa, delante. El árbol de Playwright va en el orden de la página:
 * el menú lateral primero (unas 45 líneas en Sumied, con la dirección de cada
 * enlace), y el tope por prueba se lo comía antes de llegar a lo que se lee
 * (visto en vivo el 18/11, run 44247888358). Aquí: fuera las líneas «/url:»;
 * delante los diálogos y avisos, luego «main» (lo que hay en la página) y lo
 * demás; el menú («navigation»), al final.
 */
export function ordenarPantalla(lineas) {
  const sinUrl = (lineas ?? []).filter((l) => !/^\s*- \/url: /.test(l))
  const bloques = []
  for (const l of sinUrl) {
    if (/^- /.test(l) || !bloques.length) bloques.push([l])
    else bloques.at(-1).push(l)
  }
  const peso = (b) => {
    const t = b[0]
    if (/^- (dialog|alertdialog|alert)\b/.test(t)) return 0
    if (/^- main\b/.test(t)) return 1
    if (/^- navigation\b/.test(t)) return 3
    return 2
  }
  return bloques.map((b, i) => ({ b, i, p: peso(b) })).sort((x, y) => x.p - y.p || x.i - y.i).flatMap((x) => x.b)
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

/**
 * X09 · De la última pantalla de la traza (sus «frame-snapshot»: el DOM, en instantáneas que
 * apuntan a nodos de las anteriores con [[cuántas atrás, nodo]], como las lee el visor de
 * Playwright): lo que estaba cargando (aria-busy="true") y la pestaña activa del marco
 * (.k-zona[data-activa="si"]). El árbol de accesibilidad no dice aria-busy: por eso se mira aquí.
 * Lo que está dentro de algo con «hidden» no se ve, y no cuenta.
 */
export function domDeLaTraza(eventos) {
  const snaps = []
  for (const l of eventos ?? []) {
    let e
    try { e = JSON.parse(l) } catch { continue }
    if (e?.type === 'frame-snapshot' && e.snapshot?.isMainFrame !== false && e.snapshot?.html) snaps.push(e.snapshot)
  }
  if (!snaps.length) return { activa: null, ocupados: [] }
  const pagina = snaps.at(-1).pageId
  const mias = snaps.filter((x) => x.pageId === pagina)
  const nodos = (x) => {
    if (!x._nodos) {
      const n = []
      const ver = (k) => {
        if (typeof k === 'string') n.push(k)
        else if (Array.isArray(k) && typeof k[0] === 'string') { for (const h of k.slice(2)) ver(h); n.push(k) }
      }
      ver(x.html)
      x._nodos = n
    }
    return x._nodos
  }
  const resolver = (k, i) => {
    if (Array.isArray(k) && Array.isArray(k[0])) {
      const r = i - k[0][0]
      const n = r >= 0 && r <= i ? nodos(mias[r])[k[0][1]] : undefined
      return n === undefined ? null : resolver(n, r)
    }
    return { k, i }
  }
  const texto = (k, i, max = 90) => {
    let t = ''
    const ir = (n, j) => {
      if (t.length >= max) return
      const x = resolver(n, j)
      if (!x) return
      if (typeof x.k === 'string') { t += ` ${x.k}`; return }
      if (Array.isArray(x.k)) for (const h of x.k.slice(2)) ir(h, x.i)
    }
    ir(k, i)
    t = t.replace(/\s+/g, ' ').trim()
    return t.length > max ? `${t.slice(0, max - 1)}…` : t
  }
  let activa = null
  const ocupados = []
  const andar = (k, i, oculto, enZona) => {
    const x = resolver(k, i)
    if (!x || typeof x.k === 'string' || !Array.isArray(x.k)) return
    const [nombre, attrs = {}] = x.k
    if (typeof nombre !== 'string') return
    const escondido = oculto || 'hidden' in attrs
    const clase = String(attrs.class ?? '')
    let zonaAqui = enZona
    if (/\bk-zona\b/.test(clase) && attrs['data-activa'] === 'si') { activa = attrs['aria-label'] ?? attrs['data-pestana'] ?? null; zonaAqui = activa ?? '' }
    if (!escondido && attrs['aria-busy'] === 'true') {
      const quien = attrs['aria-label'] ? `«${attrs['aria-label']}»` : `${nombre.toLowerCase()}${clase ? `.${clase.split(/\s+/)[0]}` : ''}`
      const dice = texto(x.k, x.i)
      ocupados.push(`${zonaAqui !== null && zonaAqui !== undefined ? `en la pestaña «${zonaAqui}»: ` : ''}${quien}${dice && !attrs['aria-label'] ? ` («${dice}»)` : ''}`)
    }
    for (const h of x.k.slice(2)) andar(h, x.i, escondido, zonaAqui)
  }
  andar(mias.at(-1).html, mias.length - 1, false, null)
  return { activa, ocupados: unicos(ocupados).map(limpiar) }
}

/** Lee trace.zip con `unzip` (está en los runners de GitHub). Si no se puede, vacío. */
export function leerTraza(ruta) {
  if (!ruta || !existsSync(ruta)) return { respuestas: [], errores: [], activa: null, ocupados: [] }
  try {
    const nombres = execFileSync('unzip', ['-Z1', ruta], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\n')
    const leer = (n) => execFileSync('unzip', ['-p', ruta, n], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const red = nombres.filter((n) => /^\d+-trace\.network$/.test(n)).flatMap((n) => leer(n).split('\n'))
    const eventos = nombres.filter((n) => /^\d+-trace\.trace$/.test(n)).flatMap((n) => leer(n).split('\n'))
    return { ...deLaTraza({ red, eventos, cuerpo: (f) => { try { return nombres.includes(f) ? leer(f) : null } catch { return null } } }), ...domDeLaTraza(eventos) }
  } catch {
    return { respuestas: [], errores: [], activa: null, ocupados: [] }
  }
}

/** Lo que la prueba escribió de los errores de la página (si no hay traza). */
export function erroresDeLaSalida(lineas) {
  return (lineas ?? []).flatMap((x) => String(x).split('\n')).map((l) => l.trim())
    .filter((l) => /^\[(error de la página|consola|red sin parar)\]/.test(l)).map(limpiar)
}

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
  // X09 · Lo que estaba cargando (de la traza), lo primero.
  for (const x of f.ocupados ?? []) l.push(`  [cargando] ${corta(limpiar(x))}`)
  if (f.pantalla?.length) {
    const r = repartirPantalla(f.pantalla, { zona: f.activa ?? null, tope: topes.lineasPantalla })
    for (const x of r.lineas) l.push(`  ${corta(limpiar(x))}`)
    const frase = fraseFuera(r.fuera)
    if (frase) l.push(`  ${frase}`)
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
      const r = repartirPantalla(f.pantalla, { zona: f.activa ?? null, tope: topes.lineasResumen })
      l.push('', '**Lo que había en pantalla**', '', '```yaml', ...(f.ocupados ?? []).map((x) => `# [cargando] ${corta(limpiar(x))}`), ...r.lineas.map((x) => corta(limpiar(x))), '```')
      if (r.fuera.size) l.push(`… y ${[...r.fuera.values()].reduce((t, n) => t + n, 0)} líneas más (en el registro del job).`)
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
