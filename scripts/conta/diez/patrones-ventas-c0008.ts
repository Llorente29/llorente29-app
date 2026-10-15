// scripts/conta/diez/patrones-ventas-c0008.ts
//
// C06b · 15/10 · CÓMO NUMERA LA GESTORÍA LAS FACTURAS DIARIAS DE GLOVO Y DE
// JUST EAT EN C0008, SOLO LEYENDO.
//
// El asiento 1803 (Ventas Glovo · Alcalá, 01/10) se validó y no llegó a Diez:
// «la plataforma «glovo» no tiene su patrón de factura medido en Diez». Solo
// estaba medido el de Uber (UBR-<grupo>-<AAAAMMDD>, «UBER EATS <grupo> dd/mm»,
// la 43000002). Aquí se mide el de Glovo (43000001) y el de Just Eat
// (43000003) en las facturas que la gestoría ya ha metido en C0008, con Uber
// como testigo de que la medida está bien hecha.
//
// Frenos:
//   · el cliente se crea con escribir: false: no puede escribir nada;
//   · TODA la salida es «@@ clave número|huella» y pasa por
//     scripts/conta/salida-segura.mjs: ni números de factura, ni descripciones,
//     ni nombres, ni importes. Las formas salen como HUELLA (md5, 16 cifras) y
//     se descifran fuera comparándolas con las candidatas (formaHuella abajo).
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/patrones-ventas-c0008.ts
import { createHash } from 'node:crypto'
import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0008'
const PLATAFORMAS = { glovo: '43000001', uber: '43000002', justeat: '43000003' } as const
const PREFIJOS = ['GLV', 'GLO', 'GLOVO', 'GL', 'JUS', 'JET', 'JE', 'JUST', 'JEAT', 'TKW', 'UBR']
const DESCRIPCIONES = ['GLOVO', 'GLOVOAPP', 'GLOVO APP', 'JUST EAT', 'JUSTEAT', 'JUST EAT TAKEAWAY', 'TAKEAWAY', 'UBER EATS']

/** La forma de un texto: cada cifra un 9 y cada letra una A. */
export const forma = (x: unknown) => String(x ?? '').toUpperCase().replace(/\d/g, '9').replace(/[A-ZÑÁÉÍÓÚÜ]/g, 'A')
/** Su huella publicable (16 cifras hexadecimales). */
export const formaHuella = (f: string) => createHash('md5').update(f).digest('hex').slice(0, 16)

