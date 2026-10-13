// scripts/conta/d01/leer-con-modelo.ts
//
// D01 · R2 punto 2 · LA LECTURA CON EL MODELO, sobre las facturas inventadas
// de tests/conta/d01/facturas-inventadas/ (los ocho formatos, una foto
// torcida, una borrosa y un PDF escaneado).
//
// Hace lo mismo que ocr-albaran en modo «factura»: el mismo modelo
// (MODELO_VISION, o VISION_MODEL si se pasa), el mismo bloque (PDF como
// document, foto como image), el mismo prompt (buildPrompt() + PROMPT_FACTURA)
// y el mismo extractJson; y pasa lo leído por leerFactura, como la app. Lo
// compara con leerFactura(ideal(f)) campo a campo (compararLectura.mjs), con
// la misma vara a los dos lados.
//
// La salida es solo «@@ clave 0|1» (aciertos por campo) y recuentos: ni lo
// leído ni lo esperado (regla de salida, R2 punto 1). La clave la pone Julio
// como secreto ANTHROPIC_API_KEY en GitHub; nunca pasa por el chat ni por el
// repositorio.
//
//   ANTHROPIC_API_KEY=… npx tsx scripts/conta/d01/leer-con-modelo.ts [f01-mercancia …]

import { readFileSync } from 'node:fs'
import { MODELO_VISION, buildPrompt, extractJson } from '../../../supabase/functions/_shared/ocrAlbaranNucleo.ts'
import { PROMPT_FACTURA, leerFactura, type LecturaModelo } from '../../../supabase/functions/_shared/lecturaFactura.ts'
// @ts-expect-error módulo .mjs sin tipos
import { CAMPOS, compararLectura } from './compararLectura.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { FACTURAS, HOY, ideal } from './facturasInventadas.mjs'

const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)
const clave = (id: string) => id.replace(/-/g, '_')

const KEY = process.env.ANTHROPIC_API_KEY
if (!KEY) { di('falta_la_clave', true); process.exit(1) }
const MODELO = process.env.VISION_MODEL || MODELO_VISION
const solo = new Set(process.argv.slice(2))
type F = { id: string; papel: string }
const lista = (FACTURAS as F[]).filter((f) => !solo.size || solo.has(f.id))

const aciertos: Record<string, number> = Object.fromEntries(CAMPOS.map((k: string) => [k, 0]))
let leidas = 0
const confLeida: Record<string, number> = { seguro: 0, probable: 0, duda: 0, ninguna: 0 }
const prompt = buildPrompt() + PROMPT_FACTURA

for (const f of lista) {
  const foto = f.papel === 'torcida' || f.papel === 'borrosa'
  const datos = readFileSync(`tests/conta/d01/facturas-inventadas/${f.id}.${foto ? 'jpg' : 'pdf'}`).toString('base64')
  const bloque = foto
    ? { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: datos } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: datos } }
  let lectura = null
  seccion(clave(f.id))
  try {
    const r = await fetch(process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODELO, max_tokens: 8192, messages: [{ role: 'user', content: [bloque, { type: 'text', text: prompt }] }] }),
    })
    di(`${clave(f.id)}.http`, r.status)
    if (!r.ok) {
      // El porqué, como código (no su texto): la respuesta de la API dice qué no le gustó.
      const t = (await r.text()).toLowerCase()
      di(`${clave(f.id)}.error_${/pdf/.test(t) ? 'pdf' : /image/.test(t) ? 'imagen' : /too large|size|exceed/.test(t) ? 'tamano' : /model/.test(t) ? 'modelo' : 'otro'}`, 1)
      di(`${clave(f.id)}.error_${/password|encrypt/.test(t) ? 'cifrado' : /pages?/.test(t) ? 'paginas' : /parse|process|invalid|corrupt/.test(t) ? 'no_se_procesa' : 'sin_detalle'}`, 1)
    }
    if (r.ok) {
      const j = await r.json() as { content?: { type: string; text?: string }[] }
      const parsed = extractJson((j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''))
      if (parsed?.document) lectura = leerFactura(parsed as unknown as LecturaModelo, { hoy: HOY })
    }
  } catch {
    di(`${clave(f.id)}.red`, 0)
  }
  const esperada = leerFactura(ideal(f) as LecturaModelo, { hoy: HOY })
  const r = compararLectura(lectura, esperada) as Record<string, number>
  di(`${clave(f.id)}.leida`, !!lectura)
  if (lectura) leidas++
  confLeida[lectura?.confianza ?? 'ninguna']++
  for (const k of CAMPOS as string[]) { di(`${clave(f.id)}.${k}`, r[k]); aciertos[k] += r[k] }
  // Que no diga «seguro» lo que no lo es: la peor equivocación posible.
  di(`${clave(f.id)}.seguro_sin_serlo`, lectura?.confianza === 'seguro' && Object.entries(r).some(([k, v]) => k !== 'confianza' && v === 0))
}

seccion('total')
di('facturas', lista.length)
di('leidas', leidas)
for (const k of CAMPOS as string[]) di(`aciertos.${k}`, aciertos[k])
for (const [k, v] of Object.entries(confLeida)) di(`confianza_leida.${k}`, v)
