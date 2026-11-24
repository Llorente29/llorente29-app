// scripts/conta/e10/servir.mts
//
// E10 · Sirve un ocr-albaran (el de la rama o una copia del de main) en local, en el puerto 8000,
// con supabase-js de mentira (supabaseFalso.ts, por el mapa mapa.json). Las llamadas al modelo:
//   · E10_MODO=grabado: no salen; contesta la respuesta guardada de ese fichero y ese prompt
//     (E10_GRABADAS: {clave: respuesta}), la misma para main y para la rama (regla 31);
//   · E10_MODO=falso: no salen; un modelo de mentira para probar el camino sin gastar: la lectura
//     entera llega cortada, la cabecera trae una factura de 100 € y cada página una línea de 20 €;
//   · E10_MODO=real: salen al modelo de verdad (ANTHROPIC_API_KEY), y se apunta en E10_USO lo
//     que gasta cada una (tokens de entrada y salida, y por qué paró), sin el contenido.
//
//   deno run -A --no-config --import-map=scripts/conta/e10/mapa.json scripts/conta/e10/servir.mts <index.ts>

const indice = Deno.args[0]
const modo = Deno.env.get('E10_MODO') ?? 'grabado'
const grabadas: Record<string, unknown> = modo === 'grabado' ? JSON.parse(Deno.readTextFileSync(Deno.env.get('E10_GRABADAS')!)) : {}
const uso = Deno.env.get('E10_USO') ?? ''
const original = globalThis.fetch

/** La clave de una llamada: el principio de su primer bloque (el fichero) y su prompt. */
async function clave(cuerpo: { messages: { content: { type: string; source?: { data: string }; text?: string }[] }[] }): Promise<string> {
  const partes = cuerpo.messages[0].content
  const datos = partes.find((p) => p.source)?.source?.data ?? ''
  const texto = partes.find((p) => p.type === 'text')?.text ?? ''
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(datos + '\u0000' + texto))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

globalThis.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
  if (!url.startsWith('https://api.anthropic.com/')) return original(entrada, init)
  const cuerpo = JSON.parse(String(init?.body ?? '{}'))
  const k = await clave(cuerpo)
  if (modo === 'falso') {
    const texto = cuerpo.messages[0].content.find((p: { type: string }) => p.type === 'text')?.text ?? ''
    const json = (o: unknown, stop = 'end_turn') => new Response(JSON.stringify({ stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(o) }] }), { status: 200 })
    if (/SOLO LA CABECERA/.test(texto)) {
      return json({ document: { supplier_name: 'Proveedor de mentira', supplier_tax_id: 'B00000000', doc_number: 'F-1', doc_date: '2026-10-31', doc_type: 'factura', handwritten: false, tax_base_total: 100, tax_total: 10, grand_total: 110 },
        lines: [], lines_expected: 5, pages: 5, confidence: 0.9, factura: { invoice_kind: 'completa', tax_breakdown: [{ vat_pct: 10, base: 100, vat_amount: 10 }] } })
    }
    if (/SOLO LAS LÍNEAS DE UN TROZO/.test(texto)) {
      const pag = Number(texto.match(/te paso la página (\d+)/)?.[1] ?? 0)
      return json({ lines: [{ raw_text: `Línea de la página ${pag}`, quantity: 1, unit_price_net: 20, line_amount: 20, vat_pct: 10, lot_code: `L${pag}` }] })
    }
    return new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"document": {' }] }), { status: 200 })
  }
  if (modo === 'grabado') {
    const r = grabadas[k]
    if (!r) return new Response(JSON.stringify({ error: { message: `sin grabar: ${k.slice(0, 12)}` } }), { status: 599 })
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const t0 = Date.now()
  const r = await original(entrada, init)
  const copia = r.clone()
  if (uso) {
    const j = await copia.json().catch(() => null) as { stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } } | null
    const texto = cuerpo.messages[0].content.find((p: { type: string }) => p.type === 'text')?.text ?? ''
    const paso = /SOLO LA CABECERA/.test(texto) ? 'cabecera' : /SOLO LAS LÍNEAS DE UN TROZO/.test(texto) ? 'lineas' : 'entera'
    Deno.writeTextFileSync(uso, JSON.stringify({ paso, http: r.status, stop: j?.stop_reason ?? null, entrada: j?.usage?.input_tokens ?? null, salida: j?.usage?.output_tokens ?? null, ms: Date.now() - t0 }) + '\n', { append: true })
  }
  return r
}

await import(new URL(indice, `file://${Deno.cwd()}/`).href)
