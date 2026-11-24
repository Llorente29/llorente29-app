#!/usr/bin/env node
// scripts/e2e/noche.mjs — la entera de la noche: ¿verde, repetir o avisar?
//
// Julio, 21/10: «la entera cada noche sobre main, hacia las 3:00 de Madrid. Si
// falla, un aviso claro que diga qué prueba, en qué fichero y el commit. Un
// fallo de staging (sesión, 520) se repite una vez antes de avisar».
//
// Q02 (17/11): el aviso dice la verdad entera. Arriba, en una línea, cuántos
// ficheros en rojo, cuántos nuevos frente a la noche real anterior, cuántos ya
// fallaban y cuántos han dejado de fallar; debajo, lo nuevo primero y entero
// (sin cortar en 25). Y un fallo de staging (520, 57014, no poder entrar) se
// repite una vez AUNQUE haya otros fallos: el 17/11 no se repitió porque la
// regla de antes pedía que TODO pareciera de staging.
//
// Lee el informe JSON de Playwright de la noche (los trozos juntos) y decide:
//   · verde    — todo pasó (y, si es la repetición, también lo que no se repitió);
//   · repetir  — solo en la noche (no en la repetición): los ficheros con algún
//                fallo que parece de staging, una vez; o la entera, si no llegó
//                a fallar ninguna prueba (se cayó el carril, el build…). El aviso
//                lo da la repetición, con lo de la noche y lo repetido juntos;
//   · avisar   — no hay nada de staging que repetir, o ya es la repetición.
//
//   node scripts/e2e/noche.mjs <informe.json|-> --trozos <success|failure|…> \
//        [--repeticion <run de la noche>] [--noche <informe de la noche.json>] \
//        [--repetidos "<ficheros repetidos>"] [--anterior <resumen.json>] \
//        [--cuerpo <fichero.md>] [--resumen <fichero.json>]
//   → para $GITHUB_OUTPUT: accion=verde|repetir|avisar, ficheros=…, linea=…
//
// Lo que cuenta como «de staging» sale de los fallos REALES de las e2e del
// 18 al 21/10 (tests/unit/e2e/fixtures/noche/), no de una lista inventada.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Señales de que lo que falló es staging, no la prueba. Cada una, con el caso
 * real que la justifica (tests/unit/e2e/noche.test.ts las comprueba contra él).
 */
export const DE_STAGING = [
  // Cloudflare delante de Supabase: «Web server is returning an unknown error» (520) y sus hermanos.
  // Con su contexto: un «520» suelto puede ser un importe en una aserción.
  /\b(?:status|HTTP|code|código|error)\b\W{0,12}5(?:0[234]|2[0-4])\b|\b5(?:0[234]|2[0-4]):? (?:Web server is returning|Bad Gateway|Service Unavailable|Gateway Time-?out|Origin )/i,
  // Una llamada a la base que contesta una página HTML en vez de JSON.
  /<!DOCTYPE html|<html[\s>]|Unexpected token '<'|is not valid JSON/i,
  // La red entre el runner y staging.
  /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|Failed to fetch|NetworkError|net::ERR_/i,
  // La sesión: entrar (tests/e2e/conta/sesion.ts: «No se pudo entrar como …: HTTP 520», y
  // HTTP 400 en las entradas siguientes del mismo carril) y renovar el token.
  /No se pudo entrar como \S+: HTTP \d+|AuthRetryableFetchError|Invalid Refresh Token|Refresh Token Not Found|JWT expired|session_not_found/i,
  // Q02: la base de staging corta una consulta por tiempo (17/11: «conta_pendientes: 57014
  // canceling statement due to statement timeout», y dos ficheros en la entera de la tarde).
  /\b57014\b|canceling statement due to statement timeout/i,
]

/** ¿El mensaje de error parece de staging? */
export function esDeStaging(mensaje) {
  const m = String(mensaje ?? '')
  return DE_STAGING.some((re) => re.test(m))
}

const sinColor = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '')
const conRuta = (f) => (f.startsWith('tests/e2e/') ? f : `tests/e2e/${f}`)
const unicos = (xs) => [...new Set(xs)].sort()

