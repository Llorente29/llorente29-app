#!/usr/bin/env node
// scripts/conta/fuentes.mjs
//
// Descarga las fuentes oficiales del módulo de contabilidad (C00, D7) y deja
// en el repositorio, por cada una: el texto (docs/conta/fuentes/textos/), y en
// docs/conta/fuentes/registro.json su URL, la fecha de descarga, el título que
// dice la propia fuente, la huella sha256 del texto y si contiene lo que tiene
// que contener (para cazar un identificador equivocado).
//
// Corre en GitHub Actions: desde el contenedor de trabajo esas webs no se
// alcanzan. Dos modos:
//   node scripts/conta/fuentes.mjs descargar   → reescribe textos y registro
//   node scripts/conta/fuentes.mjs comparar    → no escribe textos; deja en
//       docs/conta/fuentes/cambios.md qué fuentes han cambiado desde la última
//       descarga (agente «Normativa al día»). No cambia nada solo.
//
// Sin dependencias: Node 20+ (fetch y crypto).

import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = 'docs/conta/fuentes'
const modo = process.argv[2] ?? 'descargar'
const UA = 'Folvy-contabilidad/1.0 (+https://github.com/Llorente29/llorente29-app)'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function entidades(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}
const sinEtiquetas = (s) => entidades(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/**
 * Texto de la legislación consolidada del BOE: un encabezado por bloque
 * (artículo), y dentro, cada VERSIÓN con su fecha de vigencia y la norma que
 * la introdujo. La última versión de cada bloque es la vigente.
 */
function textoBoe(xml) {
  const lineas = []
  const re = /<bloque\b[^>]*\bid="([^"]+)"[^>]*>|<version\b([^>]*)>|<p\b[^>]*>([\s\S]*?)<\/p>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) lineas.push('', `## [${m[1]}]`)
    else if (m[2] !== undefined) {
      const at = (n) => ((m[2].match(new RegExp(`${n}="([^"]*)"`)) ?? [])[1] ?? '')
      const f = at('fecha_vigencia')
      const fecha = f.length === 8 ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : (f || '¿?')
      lineas.push(`### versión · vigente desde ${fecha} · ${at('id_norma') || 'norma sin identificar'}`)
    } else {
      const t = sinEtiquetas(m[3] ?? '')
      if (t) lineas.push(t)
    }
  }
  return lineas.join('\n').trim() + '\n'
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
/**
 * Tiempo límite de cada petición, cuerpo incluido. Sin él, una fuente que no
 * contesta se come los 15 minutos del trabajo «Normativa al día» y las demás no
 * se comprueban (06/10: la consulta SPARQL de la UE colgada tras la CNAE-2025).
 * Con él, esa petición falla, se reintenta como un error de red y la fuente sale
 * en el informe con su error.
 */
const LIMITE_MS = 60_000

/**
 * Pide una URL; si el servidor falla (5xx o red), reintenta dos veces. Un fallo
 * de red (o el tiempo límite) va en `error`, nunca en `cuerpo`: el texto del
 * error no es la fuente, y con él dentro el registro guardaba su huella como si
 * se hubiera descargado (06/10, la SPARQL de la UE: 54 bytes de «TimeoutError»).
 */
async function pedir(url, opciones = {}) {
  let ultimo = { http: 0, cuerpo: '', error: null }
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(url, { ...opciones, headers: { 'User-Agent': UA, ...(opciones.headers ?? {}) }, signal: AbortSignal.timeout(LIMITE_MS) })
      ultimo = { http: r.status, cuerpo: await r.text(), error: null }
      if (r.status < 500) return ultimo
    } catch (e) { ultimo = { http: 0, cuerpo: '', error: String(e) } }
    await espera(3000 * (intento + 1))
  }
  return ultimo
}

/** Busca en la legislación consolidada del BOE por texto del título; devuelve los identificadores encontrados. */
async function buscarEnBoe(texto) {
  const q = JSON.stringify({ query: { query_string: { query: `titulo:(${texto})` } } })
  const r = await pedir(`https://www.boe.es/datosabiertos/api/legislacion-consolidada?query=${encodeURIComponent(q)}&limit=10`,
    { headers: { Accept: 'application/json' } })
  const ids = [...new Set(r.cuerpo.match(/BOE-A-\d{4}-\d+/g) ?? [])]
  return { ids, http: r.http, muestra: r.cuerpo.slice(0, 300) }
}

