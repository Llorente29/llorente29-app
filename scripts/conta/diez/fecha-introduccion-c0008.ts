// scripts/conta/diez/fecha-introduccion-c0008.ts
//
// B01r26 (15/11) · LA «FECHA INTRODUCCIÓN» DE LAS RECIBIDAS DE OCTUBRE EN LA C0008.
// SOLO LEE (escribir: false). Las recibidas importadas por Excel con fecha de
// factura anterior al 01/10 quedaron con FechaIntroduccionFactura = fecha de
// factura (p. ej. 30/06), aunque la fecha del asiento y la fiscal sean 01/10.
// Julio quiere que el registro diga la misma fecha que aplica. Esto mide, antes
// de escribir nada:
//   1. Cuáles son: las de la serie 2 con fecha de asiento en octubre y fecha de
//      factura anterior al 01/10/2026; de cada una, su documento y todas sus
//      fechas (las claves que empiezan por «Fecha», como AAAAMMDD).
//   2. La 2/3443 entera, por nombres de campo y su tipo (ningún valor que no sea
//      una fecha), y el cuerpo que se mandaría con solo FechaIntroduccionFactura
//      = 20261001: qué campos cambian (tiene que ser uno).
//   3. El Swagger público de apiCON (sin credenciales): qué operaciones hay para
//      cambiar una factura (PUT/PATCH en /api/facturas…) y qué campos pide su
//      cuerpo, contra los que trae la 2/3443 (lo que no pide se perdería).
// Por la puerta de salida: claves, documentos y fechas como enteros; ningún
// importe, ningún texto, ningún número de factura ni NIF.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/fecha-introduccion-c0008.ts

import { ClienteDiez, ErrorDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const sale = (k: string, v: number | string) => console.log(`@@ ${k} ${typeof v === 'number' ? Math.trunc(v) : v}`)
const seccion = (t: string) => console.log(`@@ # ${t}`)
/** Un nombre de campo o de ruta como clave de la puerta: minúsculas, cifras, «_» y «.». */
const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9_.]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { sale('sin_secreto', 1); process.exit(1) }

const CORTE = 20261001
const NUEVA = 20261001
const UNA = 3443
const tipo = (v: unknown) => v === null || v === undefined ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : Array.isArray(v) ? 4 : 5
/** Una fecha de Diez como AAAAMMDD entero (número AAAAMMDD, o texto ISO «2026-06-30T00:00:00»); si no lo es, null. */
function fecha(v: unknown): number | null {
  if (typeof v === 'number' && v > 19000101 && v < 21000101) return Math.trunc(v)
  if (typeof v === 'string') { const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v); if (m) return Number(m[1] + m[2] + m[3]) }
  return null
}
let f3443: Record<string, unknown> | undefined
type Esquema = { $ref?: string; properties?: Record<string, unknown>; required?: string[] }
type Op = { parameters?: { in?: string; schema?: Esquema }[]; requestBody?: { content?: Record<string, { schema?: Esquema }> } }
type Swagger = { paths?: Record<string, Record<string, Op>>; definitions?: Record<string, Esquema>; components?: { schemas?: Record<string, Esquema> } }
const camposFecha = (f: Record<string, unknown>) => Object.keys(f).filter((x) => /^fecha/i.test(x)).sort()

let g: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: 'C0008',
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

