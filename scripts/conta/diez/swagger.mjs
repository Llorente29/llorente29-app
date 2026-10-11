// scripts/conta/diez/swagger.mjs
//
// C04b · T1 · Lo que dice el Swagger de apiCON (Diez), leído y resumido.
// Público y SIN credenciales: no toca ningún dato de nadie. Lo corre el
// workflow diez-lectura.yml (el contenedor de desarrollo no tiene salida a
// apicon.diezsoftware.com). Escribe en la salida estándar un Markdown con:
//   · cuántas operaciones hay, por recurso y por método;
//   · cada operación: método, ruta y sus parámetros (dónde, tipo, obligatorio);
//   · el detalle de los modelos que importan al encargo (apuntes, asiento,
//     facturas, subcuentas y sumas y saldos, series, ejercicios, token) y de
//     todo lo que esos modelos nombran;
//   · el cuerpo y las respuestas de POST /api/apuntes/add, entero.
// Y guarda el JSON original en el fichero que se le pase (artefacto del run).
//
//   node scripts/conta/diez/swagger.mjs [base] [salida.json]

import { writeFileSync } from 'node:fs'

const BASE = (process.argv[2] || 'https://apicon.diezsoftware.com').replace(/\/$/, '')
const SALIDA = process.argv[3] || null
const CANDIDATAS = ['/swagger/docs/v1', '/swagger/v1/swagger.json', '/swagger/v2/swagger.json', '/swagger/swagger.json', '/swagger.json', '/api-docs']

async function traer() {
  const vistos = []
  for (const c of CANDIDATAS) {
    const t0 = Date.now()
    try {
      const r = await fetch(BASE + c, { headers: { accept: 'application/json' } })
      const txt = await r.text()
      vistos.push(`${c} → ${r.status} (${txt.length} B, ${Date.now() - t0} ms)`)
      if (r.ok) {
        try { return { doc: JSON.parse(txt), de: c, vistos } } catch { /* no es JSON: la siguiente */ }
      }
    } catch (e) { vistos.push(`${c} → ${e.message}`) }
  }
  return { doc: null, de: null, vistos }
}

const { doc, de, vistos } = await traer()
const l = ['## Swagger de apiCON', '', `Base: \`${BASE}\``, '', 'Rutas probadas:', ...vistos.map((v) => `- ${v}`), '']
if (!doc) {
  l.push('**No se ha podido leer el Swagger en ninguna de las rutas.**')
  process.stdout.write(l.join('\n') + '\n')
  process.exit(1)
}
if (SALIDA) writeFileSync(SALIDA, JSON.stringify(doc, null, 1))

const v3 = !!doc.openapi
const defs = v3 ? (doc.components?.schemas ?? {}) : (doc.definitions ?? {})
const nombreRef = (ref) => String(ref).split('/').pop()
const tipo = (s) => {
  if (!s) return '—'
  if (s.$ref) return nombreRef(s.$ref)
  if (s.type === 'array') return `${tipo(s.items)}[]`
  return [s.type, s.format].filter(Boolean).join(':') + (s.enum ? ` (${s.enum.join('|')})` : '')
}
const ops = []
for (const [ruta, metodos] of Object.entries(doc.paths ?? {})) {
  for (const [m, op] of Object.entries(metodos)) {
    if (!['get', 'post', 'put', 'delete', 'patch'].includes(m)) continue
    const params = (op.parameters ?? []).map((p) => `${p.name}${p.required ? '*' : ''} (${p.in}${p.in === 'body' ? ' ' + tipo(p.schema) : ' ' + tipo(p.schema ?? p)})`)
    if (v3 && op.requestBody) {
      const c = op.requestBody.content ?? {}
      for (const [mt, x] of Object.entries(c)) params.push(`cuerpo ${mt} ${tipo(x.schema)}`)
    }
    const resp = Object.entries(op.responses ?? {}).map(([k, x]) => `${k}${x.schema ? ' ' + tipo(x.schema) : ''}${v3 && x.content ? ' ' + Object.values(x.content).map((y) => tipo(y.schema)).join('/') : ''}`)
    ops.push({ m: m.toUpperCase(), ruta, recurso: ruta.split('/')[2] ?? ruta, params, resp, tags: op.tags ?? [] })
  }
}
l.push(`Versión: ${v3 ? 'OpenAPI ' + doc.openapi : 'Swagger ' + doc.swagger} · título: ${doc.info?.title ?? '—'} · versión de la API: ${doc.info?.version ?? '—'} · leído de \`${de}\``, '')
l.push(`**${ops.length} operaciones**; por método: ${Object.entries(ops.reduce((a, o) => ((a[o.m] = (a[o.m] ?? 0) + 1), a), {})).map(([k, n]) => `${k} ${n}`).join(' · ')}`, '')
l.push(`Seguridad declarada: \`${JSON.stringify(doc.securityDefinitions ?? doc.components?.securitySchemes ?? {})}\``, '')

l.push('### Operaciones', '', '| Método | Ruta | Parámetros (* obligatorio) | Respuestas |', '|---|---|---|---|')
for (const o of ops.sort((a, b) => a.ruta.localeCompare(b.ruta) || a.m.localeCompare(b.m))) {
  l.push(`| ${o.m} | \`${o.ruta}\` | ${o.params.join('<br>') || '—'} | ${o.resp.join(', ')} |`)
}

// Los modelos que importan y todo lo que nombran.
const interes = /apunte|asiento|detalle|factura|subcuenta|saldo|serie|ejercicio|empresa|analit|vencim|token|cliente|proveedor|adjunto|document/i
const pendientes = Object.keys(defs).filter((k) => interes.test(k))
const hechos = new Set()
l.push('', '### Modelos', '')
while (pendientes.length) {
  const k = pendientes.shift()
  if (hechos.has(k) || !defs[k]) continue
  hechos.add(k)
  const s = defs[k]
  l.push(`#### \`${k}\``, '', '| Campo | Tipo | Obligatorio | Otros |', '|---|---|---|---|')
  const req = new Set(s.required ?? [])
  for (const [c, p] of Object.entries(s.properties ?? {})) {
    const otros = ['maxLength', 'minLength', 'maximum', 'minimum', 'pattern', 'default', 'nullable', 'readOnly'].filter((x) => p[x] !== undefined).map((x) => `${x}=${JSON.stringify(p[x])}`).join(' ')
    l.push(`| ${c} | ${tipo(p)} | ${req.has(c) ? 'sí' : ''} | ${otros} |`)
    const refs = [p.$ref, p.items?.$ref].filter(Boolean).map(nombreRef)
    for (const r of refs) if (!hechos.has(r)) pendientes.push(r)
  }
  l.push('')
}
const resto = Object.keys(defs).filter((k) => !hechos.has(k))
l.push(`Otros modelos (${resto.length}): ${resto.map((k) => `\`${k}\``).join(', ')}`, '')

// La escritura de apuntes, entera.
const add = Object.entries(doc.paths ?? {}).filter(([r]) => /apuntes\/add/i.test(r))
l.push('### POST /api/apuntes/add, tal cual', '', '```json', JSON.stringify(Object.fromEntries(add), null, 1), '```')
process.stdout.write(l.join('\n') + '\n')
