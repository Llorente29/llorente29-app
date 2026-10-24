#!/usr/bin/env node
// scripts/e2e/noche.mjs — la entera de la noche: ¿verde, repetir o avisar?
//
// Julio, 21/10: «la entera cada noche sobre main, hacia las 3:00 de Madrid. Si
// falla, un aviso claro que diga qué prueba, en qué fichero y el commit. Un
// fallo de staging (sesión, 520) se repite una vez antes de avisar».
//
// Lee el informe JSON de Playwright de la noche (los trozos juntos) y decide:
//   · verde    — todo pasó;
//   · repetir  — solo es la noche (no una repetición) y todo lo que falló
//                parece de staging, o no llegó a fallar ninguna prueba (se cayó
//                el carril, el build…): se lanzan otra vez solo esos ficheros
//                (o la entera, si no hay ninguno);
//   · avisar   — hay al menos un fallo que no es de staging, o ya es la
//                repetición: incidencia con cada prueba, su fichero y el commit.
//
//   node scripts/e2e/noche.mjs <informe.json|-> --trozos <success|failure|…> \
//        [--repeticion <run de la noche>] --cuerpo <fichero.md>
//   → para $GITHUB_OUTPUT: accion=verde|repetir|avisar, ficheros=…
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
]

/** ¿El mensaje de error parece de staging? */
export function esDeStaging(mensaje) {
  const m = String(mensaje ?? '')
  return DE_STAGING.some((re) => re.test(m))
}

const sinColor = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '')
const conRuta = (f) => (f.startsWith('tests/e2e/') ? f : `tests/e2e/${f}`)

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

/**
 * La decisión. «trozos» es el resultado de los trozos y la entera juntos
 * (success solo si todos pasaron y no faltó ningún fichero).
 */
export function decidir({ informe, trozos, repeticion }) {
  const f = informe ? fallos(informe) : []
  if (trozos === 'success' && !f.length) return { accion: 'verde', fallos: f, ficheros: [] }
  const ficheros = [...new Set(f.map((x) => x.fichero))].sort()
  const todoStaging = f.every((x) => x.deStaging)
  if (!repeticion && todoStaging) {
    return { accion: 'repetir', fallos: f, ficheros, porque: f.length ? 'todo lo que falló parece de staging' : 'no llegó a fallar ninguna prueba: se cayó lo de alrededor' }
  }
  return { accion: 'avisar', fallos: f, ficheros }
}

const celda = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim().slice(0, 160)

/** El cuerpo de la incidencia: qué prueba, en qué fichero y el commit. */
export function cuerpo({ fallos: f, sha, asunto, enlace, trozos, repeticion, enlaceNoche }) {
  const l = []
  l.push(repeticion
    ? 'La e2e entera de la noche sobre `main` ha fallado, se repitió lo que falló (parecía de staging) y **ha vuelto a fallar**.'
    : 'La e2e entera de la noche sobre `main` **no ha salido en verde**.')
  l.push('')
  l.push(`- **Commit:** \`${String(sha).slice(0, 7)}\`${asunto ? ` — ${celda(asunto)}` : ''}`)
  l.push(`- **Ejecución:** ${enlace}${repeticion && enlaceNoche ? ` (la de la noche: ${enlaceNoche})` : ''}`)
  if (f.length) {
    const ficheros = new Set(f.map((x) => x.fichero)).size
    l.push(`- **Qué falla:** ${f.length} ${f.length === 1 ? 'prueba' : 'pruebas'} en ${ficheros} ${ficheros === 1 ? 'fichero' : 'ficheros'}`)
    l.push('')
    l.push('| Fichero | Prueba | Tamaño | Error |')
    l.push('|---|---|---|---|')
    for (const x of f.slice(0, 25)) {
      l.push(`| \`${x.fichero}${x.linea ? `:${x.linea}` : ''}\` | ${celda(x.prueba)} | ${x.tamano} | \`${celda(x.primera).replace(/`/g, "'")}\`${x.deStaging ? ' *(parece de staging)*' : ''} |`)
    }
    if (f.length > 25) l.push(`| … | y ${f.length - 25} más, en el informe | | |`)
  } else {
    l.push(`- **Qué falla:** ninguna prueba llegó a fallar; lo que se cayó fue lo de alrededor (trozos: ${trozos}). Mira los pasos en rojo de la ejecución.`)
  }
  l.push('')
  l.push('El detalle de cada fallo (traza, capturas y vídeo), en el artefacto «playwright-report» de la ejecución.')
  return l.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] ?? '' : undefined }
  const ruta = args[0]
  const informe = ruta && ruta !== '-' && existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null
  const repeticion = valor('--repeticion') || ''
  const d = decidir({ informe, trozos: valor('--trozos') ?? '', repeticion })
  const fCuerpo = valor('--cuerpo')
  if (fCuerpo) {
    writeFileSync(fCuerpo, cuerpo({
      fallos: d.fallos, trozos: valor('--trozos'), repeticion,
      sha: process.env.GITHUB_SHA ?? '', asunto: process.env.ASUNTO ?? '',
      enlace: process.env.ENLACE ?? '', enlaceNoche: process.env.ENLACE_NOCHE ?? '',
    }))
  }
  console.log(`accion=${d.accion}`)
  console.log(`ficheros=${d.ficheros.join(' ')}`)
  console.log(`fallos=${d.fallos.length}`)
  console.log(`porque=${d.porque ?? ''}`)
}