/** Cada prueba que acabó mal (su último intento), con su fichero, línea, tamaño y error. */
export function fallos(informe) {
  const r = []
  const andar = (s, titulos, fichero) => {
    const t = s.title && s.title !== fichero && !/\.spec\.ts$/.test(s.title) ? [...titulos, s.title] : titulos
    for (const spec of s.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const ultimo = (test.results ?? []).at(-1)
        if (!ultimo || !['failed', 'timedOut', 'interrupted'].includes(ultimo.status)) continue
        const error = sinColor(ultimo.error?.message ?? ultimo.errors?.[0]?.message ?? '')
        r.push({
          fichero: conRuta(spec.file ?? s.file ?? fichero ?? ''),
          linea: spec.line ?? null,
          prueba: [...t, spec.title].join(' › '),
          tamano: test.projectName ?? '',
          estado: ultimo.status,
          error,
          primera: error.split('\n').map((x) => x.trim()).find(Boolean) ?? `(${ultimo.status}, sin mensaje)`,
          deStaging: esDeStaging(error),
        })
      }
    }
    for (const h of s.suites ?? []) andar(h, t, s.file ?? fichero)
  }
  for (const s of informe?.suites ?? []) andar(s, [], s.file)
  return r
}

/** Los ficheros con algún fallo que parece de staging: los que se repiten. */
export function ficherosDeStaging(f) {
  return unicos(f.filter((x) => x.deStaging).map((x) => x.fichero))
}

/**
 * Lo que queda en rojo después de una repetición: lo de la noche en los
 * ficheros que NO se repitieron, más lo que ha vuelto a fallar al repetir.
 * Sin lista de repetidos (se repitió la entera), manda la repetición.
 */
export function juntar({ noche = [], repeticion = [], repetidos = [] }) {
  if (!repetidos.length) return repeticion
  const r = new Set(repetidos)
  return [...noche.filter((x) => !r.has(x.fichero)), ...repeticion]
}

/**
 * La decisión. «trozos» es el resultado de los trozos y la entera juntos
 * (success solo si todos pasaron y no faltó ningún fichero).
 *
 * En la repetición se pasan además los fallos de la noche y los ficheros que
 * se repitieron: lo que no se repitió sigue contando.
 */
export function decidir({ informe, trozos, repeticion, noche = null, repetidos = [] }) {
  const deAhora = informe ? fallos(informe) : []
  // En una repetición parcial, sin el informe de la noche no se sabe si lo
  // que no se repitió estaba bien: no se puede decir «verde».
  const faltaLaNoche = Boolean(repeticion) && repetidos.length > 0 && !noche
  const f = repeticion ? juntar({ noche: noche ? fallos(noche) : [], repeticion: deAhora, repetidos }) : deAhora
  const ficheros = unicos(f.map((x) => x.fichero))
  if (trozos === 'success' && !f.length && !faltaLaNoche) return { accion: 'verde', fallos: f, ficheros: [] }
  if (!repeticion) {
    if (!f.length) return { accion: 'repetir', fallos: f, ficheros: [], porque: 'no llegó a fallar ninguna prueba: se cayó lo de alrededor' }
    const deStaging = ficherosDeStaging(f)
    if (deStaging.length) {
      const otros = ficheros.length - deStaging.length
      return {
        accion: 'repetir', fallos: f, ficheros: deStaging,
        porque: otros
          ? `en ${deStaging.length} ${deStaging.length === 1 ? 'fichero' : 'ficheros'} algo parece de staging; los otros ${otros} en rojo se avisan al acabar la repetición, con lo repetido`
          : 'todo lo que falló parece de staging',
      }
    }
  }
  return { accion: 'avisar', fallos: f, ficheros, faltaLaNoche }
}