/** Una norma del BOE: primero la base consolidada; si no está, el BOE del día. */
async function descargarBoe(id) {
  const base = `https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/${id}`
  const meta = await pedir(`${base}/metadatos`, { headers: { Accept: 'application/xml' } })
  const texto = await pedir(`${base}/texto`, { headers: { Accept: 'application/xml' } })
  if (texto.http === 200) {
    const titulo = sinEtiquetas((meta.cuerpo.match(/<titulo>([\s\S]*?)<\/titulo>/) ?? [])[1] ?? '')
    const actualizado = ((meta.cuerpo.match(/<fecha_actualizacion>([\s\S]*?)<\/fecha_actualizacion>/) ?? [])[1] ?? '').trim()
    return { id, url: `https://www.boe.es/buscar/act.php?id=${id}`, urlDatos: `${base}/texto`, http: 200, titulo,
      actualizadoEnFuente: actualizado || null, texto: textoBoe(texto.cuerpo), ext: 'txt' }
  }
  // No consolidada (p. ej. una norma que solo aprueba una clasificación): el BOE del día.
  const dia = await pedir(`https://www.boe.es/diario_boe/xml.php?id=${id}`, { headers: { Accept: 'application/xml' } })
  const titulo = sinEtiquetas((dia.cuerpo.match(/<titulo>([\s\S]*?)<\/titulo>/) ?? [])[1] ?? '')
  return { id, url: `https://www.boe.es/diario_boe/txt.php?id=${id}`, urlDatos: `https://www.boe.es/diario_boe/xml.php?id=${id}`,
    http: dia.http, titulo, actualizadoEnFuente: null, texto: dia.http === 200 ? textoBoe(dia.cuerpo) : '', ext: 'txt' }
}

/** El título es el de la norma buscada: empieza por su número (no una que la cita o la modifica). */
function tituloBueno(f, titulo) {
  if (f.tituloEmpiezaPor) return titulo.trim().startsWith(f.tituloEmpiezaPor)
  if (f.tituloDebeContener) return titulo.includes(f.tituloDebeContener)
  return titulo.includes(f.debeContener)
}

/**
 * Un fichero dentro de un zip (GeoNames publica los códigos postales así). Se
 * baja el zip, se saca SOLO el fichero que dice la fuente con `unzip` (está en
 * los ejecutores de Actions) y se guarda su texto; la huella es la del texto.
 */
async function descargarZip(f) {
  let http = 0
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(LIMITE_MS) })
      http = r.status
      if (r.status === 200) {
        const dir = await mkdtemp(join(tmpdir(), 'fuente-'))
        const zip = join(dir, 'f.zip')
        await writeFile(zip, Buffer.from(await r.arrayBuffer()))
        const texto = execFileSync('unzip', ['-p', zip, f.dentro], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
        return { url: f.url, http, titulo: f.nombre, actualizadoEnFuente: r.headers.get('last-modified'), texto, ext: f.formato ?? 'txt' }
      }
      if (r.status < 500) break
    } catch (e) { if (intento === 2) return { url: f.url, http, titulo: f.nombre, texto: '', ext: f.formato ?? 'txt', error: String(e) } }
    await espera(3000 * (intento + 1))
  }
  return { url: f.url, http, titulo: f.nombre, texto: '', ext: f.formato ?? 'txt', error: `HTTP ${http}` }
}

