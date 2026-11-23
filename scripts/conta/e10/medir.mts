// scripts/conta/e10/medir.mts
//
// E10 · LA LECTURA DE VERDAD Y LA REGLA 31, con el ocr-albaran entero servido en local
// (servir.ts, con supabase-js de mentira: nada se escribe en ninguna base).
//
//   1. Grabar: las facturas inventadas de una página del D01 (tests/conta/d01/facturas-inventadas),
//      leídas UNA vez con el modelo de verdad, en modo factura (Sumied) y, cuatro de ellas, sin
//      modo (Folvy, la recepción de albaranes). Las respuestas se guardan en un fichero temporal.
//   2. Regla 31: el ocr-albaran de main y el de la rama, con ESAS MISMAS respuestas, sobre los mismos
//      ficheros: el cuerpo que devuelve y la sesión que guarda tienen que ser iguales, campo a campo
//      (menos ai_latency_ms, que es el reloj). La misma vara a los dos lados.
//   3. Las largas inventadas (5 páginas y 34 líneas; 10 páginas y 68), con el modelo de verdad: la de
//      main (antes) y la de la rama (después). De la rama: la cabecera, cada línea con su lote, la suma
//      contra las bases al céntimo, cuántas llamadas y cuántos tokens.
// Todo lo que se lee es inventado (T11); aun así, la salida solo dice recuentos, igual/distinto y cifras
// de la factura inventada.
//
//   ANTHROPIC_API_KEY=… deno run -A --no-config scripts/conta/e10/medir.mts <index de main> <index de la rama>

import { buildPrompt, MODELO_VISION } from '../../../supabase/functions/_shared/ocrAlbaranNucleo.ts'
import { PROMPT_FACTURA } from '../../../supabase/functions/_shared/lecturaFactura.ts'
import { FACTURAS } from '../d01/facturasInventadas.mjs'
import { facturaLarga } from './facturaLarga.mjs'

const [MAIN, RAMA] = Deno.args
const KEY = Deno.env.get('ANTHROPIC_API_KEY')
if (!KEY || !MAIN || !RAMA) { console.log('Falta la clave o los dos index.'); Deno.exit(1) }
const MODELO = Deno.env.get('VISION_MODEL') || MODELO_VISION
const TMP = await Deno.makeTempDir({ prefix: 'e10-' })
const out: string[] = []
const di = (s = '') => { out.push(s); console.log(s) }

const b64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s) }
async function clave(datos: string, texto: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(datos + '\u0000' + texto))
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// ── 1 · Grabar ───────────────────────────────────────────────────────────────
type F = { id: string; papel: string }
const unaPagina = (FACTURAS as F[]).map((f) => {
  const foto = f.papel === 'torcida' || f.papel === 'borrosa'
  return { id: f.id, local: `tests/conta/d01/facturas-inventadas/${f.id}.${foto ? 'jpg' : 'pdf'}`, mime: foto ? 'image/jpeg' : 'application/pdf' }
})
const casos = [
  ...unaPagina.map((f) => ({ ...f, modo: 'factura' as const })),
  ...unaPagina.slice(0, 4).map((f) => ({ ...f, modo: null })),
]
const grabadas: Record<string, unknown> = {}
const paradas: Record<string, number> = {}
for (const c of casos) {
  const datos = b64(Deno.readFileSync(c.local))
  const texto = c.modo === 'factura' ? buildPrompt() + PROMPT_FACTURA : buildPrompt()
  const bloque = c.mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: datos } }
    : { type: 'image', source: { type: 'base64', media_type: c.mime, data: datos } }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO, max_tokens: 8192, messages: [{ role: 'user', content: [bloque, { type: 'text', text: texto }] }] }),
  })
  const j = await r.json() as { stop_reason?: string }
  grabadas[await clave(datos, texto)] = j
  paradas[j.stop_reason ?? `http ${r.status}`] = (paradas[j.stop_reason ?? `http ${r.status}`] ?? 0) + 1
}
const GRABADAS = `${TMP}/grabadas.json`
Deno.writeTextFileSync(GRABADAS, JSON.stringify(grabadas))

// ── El servidor: ocr-albaran en el puerto 8000 ───────────────────────────────
const FICHEROS: Record<string, string> = {}
for (const c of unaPagina) FICHEROS[`cuenta/${c.id}`] = c.local