const sale = (clave: string, valor: number | string) => process.stdout.write(`@@ ${clave} ${valor}\n`)
const seccion = (clave: string) => process.stdout.write(`@@ # ${clave}\n`)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { sale('falta_secreto', 1); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

const v = (f: Factura, k: string) => (f as Record<string, unknown>)[k]
await c.asegurarToken()
sale('entra_c0008', 1)

// Del mes más reciente hacia atrás, con 10 minutos como mucho.
const meses: string[] = []
for (let y = 2026; y >= 2025; y--) for (let m = 12; m >= 1; m--) if (y < 2026 || m <= 10) meses.push(`${y}${String(m).padStart(2, '0')}`)
const hasta = Date.now() + 10 * 60_000
const todas: Factura[] = []
let leidos = 0, sinContestar = 0
for (const m of meses) {
  if (Date.now() > hasta) break
  try { todas.push(...(await c.facturasDelMes(m))); leidos++ } catch { sinContestar++ }
}
const unicas = [...new Map(todas.map((f) => [`${f.Ejercicio}/${f.Serie}/${f.Documento}`, f])).values()]
seccion('lectura')
sale('meses_leidos', leidos); sale('meses_sin_contestar', sinContestar); sale('facturas_distintas', unicas.length)

for (const [plat, cuenta] of Object.entries(PLATAFORMAS)) {
  const xs = unicas.filter((f) => String(f.CuentaCliente ?? '') === cuenta)
  seccion(plat)
  sale(`${plat}.facturas`, xs.length)
  sale(`${plat}.serie_1`, xs.filter((f) => String(f.Serie) === '1').length)
  // El primer y el último mes en que hay (AAAAMM).
  const fechas = xs.map((f) => Number(String(v(f, 'FechaFactura') ?? v(f, 'Fecha') ?? '').slice(0, 6))).filter((n) => n > 0).sort()
  if (fechas.length) { sale(`${plat}.primer_mes`, fechas[0]); sale(`${plat}.ultimo_mes`, fechas.at(-1)!) }
  // Las formas del número, por huella (las 6 más vistas).
  const formas = new Map<string, number>()
  for (const f of xs) { const h = formaHuella(forma(v(f, 'NumeroFactura'))); formas.set(h, (formas.get(h) ?? 0) + 1) }
  ;[...formas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([h, n], i) => { sale(`${plat}.forma${i + 1}.huella`, h); sale(`${plat}.forma${i + 1}.n`, n) })
  sale(`${plat}.formas_distintas`, formas.size)
  // Prefijos candidatos: el número empieza por «PREFIJO-».
  for (const p of PREFIJOS) {
    const n = xs.filter((f) => String(v(f, 'NumeroFactura') ?? '').toUpperCase().startsWith(`${p}-`)).length
    if (n) sale(`${plat}.prefijo_${p.toLowerCase()}`, n)
  }
  // La regla de Uber con otro prefijo: PREFIJO-GRUPO-AAAAMMDD, con la fecha de la factura.
  const regla = /^([A-Z]+)-([A-Z]{3})-(\d{8})$/
  let cumple = 0, fechaIgual = 0
  const grupos = new Map<string, number>()
  const diaLocal = new Map<string, number>()
  for (const f of xs) {
    const m = regla.exec(String(v(f, 'NumeroFactura') ?? '').toUpperCase())
    if (!m) continue
    cumple++
    if (m[3] === String(v(f, 'FechaFactura') ?? '')) fechaIgual++
    grupos.set(m[2], (grupos.get(m[2]) ?? 0) + 1)
    diaLocal.set(`${m[2]}${m[3]}`, (diaLocal.get(`${m[2]}${m[3]}`) ?? 0) + 1)
  }
  sale(`${plat}.regla_prefijo_grupo_fecha`, cumple)
  sale(`${plat}.regla_fecha_es_la_de_factura`, fechaIgual)
  for (const [g, n] of grupos) sale(`${plat}.grupo_${g.toLowerCase()}`, n)
  sale(`${plat}.dia_local_repetido`, [...diaLocal.values()].filter((n) => n > 1).length)
  // La descripción: «DESCRIPCIÓN GRUPO dd/mm» con la descripción candidata.
  for (const d of DESCRIPCIONES) {
    const re = new RegExp(`^${d} [A-Z]{3} \\d{2}/\\d{2}$`)
    const n = xs.filter((f) => re.test(String(v(f, 'Descripcion') ?? '').toUpperCase().trim())).length
    if (n) sale(`${plat}.descripcion_${d.toLowerCase().replace(/ /g, '_')}`, n)
  }
  const fdesc = new Map<string, number>()
  for (const f of xs) { const h = formaHuella(forma(v(f, 'Descripcion'))); fdesc.set(h, (fdesc.get(h) ?? 0) + 1) }
  ;[...fdesc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([h, n], i) => { sale(`${plat}.descripcion_forma${i + 1}.huella`, h); sale(`${plat}.descripcion_forma${i + 1}.n`, n) })
  // Lo demás de la cabecera que Folvy rellena igual que en Uber.
  for (const k of ['TipoAsiento', 'TipoFactura', 'PorcentajeIVA1']) {
    const vals = new Map<string, number>()
    for (const f of xs) { const x = String(v(f, k) ?? 'null'); vals.set(x, (vals.get(x) ?? 0) + 1) }
    for (const [x, n] of vals) if (/^-?\d+$/.test(x)) sale(`${plat}.${k.toLowerCase()}_${x.replace('-', 'm')}`, n)
  }
}
sale('peticiones', c.metrica.peticiones)