async function descargarUna(f) {
  if (f.tipo === 'zip') return descargarZip(f)
  if (f.tipo === 'boe') {
    const probados = []
    if (f.id) {
      const d = await descargarBoe(f.id)
      probados.push(`${f.id}: «${d.titulo.slice(0, 60)}»`)
      if (d.http === 200 && (d.titulo.includes(f.debeContener) || d.texto.includes(f.debeContener)) && tituloBueno(f, d.titulo)) return d
    }
    if (f.buscar) {
      const b = await buscarEnBoe(f.buscar)
      for (const id of b.ids.slice(0, 10)) {
        const d = await descargarBoe(id)
        probados.push(`${id}: «${d.titulo.slice(0, 60)}»`)
        if (d.http === 200 && tituloBueno(f, d.titulo)) return { ...d, nota: `encontrada buscando «${f.buscar}»` }
      }
      if (b.ids.length === 0) probados.push(`búsqueda «${f.buscar}» sin resultados (HTTP ${b.http}): ${b.muestra}`)
    }
    return { url: f.id ?? f.buscar, http: 404, titulo: '', texto: '', ext: 'txt', error: `No encontrada. Probado: ${probados.join(' | ')}` }
  }
  if (f.tipo === 'sparql') {
    const r = await pedir(f.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/csv' },
      body: new URLSearchParams({ query: f.consulta, format: 'text/csv' }).toString(),
    })
    return { url: f.url, http: r.http, titulo: f.nombre, actualizadoEnFuente: null, texto: r.cuerpo, ext: 'csv', error: r.error }
  }
  const r = await pedir(f.url, { headers: { Accept: f.formato === 'json' ? 'application/json' : '*/*' } })
  // Listas paginadas (ISTAC: 1.000 por página): se siguen las páginas y se juntan.
  if (f.formato === 'json' && r.http === 200) {
    const primera = JSON.parse(r.cuerpo)
    if (Array.isArray(primera.code) && primera.nextLink) {
      const todos = [...primera.code]
      let siguiente = primera.nextLink
      for (let i = 0; siguiente && i < 50; i++) {
        const p = await pedir(siguiente, { headers: { Accept: 'application/json' } })
        if (p.http !== 200) return { url: f.url, http: p.http, titulo: f.nombre, texto: '', ext: 'json', error: `página ${i + 2}: HTTP ${p.http}` }
        const j = JSON.parse(p.cuerpo)
        todos.push(...(j.code ?? []))
        siguiente = j.nextLink && j.nextLink !== siguiente ? j.nextLink : null
      }
      if (primera.total && todos.length !== primera.total) {
        return { url: f.url, http: 200, titulo: f.nombre, texto: '', ext: 'json', error: `esperaba ${primera.total} códigos y hay ${todos.length}` }
      }
      const junto = { total: todos.length, code: todos }
      return { url: f.url, http: 200, titulo: f.nombre, actualizadoEnFuente: null, texto: JSON.stringify(junto, null, 1) + '\n', ext: 'json' }
    }
  }
  return { url: f.url, http: r.http, titulo: f.nombre, actualizadoEnFuente: null, texto: r.cuerpo, ext: f.formato ?? 'txt', error: r.error }
}