try {
  await c.asegurarToken()
  const { facturas, diasSinLeer, como } = await c.facturasDelMesComoSePueda('202610')
  seccion('recibidas_de_octubre')
  sale('leidas_como_mes', como === 'mes' ? 1 : 0)
  sale('dias_sin_leer', diasSinLeer.length)
  const recibidas = facturas.filter((f) => String(f.Serie) === '2')
  sale('recibidas', recibidas.length)
  const viejas = recibidas.filter((f) => (fecha(f.FechaFactura) ?? CORTE) < CORTE).sort((a, b) => Number(a.Documento) - Number(b.Documento))
  sale('fecha_factura_antes_del_0110', viejas.length)
  const intro = (f: Factura) => fecha(f.FechaIntroduccionFactura)
  sale('de_ellas_introduccion_distinta_de_0110', viejas.filter((f) => intro(f) !== NUEVA).length)
  sale('de_ellas_introduccion_igual_a_fecha_factura', viejas.filter((f) => intro(f) !== null && intro(f) === fecha(f.FechaFactura)).length)
  sale('de_ellas_sin_introduccion', viejas.filter((f) => intro(f) === null).length)
  sale('de_ellas_fecha_asiento_0110', viejas.filter((f) => fecha(f.Fecha) === NUEVA).length)
  sale('de_ellas_documentos_3407_3436', viejas.filter((f) => Number(f.Documento) >= 3407 && Number(f.Documento) <= 3436).length)
  sale('de_ellas_documentos_3440_3443', viejas.filter((f) => Number(f.Documento) >= 3440 && Number(f.Documento) <= 3443).length)
  // Las fechas que tienen, todas las que empiezan por «Fecha», por documento.
  const nombres = [...new Set(viejas.flatMap((f) => camposFecha(f)))]
  nombres.forEach((n, i) => sale(`campo_fecha.${i + 1}.${k(n)}`, 1))
  seccion('una_a_una')
  for (const f of viejas) {
    const d = Number(f.Documento)
    for (const n of nombres) { const v = fecha(f[n]); sale(`d${d}.${k(n)}`, v ?? 0) }
  }

  // 2. La 2/3443 entera (por nombres y tipos) y lo que cambiaría.
  seccion('la_2_3443')
  const una = recibidas.filter((f) => Number(f.Documento) === UNA)
  sale('encontradas', una.length)
  if (una.length === 1) {
    const f = una[0] as Record<string, unknown>
    f3443 = f
    for (const n of Object.keys(f).sort()) {
      const v = f[n]
      sale(`campo.${k(n)}`, tipo(v))
      if (Array.isArray(v)) sale(`campo.${k(n)}.elementos`, v.length)
      const fe = fecha(v); if (fe !== null) sale(`fecha.${k(n)}`, fe)  // toda fecha, se llame como se llame (la fiscal puede no empezar por «Fecha»)
      if (typeof v === 'number' && /periodo|trimestre|mes|ejercicio/i.test(n)) sale(`numero.${k(n)}`, v)
    }
    const cuerpo: Record<string, unknown> = { ...f, FechaIntroduccionFactura: NUEVA }
    const cambian = Object.keys(cuerpo).filter((n) => JSON.stringify(cuerpo[n]) !== JSON.stringify(f[n]))
    sale('cuerpo.campos_que_cambian', cambian.length)
    cambian.forEach((n) => sale(`cuerpo.cambia.${k(n)}`, 1))
    sale('cuerpo.fecha_introduccion_antes', fecha(f.FechaIntroduccionFactura) ?? 0)
    sale('cuerpo.fecha_introduccion_despues', NUEVA)
    // Lo que trae el PDF (si lo trae, por su nombre de campo).
    Object.keys(f).filter((n) => n !== 'Documento' && /adjunt|document|archivo|fichero|url|pdf/i.test(n)).forEach((n) => sale(`adjunto.${k(n)}`, tipo(f[n])))
  }
} catch (e) {
  if (process.env.DEPURAR) console.error(e)
  sale("parado", e instanceof ErrorDiez ? e.status : 1)
  process.exit(1)
}

// 3. El Swagger público: qué hay para cambiar una factura. Sin credenciales.
seccion('swagger_facturas')
try {
  let doc: Swagger | null = null
  for (const ruta of ['/swagger/docs/v1', '/swagger/v1/swagger.json']) {
    const r = await fetch(String(cred.base_url || 'https://apicon.diezsoftware.com') + ruta, { headers: { accept: 'application/json' } })
    if (r.ok) { try { doc = (await r.json()) as Swagger; break } catch { /* la siguiente */ } }
  }
  if (!doc) { sale('sin_swagger', 1) } else {
    const defs: Record<string, Esquema> = doc.definitions ?? doc.components?.schemas ?? {}
    const deRef = (s: Esquema | undefined): Esquema | undefined => (s?.$ref ? defs[String(s.$ref).split('/').pop() as string] : s)
    const paths: Record<string, Record<string, Op>> = doc.paths ?? {}
    sale('rutas_de_facturas', Object.keys(paths).filter((p) => /^\/api\/facturas/i.test(p)).length)
    for (const [p, ops] of Object.entries(paths)) {
      if (!/^\/api\/facturas/i.test(p)) continue
      for (const [m, op] of Object.entries(ops)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue
        sale(`op.${m}.${k(p.replace(/^\/api\//, ''))}`, 1)
        if (m !== 'put' && m !== 'patch') continue
        const cuerpoParam = (op.parameters ?? []).find((x) => x.in === 'body')
        const esquema = deRef(cuerpoParam?.schema ?? op.requestBody?.content?.['application/json']?.schema)
        const props = Object.keys(esquema?.properties ?? {})
        sale(`op.${m}.${k(p.replace(/^\/api\//, ''))}.campos`, props.length)
        const req = new Set<string>(esquema?.required ?? [])
        for (const n of props) sale(`op.${m}.${k(p.replace(/^\/api\//, '')).slice(0, 14)}.${k(n)}`, req.has(n) ? 2 : 1)
        if (f3443) sale(`op.${m}.${k(p.replace(/^\/api\//, '')).slice(0, 14)}.campos_de_3443_que_no_pide`, Object.keys(f3443).filter((n) => !props.includes(n)).length)
      }
    }
  }
} catch { sale('swagger_fallo', 1) }
sale('peticiones', c.metrica.peticiones)
