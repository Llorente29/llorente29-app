// scripts/conta/diez/adjuntos-swagger.mjs
//
// C04b · R14 · Lo que dice el Swagger PÚBLICO de apiCON sobre los ADJUNTOS,
// antes de subir el primer PDF a una factura. Sin credenciales y sin tocar
// ningún dato: solo lee la definición.
// Imprime, de cada operación cuya ruta habla de ficheros o documentos
// (upload, file, documento, adjunto, gestion): método, ruta, parámetros
// (dónde, tipo, obligatorio), cuerpo y respuestas, con sus modelos abiertos.
//
//   node scripts/conta/diez/adjuntos-swagger.mjs [base]

const BASE = (process.argv[2] || 'https://apicon.diezsoftware.com').replace(/\/$/, '')
const CANDIDATAS = ['/swagger/docs/v1', '/swagger/v1/swagger.json', '/swagger/v2/swagger.json', '/swagger/swagger.json', '/swagger.json']

let doc = null
for (const c of CANDIDATAS) {
  try {
    const r = await fetch(BASE + c, { headers: { accept: 'application/json' } })
    if (r.ok) { doc = await r.json(); console.log(`Swagger: ${c} (${r.status})`); break }
  } catch { /* la siguiente */ }
}
if (!doc) { console.log('**No se ha podido leer el Swagger.**'); process.exit(1) }

const defs = doc.definitions ?? doc.components?.schemas ?? {}
const nombre = (ref) => String(ref).split('/').pop()
const vistos = new Set()
const modelo = (n, sangria = '  ') => {
  if (vistos.has(n) || !defs[n]) return []
  vistos.add(n)
  const d = defs[n]
  const req = new Set(d.required ?? [])
  const l = [`${sangria}- **${n}** (${d.type ?? 'object'})`]
  const hijos = []
  for (const [k, p] of Object.entries(d.properties ?? {})) {
    const ref = p.$ref ?? p.items?.$ref
    const t = ref ? `${p.type === 'array' ? 'lista de ' : ''}${nombre(ref)}` : `${p.type ?? '?'}${p.format ? `/${p.format}` : ''}${p.maxLength ? ` máx ${p.maxLength}` : ''}`
    l.push(`${sangria}  - ${k}: ${t}${req.has(k) ? ' (obligatorio)' : ''}${p.description ? ` — ${p.description}` : ''}`)
    if (ref) hijos.push(nombre(ref))
  }
  for (const h of hijos) l.push(...modelo(h, sangria + '  '))
  return l
}

const RUTA = /upload|file|documento|adjunt|gestion|digital/i
const ops = []
for (const [ruta, metodos] of Object.entries(doc.paths ?? {})) {
  for (const [m, op] of Object.entries(metodos)) {
    if (!RUTA.test(ruta) && !RUTA.test(op.operationId ?? '')) continue
    ops.push([ruta, m, op])
  }
}
console.log(`\n## Operaciones de ficheros y documentos: ${ops.length}\n`)
for (const [ruta, m, op] of ops) {
  console.log(`### ${m.toUpperCase()} ${ruta}${op.operationId ? ` (${op.operationId})` : ''}`)
  if (op.summary || op.description) console.log(`- ${op.summary ?? ''} ${op.description ?? ''}`.trim())
  console.log(`- consumes: ${(op.consumes ?? doc.consumes ?? []).join(', ') || '—'} · produces: ${(op.produces ?? doc.produces ?? []).join(', ') || '—'}`)
  for (const p of op.parameters ?? []) {
    const ref = p.schema?.$ref ?? p.schema?.items?.$ref
    console.log(`- parámetro ${p.name} en ${p.in}: ${ref ? nombre(ref) : `${p.type ?? p.schema?.type ?? '?'}${p.format ? `/${p.format}` : ''}`}${p.required ? ' (obligatorio)' : ''}${p.description ? ` — ${p.description}` : ''}`)
    if (ref) console.log(modelo(nombre(ref)).join('\n'))
  }
  if (op.requestBody) console.log(`- requestBody: ${JSON.stringify(op.requestBody).slice(0, 400)}`)
  for (const [cod, r] of Object.entries(op.responses ?? {})) {
    const ref = r.schema?.$ref ?? r.schema?.items?.$ref
    console.log(`- respuesta ${cod}: ${ref ? nombre(ref) : r.schema?.type ?? '—'}${r.description ? ` — ${r.description}` : ''}`)
    if (ref) console.log(modelo(nombre(ref)).join('\n'))
  }
  console.log('')
}