async function main() {
  const todas = JSON.parse(await readFile(join(DIR, 'fuentes.json'), 'utf8')).fuentes
  // FUENTES_SOLO=clave1,clave2 descarga solo esas (el agente «Plan contable»
  // vuelve a bajar el PGC cada noche para ver si el BOE ha corregido una
  // errata). El registro conserva las demás tal y como estaban.
  const solo = (process.env.FUENTES_SOLO ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const fuentes = solo.length ? todas.filter((f) => solo.includes(f.clave)) : todas
  if (solo.length && fuentes.length !== solo.length) throw new Error(`FUENTES_SOLO nombra fuentes que no están en fuentes.json: ${solo.join(', ')}`)
  let previo = { fuentes: {} }
  try { previo = JSON.parse(await readFile(join(DIR, 'registro.json'), 'utf8')) } catch { /* primera vez */ }
  await mkdir(join(DIR, 'textos'), { recursive: true })

  const fecha = new Date().toISOString()
  const registro = { descargado: fecha, fuentes: solo.length ? { ...previo.fuentes } : {} }
  const cambios = []
  let fallos = 0

  for (const f of fuentes) {
    let d
    try { d = await descargarUna(f) } catch (e) { d = { url: f.url ?? f.id, http: 0, titulo: '', texto: '', ext: 'txt', error: String(e) } }
    const huella = d.texto ? sha256(d.texto) : null
    const contiene = d.texto.includes(f.debeContener) || (d.titulo ?? '').includes(f.debeContener)
    const ok = d.http === 200 && d.texto.length > 0 && contiene
    if (!ok) fallos++
    const fichero = `textos/${f.clave}.${d.ext}`
    // Si el texto es el mismo (misma huella), la fecha de descarga se queda la
    // de la primera vez que se bajó ESE texto, y la de hoy va a «comprobado».
    // Los valores de serie citan esa fecha (official_source.downloaded_at,
    // verified_at) y ya están aplicados: volver a bajar lo mismo no puede
    // cambiarlos (C02, 04/10: una descarga idéntica rompía serie.mjs comprobar).
    const previa = previo.fuentes?.[f.clave]
    const mismo = ok && previa?.sha256 === huella && previa?.fecha
    // Si hoy falla y había una copia buena, se queda esa copia (los valores de
    // serie se cargan de ella: serie.mjs, plan.mjs) y el fallo se apunta aparte.
    // Con el tiempo límite, una fuente caída es un fallo normal, no un cuelgue:
    // sin esto, un mal día de la UE dejaba «eu-paises» sin fichero (06/10).
    const conservar = !ok && previa?.fichero && previa?.sha256
    registro.fuentes[f.clave] = conservar
      ? { ...previa, ultimoFallo: { fecha, http: d.http, contieneLoEsperado: contiene, error: d.error ?? null } }
      : {
          nombre: f.nombre, url: d.url, urlDatos: d.urlDatos ?? null, http: d.http, titulo: d.titulo,
          actualizadoEnFuente: d.actualizadoEnFuente ?? null, fecha: mismo ? previa.fecha : fecha, comprobado: fecha, sha256: huella, bytes: d.texto.length,
          contieneLoEsperado: contiene, fichero: ok ? fichero : null, error: d.error ?? null,
          idBoe: d.id ?? null, nota: d.nota ?? null,
        }
    const antes = previo.fuentes?.[f.clave]?.sha256 ?? null
    if (ok && antes && antes !== huella) cambios.push(`- **${f.nombre}** (${d.url}): la huella pasa de \`${antes.slice(0, 12)}…\` a \`${huella.slice(0, 12)}…\`. Actualizada en la fuente: ${d.actualizadoEnFuente ?? 'no lo dice'}.`)
    if (!ok) cambios.push(`- **${f.nombre}**: NO se ha podido comprobar (HTTP ${d.http}${contiene ? '' : ', no contiene «' + f.debeContener + '»'}${d.error ? ', ' + d.error : ''})${conservar ? '; se queda la copia anterior' : ''}.`)
    if (modo === 'descargar' && ok) await writeFile(join(DIR, fichero), d.texto)
    console.log(`${ok ? 'OK ' : 'MAL'} ${f.clave.padEnd(18)} HTTP ${d.http} · ${d.texto.length} car. · ${d.titulo?.slice(0, 80) ?? ''}`)
  }

  if (modo === 'descargar') {
    // «descargado» es la fecha del texto más reciente, no la de la ejecución.
    registro.descargado = Object.values(registro.fuentes).map((x) => x.fecha).filter(Boolean).sort().at(-1) ?? fecha
    await writeFile(join(DIR, 'registro.json'), JSON.stringify(registro, null, 2) + '\n')
  } else {
    const informe = [
      `# Normativa al día · ${fecha.slice(0, 10)}`, '',
      cambios.length === 0
        ? 'Ninguna fuente ha cambiado desde la última descarga, y todas se han podido comprobar.'
        : 'Ha cambiado algo, o no se ha podido comprobar. **No se ha cambiado nada en Folvy**: hay que revisarlo y, si toca, cargar los valores nuevos con su referencia.',
      '', ...cambios, '',
    ].join('\n')
    await writeFile(join(DIR, 'cambios.md'), informe)
    console.log(informe)
  }
  console.log(`\n${fuentes.length - fallos} de ${fuentes.length} fuentes comprobadas.`)
  process.exitCode = modo === 'descargar' && fallos > 0 ? 2 : 0
}

await main()