/** Frente a la noche real anterior: qué es nuevo, qué ya fallaba y qué ha dejado de fallar (por fichero). */
export function comparar(ahora, antes) {
  const a = unicos(ahora)
  if (!antes) return { nuevos: a, yaFallaban: [], arreglados: [], conQue: false }
  const b = new Set(antes)
  const n = new Set(a)
  return {
    nuevos: a.filter((x) => !b.has(x)),
    yaFallaban: a.filter((x) => b.has(x)),
    arreglados: unicos(antes).filter((x) => !n.has(x)),
    conQue: true,
  }
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

/** La primera línea del aviso: se entiende sin abrir nada. */
export function primeraLinea({ ficheros, comparacion: c, deStaging = [], trozos = 'success' }) {
  if (!ficheros.length && trozos !== 'success') return '**En rojo sin que falle ninguna prueba: se ha caído lo de alrededor (el build, el carril…).**'
  if (!ficheros.length) {
    return c?.conQue && c.arreglados.length
      ? `**En verde: ${plural(c.arreglados.length, 'fichero ha dejado', 'ficheros han dejado')} de fallar.**`
      : '**En verde.**'
  }
  let l = `**${ficheros.length} en rojo`
  l += c?.conQue
    ? `: ${plural(c.nuevos.length, 'nuevo', 'nuevos')}, ${c.yaFallaban.length} que ya ${c.yaFallaban.length === 1 ? 'fallaba' : 'fallaban'}, ${plural(c.arreglados.length, 'arreglado', 'arreglados')}.**`
    : '.** (No hay una noche real anterior con la que comparar.)'
  if (deStaging.length) l += ` En ${plural(deStaging.length, 'fichero', 'ficheros')} algo parece de staging (no se ha podido entrar, o no ha contestado a tiempo).`
  return l
}

const celda = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim().slice(0, 160)
const codigo = (s) => `\`${celda(s).replace(/`/g, "'")}\``
const fila = (x) => `| \`${x.fichero}${x.linea ? `:${x.linea}` : ''}\` | ${celda(x.prueba)} | ${x.tamano} | ${codigo(x.primera)}${x.deStaging ? ' *(parece de staging)*' : ''} |`

/** Más de esto no cabe en un comentario de GitHub (65.536); se deja margen. */
export const TOPE = 60_000

/**
 * El cuerpo del aviso. Lo nuevo arriba y entero; lo que ya fallaba, un fichero
 * por línea; lo que ha dejado de fallar, al final. «anterior» es el resumen de
 * la noche real anterior ({ fecha, enlace, ficheros }), o null.
 */
export function cuerpo({ fallos: f, sha, asunto, enlace, trozos, repeticion, enlaceNoche, anterior = null, faltaLaNoche = false }) {
  const ficheros = unicos(f.map((x) => x.fichero))
  const c = comparar(ficheros, anterior?.ficheros ?? null)
  const deStaging = ficherosDeStaging(f)
  const porFichero = (lista) => lista.map((fi) => [fi, f.filter((x) => x.fichero === fi)])

  const armar = (nuevosPorPrueba) => {
    const l = []
    l.push(primeraLinea({ ficheros, comparacion: c, deStaging, trozos }))
    l.push('')
    if (!ficheros.length && trozos === 'success') l.push(`La e2e entera de la noche sobre \`main\` **en verde**${repeticion ? ', después de repetir lo que falló por staging' : ''}.`)
    else l.push(repeticion
      ? 'La e2e entera de la noche sobre `main` falló, se repitió lo que parecía de staging y **ha vuelto a fallar**: esto es lo que queda en rojo (lo de la noche que no se repitió, más lo que ha vuelto a fallar al repetir).'
      : 'La e2e entera de la noche sobre `main` **no ha salido en verde**.')
    l.push('')
    l.push(`- **Commit:** \`${String(sha).slice(0, 7)}\`${asunto ? ` — ${celda(asunto)}` : ''}`)
    l.push(`- **Ejecución:** ${enlace}${repeticion && enlaceNoche ? ` (la de la noche: ${enlaceNoche})` : ''}`)
    l.push(anterior
      ? `- **Comparada con:** la noche real del ${anterior.fecha}${anterior.enlace ? ` (${anterior.enlace})` : ''}, con ${plural(anterior.ficheros.length, 'fichero', 'ficheros')} en rojo.`
      : '- **Comparada con:** nada; no se ha encontrado una noche real anterior con su lista de ficheros.')
    if (faltaLaNoche) l.push('- **Ojo:** no se ha podido leer el informe de la noche; aquí solo está lo repetido, y lo que no se repitió no se sabe cómo está.')
    if (!f.length && trozos !== 'success') {
      l.push(`- **Qué falla:** ninguna prueba llegó a fallar; lo que se cayó fue lo de alrededor (trozos: ${trozos}). Mira los pasos en rojo de la ejecución.`)
    } else if (f.length) {
      l.push(`- **Qué falla:** ${plural(f.length, 'prueba', 'pruebas')} en ${plural(ficheros.length, 'fichero', 'ficheros')}.`)
    }
    if (c.nuevos.length) {
      l.push('')
      l.push(`### Nuevo esta noche (${c.nuevos.length})`)
      l.push('')
      if (nuevosPorPrueba) {
        l.push('| Fichero | Prueba | Tamaño | Error |')
        l.push('|---|---|---|---|')
        for (const [, xs] of porFichero(c.nuevos)) for (const x of xs) l.push(fila(x))
      } else {
        l.push('| Fichero | Pruebas en rojo | Primer error |')
        l.push('|---|---|---|')
        for (const [fi, xs] of porFichero(c.nuevos)) l.push(`| \`${fi}\` | ${xs.length} | ${codigo(xs[0].primera)}${xs.some((x) => x.deStaging) ? ' *(parece de staging)*' : ''} |`)
        l.push('')
        l.push('*(Prueba a prueba no cabe en un comentario: está en el informe de la ejecución.)*')
      }
    }
    if (c.yaFallaban.length) {
      l.push('')
      l.push(`### Ya fallaba la noche anterior (${c.yaFallaban.length})`)
      l.push('')
      l.push('| Fichero | Pruebas en rojo | Primer error |')
      l.push('|---|---|---|')
      for (const [fi, xs] of porFichero(c.yaFallaban)) l.push(`| \`${fi}\` | ${xs.length} | ${codigo(xs[0].primera)}${xs.some((x) => x.deStaging) ? ' *(parece de staging)*' : ''} |`)
    }
    if (c.arreglados.length) {
      l.push('')
      l.push(`### Ha dejado de fallar (${c.arreglados.length})`)
      l.push('')
      for (const fi of c.arreglados) l.push(`- \`${fi}\``)
    }
    l.push('')
    l.push('El detalle de cada fallo (traza, capturas y vídeo), en el artefacto «playwright-report» de la ejecución.')
    return l.join('\n')
  }
  const entero = armar(true)
  return entero.length <= TOPE ? entero : armar(false).slice(0, TOPE)
}

