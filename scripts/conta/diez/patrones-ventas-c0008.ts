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
// Primera pasada (run 38700752691): Uber, 55 de 72 UBR-GRUPO-FECHA; Just Eat,
// 18 JUS-GRUPO-FECHA y 21 de 7 cifras; Glovo, ninguna con prefijo y guion:
// 137 con la forma «AAA999999-99999999» y 33 «A999999999999999». Esta segunda
// mira, por forma, de qué meses es cada una (cuál es la de ahora) y, en la de
// Glovo, qué son las tres letras, las seis cifras y las ocho.
//
// Frenos:
//   · el cliente se crea con escribir: false: no puede escribir nada;
//   · TODA la salida es «@@ clave número|huella» y pasa por
//     scripts/conta/salida-segura.mjs: ni números de factura, ni descripciones,
//     ni nombres, ni importes. Lo que hace falta saber sale como HUELLA (md5,
//     16 cifras) y se descifra fuera comparándola con las candidatas.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/patrones-ventas-c0008.ts
import { createHash } from 'node:crypto'
import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0008'
const PLATAFORMAS = { glovo: '43000001', uber: '43000002', justeat: '43000003' } as const
const GRUPOS = ['FLO', 'CAM', 'CAN']

/** La forma de un texto: cada cifra un 9 y cada letra una A. */
export const forma = (x: unknown) => String(x ?? '').toUpperCase().replace(/\d/g, '9').replace(/[A-ZÑÁÉÍÓÚÜ]/g, 'A')
/** Una huella publicable (16 cifras hexadecimales). */
export const huella = (f: string) => createHash('md5').update(f).digest('hex').slice(0, 16)

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

const v = (f: Factura, k: string) => String((f as Record<string, unknown>)[k] ?? '')
try { await c.asegurarToken() } catch (e) {
  // Solo el tipo y el código: el mensaje puede llevar texto de Diez.
  const x = e as { name?: string; status?: number }
  sale('entra_c0008', 0)
  sale(`error_${String(x.name ?? 'error').toLowerCase().replace(/[^a-z]/g, '')}`, Number(x.status ?? 0))
  process.exit(1)
}
sale('entra_c0008', 1)

// Tercera pasada (Julio, 15/10, Glovo «una por local y día»): ¿hay facturas de
// Glovo con la forma de la gestoría (GLV999999-AAAAMMDD) con fecha de factura
// desde el 01/10? Si hay alguna, la de Folvy las duplicaría: se para. Y, de
// julio a septiembre, cuántas hay por local y mes (la suma va aparte).
const meses = ['202610', '202609', '202608', '202607']
const todas: Factura[] = []
let leidos = 0, sinContestar = 0
for (const m of meses) {
  try { todas.push(...(await c.facturasDelMes(m))); leidos++ } catch { sinContestar++ }
}
const unicas = [...new Map(todas.map((f) => [`${f.Ejercicio}/${f.Serie}/${f.Documento}`, f])).values()]
seccion('lectura')
sale('meses_leidos', leidos); sale('meses_sin_contestar', sinContestar); sale('facturas_distintas', unicas.length)

const g1 = /^GLV(\d{6})-(\d{8})$/
const grupoDe = (f: Factura) => GRUPOS.find((gr) => new RegExp(`\\b${gr}\\b`).test(v(f, 'Descripcion').toUpperCase())) ?? 'ninguno'
const glovo = unicas.filter((f) => v(f, 'CuentaCliente') === PLATAFORMAS.glovo)
seccion('glovo_desde_octubre')
sale('glovo.total_leidas', glovo.length)
const desdeOct = glovo.filter((f) => Number(v(f, 'FechaFactura')) >= 20261001)
sale('glovo.fecha_factura_desde_20261001', desdeOct.length)
sale('glovo.desde_20261001_forma_gestoria', desdeOct.filter((f) => g1.test(v(f, 'NumeroFactura').toUpperCase())).length)
sale('glovo.desde_20261001_forma_glv_grupo_fecha', desdeOct.filter((f) => /^GLV-[A-Z]{3}-\d{8}$/.test(v(f, 'NumeroFactura').toUpperCase())).length)
// Por local y día (si hay alguna): grupo y AAAAMMDD son claves, no datos.
const porDia = new Map<string, number>()
for (const f of desdeOct) { const k = `glovo.oct.${grupoDe(f).toLowerCase()}_${v(f, 'FechaFactura')}`; porDia.set(k, (porDia.get(k) ?? 0) + 1) }
for (const [k, n] of porDia) sale(k, n)
// ¿Alguna con fecha de asiento en octubre y fecha de factura de antes? (la búsqueda filtra por la del asiento)
sale('glovo.asiento_oct_factura_antes', glovo.filter((f) => Number(v(f, 'Fecha')) >= 20261001 && Number(v(f, 'FechaFactura')) < 20261001).length)

seccion('glovo_julio_septiembre_por_local_y_mes')
for (const f of glovo) {
  const ff = Number(v(f, 'FechaFactura'))
  if (ff < 20260701 || ff >= 20261001) continue
  const k = `glovo.${String(ff).slice(0, 6)}.${grupoDe(f).toLowerCase()}`
  porDia.set(k, (porDia.get(k) ?? 0) + 1)
}
for (const [k, n] of [...porDia].filter(([k]) => !k.startsWith('glovo.oct.')).sort()) sale(k, n)
sale('peticiones', c.metrica.peticiones)