async function conServidor<T>(indice: string, env: Record<string, string>, hacer: () => Promise<T>): Promise<T> {
  const p = new Deno.Command('deno', {
    args: ['run', '-A', '--no-config', '--import-map=scripts/conta/e10/mapa.json', 'scripts/conta/e10/servir.mts', indice],
    env: { SUPABASE_URL: 'http://base-falsa', SUPABASE_SERVICE_ROLE_KEY: 'clave-interna', SUPABASE_ANON_KEY: 'anon', ANTHROPIC_API_KEY: KEY!, VISION_MODEL: MODELO, E10_FICHEROS: JSON.stringify(FICHEROS), ...env },
    stdout: 'null', stderr: 'piped',
  }).spawn()
  for (let i = 0; i < 120; i++) {
    try { await fetch('http://localhost:8000', { method: 'OPTIONS' }).then((r) => r.body?.cancel()); break } catch { await new Promise((ok) => setTimeout(ok, 500)) }
  }
  try { return await hacer() } finally {
    p.kill('SIGTERM')
    const e = new TextDecoder().decode((await p.output()).stderr)
    if (/error/i.test(e)) console.error(`(${indice}) ${e.split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' | ').slice(0, 400)}`)
  }
}
const pedir = async (cuerpo: unknown) => {
  const r = await fetch('http://localhost:8000', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer clave-interna', 'x-internal-key': 'clave-interna' }, body: JSON.stringify(cuerpo),
  })
  return { status: r.status, cuerpo: await r.json().catch(() => null) as Record<string, unknown> | null }
}
const sinReloj = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (k === 'ai_latency_ms' ? undefined : v)))
const escritoDe = (f: string) => { try { return Deno.readTextFileSync(f).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }

// ── 2 · Regla 31 ─────────────────────────────────────────────────────────────
const lados: Record<string, { cuerpos: unknown[]; escrito: unknown[] }> = {}
for (const [nombre, indice] of [['main', MAIN], ['rama', RAMA]] as const) {
  const escrito = `${TMP}/escrito-${nombre}.jsonl`
  const cuerpos = await conServidor(indice, { E10_MODO: 'grabado', E10_GRABADAS: GRABADAS, E10_ESCRITO: escrito }, async () => {
    const r: unknown[] = []
    for (const c of casos) r.push(sinReloj(await pedir({ account_id: 'cuenta', file_paths: [`cuenta/${c.id}`], ...(c.modo ? { modo: c.modo } : {}) })))
    return r
  })
  lados[nombre] = { cuerpos, escrito: escritoDe(escrito).map(sinReloj) }
}
let iguales = 0
const distintos: string[] = []
casos.forEach((c, i) => {
  const a = JSON.stringify(lados.main.cuerpos[i]) === JSON.stringify(lados.rama.cuerpos[i])
  const b = JSON.stringify(lados.main.escrito[i]) === JSON.stringify(lados.rama.escrito[i])
  if (a && b) iguales++
  else distintos.push(`${c.id}${c.modo ? '' : ' (Folvy)'}: ${a ? '' : 'cuerpo '}${b ? '' : 'sesión'}`)
})
const lineasMain = lados.main.cuerpos.map((x) => ((x as { cuerpo?: { lines_extracted?: number } }).cuerpo?.lines_extracted ?? 0))
di('## E10 · Regla 31: las de una página, main contra la rama')
di()
di(`Modelo ${MODELO}. ${casos.length} lecturas grabadas una vez (${unaPagina.length} en modo factura y 4 de Folvy, sin modo); cómo pararon: ${Object.entries(paradas).map(([k, v]) => `${k} ${v}`).join(', ')}.`)
di(`Con la misma respuesta, **${iguales} de ${casos.length} iguales** en el cuerpo que devuelve y en la sesión que guarda (sin ai_latency_ms).${distintos.length ? ` Distintas: ${distintos.join('; ')}.` : ''}`)
di(`Sesiones guardadas: main ${lados.main.escrito.length}, rama ${lados.rama.escrito.length}. Líneas leídas en total: ${lineasMain.reduce((s, n) => s + n, 0)}.`)
di()

// ── 3 · Las largas, de verdad ────────────────────────────────────────────────
// Los PDF los hace generar-facturas-largas.mjs (con jspdf, en Node) y están en el repositorio.
const PDF: Record<number, { fichero: string; paginas: number; partidas: number }> = {
  20: { fichero: 'tests/conta/e10/factura-larga-5.pdf', paginas: 5, partidas: 2 },
  40: { fichero: 'tests/conta/e10/factura-larga-10.pdf', paginas: 10, partidas: 4 },
}
di('## E10 · Las largas inventadas, con el modelo de verdad')
di()
di('| Factura | Lado | Respuesta | Cabecera | Líneas | Lotes | Suma contra bases | Llamadas (entera · cabecera · páginas) | Tokens entrada / salida | Tiempo |')
di('|---|---|---|---|---|---|---|---|---|---|')
const faltanDe: string[] = []
for (const [albaranes, numero] of [[20, 'AV-2026-0000011'], [40, 'AV-2026-0000012']] as const) {
  const pdf = PDF[albaranes]
  const esperada = facturaLarga({ albaranes, numero }) as { lineas: { lot_code: string; line_amount: number }[]; base: number; total: number; tipos: { base: number }[] }
  FICHEROS[`cuenta/larga-${albaranes}`] = pdf.fichero
  for (const [lado, indice] of (albaranes === 20 ? [['main', MAIN], ['rama', RAMA]] : [['rama', RAMA]]) as [string, string][]) {
    const uso = `${TMP}/uso-${lado}-${albaranes}.jsonl`
    const escrito = `${TMP}/escrito-${lado}-${albaranes}.jsonl`
    const t0 = Date.now()
    const r = await conServidor(indice, { E10_MODO: 'real', E10_USO: uso, E10_ESCRITO: escrito }, () => pedir({ account_id: 'cuenta', file_paths: [`cuenta/larga-${albaranes}`], modo: 'factura' }))
    const s = Math.round((Date.now() - t0) / 1000)
    const usos = escritoDe(uso) as { paso: string; stop: string; entrada: number; salida: number }[]
    const n = (p: string) => usos.filter((u) => u.paso === p).length
    const tok = `${usos.reduce((a, u) => a + (u.entrada ?? 0), 0)} / ${usos.reduce((a, u) => a + (u.salida ?? 0), 0)}`
    const cortadas = usos.filter((u) => u.stop === 'max_tokens').map((u) => u.paso)
    const c = r.cuerpo as { factura?: { factura?: { numero?: string; total?: number; base?: number } }; clase?: string; causa?: string } | null
    const cab = c?.factura?.factura
    // Las líneas: las que guarda el paso 2 (por partes) o, si se leyó de una vez, las de la respuesta.
    const porPartes = escritoDe(escrito).filter((e) => e.que === 'rpc').pop()?.args?.p_lineas as { lot_code?: string; line_amount?: number }[] | undefined
    const deUnaVez = ((r.cuerpo as { parsed?: { lines?: unknown[] } } | null)?.parsed?.lines ?? []) as { lot_code?: string; line_amount?: number }[]
    const guardadas = porPartes ?? deUnaVez
    const lotes = new Set(guardadas.map((l) => l.lot_code))
    const lotesBien = esperada.lineas.filter((l) => lotes.has(l.lot_code)).length
    // Los lotes que faltan (inventados): para saber qué líneas se pierden y dónde.
    const faltan = esperada.lineas.filter((l) => !lotes.has(l.lot_code)).map((l) => l.lot_code)
    if (faltan.length) faltanDe.push(`${pdf.paginas} págs (${lado}): faltan los lotes ${faltan.join(', ')}`)
    const suma = Math.round(guardadas.reduce((a, l) => a + Math.round((l.line_amount ?? 0) * 100), 0)) / 100
    const cabTexto = cab ? `${cab.numero === numero ? 'número ✓' : 'número ✗'} · base ${cab.base === esperada.base ? '✓' : `✗ ${cab.base}`} · total ${cab.total === esperada.total ? '✓' : `✗ ${cab.total}`}` : '—'
    di(`| ${pdf.paginas} págs, ${esperada.lineas.length} líneas (${pdf.partidas} partidas) | ${lado} | ${r.status}${c?.causa ? ` ${c.clase}/${c.causa}` : ''} | ${cabTexto} | ${r.status === 200 ? `${guardadas.length} de ${esperada.lineas.length}${porPartes ? ' (por partes)' : ' (de una vez)'}` : '—'} | ${r.status === 200 ? `${lotesBien} de ${esperada.lineas.length}` : '—'} | ${r.status === 200 ? `${suma.toFixed(2)} contra ${esperada.base.toFixed(2)}${Math.round(suma * 100) === Math.round(esperada.base * 100) ? ' ✓' : ' ✗'}` : '—'} | ${n('entera')} · ${n('cabecera')} · ${n('lineas')}${cortadas.length ? ` (cortadas: ${cortadas.join(', ')})` : ''} | ${tok} | ${s} s |`)
  }
}
di()
for (const f of faltanDe) di(`- ${f}`)
di()
const resumen = Deno.env.get('GITHUB_STEP_SUMMARY')
if (resumen) Deno.writeTextFileSync(resumen, out.join('\n') + '\n', { append: true })
await Deno.remove(TMP, { recursive: true })