/** Lo que guarda la noche para la siguiente (y para los PR): el artefacto «noche-resumen». */
export function resumen({ fallos: f, run, sha, fecha, noche = '' }) {
  return {
    run: String(run ?? ''), sha: String(sha ?? ''), fecha, noche: String(noche ?? ''),
    fallos: f.length, ficheros: unicos(f.map((x) => x.fichero)), deStaging: ficherosDeStaging(f),
  }
}

/** La fecha de Madrid de un instante, «17/11/2026». */
export function fechaDeMadrid(instante = new Date()) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(instante))
}

const leerJson = (ruta) => (ruta && ruta !== '-' && existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null)

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] ?? '' : undefined }
  const informe = leerJson(args[0])
  const repeticion = valor('--repeticion') || ''
  const noche = leerJson(valor('--noche'))
  const repetidos = (valor('--repetidos') ?? '').split(/\s+/).filter(Boolean).map(conRuta)
  const anterior = leerJson(valor('--anterior'))
  const trozos = valor('--trozos') ?? ''
  const d = decidir({ informe, trozos, repeticion, noche, repetidos })
  const fCuerpo = valor('--cuerpo')
  if (fCuerpo) {
    writeFileSync(fCuerpo, cuerpo({
      fallos: d.fallos, trozos, repeticion, anterior, faltaLaNoche: d.faltaLaNoche,
      sha: process.env.GITHUB_SHA ?? '', asunto: process.env.ASUNTO ?? '',
      enlace: process.env.ENLACE ?? '', enlaceNoche: process.env.ENLACE_NOCHE ?? '',
    }))
  }
  const fResumen = valor('--resumen')
  if (fResumen) {
    writeFileSync(fResumen, JSON.stringify(resumen({
      fallos: d.fallos, run: process.env.GITHUB_RUN_ID, sha: process.env.GITHUB_SHA, noche: repeticion,
      fecha: fechaDeMadrid(process.env.INICIO_NOCHE || new Date()),
    }), null, 1))
  }
  const ficherosRojos = unicos(d.fallos.map((x) => x.fichero))
  console.log(`accion=${d.accion}`)
  console.log(`ficheros=${d.ficheros.join(' ')}`)
  console.log(`fallos=${d.fallos.length}`)
  console.log(`porque=${d.porque ?? ''}`)
  console.log(`linea=${primeraLinea({ ficheros: ficherosRojos, comparacion: comparar(ficherosRojos, anterior?.ficheros ?? null), deStaging: ficherosDeStaging(d.fallos), trozos }).replace(/\*\*/g, '')}`)
}
